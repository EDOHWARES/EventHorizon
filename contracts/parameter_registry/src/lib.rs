#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    Governance,
    Param(Symbol), // per-parameter value
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct ParameterRegistry;

#[contractimpl]
impl ParameterRegistry {
    // ── Initialization ────────────────────────────────────────────────────

    /// Initialize the registry. Can only be called once.
    /// `admin`      – bootstrap admin (can transfer governance later).
    /// `governance` – address allowed to update parameters (e.g. a DAO contract).
    pub fn initialize(env: Env, admin: Address, governance: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Governance, &governance);

        env.events().publish(
            (symbol_short!("init"), admin.clone()),
            governance,
        );
    }

    // ── Governance Config ─────────────────────────────────────────────────

    /// Transfer governance to a new address. Admin only.
    pub fn set_governance(env: Env, new_governance: Address) {
        Self::_require_admin(&env);
        let old: Address = env.storage().instance().get(&DataKey::Governance).unwrap();
        env.storage().instance().set(&DataKey::Governance, &new_governance);

        env.events().publish(
            (Symbol::new(&env, "gov_changed"), old),
            new_governance,
        );
    }

    // ── Parameter Management ──────────────────────────────────────────────

    /// Set (or update) a protocol parameter. Governance only.
    /// `key`   – parameter name (e.g. `Symbol::new(&env, "protocol_fee")`).
    /// `value` – i128 value (use basis-points or fixed-point as appropriate).
    pub fn set_param(env: Env, key: Symbol, value: i128) {
        Self::_require_governance(&env);

        let old: Option<i128> = env.storage().persistent().get(&DataKey::Param(key.clone()));

        env.storage().persistent().set(&DataKey::Param(key.clone()), &value);

        env.events().publish(
            (Symbol::new(&env, "param_set"), key),
            (old.unwrap_or(0), value),
        );
    }

    /// Remove a parameter. Governance only.
    pub fn remove_param(env: Env, key: Symbol) {
        Self::_require_governance(&env);

        let old: Option<i128> = env.storage().persistent().get(&DataKey::Param(key.clone()));
        if old.is_none() {
            panic!("Parameter not found");
        }

        env.storage().persistent().remove(&DataKey::Param(key.clone()));

        env.events().publish(
            (Symbol::new(&env, "param_removed"), key),
            old.unwrap(),
        );
    }

    // ── View Functions ────────────────────────────────────────────────────

    /// Get a parameter value. Panics if not set.
    pub fn get_param(env: Env, key: Symbol) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Param(key))
            .expect("Parameter not found")
    }

    /// Get a parameter value, returning a default if not set.
    pub fn get_param_or_default(env: Env, key: Symbol, default: i128) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Param(key))
            .unwrap_or(default)
    }

    /// Returns true if the parameter exists.
    pub fn has_param(env: Env, key: Symbol) -> bool {
        env.storage().persistent().has(&DataKey::Param(key))
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).expect("Not initialized")
    }

    pub fn get_governance(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Governance).expect("Not initialized")
    }

    // ── Internal Helpers ──────────────────────────────────────────────────

    fn _require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();
    }

    fn _require_governance(env: &Env) {
        let gov: Address = env
            .storage()
            .instance()
            .get(&DataKey::Governance)
            .expect("Not initialized");
        gov.require_auth();
    }
}

mod test;
