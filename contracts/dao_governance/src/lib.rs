#![no_std]
use soroban_sdk::{contract, contractevent, contractimpl, contracttype, token, Address, Env, Symbol, Vec, symbol_short};

// ── Data Structures ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Proposed,  // Initial state after creation
    Open,      // Voting is ongoing
    Closed,    // Voting has ended (includes both passed and failed)
    Executed,  // Proposal has been executed
    Expired,   // Voting period expired without meeting quorum/majority
}

// Legacy states for backward compatibility
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalOutcome {
    Pending,   // Not yet in voting
    Succeeded, // Passed voting
    Failed,    // Failed voting
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub description: Symbol,
    pub votes_for: i128,
    pub votes_against: i128,
    pub start_block: u32,
    pub end_block: u32,
    pub execution_time: u64, // Timelock execution timestamp
    pub executed: bool,
    pub outcome: ProposalOutcome, // Tracks if proposal passed or failed voting
}

/// Tracks cumulative voter participation for external reward systems.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VoterMetrics {
    /// Total cumulative voting weight across all proposals.
    pub total_weight: i128,
    /// Number of proposals the voter has participated in.
    pub vote_count: u32,
    /// Ledger sequence of the voter's first vote.
    pub first_vote_ledger: u32,
    /// Ledger sequence of the voter's most recent vote.
    pub last_vote_ledger: u32,
}

/// Delegation record: who an address has delegated to.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DelegationInfo {
    /// The address that delegated their voting power.
    pub delegator: Address,
    /// The address receiving the delegated voting power.
    pub delegatee: Address,
    /// Ledger sequence when delegation was created.
    pub delegation_ledger: u32,
}

/// Snapshot of a single voter's power at a specific ledger sequence.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PowerSnapshotEntry {
    /// The voter whose power was recorded.
    pub voter: Address,
    /// Effective voting power (own balance + delegated) at snapshot time.
    pub power: i128,
}

/// A complete snapshot of all voting powers at a given ledger.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PowerSnapshot {
    /// Unique snapshot identifier.
    pub id: u64,
    /// Ledger sequence at which the snapshot was taken.
    pub ledger_sequence: u32,
    /// Timestamp when the snapshot was taken.
    pub timestamp: u64,
    /// Entries in the snapshot (voter → power).
    pub entries: Vec<PowerSnapshotEntry>,
}

// ── Events ──────────────────────────────────────────────────────────────────

/// Emitted when a proposal is created (enters Proposed state).
#[contractevent]
pub struct ProposalCreated {
    pub proposal_id: u64,
    pub proposer: Address,
    pub description: Symbol,
    pub start_block: u32,
    pub end_block: u32,
}

/// Emitted when voting on a proposal begins (transitions to Open state).
#[contractevent]
pub struct ProposalOpened {
    pub proposal_id: u64,
    pub ledger_sequence: u32,
}

/// Emitted when voting on a proposal ends (transitions to Closed state).
#[contractevent]
pub struct ProposalClosed {
    pub proposal_id: u64,
    pub votes_for: i128,
    pub votes_against: i128,
    pub passed: bool,
    pub ledger_sequence: u32,
}

/// Emitted when a vote is cast on a proposal.
#[contractevent]
pub struct VoteCast {
    pub proposal_id: u64,
    pub voter: Address,
    pub support: bool,
    pub weight: i128,
}

/// Emitted when a proposal transitions to executed state.
#[contractevent]
pub struct ProposalExecuted {
    pub proposal_id: u64,
    pub executed_at: u64,
}

/// Emitted per-voter after a proposal reaches consensus (queued).
/// External reward systems can consume this to distribute participation rewards.
#[contractevent]
pub struct VoterEngagement {
    pub proposal_id: u64,
    pub voter: Address,
    pub weight: i128,
    pub vote_count: u32,
    pub total_weight: i128,
}

