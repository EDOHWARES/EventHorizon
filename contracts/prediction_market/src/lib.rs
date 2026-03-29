#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype,
    token, Address, Env, Map,
};

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,                  // betting token address
    NumOutcomes,            // u32 – fixed at init
    Status,                 // MarketStatus
    WinningOutcome,         // u32 – set on settlement
    TotalPool,              // i128 – sum of all bets
    OutcomePool(u32),       // i128 – total bet on outcome i
    Bets(Address),          // Map<u32, i128> – bets per outcome for a bettor
    Claimed(Address),       // bool
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MarketStatus {
    Open     = 0,
    Settled  = 1,
    Cancelled = 2,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[contractevent]
pub struct BetPlaced {
    pub bettor: Address,
    pub outcome: u32,
    pub amount: i128,
}

#[contractevent]
pub struct MarketSettled {
    pub winning_outcome: u32,
    pub total_pool: i128,
    pub winning_pool: i128,
}

#[contractevent]
pub struct MarketCancelled {}

#[contractevent]
pub struct PayoutClaimed {
    pub bettor: Address,
    pub amount: i128,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct PredictionMarket;

#[contractimpl]
impl PredictionMarket {
    // ── Setup ─────────────────────────────────────────────────────────────────

    /// `num_outcomes` must be ≥ 2 (e.g. 2 for binary Yes/No).
    pub fn initialize(env: Env, admin: Address, token: Address, num_outcomes: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        if num_outcomes < 2 { panic!("Need at least 2 outcomes"); }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::NumOutcomes, &num_outcomes);
        env.storage().instance().set(&DataKey::Status, &MarketStatus::Open);
        env.storage().instance().set(&DataKey::TotalPool, &0i128);
        for i in 0..num_outcomes {
            env.storage().instance().set(&DataKey::OutcomePool(i), &0i128);
        }
    }

    // ── Betting ───────────────────────────────────────────────────────────────

    /// Place a bet on `outcome` (0-indexed). Transfers `amount` tokens from bettor.
    pub fn place_bet(env: Env, bettor: Address, outcome: u32, amount: i128) {
        bettor.require_auth();
        Self::_require_status(&env, MarketStatus::Open);
        if amount <= 0 { panic!("Amount must be positive"); }
        let n: u32 = env.storage().instance().get(&DataKey::NumOutcomes).unwrap();
        if outcome >= n { panic!("Invalid outcome"); }

        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token)
            .transfer(&bettor, &env.current_contract_address(), &amount);

        // Update outcome pool
        let op: i128 = env.storage().instance().get(&DataKey::OutcomePool(outcome)).unwrap_or(0);
        env.storage().instance().set(&DataKey::OutcomePool(outcome), &(op + amount));

        // Update total pool
        let tp: i128 = env.storage().instance().get(&DataKey::TotalPool).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalPool, &(tp + amount));

        // Update bettor's position
        let mut bets: Map<u32, i128> = env.storage().persistent()
            .get(&DataKey::Bets(bettor.clone()))
            .unwrap_or(Map::new(&env));
        let prev = bets.get(outcome).unwrap_or(0);
        bets.set(outcome, prev + amount);
        env.storage().persistent().set(&DataKey::Bets(bettor.clone()), &bets);

        env.events().publish_event(&BetPlaced { bettor, outcome, amount });
    }

    // ── Settlement ────────────────────────────────────────────────────────────

    /// Admin settles the market with the verified winning outcome.
    /// Pari-mutuel: winners share the entire pool proportional to their stake.
    pub fn settle_market(env: Env, winning_outcome: u32) {
        Self::_require_admin(&env);
        Self::_require_status(&env, MarketStatus::Open);
        let n: u32 = env.storage().instance().get(&DataKey::NumOutcomes).unwrap();
        if winning_outcome >= n { panic!("Invalid outcome"); }

        env.storage().instance().set(&DataKey::Status, &MarketStatus::Settled);
        env.storage().instance().set(&DataKey::WinningOutcome, &winning_outcome);

        let total_pool: i128 = env.storage().instance().get(&DataKey::TotalPool).unwrap_or(0);
        let winning_pool: i128 = env.storage().instance()
            .get(&DataKey::OutcomePool(winning_outcome)).unwrap_or(0);

        env.events().publish_event(&MarketSettled { winning_outcome, total_pool, winning_pool });
    }

    /// Admin cancels the market — all bettors can claim full refunds.
    pub fn cancel_market(env: Env) {
        Self::_require_admin(&env);
        Self::_require_status(&env, MarketStatus::Open);
        env.storage().instance().set(&DataKey::Status, &MarketStatus::Cancelled);
        env.events().publish_event(&MarketCancelled {});
    }

    // ── Payout ────────────────────────────────────────────────────────────────

    /// Bettor claims their payout after settlement or refund after cancellation.
    /// Pari-mutuel formula: payout = bettor_winning_stake * total_pool / winning_pool
    pub fn claim(env: Env, bettor: Address) -> i128 {
        bettor.require_auth();

        let claimed: bool = env.storage().persistent()
            .get(&DataKey::Claimed(bettor.clone())).unwrap_or(false);
        if claimed { panic!("Already claimed"); }

        let status: MarketStatus = env.storage().instance().get(&DataKey::Status).unwrap();

        let bets: Map<u32, i128> = env.storage().persistent()
            .get(&DataKey::Bets(bettor.clone()))
            .unwrap_or(Map::new(&env));

        let payout = match status {
            MarketStatus::Settled => {
                let winning_outcome: u32 = env.storage().instance()
                    .get(&DataKey::WinningOutcome).unwrap();
                let stake = bets.get(winning_outcome).unwrap_or(0);
                if stake == 0 { panic!("No winning stake"); }

                let total_pool: i128 = env.storage().instance().get(&DataKey::TotalPool).unwrap_or(0);
                let winning_pool: i128 = env.storage().instance()
                    .get(&DataKey::OutcomePool(winning_outcome)).unwrap_or(0);

                // payout = stake * total_pool / winning_pool
                stake.checked_mul(total_pool).expect("overflow")
                     .checked_div(winning_pool).expect("div zero")
            }
            MarketStatus::Cancelled => {
                let n: u32 = env.storage().instance().get(&DataKey::NumOutcomes).unwrap();
                let mut total = 0i128;
                for i in 0..n {
                    total += bets.get(i).unwrap_or(0);
                }
                if total == 0 { panic!("No bets to refund"); }
                total
            }
            MarketStatus::Open => panic!("Market not settled"),
        };

        env.storage().persistent().set(&DataKey::Claimed(bettor.clone()), &true);

        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token)
            .transfer(&env.current_contract_address(), &bettor, &payout);

        env.events().publish_event(&PayoutClaimed { bettor, amount: payout });
        payout
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_status(env: Env) -> MarketStatus {
        env.storage().instance().get(&DataKey::Status).unwrap()
    }

    pub fn get_outcome_pool(env: Env, outcome: u32) -> i128 {
        env.storage().instance().get(&DataKey::OutcomePool(outcome)).unwrap_or(0)
    }

    pub fn get_total_pool(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalPool).unwrap_or(0)
    }

    pub fn get_bets(env: Env, bettor: Address) -> Map<u32, i128> {
        env.storage().persistent()
            .get(&DataKey::Bets(bettor))
            .unwrap_or(Map::new(&env))
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    fn _require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        admin.require_auth();
    }

    fn _require_status(env: &Env, expected: MarketStatus) {
        let status: MarketStatus = env.storage().instance().get(&DataKey::Status).unwrap();
        if status != expected { panic!("Wrong market status"); }
    }
}

mod test;
