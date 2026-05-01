#![cfg(test)]
use soroban_sdk::{testutils::Events, vec, Address, Env, Symbol, Val, Vec};

use crate::{GasEstimator, GasEstimatorClient, SimResult};

// ---------------------------------------------------------------------------
// Minimal target contract used as the call target in tests
// ---------------------------------------------------------------------------
mod target {
    use soroban_sdk::{contract, contractimpl, Env, Symbol};

    #[contract]
    pub struct Target;

    #[contractimpl]
    impl Target {
        pub fn ok(env: Env) -> Symbol {
            Symbol::new(&env, "ok")
        }

        pub fn fail(_env: Env) {
            panic!("intentional failure");
        }
    }
}

fn setup() -> (Env, GasEstimatorClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let estimator_id = env.register(GasEstimator, ());
    let target_id = env.register(target::Target, ());

    let client = GasEstimatorClient::new(&env, &estimator_id);
    (env, client, target_id)
}

// ---------------------------------------------------------------------------
// simulate – successful call
// ---------------------------------------------------------------------------
#[test]
fn test_simulate_success() {
    let (env, client, target) = setup();

    let args: Vec<Val> = vec![&env];
    let res: SimResult = client.simulate(&1u32, &target, &Symbol::new(&env, "ok"), &args);

    assert!(res.success);
    assert_eq!(res.call_id, 1);

    // Verify sim_result event was emitted
    assert!(!env.events().all().is_empty());
}

// ---------------------------------------------------------------------------
// simulate – failing call must NOT revert the outer transaction
// ---------------------------------------------------------------------------
#[test]
fn test_simulate_failure_does_not_revert() {
    let (env, client, target) = setup();

    let args: Vec<Val> = vec![&env];
    let res: SimResult = client.simulate(&2u32, &target, &Symbol::new(&env, "fail"), &args);

    assert!(!res.success);
    assert_eq!(res.call_id, 2);
    // Event still emitted even on inner failure
    assert!(!env.events().all().is_empty());
}

// ---------------------------------------------------------------------------
// simulate_batch – mixed success / failure
// ---------------------------------------------------------------------------
#[test]
fn test_simulate_batch() {
    let (env, client, target) = setup();

    let empty: Vec<Val> = vec![&env];
    let calls: Vec<(u32, Address, Symbol, Vec<Val>)> = vec![
        &env,
        (1u32, target.clone(), Symbol::new(&env, "ok"), empty.clone()),
        (
            2u32,
            target.clone(),
            Symbol::new(&env, "fail"),
            empty.clone(),
        ),
        (3u32, target.clone(), Symbol::new(&env, "ok"), empty.clone()),
    ];

    let results = client.simulate_batch(&calls);

    assert_eq!(results.len(), 3);
    assert!(results.get(0).unwrap().success);
    assert!(!results.get(1).unwrap().success);
    assert!(results.get(2).unwrap().success);

    // One event per call
    assert_eq!(env.events().all().len(), 3);
}

// ---------------------------------------------------------------------------
// Budget / resource measurement (testutils only)
// ---------------------------------------------------------------------------
#[test]
fn test_budget_is_consumed() {
    let (env, client, target) = setup();

    let args: Vec<Val> = vec![&env];
    client.simulate(&1u32, &target, &Symbol::new(&env, "ok"), &args);

    // After a contract invocation the host budget must show non-zero CPU usage.
    let cpu = env.cost_estimate().budget().cpu_instruction_cost();
    assert!(
        cpu > 0,
        "CPU instructions should be non-zero after simulate"
    );
}
