#![allow(dead_code)]

use soroban_sdk::contracttype;

/// Scaling factor for fixed-point arithmetic (1e18)
pub const SCALE: i128 = 1_000_000_000_000_000_000;

/// Configuration for the kinked interest rate model
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RateModelConfig {
    /// Annual base interest rate (scaled by 1e18)
    /// Example: 5% = 0.05 * 1e18 = 50_000_000_000_000_000
    pub base_rate: i128,
    
    /// Rate increase per utilization point before kink (scaled by 1e18)
    pub multiplier: i128,
    
    /// Rate increase per utilization point after kink (scaled by 1e18)
    pub jump_multiplier: i128,
    
    /// Utilization threshold where rate slope changes (scaled by 1e18)
    /// Example: 80% = 0.8 * 1e18 = 800_000_000_000_000_000
    pub kink: i128,
}

/// Result of interest rate calculation
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RateCalculationResult {
    /// Annual borrow interest rate (scaled by 1e18)
    pub borrow_rate: i128,
    
    /// Annual supply interest rate (scaled by 1e18)
    pub supply_rate: i128,
    
    /// Current utilization rate (scaled by 1e18)
    pub utilization_rate: i128,
}

/// Calculates the utilization rate of the lending pool
/// 
/// # Requirements
/// - Calculates utilization as total_borrows / (total_cash + total_borrows - total_reserves) - Requirement 1.4
/// - Returns 0 if denominator ≤ 0 (edge case handling)
/// 
/// # Arguments
/// * `total_cash` - Total liquid assets available for borrowing
/// * `total_borrows` - Total outstanding borrows
/// * `total_reserves` - Total protocol reserves
/// 
/// # Returns
/// * Utilization rate scaled by SCALE (1e18), where 1e18 = 100%
pub fn calculate_utilization_rate(
    total_cash: i128,
    total_borrows: i128,
    total_reserves: i128,
) -> i128 {
    // Calculate denominator: total_cash + total_borrows - total_reserves
    let denominator = total_cash + total_borrows - total_reserves;
    
    // Handle edge case: if denominator ≤ 0, return 0 utilization
    if denominator <= 0 {
        return 0;
    }
    
    // Calculate utilization rate using fixed-point arithmetic
    // utilization_rate = (total_borrows * SCALE) / denominator
    (total_borrows * SCALE) / denominator
}

/// Validates the rate model configuration
/// 
/// # Requirements
/// - Validates kink_point is between 0 and SCALE (1e18) - Requirement 1.2
/// - Validates base_rate, multiplier, jump_multiplier are non-negative - Requirement 1.3
/// 
/// # Arguments
/// * `config` - The rate model configuration to validate
/// 
/// # Returns
/// * `Ok(())` if configuration is valid
/// * `Err(&'static str)` with error message if configuration is invalid
pub fn validate_config(config: &RateModelConfig) -> Result<(), &'static str> {
    // Validate kink_point is between 0 and SCALE (0% to 100%)
    if config.kink < 0 || config.kink > SCALE {
        return Err("InvalidKinkPoint: kink must be between 0 and SCALE (1e18)");
    }
    
    // Validate base_rate is non-negative
    if config.base_rate < 0 {
        return Err("NegativeRate: base_rate must be non-negative");
    }
    
    // Validate multiplier is non-negative
    if config.multiplier < 0 {
        return Err("NegativeRate: multiplier must be non-negative");
    }
    
    // Validate jump_multiplier is non-negative
    if config.jump_multiplier < 0 {
        return Err("NegativeRate: jump_multiplier must be non-negative");
    }
    
    Ok(())
}

