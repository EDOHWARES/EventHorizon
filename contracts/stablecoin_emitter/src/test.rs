#![cfg(test)]
use crate::{Action, StablecoinEmitter, StablecoinEmitterClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, Vec,
};

#[test]
fn test_propose_and_execute_full_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let contract_id = env.register(StablecoinEmitter, ());
    let client = StablecoinEmitterClient::new(&env, &contract_id);

    client.initialize(
        &vec![&env, admin1.clone(), admin2.clone()],
        &2,
        &3600,
        &token,
    );

    // Propose
    let proposal_id = client.propose(&admin1, &Action::Mint, &1000, &recipient);

    // Approve
    client.approve(&admin2, &proposal_id);

    // Advance ledger to exactly the timelock
    env.ledger().set_timestamp(3600);
    client.execute(&admin1, &proposal_id);
}

#[test]
#[should_panic(expected = "Threshold not met")]
fn test_threshold_not_met() {
    let env = Env::default();
    env.mock_all_auths();
    let admin1 = Address::generate(&env);
    let token = Address::generate(&env);
    let contract_id = env.register(StablecoinEmitter, ());
    let client = StablecoinEmitterClient::new(&env, &contract_id);
    client.initialize(
        &vec![&env, admin1.clone(), Address::generate(&env)],
        &2,
        &0,
        &token,
    );
    let id = client.propose(&admin1, &Action::Mint, &100, &admin1);
    client.execute(&admin1, &id);
}

#[test]
#[should_panic(expected = "Timelock period not ended")]
fn test_timelock_not_met() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let contract_id = env.register(StablecoinEmitter, ());
    let client = StablecoinEmitterClient::new(&env, &contract_id);
    client.initialize(&vec![&env, admin.clone()], &1, &100, &token);
    let id = client.propose(&admin, &Action::Mint, &100, &admin);
    env.ledger().set_timestamp(99);
    client.execute(&admin, &id);
}

#[test]
#[should_panic(expected = "Not an admin")]
fn test_non_admin_propose() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let token = Address::generate(&env);
    let contract_id = env.register(StablecoinEmitter, ());
    let client = StablecoinEmitterClient::new(&env, &contract_id);
    client.initialize(&vec![&env, admin], &1, &0, &token);
    client.propose(&non_admin, &Action::Mint, &100, &non_admin);
}
