#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, Vec, Symbol,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Recipient {
    Address(Address),
    Service(u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoyaltySplit {
    pub recipient: Recipient,
    pub bps: u32, // Basis points (10000 = 100%)
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Service {
    pub id: u64,
    pub owner: Address,
    pub fee: i128,
    pub splits: Vec<RoyaltySplit>,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Settler,
    Token,
    NextServiceId,
    Service(u64),
}

const MAX_RECURSION_DEPTH: u32 = 5;

#[contract]
pub struct DeveloperRoyaltyRegistry;

#[contractimpl]
impl DeveloperRoyaltyRegistry {
    /// Initialize the registry with roles and payment token.
    pub fn initialize(env: Env, admin: Address, settler: Address, token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Settler, &settler);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::NextServiceId, &1u64);
    }

    /// Register a new middleware service with royalty splits.
    pub fn register_service(
        env: Env,
        owner: Address,
        fee: i128,
        splits: Vec<RoyaltySplit>,
    ) -> u64 {
        owner.require_auth();

        if fee < 0 {
            panic!("Fee cannot be negative");
        }

        Self::validate_splits(&splits);

        let id: u64 = env.storage().instance().get(&DataKey::NextServiceId).unwrap();
        env.storage().instance().set(&DataKey::NextServiceId, &(id + 1));

        let service = Service {
            id,
            owner,
            fee,
            splits,
        };

        env.storage().persistent().set(&DataKey::Service(id), &service);

        env.events().publish(
            (symbol_short!("reg_serv"), id),
            (service.owner, service.fee),
        );

        id
    }

    /// Update an existing service.
    pub fn update_service(
        env: Env,
        service_id: u64,
        fee: i128,
        splits: Vec<RoyaltySplit>,
    ) {
        let mut service: Service = env
            .storage()
            .persistent()
            .get(&DataKey::Service(service_id))
            .expect("Service not found");

        service.owner.require_auth();

        if fee < 0 {
            panic!("Fee cannot be negative");
        }

        Self::validate_splits(&splits);

        service.fee = fee;
        service.splits = splits;

        env.storage().persistent().set(&DataKey::Service(service_id), &service);

        env.events().publish(
            (symbol_short!("upd_serv"), service_id),
            (service.owner, service.fee),
        );
    }

    /// Settle royalties for a service. Callable only by the Settler.
    pub fn settle_royalty(env: Env, service_id: u64, executions: u32) {
        let settler: Address = env.storage().instance().get(&DataKey::Settler).unwrap();
        settler.require_auth();

        let service: Service = env
            .storage()
            .persistent()
            .get(&DataKey::Service(service_id))
            .expect("Service not found");

        if executions == 0 {
            return;
        }

        let total_amount = service.fee * (executions as i128);
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();

        Self::distribute(&env, &token_addr, &settler, total_amount, service_id, 0);

        env.events().publish(
            (symbol_short!("settled"), service_id),
            total_amount,
        );
    }

    /// View service details.
    pub fn get_service(env: Env, service_id: u64) -> Service {
        env.storage()
            .persistent()
            .get(&DataKey::Service(service_id))
            .expect("Service not found")
    }

    // --- Internals ---

    fn validate_splits(splits: &Vec<RoyaltySplit>) {
        if splits.is_empty() {
            panic!("Splits cannot be empty");
        }

        let mut total_bps: u32 = 0;
        for split in splits.iter() {
            total_bps += split.bps;
        }

        if total_bps != 10000 {
            panic!("Total splits BPS must sum to 10000");
        }
    }

    fn distribute(
        env: &Env,
        token: &Address,
        from: &Address,
        amount: i128,
        service_id: u64,
        depth: u32,
    ) {
        if depth > MAX_RECURSION_DEPTH {
            panic!("Max recursion depth reached in royalty distribution");
        }

        let service: Service = env
            .storage()
            .persistent()
            .get(&DataKey::Service(service_id))
            .expect("Sub-service not found");

        let token_client = token::Client::new(env, token);

        for split in service.splits.iter() {
            let split_amount = (amount * (split.bps as i128)) / 10000;
            if split_amount == 0 {
                continue;
            }

            match split.recipient {
                Recipient::Address(addr) => {
                    token_client.transfer_from(&env.current_contract_address(), from, &addr, &split_amount);
                    env.events().publish(
                        (symbol_short!("rev_share"), service_id, addr),
                        split_amount,
                    );
                }
                Recipient::Service(sub_id) => {
                    Self::distribute(env, token, from, split_amount, sub_id, depth + 1);
                }
            }
        }
    }
}

mod test;
