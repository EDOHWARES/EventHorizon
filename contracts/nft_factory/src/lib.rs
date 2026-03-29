#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype,
    Address, Env, String, Vec,
};

// Royalty basis points denominator (10_000 = 100%)
const BPS_DENOM: u32 = 10_000;

#[contracttype]
#[derive(Clone, Debug)]
pub struct NftInfo {
    pub owner: Address,
    pub metadata_uri: String,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    RoyaltyRecipient,
    RoyaltyBps,   // Royalty in basis points (0–10_000)
    NextTokenId,
    Nft(u64),     // token_id -> NftInfo
}

#[contractevent]
pub struct MintEvent {
    pub to: Address,
    pub token_id: u64,
}

#[contractevent]
pub struct TransferEvent {
    pub from: Address,
    pub to: Address,
    pub token_id: u64,
}

#[contract]
pub struct NftFactory;

#[contractimpl]
impl NftFactory {
    /// Initialize the factory. `royalty_bps` is in basis points (e.g. 500 = 5%).
    pub fn initialize(
        env: Env,
        admin: Address,
        royalty_recipient: Address,
        royalty_bps: u32,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        if royalty_bps > BPS_DENOM {
            panic!("royalty_bps exceeds 10000");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::RoyaltyRecipient, &royalty_recipient);
        env.storage().instance().set(&DataKey::RoyaltyBps, &royalty_bps);
        env.storage().instance().set(&DataKey::NextTokenId, &0u64);
    }

    /// Mint a single NFT to `to` with the given metadata URI.
    pub fn mint(env: Env, to: Address, metadata_uri: String) -> u64 {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        admin.require_auth();
        Self::_mint(&env, to, metadata_uri)
    }

    /// Batch mint NFTs. Each entry in `recipients` gets the corresponding URI.
    pub fn batch_mint(env: Env, recipients: Vec<Address>, uris: Vec<String>) -> Vec<u64> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        admin.require_auth();

        if recipients.len() != uris.len() {
            panic!("recipients and uris length mismatch");
        }

        let mut ids: Vec<u64> = Vec::new(&env);
        for i in 0..recipients.len() {
            let id = Self::_mint(&env, recipients.get(i).unwrap(), uris.get(i).unwrap());
            ids.push_back(id);
        }
        ids
    }

    /// Transfer an NFT from `from` to `to`.
    pub fn transfer(env: Env, from: Address, to: Address, token_id: u64) {
        from.require_auth();
        let mut nft: NftInfo = env.storage().persistent()
            .get(&DataKey::Nft(token_id))
            .expect("Token does not exist");

        if nft.owner != from {
            panic!("Not the token owner");
        }
        nft.owner = to.clone();
        env.storage().persistent().set(&DataKey::Nft(token_id), &nft);

        env.events().publish_event(&TransferEvent { from, to, token_id });
    }

    /// Returns the royalty amount and recipient for a given sale price.
    /// Callers (e.g. a marketplace) should use this to split payments.
    pub fn royalty_info(env: Env, sale_price: i128) -> (Address, i128) {
        let recipient: Address = env.storage().instance()
            .get(&DataKey::RoyaltyRecipient)
            .expect("Not initialized");
        let bps: u32 = env.storage().instance()
            .get(&DataKey::RoyaltyBps)
            .unwrap_or(0);
        let amount = sale_price
            .checked_mul(bps as i128)
            .expect("Overflow")
            .checked_div(BPS_DENOM as i128)
            .expect("Division by zero");
        (recipient, amount)
    }

    /// Update royalty settings. Admin only.
    pub fn set_royalty(env: Env, recipient: Address, royalty_bps: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        admin.require_auth();
        if royalty_bps > BPS_DENOM {
            panic!("royalty_bps exceeds 10000");
        }
        env.storage().instance().set(&DataKey::RoyaltyRecipient, &recipient);
        env.storage().instance().set(&DataKey::RoyaltyBps, &royalty_bps);
    }

    /// Returns NFT info for a given token ID.
    pub fn get_nft(env: Env, token_id: u64) -> NftInfo {
        env.storage().persistent()
            .get(&DataKey::Nft(token_id))
            .expect("Token does not exist")
    }

    /// Returns the total number of minted tokens.
    pub fn total_supply(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::NextTokenId).unwrap_or(0)
    }

    // --- Internal ---

    fn _mint(env: &Env, to: Address, metadata_uri: String) -> u64 {
        let token_id: u64 = env.storage().instance().get(&DataKey::NextTokenId).unwrap_or(0);
        let nft = NftInfo { owner: to.clone(), metadata_uri };
        env.storage().persistent().set(&DataKey::Nft(token_id), &nft);
        env.storage().instance().set(&DataKey::NextTokenId, &(token_id + 1));
        env.events().publish_event(&MintEvent { to, token_id });
        token_id
    }
}

mod test;
