//! Demand-based issuance pricing (#1137). The price grows by `step_bps`
//! of `base_price` for each issuance in the current time window, capped at
//! `max_price`, and resets when a new window starts.
use crate::{require_admin, DataKey, ExtError};
use soroban_sdk::{contracttype, symbol_short, token, Address, Env};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PricingConfig {
    pub token: Address,
    pub treasury: Address,
    pub base_price: i128,
    /// Price increase per issuance in the window, in basis points of base.
    pub step_bps: u32,
    pub max_price: i128,
    /// Demand window length in seconds.
    pub window: u64,
}

pub fn set_pricing(
    env: &Env,
    token: Address,
    treasury: Address,
    base_price: i128,
    step_bps: u32,
    max_price: i128,
    window: u64,
) -> Result<(), ExtError> {
    require_admin(env)?;
    if base_price < 0 || max_price < base_price || window == 0 {
        return Err(ExtError::InvalidPricing);
    }
    let cfg = PricingConfig { token, treasury, base_price, step_bps, max_price, window };
    env.storage().instance().set(&DataKey::Pricing, &cfg);
    Ok(())
}

pub fn get_pricing(env: &Env) -> Option<PricingConfig> {
    env.storage().instance().get(&DataKey::Pricing)
}

fn window_id(env: &Env, cfg: &PricingConfig) -> u64 {
    env.ledger().timestamp() / cfg.window
}

fn demand(env: &Env, cfg: &PricingConfig) -> u32 {
    env.storage()
        .temporary()
        .get(&DataKey::Demand(window_id(env, cfg)))
        .unwrap_or(0)
}

fn price_for(cfg: &PricingConfig, demand: u32) -> i128 {
    let increase = cfg
        .base_price
        .saturating_mul(cfg.step_bps as i128)
        .saturating_mul(demand as i128)
        / 10_000;
    cfg.base_price.saturating_add(increase).min(cfg.max_price)
}

pub fn current_price(env: &Env) -> Result<i128, ExtError> {
    let cfg = get_pricing(env).ok_or(ExtError::InvalidPricing)?;
    Ok(price_for(&cfg, demand(env, &cfg)))
}

/// Charges `payer` the current price (rejecting if above `max_price`, to
/// protect against front-running) and records one unit of demand.
pub fn pay(env: &Env, payer: Address, max_price: i128) -> Result<i128, ExtError> {
    payer.require_auth();
    let cfg = get_pricing(env).ok_or(ExtError::InvalidPricing)?;
    let count = demand(env, &cfg);
    let price = price_for(&cfg, count);
    if price > max_price {
        return Err(ExtError::InsufficientPayment);
    }
    if price > 0 {
        token::Client::new(env, &cfg.token).transfer(&payer, &cfg.treasury, &price);
    }
    let key = DataKey::Demand(window_id(env, &cfg));
    env.storage().temporary().set(&key, &(count + 1));
    let ttl = (cfg.window / 5).clamp(1, u32::MAX as u64) as u32;
    env.storage().temporary().extend_ttl(&key, ttl, ttl);
    env.events().publish((symbol_short!("price"), payer), price);
    Ok(price)
}
