//! Deterministic reputation-decay curves.
//!
//! The contract stores integer scores, so every curve rounds down and clamps
//! at zero. Time is measured in seconds and only complete periods/steps are
//! applied. See `docs/reputation-decay.md` for the formulas and examples.

use soroban_sdk::contracttype;

/// The curve used for a subject's reputation score.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecayAlgorithm {
    /// Remove `rate_bps` of the original score for every complete period.
    Linear,
    /// Divide the score by two for every complete `half_life_secs` interval.
    Exponential,
    /// Apply one compounding reduction at every complete step.
    StepFunction,
    /// Do not decay the score.
    None,
}

/// Parameters for a subject-specific decay curve.
///
/// `rate_bps` is a fraction in basis points (`10_000` = 100%). For Linear it
/// is applied once per `period_secs`; for StepFunction it is applied once per
/// `step_size_secs`. Exponential uses `half_life_secs` and ignores `rate_bps`.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DecayParameters {
    pub algorithm: DecayAlgorithm,
    pub rate_bps: u32,
    pub half_life_secs: u64,
    pub step_size_secs: u64,
    pub period_secs: u64,
}

impl DecayParameters {
    pub const fn none() -> Self {
        Self {
            algorithm: DecayAlgorithm::None,
            rate_bps: 0,
            half_life_secs: 0,
            step_size_secs: 0,
            period_secs: 0,
        }
    }

    pub const fn linear(rate_bps: u32, period_secs: u64) -> Self {
        Self {
            algorithm: DecayAlgorithm::Linear,
            rate_bps,
            half_life_secs: 0,
            step_size_secs: 0,
            period_secs,
        }
    }

    pub const fn exponential(half_life_secs: u64) -> Self {
        Self {
            algorithm: DecayAlgorithm::Exponential,
            rate_bps: 0,
            half_life_secs,
            step_size_secs: 0,
            period_secs: 0,
        }
    }

    pub const fn step(rate_bps: u32, step_size_secs: u64) -> Self {
        Self {
            algorithm: DecayAlgorithm::StepFunction,
            rate_bps,
            half_life_secs: 0,
            step_size_secs,
            period_secs: 0,
        }
    }
}

pub const MAX_RATE_BPS: u32 = 10_000;
pub const MAX_PERIODS: u64 = 3_650;

/// Validates parameters before they are persisted by the contract.
pub fn validate(params: &DecayParameters) -> bool {
    if params.rate_bps > MAX_RATE_BPS {
        return false;
    }
    match params.algorithm {
        DecayAlgorithm::None => true,
        DecayAlgorithm::Linear => params.period_secs > 0,
        DecayAlgorithm::Exponential => params.half_life_secs > 0,
        DecayAlgorithm::StepFunction => params.step_size_secs > 0,
    }
}

/// Calculates the score at `elapsed_secs` after the score's last update.
pub fn calculate(score: i64, elapsed_secs: u64, params: &DecayParameters) -> i64 {
    if score <= 0 || elapsed_secs == 0 || !validate(params) {
        return score.max(0);
    }
    let raw = score as i128;
    let result = match params.algorithm {
        DecayAlgorithm::None => raw,
        DecayAlgorithm::Linear => {
            let periods = (elapsed_secs / params.period_secs).min(MAX_PERIODS) as i128;
            let removed = (params.rate_bps as i128 * periods).min(MAX_RATE_BPS as i128);
            raw - raw * removed / MAX_RATE_BPS as i128
        }
        DecayAlgorithm::Exponential => {
            let half_lives = (elapsed_secs / params.half_life_secs).min(MAX_PERIODS);
            let mut value = raw;
            for _ in 0..half_lives {
                value /= 2;
                if value == 0 {
                    break;
                }
            }
            value
        }
        DecayAlgorithm::StepFunction => {
            let steps = (elapsed_secs / params.step_size_secs).min(MAX_PERIODS);
            let retain = MAX_RATE_BPS as i128 - params.rate_bps as i128;
            let mut value = raw;
            for _ in 0..steps {
                value = value * retain / MAX_RATE_BPS as i128;
                if value == 0 {
                    break;
                }
            }
            value
        }
    };
    result.max(0).min(i64::MAX as i128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linear_is_bounded_and_saturates() {
        assert_eq!(
            calculate(100, 2 * 86_400, &DecayParameters::linear(1_000, 86_400)),
            80
        );
        assert_eq!(
            calculate(100, 20 * 86_400, &DecayParameters::linear(1_000, 86_400)),
            0
        );
    }

    #[test]
    fn exponential_uses_half_life() {
        assert_eq!(
            calculate(100, 86_400, &DecayParameters::exponential(86_400)),
            50
        );
        assert_eq!(
            calculate(100, 2 * 86_400, &DecayParameters::exponential(86_400)),
            25
        );
    }

    #[test]
    fn step_function_only_changes_at_boundaries() {
        let params = DecayParameters::step(1_000, 86_400);
        assert_eq!(calculate(100, 86_399, &params), 100);
        assert_eq!(calculate(100, 2 * 86_400, &params), 81);
    }

    #[test]
    fn none_is_identity() {
        assert_eq!(calculate(123, u64::MAX, &DecayParameters::none()), 123);
    }
}
