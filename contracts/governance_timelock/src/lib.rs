#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, symbol_short};

// ── Data Structures ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OperationStatus {
    Pending,
    Executed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct TimelockOperation {
    pub id: u64,
    pub proposer: Address,
    pub description: Symbol,
    pub eta: u64,           // Earliest execution timestamp
    pub status: OperationStatus,
    pub is_emergency: bool,
}

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    Paused,
    Delay,          // Minimum delay in seconds before execution
    OperationCount,
    Operation(u64),
    Guardian,       // Emergency guardian address
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct GovernanceTimelock;

#[contractimpl]
impl GovernanceTimelock {
    // ── Initialization ────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, guardian: Address, delay: u64) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Guardian, &guardian);
        env.storage().instance().set(&DataKey::Delay, &delay);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::OperationCount, &0u64);
    }

    // ── Pause / Resume ────────────────────────────────────────────────────

    /// Admin pauses the timelock — no new operations can be queued or executed.
    pub fn pause(env: Env) {
        Self::_require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (symbol_short!("paused"), env.ledger().timestamp()),
            true,
        );
    }

    /// Guardian performs an emergency resume, bypassing normal admin flow.
    /// Emits an override event for full auditability.
    pub fn emergency_resume(env: Env) {
        let guardian: Address = env
            .storage()
            .instance()
            .get(&DataKey::Guardian)
            .expect("Not initialized");
        guardian.require_auth();

        let was_paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);

        env.storage().instance().set(&DataKey::Paused, &false);

        // Event-based tracking of every override attempt
        env.events().publish(
            (Symbol::new(&env, "emergency_resume"), guardian.clone()),
            (was_paused, env.ledger().timestamp()),
        );
    }

    // ── Operation Lifecycle ───────────────────────────────────────────────

    /// Queue a new protocol change operation. Enforces the delay period.
    pub fn queue_operation(env: Env, proposer: Address, description: Symbol) -> u64 {
        Self::_require_not_paused(&env);
        proposer.require_auth();

        let delay: u64 = env.storage().instance().get(&DataKey::Delay).unwrap();
        let eta = env.ledger().timestamp() + delay;

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::OperationCount)
            .unwrap_or(0);
        let op_id = count + 1;

        let op = TimelockOperation {
            id: op_id,
            proposer: proposer.clone(),
            description: description.clone(),
            eta,
            status: OperationStatus::Pending,
            is_emergency: false,
        };

        env.storage().persistent().set(&DataKey::Operation(op_id), &op);
        env.storage().instance().set(&DataKey::OperationCount, &op_id);

        env.events().publish(
            (Symbol::new(&env, "op_queued"), op_id),
            (proposer, description, eta),
        );

        op_id
    }

    /// Execute a queued operation after its delay has elapsed.
    pub fn execute_operation(env: Env, op_id: u64) {
        Self::_require_not_paused(&env);

        let mut op: TimelockOperation = env
            .storage()
            .persistent()
            .get(&DataKey::Operation(op_id))
            .expect("Operation not found");

        if op.status != OperationStatus::Pending {
            panic!("Operation not pending");
        }
        if env.ledger().timestamp() < op.eta {
            panic!("Timelock delay not elapsed");
        }

        op.status = OperationStatus::Executed;
        env.storage().persistent().set(&DataKey::Operation(op_id), &op);

        env.events().publish(
            (Symbol::new(&env, "op_executed"), op_id),
            env.ledger().timestamp(),
        );
    }

    /// Cancel a pending operation. Admin only.
    pub fn cancel_operation(env: Env, op_id: u64) {
        Self::_require_admin(&env);

        let mut op: TimelockOperation = env
            .storage()
            .persistent()
            .get(&DataKey::Operation(op_id))
            .expect("Operation not found");

        if op.status != OperationStatus::Pending {
            panic!("Operation not pending");
        }

        op.status = OperationStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Operation(op_id), &op);

        env.events().publish(
            (symbol_short!("op_cancel"), op_id),
            env.ledger().timestamp(),
        );
    }

    /// Emergency execute: guardian can bypass the delay for critical security fixes.
    /// Every attempt is tracked via an event regardless of outcome.
    pub fn emergency_execute(env: Env, op_id: u64) {
        let guardian: Address = env
            .storage()
            .instance()
            .get(&DataKey::Guardian)
            .expect("Not initialized");
        guardian.require_auth();

        // Track the override attempt unconditionally
        env.events().publish(
            (Symbol::new(&env, "emergency_override"), op_id),
            (guardian.clone(), env.ledger().timestamp()),
        );

        let mut op: TimelockOperation = env
            .storage()
            .persistent()
            .get(&DataKey::Operation(op_id))
            .expect("Operation not found");

        if op.status != OperationStatus::Pending {
            panic!("Operation not pending");
        }

        op.status = OperationStatus::Executed;
        op.is_emergency = true;
        env.storage().persistent().set(&DataKey::Operation(op_id), &op);

        env.events().publish(
            (Symbol::new(&env, "emergency_executed"), op_id),
            env.ledger().timestamp(),
        );
    }

    // ── Admin Config ──────────────────────────────────────────────────────

    /// Update the timelock delay. Admin only.
    pub fn set_delay(env: Env, new_delay: u64) {
        Self::_require_admin(&env);
        env.storage().instance().set(&DataKey::Delay, &new_delay);
        env.events().publish(
            (symbol_short!("delay_set"), new_delay),
            env.ledger().timestamp(),
        );
    }

    // ── View Functions ────────────────────────────────────────────────────

    pub fn get_operation(env: Env, op_id: u64) -> TimelockOperation {
        env.storage()
            .persistent()
            .get(&DataKey::Operation(op_id))
            .expect("Operation not found")
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    pub fn get_delay(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Delay).unwrap_or(0)
    }

    pub fn get_operation_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::OperationCount).unwrap_or(0)
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

    fn _require_not_paused(env: &Env) {
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused {
            panic!("Contract is paused");
        }
    }
}

mod test;
