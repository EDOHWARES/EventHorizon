#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceReport {
    pub price: u128,
    pub timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Oracles,
    Threshold,
    MaxAge,
    Report(Address),
}

#[contract]
pub struct OracleAggregator;

#[contractimpl]
impl OracleAggregator {
    /// Initialize with admin, list of authorized oracles, and consensus parameters.
    pub fn initialize(
        env: Env,
        admin: Address,
        oracles: Vec<Address>,
        threshold: u32,
        max_age: u64,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Oracles, &oracles);
        env.storage()
            .instance()
            .set(&DataKey::Threshold, &threshold);
        env.storage().instance().set(&DataKey::MaxAge, &max_age);
    }

    /// Submit a price report from an authorized oracle.
    pub fn report(env: Env, oracle: Address, price: u128) {
        oracle.require_auth();

        let oracles: Vec<Address> = env.storage().instance().get(&DataKey::Oracles).unwrap();
        if !oracles.contains(&oracle) {
            panic!("Unauthorized oracle");
        }

        let report = PriceReport {
            price,
            timestamp: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Report(oracle.clone()), &report);
        env.events()
            .publish((symbol_short!("rep_sub"), oracle), price);

        // Attempt to reach consensus
        Self::try_consensus(&env);
    }

    fn try_consensus(env: &Env) {
        let oracles: Vec<Address> = env.storage().instance().get(&DataKey::Oracles).unwrap();
        let threshold: u32 = env.storage().instance().get(&DataKey::Threshold).unwrap();
        let max_age: u64 = env.storage().instance().get(&DataKey::MaxAge).unwrap();
        let now = env.ledger().timestamp();

        let mut valid_prices: Vec<u128> = Vec::new(env);

        for o in oracles.iter() {
            if let Some(report) = env
                .storage()
                .persistent()
                .get::<_, PriceReport>(&DataKey::Report(o))
            {
                let expiry = report
                    .timestamp
                    .checked_add(max_age)
                    .expect("Timestamp overflow");
                if now <= expiry {
                    valid_prices.push_back(report.price);
                }
            }
        }

        if valid_prices.len() >= threshold {
            let median = Self::calculate_median(env, &valid_prices);
            env.events().publish((symbol_short!("consensus"),), median);
        }
    }

    fn calculate_median(_env: &Env, prices: &Vec<u128>) -> u128 {
        let mut p_vec: soroban_sdk::Vec<u128> = prices.clone();
        let n = p_vec.len();

        // Simple bubble sort for small N (typically oracles are < 20)
        // In a real production environment with many oracles, we'd use a more efficient sort.
        for i in 0..n {
            for j in 0..n - 1 - i {
                let p1 = p_vec.get(j).unwrap();
                let p2 = p_vec.get(j + 1).unwrap();
                if p1 > p2 {
                    p_vec.set(j, p2);
                    p_vec.set(j + 1, p1);
                }
            }
        }

        if n % 2 == 1 {
            p_vec.get(n / 2).unwrap()
        } else {
            let m1 = p_vec.get(n / 2 - 1).unwrap();
            let m2 = p_vec.get(n / 2).unwrap();
            (m1 + m2) / 2
        }
    }

    /// Update the authorized oracles list.
    pub fn update_oracles(env: Env, admin: Address, oracles: Vec<Address>) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("Unauthorized");
        }
        env.storage().instance().set(&DataKey::Oracles, &oracles);
    }

    /// Returns the contract version.
    pub fn version(_env: Env) -> u32 {
        100 // v1.0.0
    }
}

mod test;
