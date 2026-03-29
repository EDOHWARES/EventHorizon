#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

fn setup(num_outcomes: u32) -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let contract_id = env.register(PredictionMarket, ());
    PredictionMarketClient::new(&env, &contract_id)
        .initialize(&admin, &token_addr, &num_outcomes);
    (env, admin, token_addr, contract_id)
}

fn fund(env: &Env, _admin: &Address, token: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

// ── Basic flow ────────────────────────────────────────────────────────────────

#[test]
fn test_place_bet_and_settle_winner_takes_all() {
    // 2 outcomes: only one bettor on outcome 0 → gets entire pool
    let (env, admin, token, vault) = setup(2);
    let client = PredictionMarketClient::new(&env, &vault);
    let token_client = TokenClient::new(&env, &token);

    let alice = Address::generate(&env);
    fund(&env, &admin, &token, &alice, 1000);

    client.place_bet(&alice, &0u32, &1000i128);
    assert_eq!(client.get_total_pool(), 1000);
    assert_eq!(client.get_outcome_pool(&0u32), 1000);

    client.settle_market(&0u32);
    assert_eq!(client.get_status(), MarketStatus::Settled);

    // Alice bet 1000 on outcome 0, winning pool = 1000, total = 1000 → payout = 1000
    let payout = client.claim(&alice);
    assert_eq!(payout, 1000);
    assert_eq!(token_client.balance(&alice), 1000);
}

#[test]
fn test_parimutuel_payout_split() {
    // outcome 0: alice 300, bob 700 → total 1000
    // outcome 1: carol 500 → total 1500 overall
    // settle outcome 0: winning_pool = 1000, total = 1500
    // alice payout = 300 * 1500 / 1000 = 450
    // bob   payout = 700 * 1500 / 1000 = 1050
    let (env, admin, token, vault) = setup(2);
    let client = PredictionMarketClient::new(&env, &vault);
    let token_client = TokenClient::new(&env, &token);

    let alice = Address::generate(&env);
    let bob   = Address::generate(&env);
    let carol = Address::generate(&env);
    fund(&env, &admin, &token, &alice, 300);
    fund(&env, &admin, &token, &bob,   700);
    fund(&env, &admin, &token, &carol, 500);

    client.place_bet(&alice, &0u32, &300i128);
    client.place_bet(&bob,   &0u32, &700i128);
    client.place_bet(&carol, &1u32, &500i128);

    assert_eq!(client.get_total_pool(), 1500);
    assert_eq!(client.get_outcome_pool(&0u32), 1000);
    assert_eq!(client.get_outcome_pool(&1u32), 500);

    client.settle_market(&0u32);

    assert_eq!(client.claim(&alice), 450);
    assert_eq!(client.claim(&bob),   1050);
    assert_eq!(token_client.balance(&alice), 450);
    assert_eq!(token_client.balance(&bob),   1050);
}

#[test]
fn test_cancel_market_full_refund() {
    let (env, admin, token, vault) = setup(3);
    let client = PredictionMarketClient::new(&env, &vault);
    let token_client = TokenClient::new(&env, &token);

    let alice = Address::generate(&env);
    fund(&env, &admin, &token, &alice, 600);
    client.place_bet(&alice, &0u32, &400i128);
    client.place_bet(&alice, &2u32, &200i128);

    client.cancel_market();
    assert_eq!(client.get_status(), MarketStatus::Cancelled);

    let refund = client.claim(&alice);
    assert_eq!(refund, 600);
    assert_eq!(token_client.balance(&alice), 600);
}

// ── Guards ────────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Already claimed")]
fn test_double_claim_panics() {
    let (env, admin, token, vault) = setup(2);
    let client = PredictionMarketClient::new(&env, &vault);
    let alice = Address::generate(&env);
    fund(&env, &admin, &token, &alice, 500);
    client.place_bet(&alice, &0u32, &500i128);
    client.settle_market(&0u32);
    client.claim(&alice);
    client.claim(&alice);
}

#[test]
#[should_panic(expected = "No winning stake")]
fn test_claim_losing_side_panics() {
    let (env, admin, token, vault) = setup(2);
    let client = PredictionMarketClient::new(&env, &vault);
    let alice = Address::generate(&env);
    let bob   = Address::generate(&env);
    fund(&env, &admin, &token, &alice, 500);
    fund(&env, &admin, &token, &bob,   500);
    client.place_bet(&alice, &0u32, &500i128);
    client.place_bet(&bob,   &1u32, &500i128);
    client.settle_market(&0u32); // outcome 0 wins
    client.claim(&bob);          // bob bet on 1 → no winning stake
}

#[test]
#[should_panic(expected = "Wrong market status")]
fn test_bet_after_settle_panics() {
    let (env, admin, token, vault) = setup(2);
    let client = PredictionMarketClient::new(&env, &vault);
    let alice = Address::generate(&env);
    fund(&env, &admin, &token, &alice, 1000);
    client.place_bet(&alice, &0u32, &500i128);
    client.settle_market(&0u32);
    client.place_bet(&alice, &1u32, &500i128);
}

#[test]
#[should_panic(expected = "Invalid outcome")]
fn test_invalid_outcome_panics() {
    let (env, admin, token, vault) = setup(2);
    let client = PredictionMarketClient::new(&env, &vault);
    let alice = Address::generate(&env);
    fund(&env, &admin, &token, &alice, 100);
    client.place_bet(&alice, &5u32, &100i128); // outcome 5 doesn't exist
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_init_panics() {
    let (env, admin, token, vault) = setup(2);
    PredictionMarketClient::new(&env, &vault).initialize(&admin, &token, &2);
}

#[test]
fn test_multiple_bets_same_bettor_same_outcome() {
    let (env, admin, token, vault) = setup(2);
    let client = PredictionMarketClient::new(&env, &vault);
    let alice = Address::generate(&env);
    fund(&env, &admin, &token, &alice, 1000);

    client.place_bet(&alice, &0u32, &400i128);
    client.place_bet(&alice, &0u32, &600i128);
    assert_eq!(client.get_bets(&alice).get(0u32).unwrap(), 1000);
    assert_eq!(client.get_total_pool(), 1000);

    client.settle_market(&0u32);
    assert_eq!(client.claim(&alice), 1000);
}
