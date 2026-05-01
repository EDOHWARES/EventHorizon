#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoyaltyRecipient {
    pub address: Address,
    pub bps: u32, // Basis points (10000 = 100%)
}

#[contracttype]
pub enum DataKey {
    Admin,
    Config(Address), // Collection address -> Royalty split
}

#[contract]
pub struct NFTRoyaltyEmitter;

#[contractimpl]
impl NFTRoyaltyEmitter {
    /// Initialize with an admin who can configure royalty splits.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Configure the royalty split for a specific NFT collection.
    pub fn set_config(
        env: Env,
        admin: Address,
        collection: Address,
        recipients: Vec<RoyaltyRecipient>,
    ) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("Unauthorized");
        }

        let mut total_bps: u32 = 0;
        for r in recipients.iter() {
            total_bps += r.bps;
        }
        if total_bps > 10000 {
            panic!("Total BPS exceeds 10000");
        }

        env.storage()
            .persistent()
            .set(&DataKey::Config(collection.clone()), &recipients);
        env.events()
            .publish((symbol_short!("roy_conf"), collection), recipients);
    }

    /// Settle royalties for a sale.
    /// The contract must have been sent the funds or have allowance.
    pub fn settle(
        env: Env,
        collection: Address,
        amount: i128,
        payment_token: Address,
        payer: Address,
    ) {
        payer.require_auth();
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let recipients: Vec<RoyaltyRecipient> = env
            .storage()
            .persistent()
            .get(&DataKey::Config(collection.clone()))
            .expect("No royalty config for collection");

        let token_client = token::Client::new(&env, &payment_token);

        for r in recipients.iter() {
            let payout = (amount * r.bps as i128) / 10000;
            if payout > 0 {
                token_client.transfer(&payer, &r.address, &payout);
                env.events().publish(
                    (symbol_short!("roy_pay"), collection.clone(), r.address),
                    (payment_token.clone(), payout),
                );
            }
        }
    }

    /// Returns the contract version.
    pub fn version(_env: Env) -> u32 {
        100 // v1.0.0
    }

    /// Get the royalty config for a collection.
    pub fn get_config(env: Env, collection: Address) -> Vec<RoyaltyRecipient> {
        env.storage()
            .persistent()
            .get(&DataKey::Config(collection))
            .unwrap_or_else(|| Vec::new(&env))
    }
}

mod test;
