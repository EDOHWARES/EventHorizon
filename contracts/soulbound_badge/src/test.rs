#![cfg(test)]
use soroban_sdk::{testutils::{Address as _, Ledger}, vec, Address, Env, String};

use crate::{SoulboundBadge, SoulboundBadgeClient};

fn setup() -> (Env, SoulboundBadgeClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(SoulboundBadge, ());
    let admin = Address::generate(&env);
    let client = SoulboundBadgeClient::new(&env, &id);
    client.initialize(&admin);
    (env, client, admin)
}

fn uri(env: &Env) -> String { String::from_str(env, "ipfs://Qm123") }

// ── initialize ───────────────────────────────────────────────────────────────

#[test]
fn test_double_init_panics() {
    let (_, client, admin) = setup();
    assert!(client.try_initialize(&admin).is_err());
}

// ── issue / get_badge ────────────────────────────────────────────────────────

#[test]
fn test_issue_and_get() {
    let (env, client, admin) = setup();
    let holder = Address::generate(&env);
    let id = client.issue(&admin, &holder, &uri(&env), &0u32);
    let badge = client.get_badge(&id);
    assert_eq!(badge.holder, holder);
    assert!(!badge.revoked);
    assert_eq!(client.total_supply(), 1);
}

// ── soulbound: transfer always panics ────────────────────────────────────────

#[test]
fn test_transfer_panics() {
    let (env, client, admin) = setup();
    let holder = Address::generate(&env);
    let id = client.issue(&admin, &holder, &uri(&env), &0u32);
    let other = Address::generate(&env);
    assert!(client.try_transfer(&holder, &other, &id).is_err());
}

// ── revocation ───────────────────────────────────────────────────────────────

#[test]
fn test_revoke() {
    let (env, client, admin) = setup();
    let holder = Address::generate(&env);
    let id = client.issue(&admin, &holder, &uri(&env), &0u32);
    client.revoke(&admin, &id);
    assert!(client.try_get_badge(&id).is_err());
}

// ── expiration ───────────────────────────────────────────────────────────────

#[test]
fn test_expiry() {
    let (env, client, admin) = setup();
    let holder = Address::generate(&env);
    let id = client.issue(&admin, &holder, &uri(&env), &10u32);
    env.ledger().set_sequence_number(11);
    assert!(client.try_get_badge(&id).is_err());
}

// ── metadata update ───────────────────────────────────────────────────────────

#[test]
fn test_update_metadata() {
    let (env, client, admin) = setup();
    let holder = Address::generate(&env);
    let id = client.issue(&admin, &holder, &uri(&env), &0u32);
    let new_uri = String::from_str(&env, "ipfs://Qmnew");
    client.update_metadata(&admin, &id, &new_uri);
    assert_eq!(client.get_badge(&id).uri, new_uri);
}

// ── bulk issuance ─────────────────────────────────────────────────────────────

#[test]
fn test_bulk_issue() {
    let (env, client, admin) = setup();
    let holders = vec![
        &env,
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    let ids = client.bulk_issue(&admin, &holders, &uri(&env), &0u32);
    assert_eq!(ids.len(), 3);
    assert_eq!(client.total_supply(), 3);
    // Each badge is independently retrievable
    for i in 0..3u32 {
        assert!(!client.get_badge(&i).revoked);
    }
}

// ── unauthorized ──────────────────────────────────────────────────────────────

#[test]
fn test_unauthorized_issue() {
    let (env, client, _admin) = setup();
    let rogue = Address::generate(&env);
    let holder = Address::generate(&env);
    assert!(client.try_issue(&rogue, &holder, &uri(&env), &0u32).is_err());
}