/// Calculates the borrow interest rate based on utilization and rate model configuration
/// 
/// # Requirements
/// - When utilization ≤ kink: borrow_rate = base_rate + (utilization * multiplier) / SCALE - Requirement 1.5
/// - When utilization > kink: borrow_rate = base_rate + (kink * multiplier) / SCALE + ((utilization - kink) * jump_multiplier) / SCALE - Requirement 1.6
/// 
/// # Arguments
/// * `utilization_rate` - Current utilization rate (scaled by SCALE)
/// * `config` - The rate model configuration
/// 
/// # Returns
/// * Annual borrow interest rate (scaled by SCALE)
pub fn calculate_borrow_rate(
    utilization_rate: i128,
    config: &RateModelConfig,
) -> i128 {
    // Check if utilization is below or at the kink point
    if utilization_rate <= config.kink {
        // Below kink: base_rate + (utilization * multiplier) / SCALE
        config.base_rate + (utilization_rate * config.multiplier) / SCALE
    } else {
        // Above kink: base_rate + (kink * multiplier) / SCALE + ((utilization - kink) * jump_multiplier) / SCALE
        let rate_at_kink = config.base_rate + (config.kink * config.multiplier) / SCALE;
        let excess_utilization = utilization_rate - config.kink;
        rate_at_kink + (excess_utilization * config.jump_multiplier) / SCALE
    }
}

/// Calculates the supply interest rate that lenders earn
/// 
/// # Requirements
/// - Calculates supply_rate as (borrow_rate * utilization * (SCALE - reserve_factor)) / (SCALE * SCALE) - Requirement 2.2
/// - Returns 0 when utilization is zero - Requirement 2.3
/// - Ensures supply_rate ≤ borrow_rate - Requirement 2.4
/// 
/// # Arguments
/// * `borrow_rate` - Current borrow interest rate (scaled by SCALE)
/// * `utilization_rate` - Current utilization rate (scaled by SCALE)
/// * `reserve_factor` - Percentage of interest allocated to reserves (scaled by SCALE)
/// 
/// # Returns
/// * Annual supply interest rate (scaled by SCALE)
pub fn calculate_supply_rate(
    borrow_rate: i128,
    utilization_rate: i128,
    reserve_factor: i128,
) -> i128 {
    // Handle zero utilization case - no supply rate when nothing is borrowed
    if utilization_rate == 0 {
        return 0;
    }
    
    // Calculate supply rate: (borrow_rate * utilization * (SCALE - reserve_factor)) / (SCALE * SCALE)
    // To avoid overflow, we divide by SCALE first, then multiply by (SCALE - reserve_factor), then divide by SCALE again
    let rate_to_pool = (borrow_rate * utilization_rate) / SCALE;
    let rate_after_reserves = (rate_to_pool * (SCALE - reserve_factor)) / SCALE;
    rate_after_reserves
}

