#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, symbol_short};

// ── Permission Levels ─────────────────────────────────────────────────────────
//
// Hierarchical: SuperAdmin > Admin > Operator > User
// Each level can grant/revoke permissions at or below its own level.

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum PermissionLevel {
    None,       // 0 — not whitelisted
    User,       // 1 — can create triggers
    Operator,   // 2 — can manage triggers + users
    Admin,      // 3 — can manage operators + users
    SuperAdmin, // 4 — full control
}

// ── Storage Keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    SuperAdmin,
    Permission(Address),
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct AccessWhitelist;

#[contractimpl]
impl AccessWhitelist {
    // ── Initialization ────────────────────────────────────────────────────

    pub fn initialize(env: Env, super_admin: Address) {
        if env.storage().instance().has(&DataKey::SuperAdmin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::SuperAdmin, &super_admin);
        // Grant super_admin the SuperAdmin level
        env.storage()
            .persistent()
            .set(&DataKey::Permission(super_admin.clone()), &PermissionLevel::SuperAdmin);

        env.events().publish(
            (Symbol::new(&env, "access_granted"), super_admin.clone()),
            (PermissionLevel::SuperAdmin, super_admin),
        );
    }

    // ── Grant / Revoke ────────────────────────────────────────────────────

    /// Grant a permission level to an address.
    /// Caller must hold a level strictly higher than the level being granted.
    pub fn grant(env: Env, caller: Address, target: Address, level: PermissionLevel) {
        caller.require_auth();

        if level == PermissionLevel::None {
            panic!("Use revoke to remove access");
        }

        let caller_level = Self::_get_level(&env, &caller);
        Self::_require_higher(&caller_level, &level);

        let old_level = Self::_get_level(&env, &target);

        env.storage()
            .persistent()
            .set(&DataKey::Permission(target.clone()), &level);

        env.events().publish(
            (Symbol::new(&env, "access_granted"), target.clone()),
            (level, caller, old_level),
        );
    }

    /// Revoke access from an address (sets to None).
    /// Caller must hold a level strictly higher than the target's current level.
    pub fn revoke(env: Env, caller: Address, target: Address) {
        caller.require_auth();

        let caller_level = Self::_get_level(&env, &caller);
        let target_level = Self::_get_level(&env, &target);

        if target_level == PermissionLevel::None {
            panic!("Address has no access");
        }

        Self::_require_higher(&caller_level, &target_level);

        env.storage()
            .persistent()
            .set(&DataKey::Permission(target.clone()), &PermissionLevel::None);

        env.events().publish(
            (Symbol::new(&env, "access_revoked"), target.clone()),
            (target_level, caller),
        );
    }

    /// Self-revoke: an address can always remove its own access.
    pub fn renounce(env: Env, caller: Address) {
        caller.require_auth();

        let level = Self::_get_level(&env, &caller);
        if level == PermissionLevel::None {
            panic!("No access to renounce");
        }

        env.storage()
            .persistent()
            .set(&DataKey::Permission(caller.clone()), &PermissionLevel::None);

        env.events().publish(
            (symbol_short!("renounced"), caller.clone()),
            level,
        );
    }

    // ── Access Checks ─────────────────────────────────────────────────────

    /// Returns true if the address holds at least the given permission level.
    pub fn has_access(env: Env, addr: Address, required: PermissionLevel) -> bool {
        let level = Self::_get_level(&env, &addr);
        level >= required
    }

    /// Returns the exact permission level of an address.
    pub fn get_permission(env: Env, addr: Address) -> PermissionLevel {
        Self::_get_level(&env, &addr)
    }

    // ── SuperAdmin Transfer ───────────────────────────────────────────────

    /// Transfer super admin role to a new address. SuperAdmin only.
    pub fn transfer_super_admin(env: Env, current: Address, new_admin: Address) {
        current.require_auth();

        let level = Self::_get_level(&env, &current);
        if level != PermissionLevel::SuperAdmin {
            panic!("Only SuperAdmin can transfer role");
        }

        // Revoke old super admin
        env.storage()
            .persistent()
            .set(&DataKey::Permission(current.clone()), &PermissionLevel::None);

        // Grant new super admin
        env.storage()
            .persistent()
            .set(&DataKey::Permission(new_admin.clone()), &PermissionLevel::SuperAdmin);
        env.storage().instance().set(&DataKey::SuperAdmin, &new_admin);

        env.events().publish(
            (Symbol::new(&env, "super_admin_xfer"), new_admin.clone()),
            (current, new_admin),
        );
    }

    // ── Internal Helpers ──────────────────────────────────────────────────

    fn _get_level(env: &Env, addr: &Address) -> PermissionLevel {
        env.storage()
            .persistent()
            .get(&DataKey::Permission(addr.clone()))
            .unwrap_or(PermissionLevel::None)
    }

    /// Panics if `caller_level` is not strictly greater than `target_level`.
    fn _require_higher(caller_level: &PermissionLevel, target_level: &PermissionLevel) {
        if caller_level <= target_level {
            panic!("Insufficient permission level");
        }
    }
}

mod test;
