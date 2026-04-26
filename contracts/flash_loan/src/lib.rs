#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, IntoVal, token, vec};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Token,
    Owner,
    IsBusy,
    Registry,
}

#[contract]
pub struct FlashLoanProvider;

#[contractimpl]
impl FlashLoanProvider {
    /// Initializes the Flash Loan Provider with the token to be lent and the owner address.
    pub fn init(env: Env, token: Address, owner: Address) {
        if env.storage().instance().has(&DataKey::Token) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::IsBusy, &false);
    }

    /// Sets the global Flash Loan Registry address.
    pub fn set_registry(env: Env, registry: Address) {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).expect("not initialized");
        owner.require_auth();
        env.storage().instance().set(&DataKey::Registry, &registry);
    }

    /// Provides a flash loan to the receiver.
    /// The receiver contract MUST implement `flash_loan_callback(env: Env, initiator: Address, amount: i128, fee: i128)`.
    pub fn loan(env: Env, receiver: Address, amount: i128) {
        // Re-entrancy guard
        if env.storage().instance().get::<_, bool>(&DataKey::IsBusy).unwrap_or(false) {
            panic!("contract is busy");
        }
        env.storage().instance().set(&DataKey::IsBusy, &true);

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).expect("not initialized");
        let client = token::Client::new(&env, &token_addr);

        // Record balance before loan
        let balance_before = client.balance(&env.current_contract_address());

        // Transfer funds to receiver
        client.transfer(&env.current_contract_address(), &receiver, &amount);

        // Callback to receiver
        // We pass the current contract address as the initiator for simplicity.
        let initiator = env.current_contract_address();
        let fee = 0i128; // Currently zero-fee flash loan, tracking only external profit/bounty.
        
        env.invoke_contract::<()>(
            &receiver,
            &Symbol::new(&env, "flash_loan_callback"),
            vec![&env, initiator.into_val(&env), amount.into_val(&env), fee.into_val(&env)],
        );

        // Verify repayment
        let balance_after = client.balance(&env.current_contract_address());
        if balance_after < balance_before {
            panic!("insufficient repayment");
        }

        // Calculate profit (Integrated Profit Tracker)
        let profit = balance_after - balance_before;
        if profit > 0 {
            let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
            // Emit Bounty event for EventHorizon to pick up
            env.events().publish(
                (symbol_short!("Bounty"), owner, receiver),
                profit,
            );
        }

        // Record in Registry for global tracking and ROI analysis
        if let Some(registry_addr) = env.storage().instance().get::<_, Address>(&DataKey::Registry) {
            // We use current_contract_address() as the provider identifier in the registry.
            // Note: The registry must be authorized to receive calls from this contract if it uses require_auth.
            env.invoke_contract::<()>(
                &registry_addr,
                &Symbol::new(&env, "record_loan"),
                vec![
                    &env,
                    env.current_contract_address().into_val(&env),
                    receiver.into_val(&env),
                    token_addr.into_val(&env),
                    amount.into_val(&env),
                    profit.into_val(&env),
                ],
            );
        }

        // Release guard
        env.storage().instance().set(&DataKey::IsBusy, &false);
    }

    pub fn get_token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).expect("not initialized")
    }

    pub fn get_owner(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Owner).expect("not initialized")
    }

    pub fn get_registry(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Registry)
    }
}