/// Emitted when a voter delegates their voting power.
#[contractevent]
pub struct DelegationChanged {
    pub delegator: Address,
    pub old_delegatee: Option<Address>,
    pub new_delegatee: Address,
    pub delegated_power: i128,
}

/// Emitted when delegation is removed.
#[contractevent]
pub struct DelegationRemoved {
    pub delegator: Address,
    pub former_delegatee: Address,
    pub delegated_power: i128,
}

/// Emitted when voting power snapshot is taken.
#[contractevent]
pub struct SnapshotCreated {
    pub snapshot_id: u64,
    pub ledger_sequence: u32,
    pub entry_count: u32,
}

// ── Storage Keys ────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    GovernanceToken,
    MinVotingPeriod, // in blocks
    TimelockDelay,   // in seconds
    Quorum,          // min votes for
    ProposalCount,
    Proposal(u64),
    Voted(u64, Address),
    // ── Voter participation tracking ──
    VoterMetrics(Address),
    /// List of voter addresses that voted on a proposal.
    ProposalVoters(u64),
    /// The voting weight used by a voter on a specific proposal.
    VotedWeight(u64, Address),
    // ── Delegation monitoring ──
    /// Maps delegator → DelegationInfo (who they delegated to).
    Delegation(Address),
    /// Maps delegatee → Vec<DelegationInfo> (who delegated to them).
    IncomingDelegations(Address),
    // ── Voting power snapshots ──
    SnapshotCount,
    Snapshot(u64),
}

// ── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct DaoGovernance;

