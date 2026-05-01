#![cfg(test)]
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    vec, Address, Env, Symbol,
};

use crate::{SessionAuth, SessionAuthClient};

fn setup() -> (Env, SessionAuthClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(SessionAuth, ());
    let client = SessionAuthClient::new(&env, &id);
    (env, client)
}

/// Returns true if the most-recently emitted events contain one with the given second topic.
fn last_event_action(env: &Env) -> Option<Symbol> {
    use soroban_sdk::TryFromVal;
    let events = env.events().all();
    let last = events.last()?;
    let topics: soroban_sdk::Vec<soroban_sdk::Val> = last.1;
    if topics.len() < 2 {
        return None;
    }
    let topic1: soroban_sdk::Val = topics.get(1).unwrap();
    Symbol::try_from_val(env, &topic1).ok()
}

// ── create_session ────────────────────────────────────────────────────────────

#[test]
fn test_create_session_emits_created_event() {
    let (env, client) = setup();
    let caller = Address::generate(&env);
    let privs = vec![&env, Symbol::new(&env, "read")];
    client.create_session(&caller, &3600u64, &privs);

    let action = last_event_action(&env).expect("no event emitted");
    assert_eq!(action, Symbol::new(&env, "created"));
}

#[test]
fn test_create_session_is_immediately_valid() {
    let (env, client) = setup();
    let caller = Address::generate(&env);
    let session_id = client.create_session(&caller, &3600u64, &vec![&env]);
    assert!(client.validate_session(&session_id));
}

#[test]
fn test_create_session_stores_correct_data() {
    let (env, client) = setup();
    let caller = Address::generate(&env);
    env.ledger().set_timestamp(1000);

    let privs = vec![&env, Symbol::new(&env, "admin")];
    let session_id = client.create_session(&caller, &500u64, &privs);

    let data = client.get_session(&session_id);
    assert_eq!(data.owner, caller);
    assert_eq!(data.expiry, 1500u64);
    assert_eq!(data.privileges, privs);
}

// ── validate_session ──────────────────────────────────────────────────────────

#[test]
fn test_validate_session_false_after_expiry() {
    let (env, client) = setup();
    let caller = Address::generate(&env);
    env.ledger().set_timestamp(0);

    let session_id = client.create_session(&caller, &100u64, &vec![&env]);
    assert!(client.validate_session(&session_id));

    env.ledger().set_timestamp(100);
    assert!(!client.validate_session(&session_id));
}

#[test]
fn test_validate_session_emits_expired_event() {
    let (env, client) = setup();
    let caller = Address::generate(&env);
    env.ledger().set_timestamp(0);

    let session_id = client.create_session(&caller, &50u64, &vec![&env]);
    env.ledger().set_timestamp(50);

    assert!(!client.validate_session(&session_id));

    let action = last_event_action(&env).expect("no event emitted");
    assert_eq!(action, Symbol::new(&env, "expired"));
}

#[test]
fn test_validate_nonexistent_session_returns_false() {
    let (env, client) = setup();
    let fake_id = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    assert!(!client.validate_session(&fake_id));
}

// ── get_session ───────────────────────────────────────────────────────────────

#[test]
fn test_get_session_panics_when_not_found() {
    let (env, client) = setup();
    let fake_id = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);
    assert!(client.try_get_session(&fake_id).is_err());
}

#[test]
fn test_get_session_panics_when_expired() {
    let (env, client) = setup();
    let caller = Address::generate(&env);
    env.ledger().set_timestamp(0);

    let session_id = client.create_session(&caller, &10u64, &vec![&env]);
    env.ledger().set_timestamp(10);

    assert!(client.try_get_session(&session_id).is_err());
}

// ── revoke_session ────────────────────────────────────────────────────────────

#[test]
fn test_revoke_session_removes_it() {
    let (env, client) = setup();
    let caller = Address::generate(&env);

    let session_id = client.create_session(&caller, &3600u64, &vec![&env]);
    assert!(client.validate_session(&session_id));

    client.revoke_session(&caller, &session_id);
    assert!(!client.validate_session(&session_id));
}

#[test]
fn test_revoke_session_emits_event() {
    let (env, client) = setup();
    let caller = Address::generate(&env);

    let session_id = client.create_session(&caller, &3600u64, &vec![&env]);
    client.revoke_session(&caller, &session_id);

    let action = last_event_action(&env).expect("no event emitted");
    assert_eq!(action, Symbol::new(&env, "revoked"));
}

#[test]
fn test_revoke_nonexistent_session_panics() {
    let (env, client) = setup();
    let caller = Address::generate(&env);
    let fake_id = soroban_sdk::BytesN::from_array(&env, &[2u8; 32]);
    assert!(client.try_revoke_session(&caller, &fake_id).is_err());
}

#[test]
fn test_revoke_by_non_owner_panics() {
    let (env, client) = setup();
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);

    let session_id = client.create_session(&owner, &3600u64, &vec![&env]);
    assert!(client.try_revoke_session(&attacker, &session_id).is_err());
}

// ── set_privileges ────────────────────────────────────────────────────────────

#[test]
fn test_set_privileges_updates_data() {
    let (env, client) = setup();
    let caller = Address::generate(&env);

    let session_id = client.create_session(
        &caller,
        &3600u64,
        &vec![&env, Symbol::new(&env, "read")],
    );
    let new_privs = vec![&env, Symbol::new(&env, "read"), Symbol::new(&env, "write")];
    client.set_privileges(&caller, &session_id, &new_privs);

    let data = client.get_session(&session_id);
    assert_eq!(data.privileges, new_privs);
}

#[test]
fn test_set_privileges_emits_event() {
    let (env, client) = setup();
    let caller = Address::generate(&env);

    let session_id = client.create_session(&caller, &3600u64, &vec![&env]);
    let new_privs = vec![&env, Symbol::new(&env, "write")];
    client.set_privileges(&caller, &session_id, &new_privs);

    let action = last_event_action(&env).expect("no event emitted");
    assert_eq!(action, Symbol::new(&env, "privilege_changed"));
}

#[test]
fn test_set_privileges_by_non_owner_panics() {
    let (env, client) = setup();
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);

    let session_id = client.create_session(&owner, &3600u64, &vec![&env]);
    assert!(client.try_set_privileges(&attacker, &session_id, &vec![&env]).is_err());
}

#[test]
fn test_set_privileges_on_expired_session_panics() {
    let (env, client) = setup();
    let caller = Address::generate(&env);
    env.ledger().set_timestamp(0);

    let session_id = client.create_session(&caller, &10u64, &vec![&env]);
    env.ledger().set_timestamp(10);

    assert!(client.try_set_privileges(&caller, &session_id, &vec![&env]).is_err());
}

// ── auth enforcement ──────────────────────────────────────────────────────────

#[test]
fn test_create_session_requires_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(SessionAuth, ());
    let client = SessionAuthClient::new(&env, &id);
    let caller = Address::generate(&env);

    client.create_session(&caller, &100u64, &vec![&env]);

    let auths = env.auths();
    assert!(!auths.is_empty());
    assert_eq!(auths[0].0, caller);
}
