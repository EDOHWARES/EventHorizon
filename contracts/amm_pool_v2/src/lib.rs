#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Symbol};

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    TokenA,
    TokenB,
    ReserveA,
    ReserveB,
    LPSupply,
    LPBalance(Address),
    // Cumulative volume accumulators for dashboard indexing
    VolumeA,   // Total token A traded
    VolumeB,   // Total token B traded
    SwapCount, // Total number of swaps
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct AmmPoolV2;

#[contractimpl]
impl AmmPoolV2 {
    // ── Initialization ────────────────────────────────────────────────────

    pub fn initialize(env: Env, token_a: Address, token_b: Address) {
        if env.storage().instance().has(&DataKey::TokenA) {
            panic!("Already initialized");
        }
        let (a, b) = if token_a < token_b {
            (token_a, token_b)
        } else {
            (token_b, token_a)
        };
        env.storage().instance().set(&DataKey::TokenA, &a);
        env.storage().instance().set(&DataKey::TokenB, &b);
        env.storage().instance().set(&DataKey::ReserveA, &0i128);
        env.storage().instance().set(&DataKey::ReserveB, &0i128);
        env.storage().instance().set(&DataKey::LPSupply, &0i128);
        env.storage().instance().set(&DataKey::VolumeA, &0i128);
        env.storage().instance().set(&DataKey::VolumeB, &0i128);
        env.storage().instance().set(&DataKey::SwapCount, &0u64);
    }

    // ── Liquidity ─────────────────────────────────────────────────────────

