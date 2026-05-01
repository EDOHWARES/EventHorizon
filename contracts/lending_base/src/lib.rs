#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, contractclient, token, Address, Env, Symbol, log, symbol_short};

#[contractclient]
pub trait PriceFeed {
    fn get_price(&self) -> i128;
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct UserState {
    pub collateral: i128,
    pub debt: i128,
    pub last_update: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    CollateralToken,
    LoanToken,
    InterestRate,      // Fixed rate in scaled i128 (e.g. 5% = 0.05 * 1e7)
    CollateralRatio,   // e.g. 150 (for 150%)
    LiqThreshold,      // e.g. 110 (for 110%)
    Price,             // Price of collateral in loan token terms (scaled 1e7)
    PriceFeed,         // Optional external price feed contract
    User(Address),
}

const SCALAR: i128 = 10_000_000;
const LOW_HEALTH_MARGIN: i128 = 5; // 5% buffer before liquidation
const MAX_HEALTH_FACTOR: i128 = SCALAR * 100;

#[contract]
pub struct LendingProtocol;

#[contractimpl]
impl LendingProtocol {
    pub fn initialize(
        env: Env,
        admin: Address,
        collateral_token: Address,
        loan_token: Address,
        interest_rate: i128,
        collateral_ratio: i128,
        liq_threshold: i128,
        price: i128,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::CollateralToken, &collateral_token);
        env.storage().instance().set(&DataKey::LoanToken, &loan_token);
        env.storage().instance().set(&DataKey::InterestRate, &interest_rate);
        env.storage().instance().set(&DataKey::CollateralRatio, &collateral_ratio);
        env.storage().instance().set(&DataKey::LiqThreshold, &liq_threshold);
        env.storage().instance().set(&DataKey::Price, &price);
    }

    pub fn deposit_collateral(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 { panic!("Amount must be positive"); }

        let token_addr: Address = env.storage().instance().get(&DataKey::CollateralToken).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&user, &env.current_contract_address(), &amount);

        let mut user_state = Self::get_user_state(&env, &user);
        user_state.collateral += amount;
        env.storage().persistent().set(&DataKey::User(user.clone()), &user_state);
        Self::emit_low_health_alert(&env, &user, &user_state);

