#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Bytes, BytesN, Env, Symbol, Vec,
};

// ── Storage types ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionData {
    pub owner:      Address,
    pub expiry:     u64,
    pub privileges: Vec<Symbol>,
}

#[contracttype]
enum DataKey {
    Session(BytesN<32>),
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SessionError {
    NotFound    = 1,
    Expired     = 2,
    Unauthorized = 3,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct SessionAuth;

#[contractimpl]
impl SessionAuth {
    /// Creates a new session for `caller` lasting `duration` seconds.
    /// Returns the 32-byte session ID derived from the ledger's prng.
    pub fn create_session(
        env: Env,
        caller: Address,
        duration: u64,
        privileges: Vec<Symbol>,
    ) -> BytesN<32> {
        caller.require_auth();

        // Generate a unique session ID: sha256 of a random 32-byte value
        let rand: [u8; 32] = env.prng().gen();
        let session_id: BytesN<32> = env.crypto().sha256(
            &Bytes::from_slice(&env, &rand)
        ).into();

        let expiry = env.ledger().timestamp() + duration;
        let data = SessionData { owner: caller.clone(), expiry, privileges: privileges.clone() };
        env.storage().persistent().set(&DataKey::Session(session_id.clone()), &data);

        env.events().publish(
            (Symbol::new(&env, "session"), Symbol::new(&env, "created")),
            (session_id.clone(), caller),
        );

        session_id
    }

    /// Revokes an active session. Only the session owner may revoke.
    pub fn revoke_session(env: Env, caller: Address, session_id: BytesN<32>) {
        caller.require_auth();

        let data: SessionData = env
            .storage()
            .persistent()
            .get(&DataKey::Session(session_id.clone()))
            .unwrap_or_else(|| panic_with_error(&env, SessionError::NotFound));

        if data.owner != caller {
            panic_with_error(&env, SessionError::Unauthorized);
        }

        env.storage().persistent().remove(&DataKey::Session(session_id.clone()));

        env.events().publish(
            (Symbol::new(&env, "session"), Symbol::new(&env, "revoked")),
            (session_id, caller),
        );
    }

    /// Returns `true` if the session exists and has not expired.
    /// Cleans up expired sessions on access.
    pub fn validate_session(env: Env, session_id: BytesN<32>) -> bool {
        match env
            .storage()
            .persistent()
            .get::<DataKey, SessionData>(&DataKey::Session(session_id.clone()))
        {
            None => false,
            Some(data) => {
                if env.ledger().timestamp() >= data.expiry {
                    // Lazy cleanup: remove expired session
                    env.storage().persistent().remove(&DataKey::Session(session_id.clone()));
                    env.events().publish(
                        (Symbol::new(&env, "session"), Symbol::new(&env, "expired")),
                        session_id,
                    );
                    false
                } else {
                    true
                }
            }
        }
    }

    /// Returns the `SessionData` for a session, panicking if not found or expired.
    pub fn get_session(env: Env, session_id: BytesN<32>) -> SessionData {
        let data: SessionData = env
            .storage()
            .persistent()
            .get(&DataKey::Session(session_id.clone()))
            .unwrap_or_else(|| panic_with_error(&env, SessionError::NotFound));

        if env.ledger().timestamp() >= data.expiry {
            env.storage().persistent().remove(&DataKey::Session(session_id.clone()));
            env.events().publish(
                (Symbol::new(&env, "session"), Symbol::new(&env, "expired")),
                session_id,
            );
            panic_with_error(&env, SessionError::Expired);
        }

        data
    }

    /// Replaces the privilege list on an active session. Only the owner may call this.
    pub fn set_privileges(
        env: Env,
        caller: Address,
        session_id: BytesN<32>,
        new_privileges: Vec<Symbol>,
    ) {
        caller.require_auth();

        let mut data: SessionData = env
            .storage()
            .persistent()
            .get(&DataKey::Session(session_id.clone()))
            .unwrap_or_else(|| panic_with_error(&env, SessionError::NotFound));

        if data.owner != caller {
            panic_with_error(&env, SessionError::Unauthorized);
        }
        if env.ledger().timestamp() >= data.expiry {
            env.storage().persistent().remove(&DataKey::Session(session_id.clone()));
            panic_with_error(&env, SessionError::Expired);
        }

        data.privileges = new_privileges.clone();
        env.storage().persistent().set(&DataKey::Session(session_id.clone()), &data);

        env.events().publish(
            (Symbol::new(&env, "session"), Symbol::new(&env, "privilege_changed")),
            (session_id, new_privileges),
        );
    }
}

/// Helper: panic with a `SessionError` value.
#[inline(never)]
fn panic_with_error(env: &Env, err: SessionError) -> ! {
    env.panic_with_error(err)
}

mod test;
