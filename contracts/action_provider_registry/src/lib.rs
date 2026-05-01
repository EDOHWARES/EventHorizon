#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String, Symbol,
};

/// Status of a registered provider.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProviderStatus {
    Active,
    Suspended,
    Deregistered,
}

/// Core metadata for an action provider.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Provider {
    pub owner: Address,
    pub name: Symbol,
    pub endpoint: String,
    pub fee_per_call: i128,
    pub status: ProviderStatus,
    pub registered_at: u64,
    pub total_calls: u64,
    /// Cumulative rating score (sum of all ratings submitted)
    pub rating_score: u64,
    /// Number of ratings received
    pub rating_count: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    FeeToken,
    RegistrationFee,
    NextProviderId,
    Provider(u64),
    ProviderOwner(Address), // maps owner -> provider_id for uniqueness
}

#[contract]
pub struct ActionProviderRegistry;

#[contractimpl]
impl ActionProviderRegistry {
    /// Initialize the registry.
    pub fn initialize(
        env: Env,
        admin: Address,
        fee_token: Address,
        registration_fee: i128,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        if registration_fee < 0 {
            panic!("Registration fee cannot be negative");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::FeeToken, &fee_token);
        env.storage().instance().set(&DataKey::RegistrationFee, &registration_fee);
        env.storage().instance().set(&DataKey::NextProviderId, &1u64);
    }

    /// Register a new action provider. Caller pays the registration fee.
    pub fn register(
        env: Env,
        owner: Address,
        name: Symbol,
        endpoint: String,
        fee_per_call: i128,
    ) -> u64 {
        owner.require_auth();

        if fee_per_call < 0 {
            panic!("Fee per call cannot be negative");
        }

        // Prevent duplicate registrations per owner
        if env.storage().persistent().has(&DataKey::ProviderOwner(owner.clone())) {
            panic!("Owner already has a registered provider");
        }

        // Collect registration fee
        let reg_fee: i128 = env.storage().instance().get(&DataKey::RegistrationFee).unwrap();
        if reg_fee > 0 {
            let fee_token: Address = env.storage().instance().get(&DataKey::FeeToken).unwrap();
            let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
            token::Client::new(&env, &fee_token).transfer(&owner, &admin, &reg_fee);
        }

        let id: u64 = env.storage().instance().get(&DataKey::NextProviderId).unwrap();
        env.storage().instance().set(&DataKey::NextProviderId, &(id + 1));

        let provider = Provider {
            owner: owner.clone(),
            name: name.clone(),
            endpoint,
            fee_per_call,
            status: ProviderStatus::Active,
            registered_at: env.ledger().timestamp(),
            total_calls: 0,
            rating_score: 0,
            rating_count: 0,
        };

        env.storage().persistent().set(&DataKey::Provider(id), &provider);
        env.storage().persistent().set(&DataKey::ProviderOwner(owner.clone()), &id);

        env.events().publish(
            (symbol_short!("reg"), id),
            (owner, name),
        );

        id
    }

    /// Update provider endpoint or fee. Only the owner can call this.
    pub fn update(
        env: Env,
        provider_id: u64,
        endpoint: String,
        fee_per_call: i128,
    ) {
        let mut provider: Provider = Self::load_provider(&env, provider_id);
        provider.owner.require_auth();

        if fee_per_call < 0 {
            panic!("Fee per call cannot be negative");
        }

        provider.endpoint = endpoint;
        provider.fee_per_call = fee_per_call;
        env.storage().persistent().set(&DataKey::Provider(provider_id), &provider);

        env.events().publish(
            (symbol_short!("updated"), provider_id),
            provider.owner,
        );
    }

    /// Record a call execution event and update performance stats.
    pub fn record_call(env: Env, provider_id: u64) {
        let mut provider: Provider = Self::load_provider(&env, provider_id);

        if provider.status != ProviderStatus::Active {
            panic!("Provider is not active");
        }

        provider.total_calls += 1;
        env.storage().persistent().set(&DataKey::Provider(provider_id), &provider);

        env.events().publish(
            (symbol_short!("call"), provider_id),
            provider.total_calls,
        );
    }

