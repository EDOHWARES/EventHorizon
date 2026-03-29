#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Map, String, Symbol, Vec,
};

/// Royalty info stored per token (index) — shares expressed as basis points (0–10000).
#[contracttype]
#[derive(Clone)]
pub struct RoyaltyInfo {
    /// Recipient of royalty payments.
    pub recipient: Address,
    /// Basis points (e.g. 500 = 5%).
    pub bps: u32,
}

/// Per-token metadata entry.
#[contracttype]
#[derive(Clone)]
pub struct TokenMetadata {
    /// Off-chain metadata URI (e.g. IPFS link).
    pub uri: String,
}

/// Storage keys.
#[contracttype]
enum DataKey {
    Owner,
    Name,
    Symbol,
    NextTokenId,
    TokenOwner(u32),
    TokenMetadata(u32),
    TokenRoyalty(u32),
    DefaultRoyalty,
    Admin,
}

// ── Errors ──────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum NftError {
    Unauthorized = 1,
    InvalidRoyaltyBps = 2,
    TokenNotFound = 3,
    NotOwner = 4,
    MintLimitReached = 5,
}

// ── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct NftFactory;

#[contractimpl]
impl NftFactory {
    /// Initialise the NFT collection.
    ///
    /// * `admin` — the account that can set default royalties.
    /// * `name`  — collection name.
    /// * `symbol` — collection ticker.
    /// * `default_royalty_bps` — default royalty in basis points.
    pub fn initialize(
        env: Env,
        admin: Address,
        name: String,
        symbol: Symbol,
        default_royalty_bps: u32,
    ) {
        if default_royalty_bps > 10_000 {
            env.panic_with_error(NftError::InvalidRoyaltyBps);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Owner, &admin);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::NextTokenId, &0u32);
        env.storage().instance().set(
            &DataKey::DefaultRoyalty,
            &RoyaltyInfo {
                recipient: admin.clone(),
                bps: default_royalty_bps,
            },
        );
    }

    // ── Minting ─────────────────────────────────────────────────────────

    /// Mint a single NFT.
    pub fn mint(
        env: Env,
        to: Address,
        uri: String,
        royalty_bps: u32,
    ) -> u32 {
        to.require_auth();

        if royalty_bps > 10_000 {
            env.panic_with_error(NftError::InvalidRoyaltyBps);
        }

        let mut next_id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(0);

        let token_id = next_id;
        next_id += 1;

        env.storage().instance().set(&DataKey::NextTokenId, &next_id);
        env.storage().instance().set(&DataKey::TokenOwner(token_id), &to);
        env.storage().instance().set(&DataKey::TokenMetadata(token_id), &TokenMetadata { uri });
        env.storage().instance().set(
            &DataKey::TokenRoyalty(token_id),
            &RoyaltyInfo {
                recipient: to.clone(),
                bps: royalty_bps,
            },
        );

        token_id
    }

    /// Batch-mint several NFTs at once.
    pub fn batch_mint(
        env: Env,
        to: Address,
        uris: Vec<String>,
        royalty_bps: u32,
    ) -> Vec<u32> {
        to.require_auth();

        if royalty_bps > 10_000 {
            env.panic_with_error(NftError::InvalidRoyaltyBps);
        }

        let mut next_id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(0);

        let mut ids = Vec::new(&env);

        let len = uris.len();
        let mut i = 0u32;
        while i < len {
            let token_id = next_id;
            next_id += 1;

            env.storage()
                .instance()
                .set(&DataKey::TokenOwner(token_id), &to.clone());
            env.storage().instance().set(
                &DataKey::TokenMetadata(token_id),
                &TokenMetadata {
                    uri: uris.get(i).unwrap(),
                },
            );
            env.storage().instance().set(
                &DataKey::TokenRoyalty(token_id),
                &RoyaltyInfo {
                    recipient: to.clone(),
                    bps: royalty_bps,
                },
            );

            ids.push_back(token_id);
            i += 1;
        }

        env.storage().instance().set(&DataKey::NextTokenId, &next_id);
        ids
    }

    // ── Royalty helpers ────────────────────────────────────────────────

    /// Set default royalty (admin only).
    pub fn set_default_royalty(env: Env, admin: Address, recipient: Address, bps: u32) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if admin != stored_admin {
            env.panic_with_error(NftError::Unauthorized);
        }
        if bps > 10_000 {
            env.panic_with_error(NftError::InvalidRoyaltyBps);
        }
        env.storage()
            .instance()
            .set(&DataKey::DefaultRoyalty, &RoyaltyInfo { recipient, bps });
    }

    /// Get royalty info for a specific token.
    pub fn royalty_info(env: Env, token_id: u32) -> RoyaltyInfo {
        env.storage()
            .instance()
            .get(&DataKey::TokenRoyalty(token_id))
            .unwrap_or_else(|| {
                env.storage()
                    .instance()
                    .get(&DataKey::DefaultRoyalty)
                    .expect("no default royalty set")
            })
    }

    // ── Queries ────────────────────────────────────────────────────────

    pub fn owner_of(env: Env, token_id: u32) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::TokenOwner(token_id))
            .unwrap_or_else(|| env.panic_with_error(NftError::TokenNotFound))
    }

    pub fn token_metadata(env: Env, token_id: u32) -> TokenMetadata {
        env.storage()
            .instance()
            .get(&DataKey::TokenMetadata(token_id))
            .unwrap_or_else(|| env.panic_with_error(NftError::TokenNotFound))
    }

    pub fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .expect("not initialized")
    }

    pub fn symbol(env: Env) -> Symbol {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .expect("not initialized")
    }

    pub fn total_supply(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(0)
    }
}

mod test;
