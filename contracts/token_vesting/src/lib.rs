#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, log, token, Address, Env, Symbol};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Init,
    Recipient,
    Token,
    TotalAmount,
    StartTime,
    CliffTime,
    EndTime,
    ClaimedAmount,
    ClawbackAdmin,
}

#[contract]
pub struct TokenVesting;

#[contractimpl]
impl TokenVesting {
    /// Initializes the vesting contract.
    /// 
    /// ### Arguments
    /// * `recipient` - The address authorized to claim vested tokens.
    /// * `token` - The address of the token being vested.
    /// * `total_amount` - The total amount of tokens to be released over the vesting period.
    /// * `start_ts` - The Unix timestamp when the vesting begins.
    /// * `cliff_ts` - The Unix timestamp before which no tokens can be claimed (cliff period).
    /// * `end_ts` - The Unix timestamp when all tokens will be fully vested.
    /// * `clawback_admin` - The address authorized to reclaim unvested tokens.
    pub fn initialize(
        env: Env,
        recipient: Address,
        token: Address,
        total_amount: i128,
        start_ts: u64,
        cliff_ts: u64,
        end_ts: u64,
        clawback_admin: Address,
    ) {
        if env.storage().instance().has(&DataKey::Init) {
            panic!("Contract already initialized");
        }
        if end_ts <= start_ts {
            panic!("End time must be strictly after start time");
        }
        if cliff_ts < start_ts || cliff_ts > end_ts {
            panic!("Cliff time must be between start and end time (inclusive)");
        }
        if total_amount <= 0 {
            panic!("Total amount must be greater than zero");
        }

        env.storage().instance().set(&DataKey::Init, &true);
        env.storage().instance().set(&DataKey::Recipient, &recipient);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::TotalAmount, &total_amount);
        env.storage().instance().set(&DataKey::StartTime, &start_ts);
        env.storage().instance().set(&DataKey::CliffTime, &cliff_ts);
        env.storage().instance().set(&DataKey::EndTime, &end_ts);
        env.storage().instance().set(&DataKey::ClaimedAmount, &0i128);
        env.storage().instance().set(&DataKey::ClawbackAdmin, &clawback_admin);

        log!(&env, "Vesting initialized", recipient, total_amount, clawback_admin);
    }

    /// Claims all currently vested tokens for the recipient.
    /// 
    /// This function ensures only the configured recipient can initiate the claim.
    /// It calculates the vested amount based on the current ledger timestamp,
    /// subtracts any previously claimed tokens, and transfers the remainder.
    /// 
    /// ### Returns
    /// The amount of tokens successfully claimed.
    #[allow(deprecated)]
    pub fn claim(env: Env) -> i128 {
        let recipient: Address = env.storage().instance().get(&DataKey::Recipient).expect("Not initialized");
        recipient.require_auth();

        let now = env.ledger().timestamp();
        let vested = Self::vested_amount_at(&env, now);
        let claimed: i128 = env.storage().instance().get(&DataKey::ClaimedAmount).unwrap_or(0);
        
        let claimable = vested - claimed;
        if claimable <= 0 {
            return 0;
        }

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).expect("No token registered");
        let token_client = token::Client::new(&env, &token_addr);

        // Update state before external token transfer to prevent re-entrancy.
        env.storage().instance().set(&DataKey::ClaimedAmount, &(claimed + claimable));
        token_client.transfer(&env.current_contract_address(), &recipient, &claimable);

        env.events().publish(
            (Symbol::new(&env, "vesting_claimed"), recipient),
            claimable,
        );

        claimable
    }

    /// Reclaims all currently unvested tokens to the authorized clawback admin or destination.
    ///
    /// Only the configured clawback admin may call this function.
    pub fn clawback(env: Env, destination: Address) -> i128 {
        let admin: Address = env.storage().instance().get(&DataKey::ClawbackAdmin).expect("Not initialized");
        admin.require_auth();

        let now = env.ledger().timestamp();
        let total_amount: i128 = env.storage().instance().get(&DataKey::TotalAmount).unwrap_or(0);
        let vested = Self::vested_amount_at(&env, now);
        let unvested = total_amount - vested;
        if unvested <= 0 {
            return 0;
        }

        // Freeze future vesting and ensure state reflects reclaimed unvested tokens.
        env.storage().instance().set(&DataKey::TotalAmount, &vested);
        env.storage().instance().set(&DataKey::EndTime, &now);

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).expect("No token registered");
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &destination, &unvested);

        env.events().publish(
            (Symbol::new(&env, "vesting_clawed_back"), admin, destination),
            unvested,
        );

        unvested
    }

    /// Returns the total amount of tokens vested up to the current timestamp.
    pub fn get_vested_amount(env: Env) -> i128 {
        Self::vested_amount_at(&env, env.ledger().timestamp())
    }

    /// Returns the amount of tokens currently available for claiming.
    pub fn get_claimable_amount(env: Env) -> i128 {
        let vested = Self::vested_amount_at(&env, env.ledger().timestamp());
        let claimed: i128 = env.storage().instance().get(&DataKey::ClaimedAmount).unwrap_or(0);
        vested - claimed
    }

    /// Returns the configuration and status of the vesting schedule.
    pub fn get_info(env: Env) -> (Address, i128, i128, u64, u64) {
        let recipient: Address = env.storage().instance().get(&DataKey::Recipient).expect("Not initialized");
        let total: i128 = env.storage().instance().get(&DataKey::TotalAmount).unwrap_or(0);
        let claimed: i128 = env.storage().instance().get(&DataKey::ClaimedAmount).unwrap_or(0);
        let start: u64 = env.storage().instance().get(&DataKey::StartTime).unwrap_or(0);
        let end: u64 = env.storage().instance().get(&DataKey::EndTime).unwrap_or(0);
        (recipient, total, claimed, start, end)
    }

    /// Internal calculation for vested amount at a specific timestamp.
    fn vested_amount_at(env: &Env, timestamp: u64) -> i128 {
        let start_ts: u64 = env.storage().instance().get(&DataKey::StartTime).unwrap_or(0);
        let cliff_ts: u64 = env.storage().instance().get(&DataKey::CliffTime).unwrap_or(0);
        let end_ts: u64 = env.storage().instance().get(&DataKey::EndTime).unwrap_or(0);
        let total_amount: i128 = env.storage().instance().get(&DataKey::TotalAmount).unwrap_or(0);

        if timestamp < cliff_ts {
            return 0;
        }
        if timestamp >= end_ts {
            return total_amount;
        }

        let duration = end_ts - start_ts;
        let elapsed = timestamp - start_ts;

        // Linear calculation: total * (now - start) / (end - start)
        // Multiplication before division to maintain precision
        total_amount
            .checked_mul(elapsed as i128)
            .expect("Vesting multiplication overflow")
            .checked_div(duration as i128)
            .expect("Vesting division by zero")
    }
}

mod test;