    /// Submit a rating (1–5) for a provider.
    pub fn rate(env: Env, rater: Address, provider_id: u64, score: u32) {
        rater.require_auth();

        if score < 1 || score > 5 {
            panic!("Score must be between 1 and 5");
        }

        let mut provider: Provider = Self::load_provider(&env, provider_id);

        if provider.status != ProviderStatus::Active {
            panic!("Provider is not active");
        }

        provider.rating_score += score as u64;
        provider.rating_count += 1;
        env.storage().persistent().set(&DataKey::Provider(provider_id), &provider);

        env.events().publish(
            (symbol_short!("rated"), provider_id),
            (rater, score),
        );
    }

    /// Admin: suspend a provider.
    pub fn suspend(env: Env, admin: Address, provider_id: u64) {
        Self::require_admin(&env, &admin);
        let mut provider: Provider = Self::load_provider(&env, provider_id);
        provider.status = ProviderStatus::Suspended;
        env.storage().persistent().set(&DataKey::Provider(provider_id), &provider);

        env.events().publish(
            (symbol_short!("suspended"), provider_id),
            provider.owner,
        );
    }

    /// Admin: reinstate a suspended provider.
    pub fn reinstate(env: Env, admin: Address, provider_id: u64) {
        Self::require_admin(&env, &admin);
        let mut provider: Provider = Self::load_provider(&env, provider_id);
        if provider.status != ProviderStatus::Suspended {
            panic!("Provider is not suspended");
        }
        provider.status = ProviderStatus::Active;
        env.storage().persistent().set(&DataKey::Provider(provider_id), &provider);

        env.events().publish(
            (symbol_short!("reinstate"), provider_id),
            provider.owner,
        );
    }

    /// Owner or admin: deregister a provider permanently.
    pub fn deregister(env: Env, caller: Address, provider_id: u64) {
        let mut provider: Provider = Self::load_provider(&env, provider_id);

        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if caller != provider.owner && caller != admin {
            panic!("Unauthorized");
        }
        caller.require_auth();

        env.storage().persistent().remove(&DataKey::ProviderOwner(provider.owner.clone()));
        provider.status = ProviderStatus::Deregistered;
        env.storage().persistent().set(&DataKey::Provider(provider_id), &provider);

        env.events().publish(
            (symbol_short!("deregstrd"), provider_id),
            provider.owner,
        );
    }

    /// Admin: update the registration fee.
    pub fn set_registration_fee(env: Env, admin: Address, new_fee: i128) {
        Self::require_admin(&env, &admin);
        if new_fee < 0 {
            panic!("Fee cannot be negative");
        }
        env.storage().instance().set(&DataKey::RegistrationFee, &new_fee);
    }

    // --- Views ---

    pub fn get_provider(env: Env, provider_id: u64) -> Provider {
        Self::load_provider(&env, provider_id)
    }

    /// Returns the average rating scaled by 100 (e.g. 450 = 4.50).
    pub fn get_avg_rating(env: Env, provider_id: u64) -> u64 {
        let provider: Provider = Self::load_provider(&env, provider_id);
        if provider.rating_count == 0 {
            return 0;
        }
        (provider.rating_score * 100) / provider.rating_count
    }

    pub fn get_provider_id_by_owner(env: Env, owner: Address) -> Option<u64> {
        env.storage().persistent().get(&DataKey::ProviderOwner(owner))
    }

    // --- Internals ---

    fn load_provider(env: &Env, id: u64) -> Provider {
        env.storage()
            .persistent()
            .get(&DataKey::Provider(id))
            .expect("Provider not found")
    }

    fn require_admin(env: &Env, caller: &Address) {
        caller.require_auth();
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if *caller != admin {
            panic!("Unauthorized: admin only");
        }
    }
}

mod test;
