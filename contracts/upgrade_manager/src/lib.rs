#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, vec, Address, BytesN, Env, IntoVal, Symbol, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposedUpgrade {
    pub target: Address,
    pub new_wasm_hash: BytesN<32>,
    pub eta: u64,
    pub frozen: bool,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Guardians,
    Upgrade(Address),
}

const MIN_DELAY: u64 = 172_800; // 48 hours

#[contract]
pub struct UpgradeManager;

#[contractimpl]
impl UpgradeManager {
    /// Initialize the contract with an admin and a list of security guardians.
    pub fn initialize(env: Env, admin: Address, guardians: Vec<Address>) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Guardians, &guardians);
    }

    /// Propose an upgrade for a target contract.
    /// Only the admin can propose upgrades.
    /// Emits `UpgradeSignal`.
    pub fn propose_upgrade(env: Env, proposer: Address, target: Address, new_wasm_hash: BytesN<32>) {
        proposer.require_auth();
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        if proposer != admin {
            panic!("Only admin can propose upgrades");
        }

        let eta = env.ledger().timestamp() + MIN_DELAY;
        let proposal = ProposedUpgrade {
            target: target.clone(),
            new_wasm_hash: new_wasm_hash.clone(),
            eta,
            frozen: false,
        };

        env.storage().persistent().set(&DataKey::Upgrade(target.clone()), &proposal);

        env.events().publish(
            (symbol_short!("Upgrade"), symbol_short!("Signal")),
            (target, new_wasm_hash, eta),
        );
    }

    /// Finalize a proposed upgrade after the 48-hour delay has passed.
    /// The upgrade must not be frozen.
    /// Emits `UpgradeFinalized`.
    pub fn finalize_upgrade(env: Env, target: Address) {
        let proposal: ProposedUpgrade = env.storage().persistent()
            .get(&DataKey::Upgrade(target.clone()))
            .expect("No upgrade proposed for this target");

        if proposal.frozen {
            panic!("Upgrade is frozen");
        }

        if env.ledger().timestamp() < proposal.eta {
            panic!("Timelock not expired");
        }

        // Call the target contract's upgrade method.
        // The target contract must implement: pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>)
        // and authorize this UpgradeManager contract.
        env.invoke_contract::<()>(
            &target,
            &Symbol::new(&env, "upgrade"),
            vec![&env, proposal.new_wasm_hash.into_val(&env)],
        );

        env.storage().persistent().remove(&DataKey::Upgrade(target.clone()));

        env.events().publish(
            (symbol_short!("Upgrade"), symbol_short!("Finalized")),
            (target, proposal.new_wasm_hash),
        );
    }

    /// Freeze a proposed upgrade. Can be called by any designated guardian.
    pub fn freeze_upgrade(env: Env, guardian: Address, target: Address) {
        guardian.require_auth();
        let guardians: Vec<Address> = env.storage().instance().get(&DataKey::Guardians).unwrap();
        if !guardians.contains(&guardian) {
            panic!("Not a guardian");
        }

        let mut proposal: ProposedUpgrade = env.storage().persistent()
            .get(&DataKey::Upgrade(target.clone()))
            .expect("No upgrade proposed for this target");

        proposal.frozen = true;
        env.storage().persistent().set(&DataKey::Upgrade(target.clone()), &proposal);

        env.events().publish(
            (symbol_short!("Upgrade"), symbol_short!("Frozen")),
            target,
        );
    }

    /// Unfreeze a previously frozen upgrade. Only the admin can unfreeze.
    pub fn unfreeze_upgrade(env: Env, target: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut proposal: ProposedUpgrade = env.storage().persistent()
            .get(&DataKey::Upgrade(target.clone()))
            .expect("No upgrade proposed for this target");

        proposal.frozen = false;
        env.storage().persistent().set(&DataKey::Upgrade(target.clone()), &proposal);

        env.events().publish(
            (symbol_short!("Upgrade"), symbol_short!("Unfrozen")),
            target,
        );
    }

    /// Cancel a proposed upgrade. Only the admin can cancel.
    pub fn cancel_upgrade(env: Env, target: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if !env.storage().persistent().has(&DataKey::Upgrade(target.clone())) {
            panic!("No upgrade proposed for this target");
        }

        env.storage().persistent().remove(&DataKey::Upgrade(target.clone()));

        env.events().publish(
            (symbol_short!("Upgrade"), symbol_short!("Canceled")),
            target,
        );
    }

    /// Get the current status of a proposed upgrade.
    pub fn get_upgrade(env: Env, target: Address) -> Option<ProposedUpgrade> {
        env.storage().persistent().get(&DataKey::Upgrade(target))
    }
}

mod test;
