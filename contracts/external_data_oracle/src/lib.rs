#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NumericFeedConfig {
    pub min_sources: u32,
    pub max_age: u64,
    pub tolerance_bps: Option<u32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LogisticsFeedConfig {
    pub min_sources: u32,
    pub max_age: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FeedConfig {
    Numeric(NumericFeedConfig),
    Logistics(LogisticsFeedConfig),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NumericSubmission {
    pub value: i128,
    pub observed_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LogisticsEvent {
    pub shipment_id: String,
    pub event_type: Symbol,
    pub status: Symbol,
    pub location: Option<String>,
    pub eta: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LogisticsSubmission {
    pub event: LogisticsEvent,
    pub observed_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ValidatedValue {
    Numeric(i128),
    Logistics(LogisticsEvent),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedFeed {
    pub value: ValidatedValue,
    pub validated_at: u64,
    pub sources_used: u32,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Sources,
    IsSource(Address),
    FeedConfig(Symbol),
    Validated(Symbol),
    NumSub(Symbol, Address),
    LogSub(Symbol, Address),
}

#[contract]
pub struct ExternalDataOracle;

#[contractimpl]
impl ExternalDataOracle {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Sources, &Vec::<Address>::new(&env));
    }

    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized")
    }

    pub fn sources(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Sources)
            .unwrap_or(Vec::<Address>::new(&env))
    }

    pub fn is_source(env: Env, source: Address) -> bool {
        env.storage().instance().has(&DataKey::IsSource(source))
    }

    pub fn add_source(env: Env, admin: Address, source: Address) {
        Self::require_admin(&env, &admin);

        if env.storage().instance().has(&DataKey::IsSource(source.clone())) {
            return;
        }

        let mut sources: Vec<Address> = Self::sources(env.clone());
        sources.push_back(source.clone());

        env.storage().instance().set(&DataKey::Sources, &sources);
        env.storage().instance().set(&DataKey::IsSource(source.clone()), &true);

        env.events()
            .publish((symbol_short!("src_add"),), source);
    }

    pub fn remove_source(env: Env, admin: Address, source: Address) {
        Self::require_admin(&env, &admin);

        if !env.storage().instance().has(&DataKey::IsSource(source.clone())) {
            return;
        }

        let mut sources: Vec<Address> = Self::sources(env.clone());
        let mut i: u32 = 0;
        while i < sources.len() {
            if sources.get(i).unwrap() == source {
                sources.remove(i);
                break;
            }
            i += 1;
        }

        env.storage().instance().set(&DataKey::Sources, &sources);
        env.storage().instance().remove(&DataKey::IsSource(source.clone()));

        env.events()
            .publish((symbol_short!("src_rm"),), source);
    }

    pub fn register_numeric_feed(
        env: Env,
        admin: Address,
        feed_id: Symbol,
        min_sources: u32,
        max_age: u64,
        tolerance_bps: Option<u32>,
    ) {
        Self::require_admin(&env, &admin);
        if min_sources == 0 {
            panic!("min_sources must be > 0");
        }
        let cfg = FeedConfig::Numeric(NumericFeedConfig {
            min_sources,
            max_age,
            tolerance_bps,
        });
        env.storage().persistent().set(&DataKey::FeedConfig(feed_id.clone()), &cfg);
        env.events()
            .publish((symbol_short!("feed_num"), feed_id), (min_sources, max_age));
    }

    pub fn register_logistics_feed(
        env: Env,
        admin: Address,
        feed_id: Symbol,
        min_sources: u32,
        max_age: u64,
    ) {
        Self::require_admin(&env, &admin);
        if min_sources == 0 {
            panic!("min_sources must be > 0");
        }
        let cfg = FeedConfig::Logistics(LogisticsFeedConfig { min_sources, max_age });
        env.storage().persistent().set(&DataKey::FeedConfig(feed_id.clone()), &cfg);
        env.events()
            .publish((symbol_short!("feed_log"), feed_id), (min_sources, max_age));
    }

    pub fn get_feed_config(env: Env, feed_id: Symbol) -> Option<FeedConfig> {
        env.storage().persistent().get(&DataKey::FeedConfig(feed_id))
    }

    pub fn get_validated(env: Env, feed_id: Symbol) -> Option<ValidatedFeed> {
        env.storage().persistent().get(&DataKey::Validated(feed_id))
    }

    pub fn submit_numeric(
        env: Env,
        source: Address,
        feed_id: Symbol,
        value: i128,
        observed_at: u64,
    ) -> Option<ValidatedFeed> {
        source.require_auth();
        Self::require_source(&env, &source);
        Self::require_numeric_feed(&env, &feed_id);

        let now = env.ledger().timestamp();
        if observed_at > now {
            panic!("observed_at cannot be in the future");
        }

        env.storage().persistent().set(
            &DataKey::NumSub(feed_id.clone(), source.clone()),
            &NumericSubmission { value, observed_at },
        );

        env.events()
            .publish((symbol_short!("sub_num"), feed_id.clone(), source), (value, observed_at));

        Self::validate_feed(env, feed_id)
    }

    pub fn submit_logistics(
        env: Env,
        source: Address,
        feed_id: Symbol,
        event: LogisticsEvent,
        observed_at: u64,
    ) -> Option<ValidatedFeed> {
        source.require_auth();
        Self::require_source(&env, &source);
        Self::require_logistics_feed(&env, &feed_id);

        let now = env.ledger().timestamp();
        if observed_at > now {
            panic!("observed_at cannot be in the future");
        }

        env.storage().persistent().set(
            &DataKey::LogSub(feed_id.clone(), source.clone()),
            &LogisticsSubmission {
                event: event.clone(),
                observed_at,
            },
        );

        env.events().publish(
            (symbol_short!("sub_log"), feed_id.clone(), source),
            (event.shipment_id.clone(), event.event_type, event.status, observed_at),
        );

        Self::validate_feed(env, feed_id)
    }

    /// Validate a feed using the stored submissions across all authorized sources.
    /// Returns `Some(ValidatedFeed)` when quorum is met and a value can be validated.
    pub fn validate_feed(env: Env, feed_id: Symbol) -> Option<ValidatedFeed> {
        let cfg: FeedConfig = env
            .storage()
            .persistent()
            .get(&DataKey::FeedConfig(feed_id.clone()))
            .expect("Unknown feed");

        match cfg {
            FeedConfig::Numeric(ncfg) => Self::validate_numeric(env, feed_id, ncfg),
            FeedConfig::Logistics(lcfg) => Self::validate_logistics(env, feed_id, lcfg),
        }
    }

    fn validate_numeric(
        env: Env,
        feed_id: Symbol,
        cfg: NumericFeedConfig,
    ) -> Option<ValidatedFeed> {
        let now = env.ledger().timestamp();
        let sources = Self::sources(env.clone());

        let mut values = Vec::<i128>::new(&env);
        let mut i: u32 = 0;
        while i < sources.len() {
            let src = sources.get(i).unwrap();
            if let Some(sub) =
                env.storage()
                    .persistent()
                    .get::<_, NumericSubmission>(&DataKey::NumSub(feed_id.clone(), src.clone()))
            {
                if now.saturating_sub(sub.observed_at) <= cfg.max_age {
                    values.push_back(sub.value);
                }
            }
            i += 1;
        }

        if values.len() < cfg.min_sources {
            return None;
        }

        Self::sort_i128(&mut values);
        let median = values.get(values.len() / 2).unwrap();

        if let Some(tol) = cfg.tolerance_bps {
            let mut j: u32 = 0;
            while j < values.len() {
                let v = values.get(j).unwrap();
                if !Self::within_tolerance_bps(v, median, tol) {
                    return None;
                }
                j += 1;
            }
        }

        let validated = ValidatedFeed {
            value: ValidatedValue::Numeric(median),
            validated_at: now,
            sources_used: values.len(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Validated(feed_id.clone()), &validated);

        env.events()
            .publish((symbol_short!("val_num"), feed_id), (median, values.len()));

        Some(validated)
    }

    fn validate_logistics(
        env: Env,
        feed_id: Symbol,
        cfg: LogisticsFeedConfig,
    ) -> Option<ValidatedFeed> {
        let now = env.ledger().timestamp();
        let sources = Self::sources(env.clone());

        let mut events = Vec::<LogisticsEvent>::new(&env);
        let mut i: u32 = 0;
        while i < sources.len() {
            let src = sources.get(i).unwrap();
            if let Some(sub) =
                env.storage()
                    .persistent()
                    .get::<_, LogisticsSubmission>(&DataKey::LogSub(feed_id.clone(), src.clone()))
            {
                if now.saturating_sub(sub.observed_at) <= cfg.max_age {
                    events.push_back(sub.event);
                }
            }
            i += 1;
        }

        if events.len() < cfg.min_sources {
            return None;
        }

        let (best, count) = Self::mode_event(events);
        if count < cfg.min_sources {
            return None;
        }

        let validated = ValidatedFeed {
            value: ValidatedValue::Logistics(best.clone()),
            validated_at: now,
            sources_used: count,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Validated(feed_id.clone()), &validated);

        env.events().publish(
            (symbol_short!("val_log"), feed_id),
            (best.shipment_id, best.event_type, best.status, count),
        );

        Some(validated)
    }

    fn require_admin(env: &Env, admin: &Address) {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored != *admin {
            panic!("Unauthorized");
        }
    }

    fn require_source(env: &Env, source: &Address) {
        if !env
            .storage()
            .instance()
            .has(&DataKey::IsSource(source.clone()))
        {
            panic!("Unauthorized source");
        }
    }

    fn require_numeric_feed(env: &Env, feed_id: &Symbol) {
        let cfg: FeedConfig = env
            .storage()
            .persistent()
            .get(&DataKey::FeedConfig(feed_id.clone()))
            .expect("Unknown feed");
        if let FeedConfig::Numeric(_) = cfg {
            return;
        }
        panic!("Feed is not numeric");
    }

    fn require_logistics_feed(env: &Env, feed_id: &Symbol) {
        let cfg: FeedConfig = env
            .storage()
            .persistent()
            .get(&DataKey::FeedConfig(feed_id.clone()))
            .expect("Unknown feed");
        if let FeedConfig::Logistics(_) = cfg {
            return;
        }
        panic!("Feed is not logistics");
    }

    fn sort_i128(values: &mut Vec<i128>) {
        // Simple in-place bubble sort (small N expected).
        let mut i: u32 = 0;
        while i < values.len() {
            let mut j: u32 = 0;
            while j + 1 < values.len() {
                let a = values.get(j).unwrap();
                let b = values.get(j + 1).unwrap();
                if a > b {
                    values.set(j, b);
                    values.set(j + 1, a);
                }
                j += 1;
            }
            i += 1;
        }
    }

    fn within_tolerance_bps(value: i128, reference: i128, tolerance_bps: u32) -> bool {
        if tolerance_bps == 0 {
            return value == reference;
        }
        let diff = if value >= reference {
            value - reference
        } else {
            reference - value
        };
        let ref_abs = if reference >= 0 { reference } else { -reference };
        if ref_abs == 0 {
            diff == 0
        } else {
            // diff/reference <= tolerance_bps/10_000
            diff * 10_000 <= ref_abs * (tolerance_bps as i128)
        }
    }

    fn mode_event(events: Vec<LogisticsEvent>) -> (LogisticsEvent, u32) {
        // O(n^2) mode calculation (small N expected).
        let mut best = events.get(0).unwrap();
        let mut best_count: u32 = 1;

        let mut i: u32 = 0;
        while i < events.len() {
            let candidate = events.get(i).unwrap();
            let mut count: u32 = 0;
            let mut j: u32 = 0;
            while j < events.len() {
                if events.get(j).unwrap() == candidate {
                    count += 1;
                }
                j += 1;
            }
            if count > best_count {
                best = candidate;
                best_count = count;
            }
            i += 1;
        }

        (best, best_count)
    }
}

mod test;