    #[allow(deprecated)]
    pub fn add_liquidity(
        env: Env,
        to: Address,
        amount_a_desired: i128,
        amount_b_desired: i128,
    ) -> i128 {
        to.require_auth();

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).expect("Not init");
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).expect("Not init");
        let reserve_a: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap_or(0);
        let reserve_b: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap_or(0);
        let total_supply: i128 = env.storage().instance().get(&DataKey::LPSupply).unwrap_or(0);

        let (amount_a, amount_b, lp_to_mint) = if total_supply == 0 {
            let lp = Self::sqrt(amount_a_desired * amount_b_desired);
            (amount_a_desired, amount_b_desired, lp)
        } else {
            let b_optimal = (amount_a_desired * reserve_b) / reserve_a;
            if b_optimal <= amount_b_desired {
                let lp = (amount_a_desired * total_supply) / reserve_a;
                (amount_a_desired, b_optimal, lp)
            } else {
                let a_optimal = (amount_b_desired * reserve_a) / reserve_b;
                let lp = (amount_b_desired * total_supply) / reserve_b;
                (a_optimal, amount_b_desired, lp)
            }
        };

        token::Client::new(&env, &token_a).transfer(&to, &env.current_contract_address(), &amount_a);
        token::Client::new(&env, &token_b).transfer(&to, &env.current_contract_address(), &amount_b);

        let new_reserve_a = reserve_a + amount_a;
        let new_reserve_b = reserve_b + amount_b;

        env.storage().instance().set(&DataKey::ReserveA, &new_reserve_a);
        env.storage().instance().set(&DataKey::ReserveB, &new_reserve_b);
        env.storage().instance().set(&DataKey::LPSupply, &(total_supply + lp_to_mint));

        let bal: i128 = env.storage().persistent().get(&DataKey::LPBalance(to.clone())).unwrap_or(0);
        env.storage().persistent().set(&DataKey::LPBalance(to.clone()), &(bal + lp_to_mint));

        // Spot price after liquidity add: price_a_in_b = reserve_b / reserve_a (scaled 1e7)
        let spot_price = Self::_spot_price(new_reserve_a, new_reserve_b);

        env.events().publish(
            (Symbol::new(&env, "liquidity_added"), to),
            (amount_a, amount_b, lp_to_mint, spot_price),
        );

        lp_to_mint
    }

    #[allow(deprecated)]
    pub fn remove_liquidity(env: Env, from: Address, lp_amount: i128) -> (i128, i128) {
        from.require_auth();

        let bal: i128 = env.storage().persistent().get(&DataKey::LPBalance(from.clone())).unwrap_or(0);
        if bal < lp_amount {
            panic!("Insufficient LP balance");
        }

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).expect("Not init");
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).expect("Not init");
        let reserve_a: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap_or(0);
        let reserve_b: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap_or(0);
        let total_supply: i128 = env.storage().instance().get(&DataKey::LPSupply).unwrap_or(0);

        let amount_a = (lp_amount * reserve_a) / total_supply;
        let amount_b = (lp_amount * reserve_b) / total_supply;

        token::Client::new(&env, &token_a).transfer(&env.current_contract_address(), &from, &amount_a);
        token::Client::new(&env, &token_b).transfer(&env.current_contract_address(), &from, &amount_b);

        let new_reserve_a = reserve_a - amount_a;
        let new_reserve_b = reserve_b - amount_b;

        env.storage().instance().set(&DataKey::ReserveA, &new_reserve_a);
        env.storage().instance().set(&DataKey::ReserveB, &new_reserve_b);
        env.storage().instance().set(&DataKey::LPSupply, &(total_supply - lp_amount));
        env.storage().persistent().set(&DataKey::LPBalance(from.clone()), &(bal - lp_amount));

        // IL tracking: emit the spot price after removal for dashboard indexing
        let spot_price = Self::_spot_price(new_reserve_a, new_reserve_b);

        env.events().publish(
            (Symbol::new(&env, "liquidity_removed"), from),
            (amount_a, amount_b, lp_amount, spot_price),
        );

        (amount_a, amount_b)
    }

    // ── Swap ──────────────────────────────────────────────────────────────

    /// CPMM swap with granular price impact, slippage, and volume events.
    #[allow(deprecated)]
    pub fn swap(
        env: Env,
        from: Address,
        token_in: Address,
        amount_in: i128,
        min_amount_out: i128,
    ) -> i128 {
        from.require_auth();

        let token_a_addr: Address = env.storage().instance().get(&DataKey::TokenA).expect("Not init");
        let token_b_addr: Address = env.storage().instance().get(&DataKey::TokenB).expect("Not init");
        let reserve_a: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap_or(0);
        let reserve_b: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap_or(0);

        let (reserve_in, reserve_out, is_a_in) = if token_in == token_a_addr {
            (reserve_a, reserve_b, true)
        } else if token_in == token_b_addr {
            (reserve_b, reserve_a, false)
        } else {
            panic!("Invalid token");
        };

        // Spot price BEFORE swap (scaled 1e7) for price impact calculation
        let price_before = Self::_spot_price(reserve_in, reserve_out);

        // CPMM formula with 0.3% fee
        let amount_in_with_fee = amount_in * 997;
        let numerator = amount_in_with_fee * reserve_out;
        let denominator = (reserve_in * 1000) + amount_in_with_fee;
        let amount_out = numerator / denominator;

        if amount_out < min_amount_out {
            panic!("Slippage limit exceeded");
        }

        // Actual slippage = (min_amount_out - amount_out) expressed as bps
        // We store it as: expected_out (no-fee ideal) vs actual_out
        let ideal_out = (amount_in * reserve_out) / (reserve_in + amount_in);
        // slippage_bps = (ideal_out - amount_out) * 10000 / ideal_out
        let slippage_bps: i128 = if ideal_out > 0 {
            ((ideal_out - amount_out) * 10_000) / ideal_out
        } else {
            0
        };

        let token_out_addr = if is_a_in { &token_b_addr } else { &token_a_addr };
        token::Client::new(&env, &token_in).transfer(&from, &env.current_contract_address(), &amount_in);
        token::Client::new(&env, token_out_addr).transfer(&env.current_contract_address(), &from, &amount_out);

        // Update reserves
        let (new_reserve_a, new_reserve_b) = if is_a_in {
            (reserve_a + amount_in, reserve_b - amount_out)
        } else {
            (reserve_a - amount_out, reserve_b + amount_in)
        };

        env.storage().instance().set(&DataKey::ReserveA, &new_reserve_a);
        env.storage().instance().set(&DataKey::ReserveB, &new_reserve_b);

        // Spot price AFTER swap
        let price_after = Self::_spot_price(new_reserve_a, new_reserve_b);

        // Price impact in bps = (price_after - price_before) * 10000 / price_before
        let price_impact_bps: i128 = if price_before > 0 {
            let delta = if price_after > price_before {
                price_after - price_before
            } else {
                price_before - price_after
            };
            (delta * 10_000) / price_before
        } else {
            0
        };

        // Update cumulative volume accumulators
        let (vol_a, vol_b) = if is_a_in {
            let va: i128 = env.storage().instance().get(&DataKey::VolumeA).unwrap_or(0);
            let vb: i128 = env.storage().instance().get(&DataKey::VolumeB).unwrap_or(0);
            (va + amount_in, vb + amount_out)
        } else {
            let va: i128 = env.storage().instance().get(&DataKey::VolumeA).unwrap_or(0);
            let vb: i128 = env.storage().instance().get(&DataKey::VolumeB).unwrap_or(0);
            (va + amount_out, vb + amount_in)
        };
        env.storage().instance().set(&DataKey::VolumeA, &vol_a);
        env.storage().instance().set(&DataKey::VolumeB, &vol_b);

        let swap_count: u64 = env.storage().instance().get(&DataKey::SwapCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::SwapCount, &(swap_count + 1));

        // ── Granular swap event for dashboard indexing ──
        // Fields: (token_in, amount_in, amount_out, price_before, price_after,
        //          price_impact_bps, slippage_bps, cumulative_vol_a, cumulative_vol_b)
        env.events().publish(
            (Symbol::new(&env, "swap"), from.clone()),
            (
                token_in,
                amount_in,
                amount_out,
                price_before,
                price_after,
                price_impact_bps,
                slippage_bps,
            ),
        );

        // Separate volume event for indexers that only care about volume
        env.events().publish(
            (Symbol::new(&env, "volume_update"), from),
            (vol_a, vol_b, swap_count + 1),
        );

        amount_out
    }

    // ── View Functions ────────────────────────────────────────────────────

    pub fn get_pool_info(env: Env) -> (i128, i128, i128) {
        let ra = env.storage().instance().get(&DataKey::ReserveA).unwrap_or(0);
        let rb = env.storage().instance().get(&DataKey::ReserveB).unwrap_or(0);
        let supply = env.storage().instance().get(&DataKey::LPSupply).unwrap_or(0);
        (ra, rb, supply)
    }

    pub fn get_spot_price(env: Env) -> i128 {
        let ra: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap_or(0);
        let rb: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap_or(0);
        Self::_spot_price(ra, rb)
    }

    pub fn get_cumulative_volume(env: Env) -> (i128, i128, u64) {
        let va: i128 = env.storage().instance().get(&DataKey::VolumeA).unwrap_or(0);
        let vb: i128 = env.storage().instance().get(&DataKey::VolumeB).unwrap_or(0);
        let sc: u64 = env.storage().instance().get(&DataKey::SwapCount).unwrap_or(0);
        (va, vb, sc)
    }

    pub fn get_lp_balance(env: Env, user: Address) -> i128 {
        env.storage().persistent().get(&DataKey::LPBalance(user)).unwrap_or(0)
    }

    // ── Internal Helpers ──────────────────────────────────────────────────

    /// Spot price of token_in in terms of token_out, scaled by 1e7.
    fn _spot_price(reserve_in: i128, reserve_out: i128) -> i128 {
        if reserve_in == 0 {
            return 0;
        }
        (reserve_out * 10_000_000) / reserve_in
    }

    fn sqrt(y: i128) -> i128 {
        if y <= 0 { return 0; }
        if y < 4 { return 1; }
        let mut z = y;
        let mut x = y / 2 + 1;
        while x < z {
            z = x;
            x = (y / x + x) / 2;
        }
        z
    }
}

mod test;
