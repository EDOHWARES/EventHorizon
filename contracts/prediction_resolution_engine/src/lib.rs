#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, 
    token, Address, Env, Map, Symbol, Vec,
};

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    MarketCount,
    Market(u64),             // MarketInfo
    UserShares(u64, Address), // Map<u32, i128> (market_id, user -> shares per outcome)
    OutcomePool(u64, u32),   // i128 (market_id, outcome_index -> virtual reserve)
}

// ── Data Types ───────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MarketStatus {
    Open = 0,
    Resolved = 1,
    Cancelled = 2,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MarketInfo {
    pub id: u64,
    pub creator: Address,
    pub token: Address,
    pub num_outcomes: u32,
    pub status: MarketStatus,
    pub winning_outcome: u32,
    pub oracle: Address,
    pub deadline: u64,
    pub total_collateral: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MarketAnalysis {
    pub market_id: u64,
    pub total_volume: i128,
    pub probabilities: Vec<i128>, // Scaled by 10000 (bps)
    pub depth: Vec<i128>,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[contractevent]
pub struct MarketCreated {
    pub market_id: u64,
    pub creator: Address,
    pub oracle: Address,
}

#[contractevent]
pub struct TradeExecuted {
    pub market_id: u64,
    pub user: Address,
    pub outcome: u32,
    pub is_buy: bool,
    pub amount_tokens: i128,
    pub shares: i128,
}

#[contractevent]
pub struct MarketResolved {
    pub market_id: u64,
    pub winning_outcome: u32,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct PredictionResolutionEngine;

#[contractimpl]
impl PredictionResolutionEngine {
    
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::MarketCount, &0u64);
    }

    pub fn create_market(
        env: Env,
        creator: Address,
        token: Address,
        num_outcomes: u32,
        oracle: Address,
        deadline: u64,
        initial_liquidity: i128,
    ) -> u64 {
        creator.require_auth();
        if num_outcomes < 2 { panic!("Min 2 outcomes"); }
        if deadline <= env.ledger().timestamp() { panic!("Invalid deadline"); }
        if initial_liquidity <= 0 { panic!("Initial liquidity required"); }

        let market_id = Self::_next_market_id(&env);
        
        // Transfer initial liquidity to the contract
        token::Client::new(&env, &token).transfer(&creator, &env.current_contract_address(), &initial_liquidity);

        let market = MarketInfo {
            id: market_id,
            creator,
            token,
            num_outcomes,
            status: MarketStatus::Open,
            winning_outcome: 0,
            oracle: oracle.clone(),
            deadline,
            total_collateral: initial_liquidity,
        };

        env.storage().persistent().set(&DataKey::Market(market_id), &market);

        // Initialize outcome pools with initial liquidity (equally distributed)
        let share_per_outcome = initial_liquidity / (num_outcomes as i128);
        for i in 0..num_outcomes {
            env.storage().persistent().set(&DataKey::OutcomePool(market_id, i), &share_per_outcome);
        }

        env.events().publish_event(&MarketCreated { market_id, creator: market.creator, oracle });
        market_id
    }

    pub fn buy_shares(env: Env, user: Address, market_id: u64, outcome: u32, amount_tokens: i128) -> i128 {
        user.require_auth();
        let mut market = Self::_get_market(&env, market_id);
        Self::_require_status(&market, MarketStatus::Open);
        if env.ledger().timestamp() >= market.deadline { panic!("Market locked"); }
        if outcome >= market.num_outcomes { panic!("Invalid outcome"); }
        if amount_tokens <= 0 { panic!("Positive amount required"); }

        token::Client::new(&env, &market.token).transfer(&user, &env.current_contract_address(), &amount_tokens);

        let reserve = env.storage().persistent().get::<_, i128>(&DataKey::OutcomePool(market_id, outcome)).unwrap();
        
        // Simplified CPMM-like share calculation: shares = amount * reserve / (reserve + amount)
        // For a prediction market, buying an outcome decreases its "reserve equivalent" in the pool
        // but here we just track virtual reserves to calculate price impact.
        let shares = (amount_tokens * 1000) / ( (reserve + amount_tokens) / 100 ); // Dummy curve for demo logic
        
        // Update reserves
        env.storage().persistent().set(&DataKey::OutcomePool(market_id, outcome), &(reserve + amount_tokens));
        market.total_collateral += amount_tokens;
        env.storage().persistent().set(&DataKey::Market(market_id), &market);

        // Update user shares
        let mut user_shares: Map<u32, i128> = env.storage().persistent()
            .get(&DataKey::UserShares(market_id, user.clone()))
            .unwrap_or(Map::new(&env));
        let prev = user_shares.get(outcome).unwrap_or(0);
        user_shares.set(outcome, prev + shares);
        env.storage().persistent().set(&DataKey::UserShares(market_id, user.clone()), &user_shares);

        env.events().publish_event(&TradeExecuted {
            market_id,
            user,
            outcome,
            is_buy: true,
            amount_tokens,
            shares,
        });

        shares
    }

    pub fn resolve_market(env: Env, market_id: u64, winning_outcome: u32) {
        let mut market = Self::_get_market(&env, market_id);
        market.oracle.require_auth();
        Self::_require_status(&market, MarketStatus::Open);
        if winning_outcome >= market.num_outcomes { panic!("Invalid outcome"); }

        market.status = MarketStatus::Resolved;
        market.winning_outcome = winning_outcome;
        env.storage().persistent().set(&DataKey::Market(market_id), &market);

        env.events().publish_event(&MarketResolved { market_id, winning_outcome });
    }

    pub fn claim_payout(env: Env, user: Address, market_id: u64) -> i128 {
        user.require_auth();
        let market = Self::_get_market(&env, market_id);
        Self::_require_status(&market, MarketStatus::Resolved);

        let mut user_shares: Map<u32, i128> = env.storage().persistent()
            .get(&DataKey::UserShares(market_id, user.clone()))
            .expect("No shares found");
        
        let winning_shares = user_shares.get(market.winning_outcome).unwrap_or(0);
        if winning_shares == 0 { panic!("No winning shares"); }

        // Payout = (winning_shares / total_winning_shares_in_pool) * total_collateral
        // For simplicity in this engine, 1 share = proportional slice of the total collateral
        let total_winning_pool = env.storage().persistent().get::<_, i128>(&DataKey::OutcomePool(market_id, market.winning_outcome)).unwrap();
        
        let payout = (winning_shares * market.total_collateral) / total_winning_pool;
        
        user_shares.set(market.winning_outcome, 0); // Mark as claimed
        env.storage().persistent().set(&DataKey::UserShares(market_id, user.clone()), &user_shares);

        token::Client::new(&env, &market.token).transfer(&env.current_contract_address(), &user, &payout);

        payout
    }

    pub fn get_market_analysis(env: Env, market_id: u64) -> MarketAnalysis {
        let market = Self::_get_market(&env, market_id);
        let mut probabilities = Vec::new(&env);
        let mut depths = Vec::new(&env);

        for i in 0..market.num_outcomes {
            let reserve = env.storage().persistent().get::<_, i128>(&DataKey::OutcomePool(market_id, i)).unwrap_or(1);
            // Probability = reserve / total_collateral * 10000 (bps)
            let prob = (reserve * 10000) / market.total_collateral;
            probabilities.push_back(prob);
            depths.push_back(reserve);
        }

        MarketAnalysis {
            market_id,
            total_volume: market.total_collateral,
            probabilities,
            depth: depths,
        }
    }

    // ── Internals ────────────────────────────────────────────────────────────

    fn _next_market_id(env: &Env) -> u64 {
        let id: u64 = env.storage().instance().get(&DataKey::MarketCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::MarketCount, &(id + 1));
        id
    }

    fn _get_market(env: &Env, market_id: u64) -> MarketInfo {
        env.storage().persistent().get(&DataKey::Market(market_id)).expect("Market not found")
    }

    fn _require_status(market: &MarketInfo, expected: MarketStatus) {
        if market.status != expected { panic!("Wrong market status"); }
    }
}

mod test;