/// Calculates all interest rates for the lending pool
/// 
/// # Requirements
/// - Calculates utilization rate - Requirement 1.4
/// - Calculates borrow rate based on utilization - Requirements 1.5, 1.6
/// - Calculates supply rate - Requirement 2.2
/// 
/// # Arguments
/// * `total_cash` - Total liquid assets available for borrowing
/// * `total_borrows` - Total outstanding borrows
/// * `total_reserves` - Total protocol reserves
/// * `reserve_factor` - Percentage of interest allocated to reserves (scaled by SCALE)
/// * `config` - The rate model configuration
/// 
/// # Returns
/// * `RateCalculationResult` containing utilization_rate, borrow_rate, and supply_rate
pub fn calculate_rates(
    total_cash: i128,
    total_borrows: i128,
    total_reserves: i128,
    reserve_factor: i128,
    config: &RateModelConfig,
) -> RateCalculationResult {
    // Calculate utilization rate
    let utilization_rate = calculate_utilization_rate(total_cash, total_borrows, total_reserves);
    
    // Calculate borrow rate based on utilization
    let borrow_rate = calculate_borrow_rate(utilization_rate, config);
    
    // Calculate supply rate
    let supply_rate = calculate_supply_rate(borrow_rate, utilization_rate, reserve_factor);
    
    RateCalculationResult {
        borrow_rate,
        supply_rate,
        utilization_rate,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_config_valid() {
        let config = RateModelConfig {
            base_rate: SCALE / 20,           // 5%
            multiplier: SCALE / 10,          // 10%
            jump_multiplier: SCALE,          // 100%
            kink: (SCALE * 8) / 10,          // 80%
        };
        
        assert!(validate_config(&config).is_ok());
    }

    #[test]
    fn test_validate_config_kink_at_zero() {
        let config = RateModelConfig {
            base_rate: SCALE / 20,
            multiplier: SCALE / 10,
            jump_multiplier: SCALE,
            kink: 0,                         // 0% - valid boundary
        };
        
        assert!(validate_config(&config).is_ok());
    }

    #[test]
    fn test_validate_config_kink_at_scale() {
        let config = RateModelConfig {
            base_rate: SCALE / 20,
            multiplier: SCALE / 10,
            jump_multiplier: SCALE,
            kink: SCALE,                     // 100% - valid boundary
        };
        
        assert!(validate_config(&config).is_ok());
    }

    #[test]
    fn test_validate_config_invalid_kink_negative() {
        let config = RateModelConfig {
            base_rate: SCALE / 20,
            multiplier: SCALE / 10,
            jump_multiplier: SCALE,
            kink: -1,                        // Invalid: negative
        };
        
        let result = validate_config(&config);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "InvalidKinkPoint: kink must be between 0 and SCALE (1e18)");
    }

    #[test]
    fn test_validate_config_invalid_kink_above_scale() {
        let config = RateModelConfig {
            base_rate: SCALE / 20,
            multiplier: SCALE / 10,
            jump_multiplier: SCALE,
            kink: SCALE + 1,                 // Invalid: above 100%
        };
        
        let result = validate_config(&config);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "InvalidKinkPoint: kink must be between 0 and SCALE (1e18)");
    }

    #[test]
    fn test_validate_config_negative_base_rate() {
        let config = RateModelConfig {
            base_rate: -1,                   // Invalid: negative
            multiplier: SCALE / 10,
            jump_multiplier: SCALE,
            kink: (SCALE * 8) / 10,
        };
        
        let result = validate_config(&config);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "NegativeRate: base_rate must be non-negative");
    }

    #[test]
    fn test_validate_config_negative_multiplier() {
        let config = RateModelConfig {
            base_rate: SCALE / 20,
            multiplier: -1,                  // Invalid: negative
            jump_multiplier: SCALE,
            kink: (SCALE * 8) / 10,
        };
        
        let result = validate_config(&config);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "NegativeRate: multiplier must be non-negative");
    }

    #[test]
    fn test_validate_config_negative_jump_multiplier() {
        let config = RateModelConfig {
            base_rate: SCALE / 20,
            multiplier: SCALE / 10,
            jump_multiplier: -1,             // Invalid: negative
            kink: (SCALE * 8) / 10,
        };
        
        let result = validate_config(&config);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "NegativeRate: jump_multiplier must be non-negative");
    }

    #[test]
    fn test_validate_config_all_zero_rates() {
        let config = RateModelConfig {
            base_rate: 0,                    // Valid: zero is non-negative
            multiplier: 0,
            jump_multiplier: 0,
            kink: SCALE / 2,
        };
        
        assert!(validate_config(&config).is_ok());
    }

    #[test]
    fn test_validate_config_multiple_invalid_params() {
        // Test that the function returns the first error it encounters
        let config = RateModelConfig {
            base_rate: -1,                   // Invalid
            multiplier: -1,                  // Invalid
            jump_multiplier: -1,             // Invalid
            kink: SCALE + 1,                 // Invalid
        };
        
        let result = validate_config(&config);
        assert!(result.is_err());
        // Should fail on kink validation first (checked first in the function)
        assert_eq!(result.unwrap_err(), "InvalidKinkPoint: kink must be between 0 and SCALE (1e18)");
    }

    #[test]
    fn test_calculate_utilization_rate_normal() {
        // Test normal case: 50% utilization
        // total_cash = 1000, total_borrows = 500, total_reserves = 0
        // utilization = 500 / (1000 + 500 - 0) = 500 / 1500 = 1/3 ≈ 0.333...
        let total_cash = 1000 * SCALE;
        let total_borrows = 500 * SCALE;
        let total_reserves = 0;
        
        let utilization = calculate_utilization_rate(total_cash, total_borrows, total_reserves);
        let expected = (500 * SCALE) / 1500; // 0.333... * SCALE
        
        assert_eq!(utilization, expected);
    }

    #[test]
    fn test_calculate_utilization_rate_zero_borrows() {
        // Test edge case: no borrows
        let total_cash = 1000 * SCALE;
        let total_borrows = 0;
        let total_reserves = 0;
        
        let utilization = calculate_utilization_rate(total_cash, total_borrows, total_reserves);
        
        assert_eq!(utilization, 0);
    }

    #[test]
    fn test_calculate_utilization_rate_with_reserves() {
        // Test with reserves: utilization = 500 / (1000 + 500 - 100) = 500 / 1400
        let total_cash = 1000 * SCALE;
        let total_borrows = 500 * SCALE;
        let total_reserves = 100 * SCALE;
        
        let utilization = calculate_utilization_rate(total_cash, total_borrows, total_reserves);
        let expected = (500 * SCALE) / 1400;
        
        assert_eq!(utilization, expected);
    }

    #[test]
    fn test_calculate_utilization_rate_denominator_zero() {
        // Test edge case: denominator = 0
        // total_cash = 100, total_borrows = 0, total_reserves = 100
        // denominator = 100 + 0 - 100 = 0
        let total_cash = 100 * SCALE;
        let total_borrows = 0;
        let total_reserves = 100 * SCALE;
        
        let utilization = calculate_utilization_rate(total_cash, total_borrows, total_reserves);
        
        assert_eq!(utilization, 0);
    }

    #[test]
    fn test_calculate_utilization_rate_denominator_negative() {
        // Test edge case: denominator < 0
        // total_cash = 100, total_borrows = 0, total_reserves = 200
        // denominator = 100 + 0 - 200 = -100
        let total_cash = 100 * SCALE;
        let total_borrows = 0;
        let total_reserves = 200 * SCALE;
        
        let utilization = calculate_utilization_rate(total_cash, total_borrows, total_reserves);
        
        assert_eq!(utilization, 0);
    }

    #[test]
    fn test_calculate_utilization_rate_full_utilization() {
        // Test edge case: 100% utilization
        // total_cash = 0, total_borrows = 1000, total_reserves = 0
        // utilization = 1000 / (0 + 1000 - 0) = 1000 / 1000 = 1.0 = SCALE
        let total_cash = 0;
        let total_borrows = 1000 * SCALE;
        let total_reserves = 0;
        
        let utilization = calculate_utilization_rate(total_cash, total_borrows, total_reserves);
        
        assert_eq!(utilization, SCALE); // 100% = 1.0 * SCALE
    }

    #[test]
    fn test_calculate_utilization_rate_high_utilization() {
        // Test high utilization: 90%
        // total_cash = 100, total_borrows = 900, total_reserves = 0
        // utilization = 900 / (100 + 900 - 0) = 900 / 1000 = 0.9
        let total_cash = 100 * SCALE;
        let total_borrows = 900 * SCALE;
        let total_reserves = 0;
        
        let utilization = calculate_utilization_rate(total_cash, total_borrows, total_reserves);
        let expected = (900 * SCALE) / 1000; // 0.9 * SCALE
        
        assert_eq!(utilization, expected);
    }

    #[test]
    fn test_calculate_borrow_rate_below_kink() {
        // Test borrow rate calculation below kink point
        // Config: base_rate = 2%, multiplier = 10%, kink = 80%
        // Utilization = 50%
        // Expected: 2% + (50% * 10%) = 2% + 5% = 7%
        let config = RateModelConfig {
            base_rate: (SCALE * 2) / 100,           // 2%
            multiplier: (SCALE * 10) / 100,         // 10%
            jump_multiplier: SCALE,                 // 100%
            kink: (SCALE * 80) / 100,               // 80%
        };
        
        let utilization = (SCALE * 50) / 100;       // 50%
        let borrow_rate = calculate_borrow_rate(utilization, &config);
        
        // Expected: 2% + (50% * 10%) = 2% + 5% = 7%
        let expected = (SCALE * 2) / 100 + ((SCALE * 50) / 100 * (SCALE * 10) / 100) / SCALE;
        
        assert_eq!(borrow_rate, expected);
    }

    #[test]
    fn test_calculate_borrow_rate_at_kink() {
        // Test borrow rate calculation exactly at kink point
        // Config: base_rate = 2%, multiplier = 10%, kink = 80%
        // Utilization = 80% (at kink)
        // Expected: 2% + (80% * 10%) = 2% + 8% = 10%
        let config = RateModelConfig {
            base_rate: (SCALE * 2) / 100,           // 2%
            multiplier: (SCALE * 10) / 100,         // 10%
            jump_multiplier: SCALE,                 // 100%
            kink: (SCALE * 80) / 100,               // 80%
        };
        
        let utilization = (SCALE * 80) / 100;       // 80% (at kink)
        let borrow_rate = calculate_borrow_rate(utilization, &config);
        
        // Expected: 2% + (80% * 10%) = 2% + 8% = 10%
        let expected = (SCALE * 2) / 100 + ((SCALE * 80) / 100 * (SCALE * 10) / 100) / SCALE;
        
        assert_eq!(borrow_rate, expected);
    }

    #[test]
    fn test_calculate_borrow_rate_above_kink() {
        // Test borrow rate calculation above kink point
        // Config: base_rate = 2%, multiplier = 10%, jump_multiplier = 100%, kink = 80%
        // Utilization = 90%
        // Expected: 2% + (80% * 10%) + ((90% - 80%) * 100%) = 2% + 8% + 10% = 20%
        let config = RateModelConfig {
            base_rate: (SCALE * 2) / 100,           // 2%
            multiplier: (SCALE * 10) / 100,         // 10%
            jump_multiplier: SCALE,                 // 100%
            kink: (SCALE * 80) / 100,               // 80%
        };
        
        let utilization = (SCALE * 90) / 100;       // 90%
        let borrow_rate = calculate_borrow_rate(utilization, &config);
        
        // Expected: 2% + (80% * 10%) + ((90% - 80%) * 100%)
        let rate_at_kink = (SCALE * 2) / 100 + ((SCALE * 80) / 100 * (SCALE * 10) / 100) / SCALE;
        let excess_rate = ((SCALE * 10) / 100 * SCALE) / SCALE; // (10% * 100%)
        let expected = rate_at_kink + excess_rate;
        
        assert_eq!(borrow_rate, expected);
    }

    #[test]
    fn test_calculate_borrow_rate_zero_utilization() {
        // Test borrow rate at zero utilization
        // Expected: base_rate only
        let config = RateModelConfig {
            base_rate: (SCALE * 2) / 100,           // 2%
            multiplier: (SCALE * 10) / 100,         // 10%
            jump_multiplier: SCALE,                 // 100%
            kink: (SCALE * 80) / 100,               // 80%
        };
        
        let utilization = 0;
        let borrow_rate = calculate_borrow_rate(utilization, &config);
        
        assert_eq!(borrow_rate, config.base_rate);
    }

    #[test]
    fn test_calculate_borrow_rate_full_utilization() {
        // Test borrow rate at 100% utilization
        // Config: base_rate = 2%, multiplier = 10%, jump_multiplier = 100%, kink = 80%
        // Utilization = 100%
        // Expected: 2% + (80% * 10%) + ((100% - 80%) * 100%) = 2% + 8% + 20% = 30%
        let config = RateModelConfig {
            base_rate: (SCALE * 2) / 100,           // 2%
            multiplier: (SCALE * 10) / 100,         // 10%
            jump_multiplier: SCALE,                 // 100%
            kink: (SCALE * 80) / 100,               // 80%
        };
        
        let utilization = SCALE;                    // 100%
        let borrow_rate = calculate_borrow_rate(utilization, &config);
        
        // Expected: 2% + (80% * 10%) + ((100% - 80%) * 100%)
        let rate_at_kink = (SCALE * 2) / 100 + ((SCALE * 80) / 100 * (SCALE * 10) / 100) / SCALE;
        let excess_rate = ((SCALE * 20) / 100 * SCALE) / SCALE; // (20% * 100%)
        let expected = rate_at_kink + excess_rate;
        
        assert_eq!(borrow_rate, expected);
    }

    #[test]
    fn test_calculate_borrow_rate_just_above_kink() {
        // Test borrow rate just above kink (edge case)
        // Config: base_rate = 2%, multiplier = 10%, jump_multiplier = 100%, kink = 80%
        // Utilization = 80.1%
        let config = RateModelConfig {
            base_rate: (SCALE * 2) / 100,           // 2%
            multiplier: (SCALE * 10) / 100,         // 10%
            jump_multiplier: SCALE,                 // 100%
            kink: (SCALE * 80) / 100,               // 80%
        };
        
        let utilization = (SCALE * 801) / 1000;     // 80.1%
        let borrow_rate = calculate_borrow_rate(utilization, &config);
        
        // Should use the above-kink formula
        let rate_at_kink = (SCALE * 2) / 100 + ((SCALE * 80) / 100 * (SCALE * 10) / 100) / SCALE;
        let excess_utilization = utilization - config.kink;
        let excess_rate = (excess_utilization * SCALE) / SCALE;
        let expected = rate_at_kink + excess_rate;
        
        assert_eq!(borrow_rate, expected);
    }

    #[test]
    fn test_calculate_supply_rate_normal() {
        // Test supply rate calculation with normal values
        // borrow_rate = 10%, utilization = 50%, reserve_factor = 10%
        // Expected: (10% * 50% * (100% - 10%)) / 100% = (10% * 50% * 90%) / 100% = 4.5%
        let borrow_rate = (SCALE * 10) / 100;       // 10%
        let utilization = (SCALE * 50) / 100;       // 50%
        let reserve_factor = (SCALE * 10) / 100;    // 10%
        
        let supply_rate = calculate_supply_rate(borrow_rate, utilization, reserve_factor);
        
        // Calculate expected: (borrow_rate * utilization / SCALE) * (SCALE - reserve_factor) / SCALE
        let rate_to_pool = (borrow_rate * utilization) / SCALE;
        let expected = (rate_to_pool * (SCALE - reserve_factor)) / SCALE;
        
        assert_eq!(supply_rate, expected);
    }

    #[test]
    fn test_calculate_supply_rate_zero_utilization() {
        // Test supply rate with zero utilization
        // Expected: 0 (no borrows = no interest to distribute)
        let borrow_rate = (SCALE * 10) / 100;       // 10%
        let utilization = 0;                         // 0%
        let reserve_factor = (SCALE * 10) / 100;    // 10%
        
        let supply_rate = calculate_supply_rate(borrow_rate, utilization, reserve_factor);
        
        assert_eq!(supply_rate, 0);
    }

    #[test]
    fn test_calculate_supply_rate_zero_reserve_factor() {
        // Test supply rate with zero reserve factor (all interest goes to lenders)
        // borrow_rate = 10%, utilization = 50%, reserve_factor = 0%
        // Expected: (10% * 50% * 100%) / 100% = 5%
        let borrow_rate = (SCALE * 10) / 100;       // 10%
        let utilization = (SCALE * 50) / 100;       // 50%
        let reserve_factor = 0;                      // 0%
        
        let supply_rate = calculate_supply_rate(borrow_rate, utilization, reserve_factor);
        
        // Expected: (10% * 50%) / 100% = 5%
        let expected = (borrow_rate * utilization) / SCALE;
        
        assert_eq!(supply_rate, expected);
    }

    #[test]
    fn test_calculate_supply_rate_full_utilization() {
        // Test supply rate at 100% utilization
        // borrow_rate = 10%, utilization = 100%, reserve_factor = 10%
        // Expected: (10% * 100% * 90%) / 100% = 9%
        let borrow_rate = (SCALE * 10) / 100;       // 10%
        let utilization = SCALE;                     // 100%
        let reserve_factor = (SCALE * 10) / 100;    // 10%
        
        let supply_rate = calculate_supply_rate(borrow_rate, utilization, reserve_factor);
        
        // Expected: (10% * 100% * 90%) / 100% = 9%
        let expected = (borrow_rate * (SCALE - reserve_factor)) / SCALE;
        
        assert_eq!(supply_rate, expected);
    }

    #[test]
    fn test_calculate_supply_rate_high_reserve_factor() {
        // Test supply rate with high reserve factor (50%)
        // borrow_rate = 10%, utilization = 80%, reserve_factor = 50%
        // Expected: (10% * 80% * 50%) / 100% = 4%
        let borrow_rate = (SCALE * 10) / 100;       // 10%
        let utilization = (SCALE * 80) / 100;       // 80%
        let reserve_factor = (SCALE * 50) / 100;    // 50%
        
        let supply_rate = calculate_supply_rate(borrow_rate, utilization, reserve_factor);
        
        // Calculate expected: (borrow_rate * utilization / SCALE) * (SCALE - reserve_factor) / SCALE
        let rate_to_pool = (borrow_rate * utilization) / SCALE;
        let expected = (rate_to_pool * (SCALE - reserve_factor)) / SCALE;
        
        assert_eq!(supply_rate, expected);
    }

    #[test]
    fn test_calculate_supply_rate_less_than_borrow_rate() {
        // Test that supply rate is always less than or equal to borrow rate
        // This is a property that should always hold
        let borrow_rate = (SCALE * 15) / 100;       // 15%
        let utilization = (SCALE * 70) / 100;       // 70%
        let reserve_factor = (SCALE * 20) / 100;    // 20%
        
        let supply_rate = calculate_supply_rate(borrow_rate, utilization, reserve_factor);
        
        // Supply rate should always be less than borrow rate
        assert!(supply_rate <= borrow_rate);
    }

    #[test]
    fn test_calculate_supply_rate_max_reserve_factor() {
        // Test supply rate with 100% reserve factor (all interest goes to reserves)
        // borrow_rate = 10%, utilization = 50%, reserve_factor = 100%
        // Expected: 0 (all interest goes to reserves)
        let borrow_rate = (SCALE * 10) / 100;       // 10%
        let utilization = (SCALE * 50) / 100;       // 50%
        let reserve_factor = SCALE;                  // 100%
        
        let supply_rate = calculate_supply_rate(borrow_rate, utilization, reserve_factor);
        
        assert_eq!(supply_rate, 0);
    }

    #[test]
    fn test_calculate_supply_rate_low_values() {
        // Test supply rate with very low values to check precision
        // borrow_rate = 1%, utilization = 1%, reserve_factor = 1%
        let borrow_rate = SCALE / 100;              // 1%
        let utilization = SCALE / 100;              // 1%
        let reserve_factor = SCALE / 100;           // 1%
        
        let supply_rate = calculate_supply_rate(borrow_rate, utilization, reserve_factor);
        
        // Calculate expected: (borrow_rate * utilization / SCALE) * (SCALE - reserve_factor) / SCALE
        let rate_to_pool = (borrow_rate * utilization) / SCALE;
        let expected = (rate_to_pool * (SCALE - reserve_factor)) / SCALE;
        
        assert_eq!(supply_rate, expected);
    }

    #[test]
    fn test_calculate_rates_normal_case() {
        // Test calculate_rates with normal values
        // total_cash = 1000, total_borrows = 500, total_reserves = 0
        // reserve_factor = 10%
        // Config: base_rate = 2%, multiplier = 10%, jump_multiplier = 100%, kink = 80%
        let config = RateModelConfig {
            base_rate: (SCALE * 2) / 100,           // 2%
            multiplier: (SCALE * 10) / 100,         // 10%
            jump_multiplier: SCALE,                 // 100%
            kink: (SCALE * 80) / 100,               // 80%
        };
        
        let total_cash = 1000 * SCALE;
        let total_borrows = 500 * SCALE;
        let total_reserves = 0;
        let reserve_factor = (SCALE * 10) / 100;    // 10%
        
        let result = calculate_rates(total_cash, total_borrows, total_reserves, reserve_factor, &config);
        
        // Verify utilization rate: 500 / 1500 = 0.333...
        let expected_utilization = (500 * SCALE) / 1500;
        assert_eq!(result.utilization_rate, expected_utilization);
        
        // Verify borrow rate: 2% + (33.33% * 10%) = 2% + 3.33% = 5.33%
        let expected_borrow_rate = calculate_borrow_rate(expected_utilization, &config);
        assert_eq!(result.borrow_rate, expected_borrow_rate);
        
        // Verify supply rate
        let expected_supply_rate = calculate_supply_rate(expected_borrow_rate, expected_utilization, reserve_factor);
        assert_eq!(result.supply_rate, expected_supply_rate);
    }

    #[test]
    fn test_calculate_rates_zero_borrows() {
        // Test calculate_rates with zero borrows
        let config = RateModelConfig {
            base_rate: (SCALE * 2) / 100,
            multiplier: (SCALE * 10) / 100,
            jump_multiplier: SCALE,
            kink: (SCALE * 80) / 100,
        };
        
        let total_cash = 1000 * SCALE;
        let total_borrows = 0;
        let total_reserves = 0;
        let reserve_factor = (SCALE * 10) / 100;
        
        let result = calculate_rates(total_cash, total_borrows, total_reserves, reserve_factor, &config);
        
        // Utilization should be 0
        assert_eq!(result.utilization_rate, 0);
        
        // Borrow rate should be base_rate
        assert_eq!(result.borrow_rate, config.base_rate);
        
        // Supply rate should be 0 (no borrows)
        assert_eq!(result.supply_rate, 0);
    }

    #[test]
    fn test_calculate_rates_high_utilization() {
        // Test calculate_rates with high utilization (above kink)
        // total_cash = 100, total_borrows = 900, total_reserves = 0
        // Utilization = 90% (above 80% kink)
        let config = RateModelConfig {
            base_rate: (SCALE * 2) / 100,           // 2%
            multiplier: (SCALE * 10) / 100,         // 10%
            jump_multiplier: SCALE,                 // 100%
            kink: (SCALE * 80) / 100,               // 80%
        };
        
        let total_cash = 100 * SCALE;
        let total_borrows = 900 * SCALE;
        let total_reserves = 0;
        let reserve_factor = (SCALE * 10) / 100;
        
        let result = calculate_rates(total_cash, total_borrows, total_reserves, reserve_factor, &config);
        
        // Verify utilization rate: 900 / 1000 = 0.9 = 90%
        let expected_utilization = (900 * SCALE) / 1000;
        assert_eq!(result.utilization_rate, expected_utilization);
        
        // Verify borrow rate uses jump multiplier (above kink)
        let expected_borrow_rate = calculate_borrow_rate(expected_utilization, &config);
        assert_eq!(result.borrow_rate, expected_borrow_rate);
        
        // Verify supply rate
        let expected_supply_rate = calculate_supply_rate(expected_borrow_rate, expected_utilization, reserve_factor);
        assert_eq!(result.supply_rate, expected_supply_rate);
        
        // Supply rate should be less than borrow rate
        assert!(result.supply_rate < result.borrow_rate);
    }

    #[test]
    fn test_calculate_rates_with_reserves() {
        // Test calculate_rates with reserves affecting utilization
        let config = RateModelConfig {
            base_rate: (SCALE * 2) / 100,
            multiplier: (SCALE * 10) / 100,
            jump_multiplier: SCALE,
            kink: (SCALE * 80) / 100,
        };
        
        let total_cash = 1000 * SCALE;
        let total_borrows = 500 * SCALE;
        let total_reserves = 100 * SCALE;
        let reserve_factor = (SCALE * 10) / 100;
        
        let result = calculate_rates(total_cash, total_borrows, total_reserves, reserve_factor, &config);
        
        // Verify utilization rate: 500 / (1000 + 500 - 100) = 500 / 1400
        let expected_utilization = (500 * SCALE) / 1400;
        assert_eq!(result.utilization_rate, expected_utilization);
        
        // Verify all rates are calculated correctly
        let expected_borrow_rate = calculate_borrow_rate(expected_utilization, &config);
        assert_eq!(result.borrow_rate, expected_borrow_rate);
        
        let expected_supply_rate = calculate_supply_rate(expected_borrow_rate, expected_utilization, reserve_factor);
        assert_eq!(result.supply_rate, expected_supply_rate);
    }

    #[test]
    fn test_calculate_rates_full_utilization() {
        // Test calculate_rates at 100% utilization
        let config = RateModelConfig {
            base_rate: (SCALE * 2) / 100,
            multiplier: (SCALE * 10) / 100,
            jump_multiplier: SCALE,
            kink: (SCALE * 80) / 100,
        };
        
        let total_cash = 0;
        let total_borrows = 1000 * SCALE;
        let total_reserves = 0;
        let reserve_factor = (SCALE * 10) / 100;
        
        let result = calculate_rates(total_cash, total_borrows, total_reserves, reserve_factor, &config);
        
        // Utilization should be 100%
        assert_eq!(result.utilization_rate, SCALE);
        
        // Verify borrow rate at full utilization
        let expected_borrow_rate = calculate_borrow_rate(SCALE, &config);
        assert_eq!(result.borrow_rate, expected_borrow_rate);
        
        // Verify supply rate
        let expected_supply_rate = calculate_supply_rate(expected_borrow_rate, SCALE, reserve_factor);
        assert_eq!(result.supply_rate, expected_supply_rate);
    }
}
