#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol, BytesN};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CrossChainIntent {
    pub target_network: Symbol,
    pub target_address: String,
    pub hash: BytesN<32>,
}

#[contract]
pub struct CrossChainBridge;

#[contractimpl]
impl CrossChainBridge {
    /// Initializes a cross-chain intent.
    /// Standardized schema for bridge aggregators to monitor and index.
    pub fn init_intent(
        env: Env,
        user: Address,
        target_network: Symbol,
        target_address: String,
        hash: BytesN<32>,
    ) {
        user.require_auth();
        
        let intent = CrossChainIntent {
            target_network: target_network.clone(),
            target_address,
            hash,
        };
        
        // Emit event following aggregator-centric format.
        // Topics: [INTENT, user, target_network]
        // Data: CrossChainIntent struct
        env.events().publish(
            (symbol_short!("INTENT"), user, target_network),
            intent
        );
    }

    /// Relays a cross-chain transaction by confirming its fulfillment.
    /// Requires relayer authorization to prevent spoofing.
    pub fn relay(
        env: Env,
        relayer: Address,
        target_network: Symbol,
        target_address: String,
        hash: BytesN<32>,
    ) {
        // Enforce cryptographic signature verification for the relayer
        relayer.require_auth();
        
        // Authorization check: Verify if the sender is an authorized relayer.
        if !Self::is_relayer(env.clone(), relayer.clone()) {
            panic!("Unauthorized relayer");
        }

        let intent = CrossChainIntent {
            target_network: target_network.clone(),
            target_address,
            hash,
        };
        
        // Emit relay event to signal successful cross-chain message delivery
        env.events().publish(
            (symbol_short!("RELAY"), relayer, target_network),
            intent
        );
    }

    /// Administrative function to authorize or revoke relayers.
    pub fn set_relayer(env: Env, admin: Address, relayer: Address, status: bool) {
        admin.require_auth();
        
        // Simple admin check: first address to call this becomes admin if none exists
        let stored_admin: Option<Address> = env.storage().instance().get(&symbol_short!("admin"));
        if let Some(a) = stored_admin {
            if a != admin {
                panic!("Not authorized admin");
            }
        } else {
            env.storage().instance().set(&symbol_short!("admin"), &admin);
        }

        env.storage().instance().set(&relayer, &status);
    }

    /// Query function to check relayer status.
    pub fn is_relayer(env: Env, relayer: Address) -> bool {
        env.storage().instance().get::<Address, bool>(&relayer).unwrap_or(false)
    }
}

mod test;
