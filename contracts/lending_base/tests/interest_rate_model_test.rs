// Standalone tests for interest_rate_model module
// This file tests the borrow rate calculation independently

#[cfg(test)]
mod borrow_rate_tests {
    // Import the module functions directly
    use lending_base::interest_rate_model::{calculate_borrow_rate, RateModelConfig, SCALE};

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
}
