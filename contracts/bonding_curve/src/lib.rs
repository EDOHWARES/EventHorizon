#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String};

#[contracttype]
#[derive(Clone)]
pub struct CurveConfig {
    pub reserve_ratio: u32,  // Percentage (1-100), e.g., 50 = 50%
    pub base_price: i128,    // Initial price per token
    pub reserve_token: Address,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Config,
    TotalSupply,
    ReserveBalance,
    Balance(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct PriceStepEvent {
    pub action: String,
    pub user: Address,
    pub tokens: i128,
    pub cost: i128,
    pub new_price: i128,
    pub total_supply: i128,
}

#[contract]
pub struct BondingCurve;

#[contractimpl]
impl BondingCurve {
    pub fn initialize(env: Env, admin: Address, config: CurveConfig) {
        assert!(!env.storage().instance().has(&DataKey::Admin), "Already initialized");
        assert!(config.reserve_ratio > 0 && config.reserve_ratio <= 100, "Invalid reserve ratio");
        assert!(config.base_price > 0, "Invalid base price");
        
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
        env.storage().instance().set(&DataKey::ReserveBalance, &0i128);
    }

    pub fn buy(env: Env, buyer: Address, amount: i128) -> i128 {
        buyer.require_auth();
        assert!(amount > 0, "Amount must be positive");

        let config: CurveConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap();
        let reserve: i128 = env.storage().instance().get(&DataKey::ReserveBalance).unwrap();

        // Calculate tokens to mint using Bancor formula
        let tokens = Self::calculate_buy_tokens(&env, supply, reserve, amount, config.reserve_ratio);
        let cost = amount;

        // Transfer reserve tokens from buyer
        let reserve_token = token::Client::new(&env, &config.reserve_token);
        reserve_token.transfer(&buyer, &env.current_contract_address(), &cost);

        // Update state
        let new_supply = supply.checked_add(tokens).unwrap();
        let new_reserve = reserve.checked_add(cost).unwrap();
        let balance: i128 = env.storage().instance().get(&DataKey::Balance(buyer.clone())).unwrap_or(0);
        
        env.storage().instance().set(&DataKey::TotalSupply, &new_supply);
        env.storage().instance().set(&DataKey::ReserveBalance, &new_reserve);
        env.storage().instance().set(&DataKey::Balance(buyer.clone()), &(balance.checked_add(tokens).unwrap()));

        // Calculate new price
        let new_price = Self::get_current_price(&env, new_supply, new_reserve, config.reserve_ratio);

        // Emit PriceStep event for EventHorizon
        env.events().publish(
            (String::from_str(&env, "PriceStep"),),
            PriceStepEvent {
                action: String::from_str(&env, "buy"),
                user: buyer,
                tokens,
                cost,
                new_price,
                total_supply: new_supply,
            },
        );

        tokens
    }

    pub fn sell(env: Env, seller: Address, tokens: i128) -> i128 {
        seller.require_auth();
        assert!(tokens > 0, "Tokens must be positive");

        let config: CurveConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap();
        let reserve: i128 = env.storage().instance().get(&DataKey::ReserveBalance).unwrap();
        let balance: i128 = env.storage().instance().get(&DataKey::Balance(seller.clone())).unwrap_or(0);

        assert!(balance >= tokens, "Insufficient balance");

        // Calculate refund using Bancor formula
        let refund = Self::calculate_sell_return(&env, supply, reserve, tokens, config.reserve_ratio);

        // Update state
        let new_supply = supply.checked_sub(tokens).unwrap();
        let new_reserve = reserve.checked_sub(refund).unwrap();
        
        env.storage().instance().set(&DataKey::TotalSupply, &new_supply);
        env.storage().instance().set(&DataKey::ReserveBalance, &new_reserve);
        env.storage().instance().set(&DataKey::Balance(seller.clone()), &(balance.checked_sub(tokens).unwrap()));

        // Transfer reserve tokens to seller
        let reserve_token = token::Client::new(&env, &config.reserve_token);
        reserve_token.transfer(&env.current_contract_address(), &seller, &refund);

        // Calculate new price
        let new_price = if new_supply > 0 {
            Self::get_current_price(&env, new_supply, new_reserve, config.reserve_ratio)
        } else {
            config.base_price
        };

        // Emit PriceStep event
        env.events().publish(
            (String::from_str(&env, "PriceStep"),),
            PriceStepEvent {
                action: String::from_str(&env, "sell"),
                user: seller,
                tokens,
                cost: refund,
                new_price,
                total_supply: new_supply,
            },
        );

        refund
    }

    pub fn get_price(env: Env) -> i128 {
        let config: CurveConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap();
        let reserve: i128 = env.storage().instance().get(&DataKey::ReserveBalance).unwrap();
        
        if supply == 0 {
            config.base_price
        } else {
            Self::get_current_price(&env, supply, reserve, config.reserve_ratio)
        }
    }

    pub fn balance_of(env: Env, account: Address) -> i128 {
        env.storage().instance().get(&DataKey::Balance(account)).unwrap_or(0)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn reserve_balance(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::ReserveBalance).unwrap_or(0)
    }

    pub fn update_reserve_ratio(env: Env, admin: Address, new_ratio: u32) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "Unauthorized");
        assert!(new_ratio > 0 && new_ratio <= 100, "Invalid reserve ratio");

        let mut config: CurveConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        config.reserve_ratio = new_ratio;
        env.storage().instance().set(&DataKey::Config, &config);
    }

    // Bancor formula: tokens = supply * ((1 + amount/reserve)^(ratio/100) - 1)
    // Simplified for safety: linear approximation
    fn calculate_buy_tokens(env: &Env, supply: i128, reserve: i128, amount: i128, ratio: u32) -> i128 {
        if supply == 0 || reserve == 0 {
            // Initial purchase: use base price
            let config: CurveConfig = env.storage().instance().get(&DataKey::Config).unwrap();
            return amount.checked_div(config.base_price).unwrap();
        }

        // Linear bonding curve: tokens = amount * supply / (reserve * (100/ratio))
        let numerator = amount.checked_mul(supply).unwrap().checked_mul(ratio as i128).unwrap();
        let denominator = reserve.checked_mul(100).unwrap();
        numerator.checked_div(denominator).unwrap()
    }

    // Bancor sell formula: refund = reserve * (1 - (1 - tokens/supply)^(100/ratio))
    // Simplified: linear approximation
    fn calculate_sell_return(_env: &Env, supply: i128, reserve: i128, tokens: i128, ratio: u32) -> i128 {
        // Linear: refund = tokens * reserve * (100/ratio) / supply
        let numerator = tokens.checked_mul(reserve).unwrap().checked_mul(100).unwrap();
        let denominator = supply.checked_mul(ratio as i128).unwrap();
        numerator.checked_div(denominator).unwrap()
    }

    fn get_current_price(_env: &Env, supply: i128, reserve: i128, ratio: u32) -> i128 {
        // Price = reserve * (100/ratio) / supply
        reserve.checked_mul(100).unwrap().checked_div(supply.checked_mul(ratio as i128).unwrap()).unwrap()
    }
}

mod test;
