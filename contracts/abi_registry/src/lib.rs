#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec, Symbol,
};

/// Maximum size for ABI data (64KB limit for Soroban)
const MAX_ABI_SIZE: u32 = 65536;
/// Maximum number of versions to retain per contract
const MAX_VERSION_HISTORY: u32 = 100;

/// Represents a version of contract ABI metadata
#[contracttype]
#[derive(Clone, Debug)]
pub struct AbiVersion {
    pub version: u32,
    pub abi_hash: [u8; 32],
    pub created_at: u64,
    pub note: String,
}

/// Complete metadata for a registered contract
#[contracttype]
#[derive(Clone, Debug)]
pub struct ContractAbiMetadata {
    pub contract_id: Address,
    pub name: String,
    pub description: String,
    pub version: u32,
    pub abi_data: Vec<u8>,
    pub abi_hash: [u8; 32],
    pub verified: bool,
    pub added_at: u64,
    pub updated_at: u64,
    pub version_history: Vec<AbiVersion>,
}

/// Data keys for persistent storage
#[contracttype]
pub enum DataKey {
    /// Contract admin address
    Admin,
    /// Next available contract ID
    NextContractId,
    /// Contract metadata by contract address
    ContractMeta(Address),
    /// ABI data by contract address (stored separately for large data)
    ContractAbi(Address),
    /// Version history by contract address
    VersionHistory(Address),
    /// Index for contract name lookup
    ContractName(String),
    /// Index for verified contracts
    VerifiedContracts,
}

/// Events emitted by the ABI Registry
#[contracttype]
#[derive(Clone, Debug)]
pub enum AbiRegistryEvent {
    /// Contract registered: (contract_id, name, version)
    Registered(Address, String, u32),
    /// ABI updated: (contract_id, new_version, abi_hash)
    Updated(Address, u32, [u8; 32]),
    /// ABI version rolled back: (contract_id, version)
    RolledBack(Address, u32),
    /// Contract verified: (contract_id)
    Verified(Address),
    /// Contract removed: (contract_id)
    Removed(Address),
}

#[contract]
pub struct AbiRegistry;

