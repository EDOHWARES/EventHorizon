#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, Symbol, Vec};

// ── Storage types ────────────────────────────────────────────────────────────

/// Status of a task in the queue.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskStatus {
    Pending,
    Cancelled,
}

/// A scheduled task.
#[contracttype]
#[derive(Clone)]
pub struct Task {
    pub id: u64,
    pub owner: Address,
    /// Ledger timestamp at or after which the task should be executed.
    pub trigger_at: u64,
    /// Arbitrary payload forwarded verbatim in the event for the off-chain worker.
    pub payload: Bytes,
    pub status: TaskStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Monotonic task-id counter (instance).
    NextId,
    /// Task record (persistent).
    Task(u64),
    /// List of task ids owned by an address (persistent).
    OwnerTasks(Address),
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct TaskScheduler;

#[contractimpl]
impl TaskScheduler {
    /// Register a new task.
    ///
    /// * `trigger_at` – ledger timestamp when the task should fire.
    /// * `payload`    – opaque bytes forwarded to the off-chain worker via event.
    ///
    /// Returns the new task id.
    pub fn schedule(env: Env, owner: Address, trigger_at: u64, payload: Bytes) -> u64 {
        owner.require_auth();

        let now = env.ledger().timestamp();
        if trigger_at <= now {
            panic!("trigger_at must be in the future");
        }

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(0u64);

        let task = Task {
            id,
            owner: owner.clone(),
            trigger_at,
            payload: payload.clone(),
            status: TaskStatus::Pending,
        };

        env.storage().persistent().set(&DataKey::Task(id), &task);

        // Append to owner index
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnerTasks(owner.clone()))
            .unwrap_or(Vec::new(&env));
        ids.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::OwnerTasks(owner.clone()), &ids);

        env.storage()
            .instance()
            .set(&DataKey::NextId, &(id + 1));

        env.events().publish(
            (Symbol::new(&env, "task_scheduled"), owner),
            (id, trigger_at, payload),
        );

        id
    }

    /// Bump (reschedule) a pending task to a new `trigger_at`.
    pub fn bump(env: Env, owner: Address, task_id: u64, new_trigger_at: u64) {
        owner.require_auth();

        let mut task: Task = env
            .storage()
            .persistent()
            .get(&DataKey::Task(task_id))
            .expect("Task not found");

        if task.owner != owner {
            panic!("Not task owner");
        }
        if task.status != TaskStatus::Pending {
            panic!("Task is not pending");
        }
        let now = env.ledger().timestamp();
        if new_trigger_at <= now {
            panic!("new_trigger_at must be in the future");
        }

        task.trigger_at = new_trigger_at;
        env.storage().persistent().set(&DataKey::Task(task_id), &task);

        env.events().publish(
            (Symbol::new(&env, "task_bumped"), owner),
            (task_id, new_trigger_at, task.payload),
        );
    }

    /// Cancel a pending task.
    pub fn cancel(env: Env, owner: Address, task_id: u64) {
        owner.require_auth();

        let mut task: Task = env
            .storage()
            .persistent()
            .get(&DataKey::Task(task_id))
            .expect("Task not found");

        if task.owner != owner {
            panic!("Not task owner");
        }
        if task.status != TaskStatus::Pending {
            panic!("Task is not pending");
        }

        task.status = TaskStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Task(task_id), &task);

        env.events().publish(
            (Symbol::new(&env, "task_cancelled"), owner),
            (task_id, task.payload),
        );
    }

    /// Fetch a single task by id.
    pub fn get_task(env: Env, task_id: u64) -> Task {
        env.storage()
            .persistent()
            .get(&DataKey::Task(task_id))
            .expect("Task not found")
    }

    /// Return all task ids registered by `owner`.
    pub fn get_owner_tasks(env: Env, owner: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::OwnerTasks(owner))
            .unwrap_or(Vec::new(&env))
    }
}

mod test;
