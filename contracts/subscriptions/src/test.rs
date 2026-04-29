#[cfg(test)]
mod test {
    use crate::{SubscriptionContract, SubscriptionContractClient, SubscriptionStatus};
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{token, Address, Env};

    #[test]
    fn test_subscription_flow() {
        let env = Env::default();
        env.mock_all_auths();

        let subscriber = Address::generate(&env);
        let provider = Address::generate(&env);
        
        let token_addr = env.register_stellar_asset_contract_v2(subscriber.clone()).address();
        let token_admin = token::StellarAssetClient::new(&env, &token_addr);
        let token_client = token::Client::new(&env, &token_addr);

        let contract_id = env.register(SubscriptionContract, ());
        let client = SubscriptionContractClient::new(&env, &contract_id);

        let amount = 100;
        let frequency = 3600;
        let credits_per_period = 50;
        token_admin.mint(&subscriber, &1000);
        token_client.approve(&subscriber, &contract_id, &1000, &1000);

        // 1. Create Subscription
        let sub_id = client.create_subscription(&subscriber, &provider, &token_addr, &amount, &frequency, &credits_per_period);

        // 2. Process First Payment
        client.process_payment(&sub_id);
        assert_eq!(token_client.balance(&subscriber), 900);
        assert_eq!(token_client.balance(&provider), 100);

        // Verify credits
        let mut sub = client.get_subscription(&sub_id);
        assert_eq!(sub.credits, 50);

        // 3. Spend Credits
        client.spend_credits(&sub_id, &20);
        sub = client.get_subscription(&sub_id);
        assert_eq!(sub.credits, 30);
    }

    #[test]
    fn test_overdraft_event() {
        let env = Env::default();
        env.mock_all_auths();

        let subscriber = Address::generate(&env);
        let provider = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract_v2(subscriber.clone()).address();
        let token_admin = token::StellarAssetClient::new(&env, &token_addr);
        let token_client = token::Client::new(&env, &token_addr);

        let contract_id = env.register(SubscriptionContract, ());
        let client = SubscriptionContractClient::new(&env, &contract_id);

        token_admin.mint(&subscriber, &50); // Not enough for 100 payment
        token_client.approve(&subscriber, &contract_id, &1000, &1000);

        let sub_id = client.create_subscription(&subscriber, &provider, &token_addr, &100, &3600, &50);
        
        client.process_payment(&sub_id);

        // Should be paused due to overdraft
        let sub = client.get_subscription(&sub_id);
        assert_eq!(sub.status, SubscriptionStatus::Paused);
    }

    #[test]
    #[should_panic(expected = "Wait until the next billing cycle")]
    fn test_early_payment_fails() {
        let env = Env::default();
        env.mock_all_auths();

        let subscriber = Address::generate(&env);
        let provider = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract_v2(subscriber.clone()).address();
        let token_admin = token::StellarAssetClient::new(&env, &token_addr);
        let token_client = token::Client::new(&env, &token_addr);

        let contract_id = env.register(SubscriptionContract, ());
        let client = SubscriptionContractClient::new(&env, &contract_id);

        token_admin.mint(&subscriber, &1000);
        token_client.approve(&subscriber, &contract_id, &1000, &1000);

        let sub_id = client.create_subscription(&subscriber, &provider, &token_addr, &100, &3600, &50);
        
        env.ledger().set_timestamp(100);
        client.process_payment(&sub_id); 
        client.process_payment(&sub_id);
    }

    #[test]
    fn test_recurring_payment_success() {
        let env = Env::default();
        env.mock_all_auths();

        let subscriber = Address::generate(&env);
        let provider = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract_v2(subscriber.clone()).address();
        let token_admin = token::StellarAssetClient::new(&env, &token_addr);
        let token_client = token::Client::new(&env, &token_addr);

        let contract_id = env.register(SubscriptionContract, ());
        let client = SubscriptionContractClient::new(&env, &contract_id);

        token_admin.mint(&subscriber, &1000);
        token_client.approve(&subscriber, &contract_id, &1000, &1000);

        let sub_id = client.create_subscription(&subscriber, &provider, &token_addr, &100, &3600, &50);
        
        client.process_payment(&sub_id); 
        
        env.ledger().set_timestamp(3601);
        client.process_payment(&sub_id);

        assert_eq!(token_client.balance(&subscriber), 800);
        assert_eq!(token_client.balance(&provider), 200);

        let sub = client.get_subscription(&sub_id);
        assert_eq!(sub.credits, 100);
    }

    #[test]
    fn test_lifecycle_management() {
        let env = Env::default();
        env.mock_all_auths();

        let subscriber = Address::generate(&env);
        let provider = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract_v2(subscriber.clone()).address();
        let contract_id = env.register(SubscriptionContract, ());
        let client = SubscriptionContractClient::new(&env, &contract_id);

        let sub_id = client.create_subscription(&subscriber, &provider, &token_addr, &100, &3600, &50);
        
        client.pause_subscription(&sub_id);
        let mut sub = client.get_subscription(&sub_id);
        assert_eq!(sub.status, SubscriptionStatus::Paused);

        client.resume_subscription(&sub_id);
        sub = client.get_subscription(&sub_id);
        assert_eq!(sub.status, SubscriptionStatus::Active);

        client.cancel_subscription(&sub_id);
        sub = client.get_subscription(&sub_id);
        assert_eq!(sub.status, SubscriptionStatus::Cancelled);
    }
}
