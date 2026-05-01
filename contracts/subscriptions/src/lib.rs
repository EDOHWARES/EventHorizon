#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Symbol, log, symbol_short};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SubscriptionStatus {
    Active = 0,
    Paused = 1,
    Cancelled = 2,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Subscription {
    pub subscriber: Address,
    pub provider: Address,
    pub token: Address,
    pub amount: i128,
    pub frequency: u64, // seconds
    pub last_payment: u64, // timestamp
    pub status: SubscriptionStatus,
    pub credits: i128,            // Recurring allowance for actions
    pub credits_per_period: i128, // Credits granted per payment
}

#[contracttype]
pub enum DataKey {
    NextId,
    Subscription(u64),
}

#[contract]
pub struct SubscriptionContract;

#[contractimpl]
impl SubscriptionContract {
    /// Creates a new recurring subscription with a recurring credit allowance.
    pub fn create_subscription(
        env: Env,
        subscriber: Address,
        provider: Address,
        token: Address,
        amount: i128,
        frequency: u64,
        credits_per_period: i128,
    ) -> u64 {
        subscriber.require_auth();

        if amount <= 0 { panic!("Amount must be positive"); }
        if frequency == 0 { panic!("Frequency must be greater than zero"); }
        if credits_per_period < 0 { panic!("Credits must be non-negative"); }

        let mut next_id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        let subscription_id = next_id;
        next_id += 1;
        env.storage().instance().set(&DataKey::NextId, &next_id);

        let subscription = Subscription {
            subscriber: subscriber.clone(),
            provider,
            token,
            amount,
            frequency,
            last_payment: 0,
            status: SubscriptionStatus::Active,
            credits: 0,
            credits_per_period,
        };

        env.storage().persistent().set(&DataKey::Subscription(subscription_id), &subscription);

        env.events().publish(
            (symbol_short!("created"), subscription_id, subscriber),
            credits_per_period
        );

        subscription_id
    }

    /// Processes a recurring payment.
    /// Automates execution events when payments are successfully processed.
    /// Handles overdraft events if funds are insufficient.
    pub fn process_payment(env: Env, subscription_id: u64) {
        let mut sub = Self::get_subscription(env.clone(), subscription_id);

        if sub.status != SubscriptionStatus::Active {
            panic!("Subscription is not active");
        }

        let now = env.ledger().timestamp();
        if sub.last_payment != 0 && now < sub.last_payment + sub.frequency {
            panic!("Wait until the next billing cycle");
        }

        let token_client = token::Client::new(&env, &sub.token);
        
        // Check for Overdraft
        let balance = token_client.balance(&sub.subscriber);
        let allowance = token_client.allowance(&sub.subscriber, &env.current_contract_address());

        if balance < sub.amount || allowance < sub.amount {
            // Subscription Overdraft: insufficient funds or allowance
            sub.status = SubscriptionStatus::Paused;
            env.storage().persistent().set(&DataKey::Subscription(subscription_id), &sub);

            env.events().publish(
                (symbol_short!("overdraft"), subscription_id, sub.subscriber.clone()),
                (balance, allowance)
            );
            return;
        }

        // Perform payment
        token_client.transfer_from(&env.current_contract_address(), &sub.subscriber, &sub.provider, &sub.amount);

        // Update credits (Recurring allowance for actions)
        sub.credits += sub.credits_per_period;
        sub.last_payment = now;
        env.storage().persistent().set(&DataKey::Subscription(subscription_id), &sub);

        // Pre-approved Execution Event: triggered after successful payment
        env.events().publish(
            (symbol_short!("exec_ev"), subscription_id, sub.subscriber.clone()),
            sub.credits_per_period
        );

        env.events().publish(
            (Symbol::new(&env, "payment_processed"), subscription_id, sub.subscriber.clone(), sub.provider.clone()),
            sub.amount
        );
    }

    /// Spends credits from the subscription allowance.
    pub fn spend_credits(env: Env, subscription_id: u64, amount: i128) {
        let mut sub = Self::get_subscription(env.clone(), subscription_id);
        
        // In a real scenario, the 'provider' would call this when the user performs an action.
        sub.provider.require_auth();

        if sub.credits < amount {
            panic!("Insufficient credits");
        }

        sub.credits -= amount;
        env.storage().persistent().set(&DataKey::Subscription(subscription_id), &sub);

        env.events().publish(
            (symbol_short!("spent"), subscription_id, sub.subscriber.clone()),
            amount
        );
    }

    /// Cancels a subscription.
    pub fn cancel_subscription(env: Env, subscription_id: u64) {
        let mut sub = Self::get_subscription(env.clone(), subscription_id);
        sub.subscriber.require_auth();

        sub.status = SubscriptionStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Subscription(subscription_id), &sub);

        env.events().publish(
            (symbol_short!("cancel"), subscription_id),
            symbol_short!("success")
        );
    }

    /// Pauses a subscription.
    pub fn pause_subscription(env: Env, subscription_id: u64) {
        let mut sub = Self::get_subscription(env.clone(), subscription_id);
        sub.subscriber.require_auth();

        if sub.status != SubscriptionStatus::Active {
            panic!("Can only pause active subscriptions");
        }

        sub.status = SubscriptionStatus::Paused;
        env.storage().persistent().set(&DataKey::Subscription(subscription_id), &sub);
    }

    /// Resumes a paused subscription.
    pub fn resume_subscription(env: Env, subscription_id: u64) {
        let mut sub = Self::get_subscription(env.clone(), subscription_id);
        sub.subscriber.require_auth();

        if sub.status != SubscriptionStatus::Paused {
            panic!("Can only resume paused subscriptions");
        }

        sub.status = SubscriptionStatus::Active;
        env.storage().persistent().set(&DataKey::Subscription(subscription_id), &sub);
    }

    /// Returns subscription info.
    pub fn get_subscription(env: Env, id: u64) -> Subscription {
        env.storage().persistent().get(&DataKey::Subscription(id)).expect("Subscription not found")
    }
}

mod test;
