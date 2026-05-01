#![no_std]

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, Address, Env, String,
};

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Name,
    Symbol,
    Decimals,
    TotalSupply,
    Balance(Address),
    Allowance(Address, Address),
    BurnWindowSeconds,
    BurnWindowStart,
    BurnedInWindow,
    BurnedTotal,
}

// ── Types ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BurnVelocity {
    pub window_start: u64,
    pub now: u64,
    pub burned_in_window: i128,
    pub velocity_per_sec: i128,
    pub window_seconds: u64,
}

// ── Events ───────────────────────────────────────────────────────────────────

#[contractevent]
pub struct Transferred {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
pub struct Approved {
    pub owner: Address,
    pub spender: Address,
    pub amount: i128,
}

#[contractevent]
pub struct Minted {
    pub to: Address,
    pub amount: i128,
    pub new_total_supply: i128,
}

#[contractevent]
pub struct Burned {
    pub from: Address,
    pub amount: i128,
    pub new_total_supply: i128,
}

#[contractevent]
pub struct SupplyChecked {
    pub delta: i128,
    pub total_supply: i128,
}

#[contractevent]
pub struct BurnVelocityUpdated {
    pub window_start: u64,
    pub now: u64,
    pub burned_in_window: i128,
    pub velocity_per_sec: i128,
    pub window_seconds: u64,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct BurnableToken;

#[contractimpl]
impl BurnableToken {
    // ── Setup ────────────────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        admin: Address,
        name: String,
        symbol: String,
        decimals: u32,
        burn_window_seconds: u64,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        if burn_window_seconds == 0 {
            panic!("burn_window_seconds must be > 0");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::Decimals, &decimals);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);

        env.storage()
            .instance()
            .set(&DataKey::BurnWindowSeconds, &burn_window_seconds);
        env.storage()
            .instance()
            .set(&DataKey::BurnWindowStart, &env.ledger().timestamp());
        env.storage().instance().set(&DataKey::BurnedInWindow, &0i128);
        env.storage().instance().set(&DataKey::BurnedTotal, &0i128);
    }

    // ── Metadata views ───────────────────────────────────────────────────────

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(env: Env) -> String {
        env.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Decimals).unwrap()
    }

    // ── Token views ──────────────────────────────────────────────────────────

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0i128)
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id))
            .unwrap_or(0i128)
    }

    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(owner, spender))
            .unwrap_or(0i128)
    }

    // ── Burn analytics views ─────────────────────────────────────────────────

    pub fn burned_total(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::BurnedTotal)
            .unwrap_or(0i128)
    }

    pub fn burn_velocity(env: Env) -> BurnVelocity {
        Self::_require_initialized(&env);
        let now = env.ledger().timestamp();
        let window_seconds: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BurnWindowSeconds)
            .unwrap();
        let window_start: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BurnWindowStart)
            .unwrap();
        let burned_in_window: i128 = env
            .storage()
            .instance()
            .get(&DataKey::BurnedInWindow)
            .unwrap_or(0i128);
        let elapsed = now.saturating_sub(window_start).max(1);
        let velocity_per_sec = burned_in_window / (elapsed as i128);
        BurnVelocity {
            window_start,
            now,
            burned_in_window,
            velocity_per_sec,
            window_seconds,
        }
    }

    // ── Authenticated actions ────────────────────────────────────────────────

    pub fn mint(env: Env, to: Address, amount: i128) {
        Self::_require_admin(&env);
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let new_total_supply = Self::total_supply(env.clone())
            .checked_add(amount)
            .expect("overflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_total_supply);

        let new_balance = Self::balance(env.clone(), to.clone())
            .checked_add(amount)
            .expect("overflow");
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &new_balance);

        env.events()
            .publish_event(&Minted { to, amount, new_total_supply });
        Self::_emit_supply_check(&env, amount, new_total_supply);
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::_require_initialized(&env);
        if amount <= 0 {
            panic!("Amount must be positive");
        }
        if from == to {
            return;
        }

        let from_bal = Self::balance(env.clone(), from.clone());
        if from_bal < amount {
            panic!("Insufficient balance");
        }
        let to_bal = Self::balance(env.clone(), to.clone());

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(from_bal - amount));
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &(to_bal + amount));

        env.events().publish_event(&Transferred { from, to, amount });
    }

    pub fn approve(env: Env, owner: Address, spender: Address, amount: i128) {
        owner.require_auth();
        Self::_require_initialized(&env);
        if amount < 0 {
            panic!("Amount must be non-negative");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Allowance(owner.clone(), spender.clone()), &amount);
        env.events()
            .publish_event(&Approved { owner, spender, amount });
    }

    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        Self::_burn_internal(&env, from, amount);
    }

    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        Self::_require_initialized(&env);
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let allowance = Self::allowance(env.clone(), from.clone(), spender.clone());
        if allowance < amount {
            panic!("Insufficient allowance");
        }
        env.storage().persistent().set(
            &DataKey::Allowance(from.clone(), spender),
            &(allowance - amount),
        );

        Self::_burn_internal(&env, from, amount);
    }

    // ── Internals ────────────────────────────────────────────────────────────

    fn _require_initialized(env: &Env) {
        if !env.storage().instance().has(&DataKey::Admin) {
            panic!("Not initialized");
        }
    }

    fn _require_admin(env: &Env) {
        Self::_require_initialized(env);
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }

    fn _emit_supply_check(env: &Env, delta: i128, total_supply: i128) {
        env.events()
            .publish_event(&SupplyChecked { delta, total_supply });
    }

    fn _burn_internal(env: &Env, from: Address, amount: i128) {
        Self::_require_initialized(env);
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let bal = Self::balance(env.clone(), from.clone());
        if bal < amount {
            panic!("Insufficient balance");
        }

        let total_supply = Self::total_supply(env.clone());
        if total_supply < amount {
            panic!("Total supply underflow");
        }

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(bal - amount));

        let new_total_supply = total_supply - amount;
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_total_supply);

        let burned_total = Self::burned_total(env.clone())
            .checked_add(amount)
            .expect("overflow");
        env.storage()
            .instance()
            .set(&DataKey::BurnedTotal, &burned_total);

        // Burn-velocity tracking (O(1) update)
        let now = env.ledger().timestamp();
        let window_seconds: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BurnWindowSeconds)
            .unwrap();
        let mut window_start: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BurnWindowStart)
            .unwrap();
        let mut burned_in_window: i128 = env
            .storage()
            .instance()
            .get(&DataKey::BurnedInWindow)
            .unwrap_or(0i128);

        if now.saturating_sub(window_start) >= window_seconds {
            window_start = now;
            burned_in_window = amount;
        } else {
            burned_in_window = burned_in_window.checked_add(amount).expect("overflow");
        }

        env.storage()
            .instance()
            .set(&DataKey::BurnWindowStart, &window_start);
        env.storage()
            .instance()
            .set(&DataKey::BurnedInWindow, &burned_in_window);

        let elapsed = now.saturating_sub(window_start).max(1);
        let velocity_per_sec = burned_in_window / (elapsed as i128);

        // Events (burn, supply-check, burn-velocity)
        env.events()
            .publish_event(&Burned { from, amount, new_total_supply });
        Self::_emit_supply_check(env, -amount, new_total_supply);
        env.events().publish_event(&BurnVelocityUpdated {
            window_start,
            now,
            burned_in_window,
            velocity_per_sec,
            window_seconds,
        });
    }
}

mod test;