        env.events().publish((symbol_short!("deposit"), user), amount);
    }

    pub fn borrow(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 { panic!("Amount must be positive"); }

        let now = env.ledger().timestamp();
        let mut user_state = Self::get_user_state(&env, &user);
        
        // 1. Accumulate interest before checking ratio
        Self::accumulate_interest(&env, &mut user_state, now);

        // 2. Check collateralization ratio
        let price: i128 = Self::current_price(&env);
        let col_ratio: i128 = env.storage().instance().get(&DataKey::CollateralRatio).unwrap();
        
        let new_debt = user_state.debt + amount;
        let col_value = (user_state.collateral * price) / SCALAR;
        
        // Required Collateral Value = new_debt * col_ratio / 100
        let required_col_value = (new_debt * col_ratio) / 100;

        if col_value < required_col_value {
            panic!("Insufficient collateral");
        }

        // 3. Transfer loan tokens to user
        let loan_token_addr: Address = env.storage().instance().get(&DataKey::LoanToken).unwrap();
        let token_client = token::Client::new(&env, &loan_token_addr);
        token_client.transfer(&env.current_contract_address(), &user, &amount);

        // 4. Update state
        user_state.debt = new_debt;
        user_state.last_update = now;
        env.storage().persistent().set(&DataKey::User(user.clone()), &user_state);
        Self::emit_low_health_alert(&env, &user, &user_state);

        env.events().publish((symbol_short!("borrow"), user), amount);
    }

    pub fn repay(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 { panic!("Amount must be positive"); }

        let now = env.ledger().timestamp();
        let mut user_state = Self::get_user_state(&env, &user);
        
        Self::accumulate_interest(&env, &mut user_state, now);

        let repay_amount = if amount > user_state.debt { user_state.debt } else { amount };

        let loan_token_addr: Address = env.storage().instance().get(&DataKey::LoanToken).unwrap();
        let token_client = token::Client::new(&env, &loan_token_addr);
        token_client.transfer(&user, &env.current_contract_address(), &repay_amount);

        user_state.debt -= repay_amount;
        user_state.last_update = now;
        env.storage().persistent().set(&DataKey::User(user.clone()), &user_state);
        Self::emit_low_health_alert(&env, &user, &user_state);

        env.events().publish((symbol_short!("repay"), user), repay_amount);
    }

    pub fn liquidate(env: Env, liquidator: Address, user: Address) {
        liquidator.require_auth();
        
        let now = env.ledger().timestamp();
        let mut user_state = Self::get_user_state(&env, &user);
        
        Self::accumulate_interest(&env, &mut user_state, now);

        let price: i128 = Self::current_price(&env);
        let liq_threshold: i128 = env.storage().instance().get(&DataKey::LiqThreshold).unwrap();
        
        let col_value = (user_state.collateral * price) / SCALAR;
        let threshold_value = (user_state.debt * liq_threshold) / 100;

        if col_value >= threshold_value {
            panic!("Not eligible for liquidation");
        }

        // Simple liquidation: liquidator pays user's debt and gets collateral
        // In a real protocol, there's a bonus for the liquidator.
        let loan_token_addr: Address = env.storage().instance().get(&DataKey::LoanToken).unwrap();
        let loan_client = token::Client::new(&env, &loan_token_addr);
        loan_client.transfer(&liquidator, &env.current_contract_address(), &user_state.debt);

        let col_token_addr: Address = env.storage().instance().get(&DataKey::CollateralToken).unwrap();
        let col_client = token::Client::new(&env, &col_token_addr);
        col_client.transfer(&env.current_contract_address(), &liquidator, &user_state.collateral);

        env.events().publish(
            (symbol_short!("liquidat"), user),
            (liquidator, user_state.collateral)
        );

        user_state.debt = 0;
        user_state.collateral = 0;
        user_state.last_update = now;
        env.storage().persistent().set(&DataKey::User(user.clone()), &user_state);
    }

    pub fn priority_liquidate(env: Env, liquidator: Address, user: Address) {
        liquidator.require_auth();

        let now = env.ledger().timestamp();
        let mut user_state = Self::get_user_state(&env, &user);
        Self::accumulate_interest(&env, &mut user_state, now);

        let price: i128 = Self::current_price(&env);
        let liq_threshold: i128 = env.storage().instance().get(&DataKey::LiqThreshold).unwrap();
        let col_value = (user_state.collateral * price) / SCALAR;
        let threshold_value = (user_state.debt * liq_threshold) / 100;

        if col_value >= threshold_value {
            panic!("Not eligible for liquidation");
        }

        let health_factor = Self::get_health_factor(env.clone(), user.clone());

        let loan_token_addr: Address = env.storage().instance().get(&DataKey::LoanToken).unwrap();
        let loan_client = token::Client::new(&env, &loan_token_addr);
        loan_client.transfer(&liquidator, &env.current_contract_address(), &user_state.debt);

        let col_token_addr: Address = env.storage().instance().get(&DataKey::CollateralToken).unwrap();
        let col_client = token::Client::new(&env, &col_token_addr);
        col_client.transfer(&env.current_contract_address(), &liquidator, &user_state.collateral);

        env.events().publish((Symbol::new(&env, "PriorityLiquidation"), user.clone()), (liquidator.clone(), user_state.collateral, health_factor));

        user_state.debt = 0;
        user_state.collateral = 0;
        user_state.last_update = now;
        env.storage().persistent().set(&DataKey::User(user), &user_state);
    }

    pub fn get_user_info(env: Env, user: Address) -> UserState {
        Self::get_user_state(&env, &user)
    }

    pub fn set_price(env: Env, admin: Address, price: i128) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("Not authorized");
        }
        env.storage().instance().set(&DataKey::Price, &price);
    }

    pub fn set_price_feed(env: Env, admin: Address, feed: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("Not authorized");
        }
        env.storage().instance().set(&DataKey::PriceFeed, &feed);
    }

    pub fn update_price_from_feed(env: Env, admin: Address) -> i128 {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("Not authorized");
        }
        let feed: Address = env.storage().instance().get(&DataKey::PriceFeed).expect("Price feed not configured");
        let price = PriceFeedClient::new(&env, &feed).get_price();
        env.storage().instance().set(&DataKey::Price, &price);
        price
    }

    pub fn get_price(env: Env) -> i128 {
        Self::current_price(&env)
    }

    pub fn get_health_factor(env: Env, user: Address) -> i128 {
        let user_state = Self::get_user_state(&env, &user);
        if user_state.debt <= 0 {
            return MAX_HEALTH_FACTOR;
        }
        let price: i128 = Self::current_price(&env);
        let col_value = (user_state.collateral * price) / SCALAR;
        let liq_threshold: i128 = env.storage().instance().get(&DataKey::LiqThreshold).unwrap();
        let required_value = (user_state.debt * liq_threshold) / 100;
        if required_value <= 0 {
            return MAX_HEALTH_FACTOR;
        }
        (col_value * SCALAR) / required_value
    }

    pub fn check_health(env: Env, user: Address) -> i128 {
        let user_state = Self::get_user_state(&env, &user);
        if user_state.debt > 0 {
            Self::emit_low_health_alert(&env, &user, &user_state);
        }
        Self::get_health_factor(env, user)
    }

    fn current_price(env: &Env) -> i128 {
        if let Some(feed_addr) = env.storage().instance().get(&DataKey::PriceFeed) {
            PriceFeedClient::new(env, &feed_addr).get_price()
        } else {
            env.storage().instance().get(&DataKey::Price).unwrap()
        }
    }

    fn emit_low_health_alert(env: &Env, user: &Address, user_state: &UserState) {
        if user_state.debt <= 0 {
            return;
        }

        let price: i128 = Self::current_price(env);
        let col_value = (user_state.collateral * price) / SCALAR;
        let liq_threshold: i128 = env.storage().instance().get(&DataKey::LiqThreshold).unwrap();
        let threshold_value = (user_state.debt * liq_threshold) / 100;
        let alert_value = (user_state.debt * (liq_threshold + LOW_HEALTH_MARGIN)) / 100;
        let health_factor = if threshold_value > 0 {
            (col_value * SCALAR) / threshold_value
        } else {
            MAX_HEALTH_FACTOR
        };

        if col_value < alert_value && col_value >= threshold_value {
            env.events().publish((Symbol::new(env, "LowHealth"), user.clone()), health_factor);
        }
    }

    fn get_user_state(env: &Env, user: &Address) -> UserState {
        env.storage().persistent()
            .get(&DataKey::User(user.clone()))
            .unwrap_or(UserState { 
                collateral: 0, 
                debt: 0, 
                last_update: env.ledger().timestamp() 
            })
    }

    fn accumulate_interest(env: &Env, state: &mut UserState, now: u64) {
        if state.debt <= 0 || now <= state.last_update {
            state.last_update = now;
            return;
        }

        let rate: i128 = env.storage().instance().get(&DataKey::InterestRate).unwrap();
        let elapsed = (now - state.last_update) as i128;
        let seconds_in_year = 31_536_000;
        
        let interest = (state.debt * rate * elapsed) / (seconds_in_year * 100); 
        // Note: adjust scaling as needed based on rate definition.
        
        state.debt += interest;
        state.last_update = now;
    }
}

pub mod interest_rate_model;
mod test;