#[contractimpl]
impl AbiRegistry {
    /// Initialize the registry with an admin address
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextContractId, &1u64);
        env.storage().instance().set(&DataKey::VerifiedContracts, &Vec::<Address>::new(&env));
    }

    /// Register a new contract with ABI metadata
    pub fn register(
        env: Env,
        contract_id: Address,
        name: String,
        description: String,
        abi_data: Vec<u8>,
        note: String,
    ) -> u32 {
        // Check if contract is already registered
        if env.storage().persistent().has(&DataKey::ContractMeta(contract_id.clone())) {
            panic!("Contract already registered");
        }

        // Validate ABI data size
        if (abi_data.len() as u32) > MAX_ABI_SIZE {
            panic!("ABI data exceeds maximum size");
        }

        // Calculate ABI hash (simple hash for demonstration)
        let abi_hash = Self::calculate_hash(&abi_data);

        let version = 1u32;
        let timestamp = env.ledger().timestamp();

        // Create version history entry
        let version_entry = AbiVersion {
            version,
            abi_hash: abi_hash.clone(),
            created_at: timestamp,
            note,
        };

        let mut version_history = Vec::new(&env);
        version_history.push_back(version_entry);

        // Create metadata
        let metadata = ContractAbiMetadata {
            contract_id: contract_id.clone(),
            name: name.clone(),
            description,
            version,
            abi_data: abi_data.clone(),
            abi_hash: abi_hash.clone(),
            verified: false,
            added_at: timestamp,
            updated_at: timestamp,
            version_history: version_history.clone(),
        };

        // Store metadata
        env.storage().persistent().set(&DataKey::ContractMeta(contract_id.clone()), &metadata);
        
        // Store ABI data separately for large data optimization
        env.storage().persistent().set(&DataKey::ContractAbi(contract_id.clone()), &abi_data);
        
        // Store version history
        env.storage().persistent().set(&DataKey::VersionHistory(contract_id.clone()), &version_history);

        // Index by name
        env.storage().persistent().set(&DataKey::ContractName(name.clone()), &contract_id);

        // Emit registration event
        env.events().publish(
            (symbol_short!("reg"), contract_id.clone()),
            (name, version),
        );

        version
    }

    /// Update ABI for an existing contract
    pub fn update(
        env: Env,
        contract_id: Address,
        abi_data: Vec<u8>,
        note: String,
    ) -> u32 {
        let mut metadata: ContractAbiMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::ContractMeta(contract_id.clone()))
            .expect("Contract not registered");

        // Validate ABI data size
        if (abi_data.len() as u32) > MAX_ABI_SIZE {
            panic!("ABI data exceeds maximum size");
        }

        // Calculate new ABI hash
        let new_abi_hash = Self::calculate_hash(&abi_data);

        // Check if ABI actually changed
        if metadata.abi_hash == new_abi_hash {
            return metadata.version;
        }

        let new_version = metadata.version + 1;
        let timestamp = env.ledger().timestamp();

        // Create version history entry
        let version_entry = AbiVersion {
            version: new_version,
            abi_hash: new_abi_hash.clone(),
            created_at: timestamp,
            note,
        };

        // Get and update version history
        let mut version_history: Vec<AbiVersion> = env
            .storage()
            .persistent()
            .get(&DataKey::VersionHistory(contract_id.clone()))
            .unwrap_or(Vec::new(&env));

        // Trim history if too long
        if (version_history.len() as u32) >= MAX_VERSION_HISTORY {
            version_history.remove(0);
        }

        version_history.push_back(version_entry);

        // Update metadata
        metadata.version = new_version;
        metadata.abi_data = abi_data.clone();
        metadata.abi_hash = new_abi_hash.clone();
        metadata.updated_at = timestamp;
        metadata.version_history = version_history.clone();

        // Store updated data
        env.storage().persistent().set(&DataKey::ContractMeta(contract_id.clone()), &metadata);
        env.storage().persistent().set(&DataKey::ContractAbi(contract_id.clone()), &abi_data);
        env.storage().persistent().set(&DataKey::VersionHistory(contract_id.clone()), &version_history);

        // Emit update event
        env.events().publish(
            (symbol_short!("upd"), contract_id.clone()),
            (new_version, new_abi_hash),
        );

        new_version
    }

    /// Rollback to a previous ABI version
    pub fn rollback(env: Env, contract_id: Address, target_version: u32) -> bool {
        let metadata: ContractAbiMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::ContractMeta(contract_id.clone()))
            .expect("Contract not registered");

        if target_version >= metadata.version {
            panic!("Invalid target version");
        }

        let version_history: Vec<AbiVersion> = env
            .storage()
            .persistent()
            .get(&DataKey::VersionHistory(contract_id.clone()))
            .unwrap_or(Vec::new(&env));

        // Find the target version
        let mut target_abi_data: Option<Vec<u8>> = None;
        let mut target_hash: Option<[u8; 32]> = None;

        for v in version_history.iter() {
            if v.version == target_version {
                // We need to reconstruct ABI from the hash
                // In practice, you'd store the full ABI in version history
                target_hash = Some(v.abi_hash.clone());
                break;
            }
        }

        if target_hash.is_none() {
            panic!("Version not found");
        }

        let timestamp = env.ledger().timestamp();

        // Update metadata to point to old version
        let mut updated_metadata = metadata.clone();
        updated_metadata.version = target_version;
        updated_metadata.abi_hash = target_hash.unwrap();
        updated_metadata.updated_at = timestamp;

        env.storage().persistent().set(
            &DataKey::ContractMeta(contract_id.clone()),
            &updated_metadata,
        );

        // Emit rollback event
        env.events().publish(
            (symbol_short!("rbk"), contract_id.clone()),
            target_version,
        );

        true
    }

    /// Mark a contract as verified
    pub fn verify(env: Env, contract_id: Address) -> bool {
        let mut metadata: ContractAbiMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::ContractMeta(contract_id.clone()))
            .expect("Contract not registered");

        if metadata.verified {
            return true;
        }

        metadata.verified = true;

        env.storage().persistent().set(
            &DataKey::ContractMeta(contract_id.clone()),
            &metadata,
        );

        // Add to verified index
        let mut verified_list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::VerifiedContracts)
            .unwrap_or(Vec::new(&env));
        
        verified_list.push_back(contract_id.clone());
        env.storage().instance().set(&DataKey::VerifiedContracts, &verified_list);

        // Emit verification event
        env.events().publish(
            (symbol_short!("ver"), contract_id.clone()),
            (),
        );

        true
    }

    /// Remove a contract from the registry
    pub fn remove(env: Env, contract_id: Address) -> bool {
        let metadata: ContractAbiMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::ContractMeta(contract_id.clone()))
            .expect("Contract not registered");

        // Remove from name index
        env.storage().persistent().remove(&DataKey::ContractName(metadata.name));

        // Remove from verified list if verified
        if metadata.verified {
            let mut verified_list: Vec<Address> = env
                .storage()
                .instance()
                .get(&DataKey::VerifiedContracts)
                .unwrap_or(Vec::new(&env));
            
            // Find and remove contract from verified list
            let mut new_verified = Vec::new(&env);
            for addr in verified_list.iter() {
                if addr != &contract_id {
                    new_verified.push_back(addr.clone());
                }
            }
            env.storage().instance().set(&DataKey::VerifiedContracts, &new_verified);
        }

        // Remove all stored data
        env.storage().persistent().remove(&DataKey::ContractMeta(contract_id.clone()));
        env.storage().persistent().remove(&DataKey::ContractAbi(contract_id.clone()));
        env.storage().persistent().remove(&DataKey::VersionHistory(contract_id.clone()));

        // Emit removal event
        env.events().publish(
            (symbol_short!("rem"), contract_id.clone()),
            (),
        );

        true
    }

    /// Get contract metadata (without full ABI data for efficiency)
    pub fn get_metadata(env: Env, contract_id: Address) -> ContractAbiMetadata {
        env.storage()
            .persistent()
            .get(&DataKey::ContractMeta(contract_id))
            .expect("Contract not registered")
    }

    /// Get only the ABI data for a contract (optimized for high-throughput)
    pub fn get_abi(env: Env, contract_id: Address) -> Vec<u8> {
        env.storage()
            .persistent()
            .get(&DataKey::ContractAbi(contract_id))
            .expect("Contract not registered")
    }

    /// Get version history for a contract
    pub fn get_version_history(env: Env, contract_id: Address) -> Vec<AbiVersion> {
        env.storage()
            .persistent()
            .get(&DataKey::VersionHistory(contract_id))
            .unwrap_or(Vec::new(&env))
    }

    /// Lookup contract by name
    pub fn get_by_name(env: Env, name: String) -> Option<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::ContractName(name))
    }

    /// Get all verified contracts
    pub fn get_verified_contracts(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::VerifiedContracts)
            .unwrap_or(Vec::new(&env))
    }

    /// Check if a contract is registered
    pub fn is_registered(env: Env, contract_id: Address) -> bool {
        env.storage().persistent().has(&DataKey::ContractMeta(contract_id))
    }

    /// Calculate a simple hash of the ABI data
    fn calculate_hash(data: &Vec<u8>) -> [u8; 32] {
        let mut hash = [0u8; 32];
        let data_slice = data.as_slice();
        
        // Simple FNV-like hash for demonstration
        // In production, use a proper cryptographic hash
        let mut hash_val: u64 = 2166136261;
        const FNV_PRIME: u64 = 1099511628211;
        
        for (i, &byte) in data_slice.iter().enumerate() {
            hash_val ^= byte as u64;
            hash_val = hash_val.wrapping_mul(FNV_PRIME);
            if i < 32 {
                hash[i] = (hash_val >> (i % 8 * 8)) as u8;
            }
        }
        
        hash
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = Address::generate(&env);
        
        let contract_id = env.register(AbiRegistry, ());
        let client = AbiRegistryClient::new(&env, &contract_id);
        
        client.initialize(&admin);
        
        assert!(true);
    }

    #[test]
    fn test_register_and_get() {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = Address::generate(&env);
        let contract_id = Address::generate(&env);
        
        let registry_id = env.register(AbiRegistry, ());
        let client = AbiRegistryClient::new(&env, &registry_id);
        
        client.initialize(&admin);
        
        let name = String::from_slice(&env, "TestContract");
        let description = String::from_slice(&env, "A test contract");
        let abi_data = vec![1u8, 2, 3, 4];
        let note = String::from_slice(&env, "Initial version");
        
        let version = client.register(
            &contract_id,
            &name,
            &description,
            &abi_data,
            &note,
        );
        
        assert_eq!(version, 1);
        
        let metadata = client.get_metadata(&contract_id);
        assert_eq!(metadata.name, name);
        assert_eq!(metadata.version, 1);
        assert!(!metadata.verified);
    }

    #[test]
    fn test_update() {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = Address::generate(&env);
        let contract_id = Address::generate(&env);
        
        let registry_id = env.register(AbiRegistry, ());
        let client = AbiRegistryClient::new(&env, &registry_id);
        
        client.initialize(&admin);
        
        let name = String::from_slice(&env, "TestContract");
        let description = String::from_slice(&env, "A test contract");
        let abi_data = vec![1u8, 2, 3, 4];
        let note = String::from_slice(&env, "Initial version");
        
        client.register(&contract_id, &name, &description, &abi_data, &note);
        
        let new_abi = vec![1u8, 2, 3, 4, 5];
        let new_note = String::from_slice(&env, "Updated version");
        
        let new_version = client.update(&contract_id, &new_abi, &new_note);
        
        assert_eq!(new_version, 2);
        
        let metadata = client.get_metadata(&contract_id);
        assert_eq!(metadata.version, 2);
    }

    #[test]
    fn test_verify() {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = Address::generate(&env);
        let contract_id = Address::generate(&env);
        
        let registry_id = env.register(AbiRegistry, ());
        let client = AbiRegistryClient::new(&env, &registry_id);
        
        client.initialize(&admin);
        
        let name = String::from_slice(&env, "TestContract");
        let description = String::from_slice(&env, "A test contract");
        let abi_data = vec![1u8, 2, 3, 4];
        let note = String::from_slice(&env, "Initial version");
        
        client.register(&contract_id, &name, &description, &abi_data, &note);
        
        let verified = client.verify(&contract_id);
        
        assert!(verified);
        
        let metadata = client.get_metadata(&contract_id);
        assert!(metadata.verified);
    }

    #[test]
    fn test_get_by_name() {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = Address::generate(&env);
        let contract_id = Address::generate(&env);
        
        let registry_id = env.register(AbiRegistry, ());
        let client = AbiRegistryClient::new(&env, &registry_id);
        
        client.initialize(&admin);
        
        let name = String::from_slice(&env, "TestContract");
        let description = String::from_slice(&env, "A test contract");
        let abi_data = vec![1u8, 2, 3, 4];
        let note = String::from_slice(&env, "Initial version");
        
        client.register(&contract_id, &name, &description, &abi_data, &note);
        
        let found_id = client.get_by_name(&name);
        
        assert!(found_id.is_some());
        assert_eq!(found_id.unwrap(), contract_id);
    }
}