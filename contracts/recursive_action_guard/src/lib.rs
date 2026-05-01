#![no_std]
use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, Env, Symbol};

// ── Constants ─────────────────────────────────────────────────────────────────

/// Maximum allowed call depth before a trigger is blocked.
const MAX_DEPTH: u32 = 5;

// ── Storage Keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    MaxDepth,
    /// Current call depth for a (caller, action) pair.
    Depth(Address, Symbol),
}

// ── Events ────────────────────────────────────────────────────────────────────

/// Emitted when a trigger is allowed to proceed.
#[contractevent]
pub struct ActionEntered {
    pub caller: Address,
    pub action: Symbol,
    pub depth: u32,
}

/// Emitted when a trigger exits normally.
#[contractevent]
pub struct ActionExited {
    pub caller: Address,
    pub action: Symbol,
    pub depth: u32,
}

/// Emitted when a recursive loop is detected and the action is blocked.
#[contractevent]
pub struct LoopDetected {
    pub caller: Address,
    pub action: Symbol,
    pub depth: u32,
    pub max_depth: u32,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct RecursiveActionGuard;

#[contractimpl]
impl RecursiveActionGuard {
    // ── Initialization ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, max_depth: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        if max_depth == 0 { panic!("max_depth must be > 0"); }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::MaxDepth, &max_depth);
    }

    // ── Guard API ─────────────────────────────────────────────────────────────

    /// Called before executing a trigger action.
    /// Increments the depth counter for (caller, action).
    /// Panics (blocking the action) if depth would exceed max_depth.
    pub fn enter(env: Env, caller: Address, action: Symbol) -> u32 {
        caller.require_auth();

        let key = DataKey::Depth(caller.clone(), action.clone());
        let depth: u32 = env.storage().temporary().get(&key).unwrap_or(0);
        let max: u32 = env.storage().instance().get(&DataKey::MaxDepth).unwrap_or(MAX_DEPTH);

        if depth >= max {
            env.events().publish_event(&LoopDetected {
                caller,
                action,
                depth,
                max_depth: max,
            });
            panic!("Recursive loop detected");
        }

        let new_depth = depth + 1;
        env.storage().temporary().set(&key, &new_depth);

        env.events().publish_event(&ActionEntered {
            caller,
            action,
            depth: new_depth,
        });

        new_depth
    }

    /// Called after a trigger action completes (success or failure).
    /// Decrements the depth counter for (caller, action).
    pub fn exit(env: Env, caller: Address, action: Symbol) -> u32 {
        caller.require_auth();

        let key = DataKey::Depth(caller.clone(), action.clone());
        let depth: u32 = env.storage().temporary().get(&key).unwrap_or(0);

        if depth == 0 { panic!("No active entry to exit"); }

        let new_depth = depth - 1;
        if new_depth == 0 {
            env.storage().temporary().remove(&key);
        } else {
            env.storage().temporary().set(&key, &new_depth);
        }

        env.events().publish_event(&ActionExited {
            caller,
            action,
            depth: new_depth,
        });

        new_depth
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_depth(env: Env, caller: Address, action: Symbol) -> u32 {
        env.storage().temporary()
            .get(&DataKey::Depth(caller, action))
            .unwrap_or(0)
    }

    pub fn get_max_depth(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::MaxDepth).unwrap_or(MAX_DEPTH)
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Update the maximum allowed depth.
    pub fn set_max_depth(env: Env, max_depth: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if max_depth == 0 { panic!("max_depth must be > 0"); }
        env.storage().instance().set(&DataKey::MaxDepth, &max_depth);
    }
}

mod test;
