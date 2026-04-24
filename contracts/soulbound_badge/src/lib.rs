#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, contracterror,
    Address, Env, String, Vec,
};

// ── Storage types ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct Badge {
    /// Holder — immutable after issuance (soulbound).
    pub holder: Address,
    /// Off-chain metadata URI (e.g. IPFS).
    pub uri: String,
    /// Optional expiry ledger sequence (0 = no expiry).
    pub expires_at: u32,
    /// Whether the badge has been revoked by the issuer.
    pub revoked: bool,
}

#[contracttype]
enum DataKey {
    Admin,
    NextId,
    Badge(u32),
}

// ── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum BadgeError {
    AlreadyInitialized = 1,
    Unauthorized       = 2,
    NotFound           = 3,
    Expired            = 4,
    Revoked            = 5,
    Soulbound          = 6,
}

// ── Events ───────────────────────────────────────────────────────────────────

#[contractevent]
pub struct BadgeIssued {
    #[topic]
    pub badge_id:   u32,
    pub holder:     Address,
    pub uri:        String,
    pub expires_at: u32,
}

#[contractevent]
pub struct MetadataUpdated {
    #[topic]
    pub badge_id: u32,
    pub new_uri:  String,
}

#[contractevent]
pub struct BadgeRevoked {
    #[topic]
    pub badge_id: u32,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct SoulboundBadge;

#[contractimpl]
impl SoulboundBadge {
    /// One-time initialisation. `admin` is the sole issuer/revoker.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            env.panic_with_error(BadgeError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextId, &0u32);
    }

    // ── Internal helpers ─────────────────────────────────────────────────

    fn admin(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).expect("not initialized")
    }

    fn mint_one(env: &Env, holder: Address, uri: String, expires_at: u32) -> u32 {
        let id: u32 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        env.storage().instance().set(
            &DataKey::Badge(id),
            &Badge { holder: holder.clone(), uri: uri.clone(), expires_at, revoked: false },
        );
        env.storage().instance().set(&DataKey::NextId, &(id + 1));
        BadgeIssued { badge_id: id, holder, uri, expires_at }.publish(env);
        id
    }

    // ── Issuance ─────────────────────────────────────────────────────────

    /// Issue a single badge. `expires_at = 0` means no expiry.
    pub fn issue(env: Env, admin: Address, holder: Address, uri: String, expires_at: u32) -> u32 {
        admin.require_auth();
        if admin != Self::admin(&env) {
            env.panic_with_error(BadgeError::Unauthorized);
        }
        Self::mint_one(&env, holder, uri, expires_at)
    }

    /// Bulk-issue badges for an organisation event.
    pub fn bulk_issue(
        env: Env,
        admin: Address,
        holders: Vec<Address>,
        uri: String,
        expires_at: u32,
    ) -> Vec<u32> {
        admin.require_auth();
        if admin != Self::admin(&env) {
            env.panic_with_error(BadgeError::Unauthorized);
        }
        let mut ids = Vec::new(&env);
        for holder in holders.iter() {
            ids.push_back(Self::mint_one(&env, holder, uri.clone(), expires_at));
        }
        ids
    }

    // ── Metadata update ───────────────────────────────────────────────────

    /// Admin anchors updated metadata (e.g. new IPFS CID after enrichment).
    pub fn update_metadata(env: Env, admin: Address, badge_id: u32, new_uri: String) {
        admin.require_auth();
        if admin != Self::admin(&env) {
            env.panic_with_error(BadgeError::Unauthorized);
        }
        let mut badge: Badge = env
            .storage().instance().get(&DataKey::Badge(badge_id))
            .unwrap_or_else(|| env.panic_with_error(BadgeError::NotFound));
        badge.uri = new_uri.clone();
        env.storage().instance().set(&DataKey::Badge(badge_id), &badge);
        MetadataUpdated { badge_id, new_uri }.publish(&env);
    }

    // ── Revocation ────────────────────────────────────────────────────────

    /// Permanently revoke a badge (admin only).
    pub fn revoke(env: Env, admin: Address, badge_id: u32) {
        admin.require_auth();
        if admin != Self::admin(&env) {
            env.panic_with_error(BadgeError::Unauthorized);
        }
        let mut badge: Badge = env
            .storage().instance().get(&DataKey::Badge(badge_id))
            .unwrap_or_else(|| env.panic_with_error(BadgeError::NotFound));
        badge.revoked = true;
        env.storage().instance().set(&DataKey::Badge(badge_id), &badge);
        BadgeRevoked { badge_id }.publish(&env);
    }

    // ── Transfer guard (soulbound) ────────────────────────────────────────

    /// Always panics — badges are non-transferable by design.
    pub fn transfer(env: Env, _from: Address, _to: Address, _badge_id: u32) {
        env.panic_with_error(BadgeError::Soulbound);
    }

    // ── Queries ───────────────────────────────────────────────────────────

    /// Returns badge data. Panics if expired or revoked.
    pub fn get_badge(env: Env, badge_id: u32) -> Badge {
        let badge: Badge = env
            .storage().instance().get(&DataKey::Badge(badge_id))
            .unwrap_or_else(|| env.panic_with_error(BadgeError::NotFound));
        if badge.revoked {
            env.panic_with_error(BadgeError::Revoked);
        }
        if badge.expires_at > 0 && env.ledger().sequence() > badge.expires_at {
            env.panic_with_error(BadgeError::Expired);
        }
        badge
    }

    pub fn total_supply(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::NextId).unwrap_or(0)
    }
}

mod test;
