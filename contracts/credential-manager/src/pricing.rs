//! Issue #1128: dynamic pricing for credential issuance.
//!
//! Price per credential follows a linear bonding curve over the issuer's
//! total sold count, then reputation, bulk-tier and promo-code discounts are
//! applied (in basis points, combined additively and capped at 100%).
//! Payments are split among configured recipients and can be refunded by the
//! issuer within a configurable window.

use soroban_sdk::{contractimpl, contracttype, symbol_short, token, Address, Env, Symbol, Vec};

use crate::{ContractError, CredentialManager, EVENT_VERSION};

const BPS: i128 = 10_000;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PricingConfig {
    pub token: Address,
    pub base_price: i128,
    /// Price increase per credential already sold (bonding-curve slope).
    pub slope: i128,
    /// (min_quantity, discount_bps), any order.
    pub bulk_tiers: Vec<(u32, u32)>,
    /// (recipient, share_bps); shares must sum to 10_000.
    pub splits: Vec<(Address, u32)>,
    pub refund_window_secs: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Purchase {
    pub buyer: Address,
    pub issuer: Address,
    pub quantity: u32,
    pub amount: i128,
    pub timestamp: u64,
    pub refunded: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct RevenueStats {
    pub gross: i128,
    pub refunded: i128,
    pub purchases: u32,
    pub units_sold: u32,
}

#[contracttype]
#[derive(Clone)]
enum PriceKey {
    Config(Address),
    Sold(Address),
    RepDiscount(Address),
    Promo(Address, Symbol),
    Purchase(u64),
    PurchaseSeq,
    Revenue(Address),
}

impl CredentialManager {
    fn price_config(env: &Env, issuer: &Address) -> Result<PricingConfig, ContractError> {
        env.storage().persistent().get(&PriceKey::Config(issuer.clone())).ok_or(ContractError::NotFound)
    }

    fn price_quote_internal(
        env: &Env,
        cfg: &PricingConfig,
        issuer: &Address,
        buyer: &Address,
        quantity: u32,
        promo: &Option<Symbol>,
    ) -> Result<i128, ContractError> {
        if quantity == 0 {
            return Err(ContractError::InvalidInput);
        }
        let sold: u32 = env.storage().persistent().get(&PriceKey::Sold(issuer.clone())).unwrap_or(0);
        // Sum of linear curve over [sold, sold + quantity).
        let q = quantity as i128;
        let gross = cfg.base_price * q + cfg.slope * (q * sold as i128 + q * (q - 1) / 2);

        let mut disc: u32 = env.storage().persistent().get(&PriceKey::RepDiscount(buyer.clone())).unwrap_or(0);
        let mut bulk = 0;
        for (min_q, bps) in cfg.bulk_tiers.iter() {
            if quantity >= min_q && bps > bulk {
                bulk = bps;
            }
        }
        disc += bulk;
        if let Some(code) = promo {
            disc += env
                .storage()
                .persistent()
                .get::<_, u32>(&PriceKey::Promo(issuer.clone(), code.clone()))
                .ok_or(ContractError::InvalidInput)?;
        }
        let disc = (disc as i128).min(BPS);
        Ok(gross * (BPS - disc) / BPS)
    }
}

#[contractimpl]
impl CredentialManager {
    pub fn set_pricing(env: Env, issuer: Address, config: PricingConfig) -> Result<(), ContractError> {
        issuer.require_auth();
        Self::require_issuer(&env, &issuer)?;
        let total: u32 = config.splits.iter().map(|(_, s)| s).sum();
        if config.base_price < 0 || config.slope < 0 || total as i128 != BPS {
            return Err(ContractError::InvalidInput);
        }
        env.storage().persistent().set(&PriceKey::Config(issuer), &config);
        Ok(())
    }

    /// Admin sets a reputation-based discount for a buyer (bps, max 10_000).
    pub fn set_reputation_discount(env: Env, buyer: Address, bps: u32) -> Result<(), ContractError> {
        Self::require_admin(&env)?;
        if bps as i128 > BPS {
            return Err(ContractError::InvalidInput);
        }
        env.storage().persistent().set(&PriceKey::RepDiscount(buyer), &bps);
        Ok(())
    }

    /// Issuer creates (bps > 0) or deletes (bps == 0) a promo code.
    pub fn set_promo_code(env: Env, issuer: Address, code: Symbol, bps: u32) -> Result<(), ContractError> {
        issuer.require_auth();
        if bps as i128 > BPS {
            return Err(ContractError::InvalidInput);
        }
        let key = PriceKey::Promo(issuer, code);
        if bps == 0 {
            env.storage().persistent().remove(&key);
        } else {
            env.storage().persistent().set(&key, &bps);
        }
        Ok(())
    }

    pub fn quote_price(
        env: Env,
        issuer: Address,
        buyer: Address,
        quantity: u32,
        promo: Option<Symbol>,
    ) -> Result<i128, ContractError> {
        let cfg = Self::price_config(&env, &issuer)?;
        Self::price_quote_internal(&env, &cfg, &issuer, &buyer, quantity, &promo)
    }

    /// Pay for `quantity` credential issuances; returns the purchase id.
    pub fn purchase_issuance(
        env: Env,
        buyer: Address,
        issuer: Address,
        quantity: u32,
        promo: Option<Symbol>,
    ) -> Result<u64, ContractError> {
        buyer.require_auth();
        Self::require_not_paused(&env)?;
        let cfg = Self::price_config(&env, &issuer)?;
        let amount = Self::price_quote_internal(&env, &cfg, &issuer, &buyer, quantity, &promo)?;

        let tk = token::Client::new(&env, &cfg.token);
        let mut paid = 0i128;
        let n = cfg.splits.len();
        for (i, (to, bps)) in cfg.splits.iter().enumerate() {
            // Last recipient absorbs rounding dust.
            let share = if i as u32 + 1 == n { amount - paid } else { amount * bps as i128 / BPS };
            if share > 0 {
                tk.transfer(&buyer, &to, &share);
            }
            paid += share;
        }

        let sold_key = PriceKey::Sold(issuer.clone());
        let sold: u32 = env.storage().persistent().get(&sold_key).unwrap_or(0);
        env.storage().persistent().set(&sold_key, &(sold + quantity));

        let id: u64 = env.storage().instance().get(&PriceKey::PurchaseSeq).unwrap_or(0);
        env.storage().instance().set(&PriceKey::PurchaseSeq, &(id + 1));
        let purchase = Purchase {
            buyer, issuer: issuer.clone(), quantity, amount, timestamp: env.ledger().timestamp(), refunded: false,
        };
        env.storage().persistent().set(&PriceKey::Purchase(id), &purchase);

        let rev_key = PriceKey::Revenue(issuer.clone());
        let mut rev: RevenueStats = env.storage().persistent().get(&rev_key).unwrap_or_default();
        rev.gross += amount;
        rev.purchases += 1;
        rev.units_sold += quantity;
        env.storage().persistent().set(&rev_key, &rev);

        env.events().publish((symbol_short!("price"), symbol_short!("paid")), (EVENT_VERSION, id, issuer, amount));
        Ok(id)
    }

    /// Issuer refunds a purchase within the refund window, paying from its
    /// own balance.
    pub fn refund_purchase(env: Env, issuer: Address, purchase_id: u64) -> Result<(), ContractError> {
        issuer.require_auth();
        let key = PriceKey::Purchase(purchase_id);
        let mut p: Purchase = env.storage().persistent().get(&key).ok_or(ContractError::NotFound)?;
        if p.issuer != issuer {
            return Err(ContractError::Unauthorized);
        }
        let cfg = Self::price_config(&env, &issuer)?;
        if p.refunded || env.ledger().timestamp() > p.timestamp + cfg.refund_window_secs {
            return Err(ContractError::RefundWindowClosed);
        }
        if p.amount > 0 {
            token::Client::new(&env, &cfg.token).transfer(&issuer, &p.buyer, &p.amount);
        }
        p.refunded = true;
        env.storage().persistent().set(&key, &p);

        let rev_key = PriceKey::Revenue(issuer.clone());
        let mut rev: RevenueStats = env.storage().persistent().get(&rev_key).unwrap_or_default();
        rev.refunded += p.amount;
        env.storage().persistent().set(&rev_key, &rev);

        env.events().publish((symbol_short!("price"), symbol_short!("refund")), (EVENT_VERSION, purchase_id, p.amount));
        Ok(())
    }

    pub fn get_purchase(env: Env, purchase_id: u64) -> Result<Purchase, ContractError> {
        env.storage().persistent().get(&PriceKey::Purchase(purchase_id)).ok_or(ContractError::NotFound)
    }

    pub fn get_revenue_stats(env: Env, issuer: Address) -> RevenueStats {
        env.storage().persistent().get(&PriceKey::Revenue(issuer)).unwrap_or_default()
    }
}
