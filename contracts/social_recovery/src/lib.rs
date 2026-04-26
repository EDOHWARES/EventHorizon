#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, Env, Vec};

const MIN_RECOVERY_DELAY: u64 = 3_600;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Owner,
    Guardians,
    Threshold,
    RecoveryDelay,
    NextRequestId,
    ActiveRequest,
    Vote(u64, Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryRequest {
    pub id: u64,
    pub proposed_owner: Address,
    pub approvals: u32,
    pub created_at: u64,
    pub ready_at: Option<u64>,
}

#[contractevent]
pub struct Initialized {
    pub owner: Address,
    pub guardian_count: u32,
    pub threshold: u32,
    pub recovery_delay: u64,
}

#[contractevent]
pub struct RecoveryRequested {
    pub request_id: u64,
    pub requester: Address,
    pub proposed_owner: Address,
    pub approvals: u32,
    pub threshold: u32,
}

#[contractevent]
pub struct RecoveryVoteCast {
    pub request_id: u64,
    pub guardian: Address,
    pub approvals: u32,
    pub threshold: u32,
    pub ready_at: Option<u64>,
}

#[contractevent]
pub struct RecoveryVoteRevoked {
    pub request_id: u64,
    pub guardian: Address,
    pub approvals: u32,
    pub threshold: u32,
}

#[contractevent]
pub struct RecoveryCancelled {
    pub request_id: u64,
    pub canceller: Address,
}

#[contractevent]
pub struct RecoveryExecuted {
    pub request_id: u64,
    pub previous_owner: Address,
    pub new_owner: Address,
}

#[contract]
pub struct SocialRecovery;

#[contractimpl]
impl SocialRecovery {
    pub fn initialize(
        env: Env,
        owner: Address,
        guardians: Vec<Address>,
        threshold: u32,
        recovery_delay: u64,
    ) {
        if env.storage().instance().has(&DataKey::Owner) {
            panic!("Already initialized");
        }
        Self::validate_guardians(&guardians);
        Self::validate_threshold(&guardians, threshold);
        if recovery_delay < MIN_RECOVERY_DELAY {
            panic!("Recovery delay too short");
        }

        env.storage().instance().set(&DataKey::Owner, &owner.clone());
        env.storage().instance().set(&DataKey::Guardians, &guardians.clone());
        env.storage().instance().set(&DataKey::Threshold, &threshold);
        env.storage().instance().set(&DataKey::RecoveryDelay, &recovery_delay);
        env.storage().instance().set(&DataKey::NextRequestId, &1u64);

        env.events().publish_event(&Initialized {
            owner,
            guardian_count: guardians.len(),
            threshold,
            recovery_delay,
        });
    }

    pub fn request_recovery(env: Env, guardian: Address, proposed_owner: Address) -> u64 {
        guardian.require_auth();
        Self::require_guardian(&env, &guardian);
        Self::require_no_active_request(&env);

        let owner = Self::get_owner(env.clone());
        if proposed_owner == owner {
            panic!("Proposed owner unchanged");
        }

        let request_id = Self::next_request_id(&env);
        let mut request = RecoveryRequest {
            id: request_id,
            proposed_owner: proposed_owner.clone(),
            approvals: 0,
            created_at: env.ledger().timestamp(),
            ready_at: None,
        };

        env.storage().persistent().set(&DataKey::ActiveRequest, &request);
        env.events().publish_event(&RecoveryRequested {
            request_id,
            requester: guardian.clone(),
            proposed_owner,
            approvals: 0,
            threshold: Self::get_threshold(env.clone()),
        });

        Self::cast_vote(&env, &mut request, guardian.clone());
        env.storage().persistent().set(&DataKey::ActiveRequest, &request);
        request_id
    }

    pub fn vote_recovery(env: Env, guardian: Address) {
        guardian.require_auth();
        Self::require_guardian(&env, &guardian);

        let mut request = Self::get_active_request(env.clone());
        Self::cast_vote(&env, &mut request, guardian);
        env.storage().persistent().set(&DataKey::ActiveRequest, &request);
    }

    pub fn revoke_vote(env: Env, guardian: Address) {
        guardian.require_auth();
        Self::require_guardian(&env, &guardian);

        let mut request = Self::get_active_request(env.clone());
        let vote_key = DataKey::Vote(request.id, guardian.clone());
        let has_voted = env.storage().persistent().get::<_, bool>(&vote_key).unwrap_or(false);
        if !has_voted {
            panic!("Vote not found");
        }

        env.storage().persistent().remove(&vote_key);
        request.approvals -= 1;

        let threshold = Self::get_threshold(env.clone());
        if request.approvals < threshold {
            request.ready_at = None;
        }

        env.storage().persistent().set(&DataKey::ActiveRequest, &request);
        env.events().publish_event(&RecoveryVoteRevoked {
            request_id: request.id,
            guardian,
            approvals: request.approvals,
            threshold,
        });
    }

    pub fn cancel_recovery(env: Env, actor: Address) {
        actor.require_auth();

        let owner = Self::get_owner(env.clone());
        if actor != owner {
            Self::require_guardian(&env, &actor);
        }

        let request = Self::get_active_request(env.clone());
        Self::clear_votes(&env, request.id);
        env.storage().persistent().remove(&DataKey::ActiveRequest);

        env.events().publish_event(&RecoveryCancelled {
            request_id: request.id,
            canceller: actor,
        });
    }

    pub fn execute_recovery(env: Env, proposed_owner: Address) {
        proposed_owner.require_auth();

        let request = Self::get_active_request(env.clone());
        if request.proposed_owner != proposed_owner {
            panic!("Unauthorized nominee");
        }

        let ready_at = request.ready_at.expect("Threshold not met");
        if env.ledger().timestamp() < ready_at {
            panic!("Recovery delay not elapsed");
        }

        let previous_owner = Self::get_owner(env.clone());
        env.storage().instance().set(&DataKey::Owner, &proposed_owner.clone());
        Self::clear_votes(&env, request.id);
        env.storage().persistent().remove(&DataKey::ActiveRequest);

        env.events().publish_event(&RecoveryExecuted {
            request_id: request.id,
            previous_owner,
            new_owner: proposed_owner,
        });
    }

    pub fn get_owner(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Owner).expect("Not initialized")
    }

    pub fn get_guardians(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::Guardians).expect("Not initialized")
    }

    pub fn get_threshold(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Threshold).expect("Not initialized")
    }

    pub fn get_recovery_delay(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::RecoveryDelay).expect("Not initialized")
    }

    pub fn get_active_recovery(env: Env) -> Option<RecoveryRequest> {
        env.storage().persistent().get(&DataKey::ActiveRequest)
    }

    pub fn has_voted(env: Env, guardian: Address) -> bool {
        if let Some(request) = Self::get_active_recovery(env.clone()) {
            return env
                .storage()
                .persistent()
                .get(&DataKey::Vote(request.id, guardian))
                .unwrap_or(false);
        }

        false
    }

    fn validate_guardians(guardians: &Vec<Address>) {
        if guardians.is_empty() {
            panic!("At least one guardian required");
        }

        let len = guardians.len();
        let mut i = 0;
        while i < len {
            let current = guardians.get(i).unwrap();
            let mut j = i + 1;
            while j < len {
                if guardians.get(j).unwrap() == current {
                    panic!("Duplicate guardian");
                }
                j += 1;
            }
            i += 1;
        }
    }

    fn validate_threshold(guardians: &Vec<Address>, threshold: u32) {
        if threshold == 0 {
            panic!("Threshold must be >= 1");
        }
        if threshold > guardians.len() {
            panic!("Threshold exceeds guardian count");
        }
    }

    fn require_guardian(env: &Env, guardian: &Address) {
        let guardians: Vec<Address> = env.storage().instance().get(&DataKey::Guardians).expect("Not initialized");
        if !guardians.contains(guardian) {
            panic!("Not a guardian");
        }
    }

    fn require_no_active_request(env: &Env) {
        if env.storage().persistent().has(&DataKey::ActiveRequest) {
            panic!("Recovery already active");
        }
    }

    fn get_active_request(env: Env) -> RecoveryRequest {
        env.storage().persistent().get(&DataKey::ActiveRequest).expect("No active recovery")
    }

    fn next_request_id(env: &Env) -> u64 {
        let id: u64 = env.storage().instance().get(&DataKey::NextRequestId).unwrap_or(1);
        env.storage().instance().set(&DataKey::NextRequestId, &(id + 1));
        id
    }

    fn cast_vote(env: &Env, request: &mut RecoveryRequest, guardian: Address) {
        let vote_key = DataKey::Vote(request.id, guardian.clone());
        let has_voted = env.storage().persistent().get::<_, bool>(&vote_key).unwrap_or(false);
        if has_voted {
            panic!("Guardian already voted");
        }

        env.storage().persistent().set(&vote_key, &true);
        request.approvals += 1;

        let threshold = Self::get_threshold(env.clone());
        if request.approvals >= threshold && request.ready_at.is_none() {
            let delay = Self::get_recovery_delay(env.clone());
            request.ready_at = Some(env.ledger().timestamp() + delay);
        }

        env.events().publish_event(&RecoveryVoteCast {
            request_id: request.id,
            guardian,
            approvals: request.approvals,
            threshold,
            ready_at: request.ready_at,
        });
    }

    fn clear_votes(env: &Env, request_id: u64) {
        let guardians = Self::get_guardians(env.clone());
        let mut i = 0;
        while i < guardians.len() {
            let guardian = guardians.get(i).unwrap();
            env.storage()
                .persistent()
                .remove(&DataKey::Vote(request_id, guardian));
            i += 1;
        }
    }
}

mod test;
