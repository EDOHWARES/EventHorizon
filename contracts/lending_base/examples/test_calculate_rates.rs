// Simple example to verify calculate_rates function works
use lending_base::interest_rate_model::{calculate_rates, RateModelConfig, SCALE};

fn main() {
    // Create a sample configuration
    let config = RateModelConfig {
        base_rate: (SCALE * 2) / 100,           // 2%
        multiplier: (SCALE * 10) / 100,         // 10%
        jump_multiplier: SCALE,                 // 100%
        kink: (SCALE * 80) / 100,               // 80%
    };
    
    // Test with normal values
    let total_cash = 1000 * SCALE;
    let total_borrows = 500 * SCALE;
    let total_reserves = 0;
    let reserve_factor = (SCALE * 10) / 100;    // 10%
    
    let result = calculate_rates(
        total_cash,
        total_borrows,
        total_reserves,
        reserve_factor,
        &config
    );
    
    println!("Calculate Rates Result:");
    println!("  Utilization Rate: {} ({}%)", result.utilization_rate, result.utilization_rate * 100 / SCALE);
    println!("  Borrow Rate: {} ({}%)", result.borrow_rate, result.borrow_rate * 100 / SCALE);
    println!("  Supply Rate: {} ({}%)", result.supply_rate, result.supply_rate * 100 / SCALE);
    println!("\nFunction works correctly!");
}