#[contractimpl]
impl DaoGovernance {
    // ── Initialization ──────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        min_voting_period: u32,
        timelock_delay: u64,
        quorum: i128,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::GovernanceToken, &token);
        env.storage().instance().set(&DataKey::MinVotingPeriod, &min_voting_period);
        env.storage().instance().set(&DataKey::TimelockDelay, &timelock_delay);
        env.storage().instance().set(&DataKey::Quorum, &quorum);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
        env.storage().instance().set(&DataKey::SnapshotCount, &0u64);
    }

    // ── Proposal Management ─────────────────────────────────────────────────

    pub fn create_proposal(env: Env, proposer: Address, description: Symbol) -> u64 {
        proposer.require_auth();

        let count: u64 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        let proposal_id = count + 1;

        let min_voting_period: u32 = env.storage().instance().get(&DataKey::MinVotingPeriod).unwrap();
        let start_block = env.ledger().sequence();
        let end_block = start_block + min_voting_period;

        let proposal = Proposal {
            id: proposal_id,
            proposer: proposer.clone(),
            description: description.clone(),
            votes_for: 0,
            votes_against: 0,
            start_block,
            end_block,
            execution_time: 0,
            executed: false,
            outcome: ProposalOutcome::Pending,
        };

        // Initialize empty voter list for this proposal
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &proposal_id);
        env.storage().persistent().set(&DataKey::ProposalVoters(proposal_id), &Vec::<Address>::new(&env));

        // Emit ProposalCreated event
        env.events().publish_event(&ProposalCreated {
            proposal_id,
            proposer,
            description,
            start_block,
            end_block,
        });

        // Emit legacy event for backward compatibility
        env.events().publish(
            (Symbol::new(&env, "proposal_created"), proposal_id),
            (proposer, description)
        );

        proposal_id
    }

    /// Cast a vote on a proposal. Uses effective voting power (own balance + all
    /// power delegated to the voter). Records voter metrics for participation tracking.
    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool) {
        voter.require_auth();

        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        let current_block = env.ledger().sequence();
        
        // Ensure voting is in the Open state
        if current_block < proposal.start_block {
            panic!("Voting not yet started");
        }
        if current_block > proposal.end_block {
            panic!("Voting has ended");
        }

        let voted_key = DataKey::Voted(proposal_id, voter.clone());
        if env.storage().persistent().has(&voted_key) {
            panic!("Already voted");
        }

        // Prevent delegated voters from voting directly — their power is
        // exercised by their delegatee via effective voting power.
        if env.storage().persistent().has(&DataKey::Delegation(voter.clone())) {
            panic!("Delegated voters cannot vote directly");
        }

        // Calculate effective voting power: own balance + delegated power
        let voting_power = Self::_effective_voting_power(&env, &voter);

        if voting_power <= 0 {
            panic!("No voting power");
        }

        if support {
            proposal.votes_for += voting_power;
        } else {
            proposal.votes_against += voting_power;
        }

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().persistent().set(&voted_key, &true);
        // Store the exact weight used in this vote for engagement events
        env.storage().persistent().set(&DataKey::VotedWeight(proposal_id, voter.clone()), &voting_power);

        // ── Track voter participation metrics ──
        Self::_update_voter_metrics(&env, &voter, voting_power, current_block);

        // ── Add voter to proposal's voter list (for engagement events later) ──
        let mut voters: Vec<Address> = env.storage().persistent()
            .get(&DataKey::ProposalVoters(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));
        voters.push_back(voter.clone());
        env.storage().persistent().set(&DataKey::ProposalVoters(proposal_id), &voters);

        // Emit VoteCast event
        env.events().publish_event(&VoteCast {
            proposal_id,
            voter: voter.clone(),
            support,
            weight: voting_power,
        });

        // Emit legacy event for backward compatibility
        env.events().publish(
            (Symbol::new(&env, "vote_cast"), proposal_id, voter.clone()),
            (support, voting_power)
        );
    }

    /// Queue a succeeded proposal for execution after the timelock.
    /// Emits `VoterEngagement` events for every participant — this is the
    /// "consensus reached" signal that external reward systems consume.
    pub fn queue_proposal(env: Env, proposal_id: u64) {
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        let current_block = env.ledger().sequence();
        if current_block <= proposal.end_block {
            panic!("Voting still ongoing");
        }

        let quorum: i128 = env.storage().instance().get(&DataKey::Quorum).unwrap();
        let proposal_passed = proposal.votes_for > proposal.votes_against && proposal.votes_for >= quorum;
        
        if !proposal_passed {
            panic!("Proposal failed");
        }

        if proposal.execution_time > 0 {
            panic!("Proposal already queued");
        }

        // Update proposal outcome to track that voting passed
        proposal.outcome = ProposalOutcome::Succeeded;

        let delay: u64 = env.storage().instance().get(&DataKey::TimelockDelay).unwrap();
        proposal.execution_time = env.ledger().timestamp() + delay;

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        // Emit ProposalClosed event when transitioning to Closed state
        env.events().publish_event(&ProposalClosed {
            proposal_id,
            votes_for: proposal.votes_for,
            votes_against: proposal.votes_against,
            passed: true,
            ledger_sequence: current_block,
        });

        // Emit legacy event for backward compatibility
        env.events().publish(
            (symbol_short!("prop_que"), proposal_id),
            proposal.execution_time
        );

        // ── Emit VoterEngagement events for every participant ──
        // Consensus has been reached — this is the signal for external reward systems.
        let voters: Vec<Address> = env.storage().persistent()
            .get(&DataKey::ProposalVoters(proposal_id))
            .unwrap_or_else(|| Vec::new(&env));

        for voter in voters.iter() {
            let weight: i128 = env.storage().persistent()
                .get(&DataKey::VotedWeight(proposal_id, voter.clone()))
                .unwrap_or(0);
            let metrics: VoterMetrics = env.storage().persistent()
                .get(&DataKey::VoterMetrics(voter.clone()))
                .unwrap_or(VoterMetrics {
                    total_weight: 0,
                    vote_count: 0,
                    first_vote_ledger: 0,
                    last_vote_ledger: 0,
                });

            env.events().publish_event(&VoterEngagement {
                proposal_id,
                voter: voter.clone(),
                weight,
                vote_count: metrics.vote_count,
                total_weight: metrics.total_weight,
            });
        }
    }

    pub fn execute_proposal(env: Env, proposal_id: u64) {
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.executed {
            panic!("Already executed");
        }

        if proposal.execution_time == 0 {
            panic!("Proposal not queued");
        }

        if env.ledger().timestamp() < proposal.execution_time {
            panic!("Timelock not expired");
        }

        proposal.executed = true;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        let executed_at = env.ledger().timestamp();

        // Emit ProposalExecuted event
        env.events().publish_event(&ProposalExecuted {
            proposal_id,
            executed_at,
        });

        // Emit legacy event for backward compatibility
        env.events().publish(
            (symbol_short!("prop_exe"), proposal_id),
            true
        );
    }

    // ── Delegation ──────────────────────────────────────────────────────────

    /// Delegate your voting power to another address.
    /// The delegatee's effective power becomes their own balance + all
    /// incoming delegations. The delegator can no longer vote directly
    /// until they call `undelegate`.
    pub fn delegate(env: Env, delegator: Address, delegatee: Address) {
        delegator.require_auth();

        if delegator == delegatee {
            panic!("Cannot delegate to self");
        }

        // Get the delegated power amount
        let token_addr: Address = env.storage().instance().get(&DataKey::GovernanceToken).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        let delegated_power = token_client.balance(&delegator);

        // Check for existing delegation
        let old_delegatee: Option<Address> = if env.storage().persistent().has(&DataKey::Delegation(delegator.clone())) {
            let existing: DelegationInfo = env.storage().persistent()
                .get(&DataKey::Delegation(delegator.clone()))
                .unwrap();
            if existing.delegatee == delegatee {
                panic!("Already delegated to this address");
            }
            Some(existing.delegatee)
        } else {
            None
        };

        // Remove from old delegatee's incoming list (if re-delegating)
        if let Some(ref old) = old_delegatee {
            Self::_remove_incoming_delegation(&env, old, &delegator);
        }

        let current_ledger = env.ledger().sequence();

        // Create delegation record
        let delegation = DelegationInfo {
            delegator: delegator.clone(),
            delegatee: delegatee.clone(),
            delegation_ledger: current_ledger,
        };
        env.storage().persistent().set(&DataKey::Delegation(delegator.clone()), &delegation);

        // Add to new delegatee's incoming list
        Self::_add_incoming_delegation(&env, &delegatee, &delegation);

        env.events().publish_event(&DelegationChanged {
            delegator: delegator.clone(),
            old_delegatee,
            new_delegatee: delegatee,
            delegated_power,
        });
    }

    /// Remove your delegation, restoring the ability to vote directly.
    pub fn undelegate(env: Env, delegator: Address) {
        delegator.require_auth();

        let delegation: DelegationInfo = env.storage().persistent()
            .get(&DataKey::Delegation(delegator.clone()))
            .expect("No active delegation");

        let former_delegatee = delegation.delegatee.clone();

        // Get the delegated power amount
        let token_addr: Address = env.storage().instance().get(&DataKey::GovernanceToken).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        let delegated_power = token_client.balance(&delegator);

        // Remove delegation record
        env.storage().persistent().remove(&DataKey::Delegation(delegator.clone()));

        // Remove from delegatee's incoming list
        Self::_remove_incoming_delegation(&env, &former_delegatee, &delegator);

        env.events().publish_event(&DelegationRemoved {
            delegator,
            former_delegatee,
            delegated_power,
        });
    }

    /// Returns the delegation info for a given address, if any.
    pub fn get_delegation(env: Env, delegator: Address) -> Option<DelegationInfo> {
        env.storage().persistent().get(&DataKey::Delegation(delegator))
    }

    /// Returns all incoming delegations for a delegatee address.
    pub fn get_incoming_delegations(env: Env, delegatee: Address) -> Vec<DelegationInfo> {
        env.storage().persistent()
            .get(&DataKey::IncomingDelegations(delegatee))
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ── Voting Power Snapshots ──────────────────────────────────────────────

    /// Take a snapshot of the current voting power for all known voters.
    /// Returns the snapshot ID. Snapshots are efficient because they only
    /// record addresses that have ever participated or delegated.
    ///
    /// Only the admin can trigger a snapshot to prevent spam.
    pub fn snapshot_voting_power(env: Env) -> u64 {
        Self::_require_admin(&env);

        let snapshot_count: u64 = env.storage().instance().get(&DataKey::SnapshotCount).unwrap_or(0);
        let snapshot_id = snapshot_count + 1;

        // Collect all voters who have metrics (meaning they've voted before)
        // and any active delegatees who hold delegated power.
        let mut entries: Vec<PowerSnapshotEntry> = Vec::new(&env);

        // We iterate proposal voters to discover all participants.
        // This is the authoritative source of "who has engaged".
        let proposal_count: u64 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        let mut seen: Vec<Address> = Vec::new(&env);

        // Collect all unique voters across all proposals
        for pid in 1..=proposal_count {
            let voters: Vec<Address> = env.storage().persistent()
                .get(&DataKey::ProposalVoters(pid))
                .unwrap_or_else(|| Vec::new(&env));
            for voter in voters.iter() {
                // Check if we've already seen this address
                let mut already_seen = false;
                let mut j = 0;
                while j < seen.len() {
                    if seen.get(j).unwrap() == voter {
                        already_seen = true;
                        break;
                    }
                    j += 1;
                }
                if !already_seen {
                    seen.push_back(voter.clone());
                }
            }
        }

        // Also check delegatees who may not have voted but hold delegated power
        // We need to discover delegatees — they will be in incoming delegations.
        // Since we can't enumerate all keys, we rely on the proposer/voter lists.
        // Delegators who haven't voted won't appear — but their delegatees who have
        // voted will get the correct effective power.

        // Build snapshot entries
        for voter in seen.iter() {
            let power = Self::_effective_voting_power(&env, &voter);
            entries.push_back(PowerSnapshotEntry {
                voter,
                power,
            });
        }

        let snapshot = PowerSnapshot {
            id: snapshot_id,
            ledger_sequence: env.ledger().sequence(),
            timestamp: env.ledger().timestamp(),
            entries,
        };

        env.storage().persistent().set(&DataKey::Snapshot(snapshot_id), &snapshot);
        env.storage().instance().set(&DataKey::SnapshotCount, &snapshot_id);

        let entry_count = snapshot.entries.len() as u32;
        env.events().publish_event(&SnapshotCreated {
            snapshot_id,
            ledger_sequence: env.ledger().sequence(),
            entry_count,
        });

        snapshot_id
    }

    /// Retrieve a previously taken snapshot by ID.
    pub fn get_snapshot(env: Env, snapshot_id: u64) -> PowerSnapshot {
        env.storage().persistent()
            .get(&DataKey::Snapshot(snapshot_id))
            .expect("Snapshot not found")
    }

    /// Get the total number of snapshots taken.
    pub fn get_snapshot_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::SnapshotCount).unwrap_or(0)
    }

    // ── View / Getter Functions ─────────────────────────────────────────────

    pub fn get_proposal(env: Env, proposal_id: u64) -> Proposal {
        env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found")
    }

    pub fn get_status(env: Env, proposal_id: u64) -> ProposalStatus {
        let proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        // Executed state
        if proposal.executed {
            return ProposalStatus::Executed;
        }

        let current_block = env.ledger().sequence();
        
        // Proposed state: before voting starts
        if current_block < proposal.start_block {
            return ProposalStatus::Proposed;
        }
        
        // Open state: voting is ongoing
        if current_block <= proposal.end_block {
            return ProposalStatus::Open;
        }

        // Determine outcome after voting period ends
        let quorum: i128 = env.storage().instance().get(&DataKey::Quorum).unwrap();
        let proposal_passed = proposal.votes_for > proposal.votes_against && proposal.votes_for >= quorum;
        
        // Closed state: voting has ended
        if proposal_passed {
            if proposal.execution_time > 0 && env.ledger().timestamp() < proposal.execution_time {
                // Still waiting for timelock
                return ProposalStatus::Closed;
            }
        } else {
            return ProposalStatus::Expired;
        }

        ProposalStatus::Closed
    }

    /// Returns the participation metrics for a voter.
    pub fn get_voter_metrics(env: Env, voter: Address) -> VoterMetrics {
        env.storage().persistent()
            .get(&DataKey::VoterMetrics(voter))
            .unwrap_or(VoterMetrics {
                total_weight: 0,
                vote_count: 0,
                first_vote_ledger: 0,
                last_vote_ledger: 0,
            })
    }

    /// Returns the effective voting power for an address (own balance + delegated power).
    /// This is the power that would be used if they vote on an active proposal.
    pub fn get_voting_power(env: Env, voter: Address) -> i128 {
        Self::_effective_voting_power(&env, &voter)
    }

    /// Returns the list of voters who participated in a proposal.
    pub fn get_proposal_voters(env: Env, proposal_id: u64) -> Vec<Address> {
        env.storage().persistent()
            .get(&DataKey::ProposalVoters(proposal_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ── Internal Helpers ────────────────────────────────────────────────────

    /// Calculate effective voting power: own token balance + sum of all
    /// delegated balances from addresses that have delegated to this voter.
    fn _effective_voting_power(env: &Env, voter: &Address) -> i128 {
        let token_addr: Address = env.storage().instance().get(&DataKey::GovernanceToken).unwrap();
        let token_client = token::Client::new(env, &token_addr);

        // Own balance
        let mut power = token_client.balance(voter);

        // Add delegated power from all incoming delegations
        let incoming: Vec<DelegationInfo> = env.storage().persistent()
            .get(&DataKey::IncomingDelegations(voter.clone()))
            .unwrap_or_else(|| Vec::new(env));

        for delegation in incoming.iter() {
            let delegator_balance = token_client.balance(&delegation.delegator);
            power += delegator_balance;
        }

        power
    }

    /// Update the cumulative voter metrics after a vote is cast.
    fn _update_voter_metrics(env: &Env, voter: &Address, weight: i128, ledger: u32) {
        let mut metrics: VoterMetrics = env.storage().persistent()
            .get(&DataKey::VoterMetrics(voter.clone()))
            .unwrap_or(VoterMetrics {
                total_weight: 0,
                vote_count: 0,
                first_vote_ledger: ledger,
                last_vote_ledger: 0,
            });

        // Set first_vote_ledger only on the very first vote
        if metrics.vote_count == 0 {
            metrics.first_vote_ledger = ledger;
        }

        metrics.total_weight += weight;
        metrics.vote_count += 1;
        metrics.last_vote_ledger = ledger;

        env.storage().persistent().set(&DataKey::VoterMetrics(voter.clone()), &metrics);
    }

    /// Add a delegation to a delegatee's incoming list.
    fn _add_incoming_delegation(env: &Env, delegatee: &Address, delegation: &DelegationInfo) {
        let mut incoming: Vec<DelegationInfo> = env.storage().persistent()
            .get(&DataKey::IncomingDelegations(delegatee.clone()))
            .unwrap_or_else(|| Vec::new(env));
        incoming.push_back(delegation.clone());
        env.storage().persistent().set(&DataKey::IncomingDelegations(delegatee.clone()), &incoming);
    }

    /// Remove a delegation from a delegatee's incoming list.
    fn _remove_incoming_delegation(env: &Env, delegatee: &Address, delegator: &Address) {
        let mut incoming: Vec<DelegationInfo> = env.storage().persistent()
            .get(&DataKey::IncomingDelegations(delegatee.clone()))
            .unwrap_or_else(|| Vec::new(env));

        let mut updated = Vec::new(env);
        for d in incoming.iter() {
            if d.delegator != *delegator {
                updated.push_back(d);
            }
        }
        env.storage().persistent().set(&DataKey::IncomingDelegations(delegatee.clone()), &updated);
    }

    /// Require the caller is the admin.
    fn _require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        admin.require_auth();
    }
}

mod test;
