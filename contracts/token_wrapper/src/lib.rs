#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, token,
    token::TokenInterface,
    Address, Env, MuxedAddress, String,
};
use soroban_token_sdk::{
    events,
    metadata::TokenMetadata,
    TokenUtils,
};

// ── TTL constants (matching the official token example) ──────────────────────
const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_BUMP: u32 = 7 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_IN_LEDGERS;
const BALANCE_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const BALANCE_THRESHOLD: u32 = BALANCE_BUMP - DAY_IN_LEDGERS;

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Address of the underlying SAC/SEP-41 token being wrapped.
    Underlying,
    /// Wrapped token balance per holder.
    Balance(Address),
    /// Allowance (temporary storage).
    Allowance(AllowanceKey),
}

// ── Custom events ─────────────────────────────────────────────────────────────

/// Emitted when underlying tokens are wrapped 1:1 into this contract.
#[contractevent]
pub struct Wrapped {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

/// Emitted when wrapped tokens are unwrapped back to the underlying asset.
#[contractevent]
pub struct Unwrapped {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

/// Emitted on every `approve` call (in addition to the standard SEP-41 event).
#[contractevent]
pub struct ApprovalRequested {
    #[topic]
    pub from: Address,
    #[topic]
    pub spender: Address,
    pub amount: i128,
    pub expiration_ledger: u32,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn check_nonneg(amount: i128) {
    if amount < 0 {
        panic!("negative amount");
    }
}

fn read_balance(e: &Env, addr: &Address) -> i128 {
    let key = DataKey::Balance(addr.clone());
    if let Some(bal) = e.storage().persistent().get::<_, i128>(&key) {
        e.storage().persistent().extend_ttl(&key, BALANCE_THRESHOLD, BALANCE_BUMP);
        bal
    } else {
        0
    }
}

fn write_balance(e: &Env, addr: &Address, amount: i128) {
    let key = DataKey::Balance(addr.clone());
    e.storage().persistent().set(&key, &amount);
    e.storage().persistent().extend_ttl(&key, BALANCE_THRESHOLD, BALANCE_BUMP);
}

fn receive_balance(e: &Env, addr: &Address, amount: i128) {
    write_balance(e, addr, read_balance(e, addr) + amount);
}

fn spend_balance(e: &Env, addr: &Address, amount: i128) {
    let bal = read_balance(e, addr);
    if bal < amount {
        panic!("insufficient balance");
    }
    write_balance(e, addr, bal - amount);
}

fn read_allowance(e: &Env, from: &Address, spender: &Address) -> AllowanceValue {
    let key = DataKey::Allowance(AllowanceKey { from: from.clone(), spender: spender.clone() });
    if let Some(v) = e.storage().temporary().get::<_, AllowanceValue>(&key) {
        if v.expiration_ledger < e.ledger().sequence() {
            AllowanceValue { amount: 0, expiration_ledger: v.expiration_ledger }
        } else {
            v
        }
    } else {
        AllowanceValue { amount: 0, expiration_ledger: 0 }
    }
}

fn write_allowance(e: &Env, from: &Address, spender: &Address, amount: i128, expiration_ledger: u32) {
    if amount > 0 && expiration_ledger < e.ledger().sequence() {
        panic!("expiration_ledger is less than ledger seq when amount > 0");
    }
    let key = DataKey::Allowance(AllowanceKey { from: from.clone(), spender: spender.clone() });
    e.storage().temporary().set(&key, &AllowanceValue { amount, expiration_ledger });
    if amount > 0 {
        let live_for = expiration_ledger.checked_sub(e.ledger().sequence()).unwrap();
        e.storage().temporary().extend_ttl(&key, live_for, live_for);
    }
}

fn spend_allowance(e: &Env, from: &Address, spender: &Address, amount: i128) {
    let v = read_allowance(e, from, spender);
    if v.amount < amount {
        panic!("insufficient allowance");
    }
    if amount > 0 {
        write_allowance(e, from, spender, v.amount - amount, v.expiration_ledger);
    }
}

fn bump_instance(e: &Env) {
    e.storage().instance().extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct TokenWrapper;

#[contractimpl]
impl TokenWrapper {
    /// Initialize the wrapper.
    ///
    /// Mirrors the underlying asset's metadata (decimal, name, symbol) with a
    /// "w" prefix on the name and symbol so wallets can distinguish the two.
    pub fn __constructor(e: Env, underlying_asset: Address) {
        if e.storage().instance().has(&DataKey::Underlying) {
            panic!("Already initialized");
        }
        e.storage().instance().set(&DataKey::Underlying, &underlying_asset);

        // Mirror metadata from the underlying token
        let underlying = token::Client::new(&e, &underlying_asset);
        let decimal = underlying.decimals();
        let name = {
            let mut prefixed = String::from_str(&e, "Wrapped ");
            prefixed.append(&underlying.name());
            prefixed
        };
        let symbol = {
            let mut prefixed = String::from_str(&e, "w");
            prefixed.append(&underlying.symbol());
            prefixed
        };

        TokenUtils::new(&e).metadata().set_metadata(&TokenMetadata { decimal, name, symbol });
    }

    // ── Wrap / Unwrap ─────────────────────────────────────────────────────────

    /// Pull `amount` of the underlying token from `from` and mint wrapped
    /// tokens 1:1.  Emits a `Wrapped` event.
    pub fn wrap(e: Env, from: Address, amount: i128) {
        from.require_auth();
        check_nonneg(amount);
        bump_instance(&e);

        let underlying: Address = e.storage().instance().get(&DataKey::Underlying).unwrap();
        token::Client::new(&e, &underlying)
            .transfer(&from, &e.current_contract_address(), &amount);

        receive_balance(&e, &from, amount);
        Wrapped { from, amount }.publish(&e);
    }

    /// Burn `amount` of wrapped tokens from `from` and return the underlying
    /// 1:1.  Emits an `Unwrapped` event.
    pub fn unwrap(e: Env, from: Address, amount: i128) {
        from.require_auth();
        check_nonneg(amount);
        bump_instance(&e);

        spend_balance(&e, &from, amount);

        let underlying: Address = e.storage().instance().get(&DataKey::Underlying).unwrap();
        token::Client::new(&e, &underlying)
            .transfer(&e.current_contract_address(), &from, &amount);

        Unwrapped { from, amount }.publish(&e);
    }

    /// Return the address of the underlying asset.
    pub fn underlying_asset(e: Env) -> Address {
        e.storage().instance().get(&DataKey::Underlying).unwrap()
    }
}

// ── SEP-41 TokenInterface ─────────────────────────────────────────────────────

#[contractimpl]
impl TokenInterface for TokenWrapper {
    fn allowance(e: Env, from: Address, spender: Address) -> i128 {
        bump_instance(&e);
        read_allowance(&e, &from, &spender).amount
    }

    fn approve(e: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        check_nonneg(amount);
        bump_instance(&e);

        write_allowance(&e, &from, &spender, amount, expiration_ledger);

        // Standard SEP-41 approve event
        events::Approve { from: from.clone(), spender: spender.clone(), amount, expiration_ledger }
            .publish(&e);

        // Additional ApprovalRequested event for EventHorizon workers
        ApprovalRequested { from, spender, amount, expiration_ledger }.publish(&e);
    }

    fn balance(e: Env, id: Address) -> i128 {
        bump_instance(&e);
        read_balance(&e, &id)
    }

    fn transfer(e: Env, from: Address, to_muxed: MuxedAddress, amount: i128) {
        from.require_auth();
        check_nonneg(amount);
        bump_instance(&e);

        let to = to_muxed.address();
        spend_balance(&e, &from, amount);
        receive_balance(&e, &to, amount);

        events::Transfer { from, to, to_muxed_id: to_muxed.id(), amount }.publish(&e);
    }

    fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        check_nonneg(amount);
        bump_instance(&e);

        spend_allowance(&e, &from, &spender, amount);
        spend_balance(&e, &from, amount);
        receive_balance(&e, &to, amount);

        events::Transfer { from, to, to_muxed_id: None, amount }.publish(&e);
    }

    fn burn(e: Env, from: Address, amount: i128) {
        from.require_auth();
        check_nonneg(amount);
        bump_instance(&e);

        spend_balance(&e, &from, amount);
        events::Burn { from, amount }.publish(&e);
    }

    fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        check_nonneg(amount);
        bump_instance(&e);

        spend_allowance(&e, &from, &spender, amount);
        spend_balance(&e, &from, amount);
        events::Burn { from, amount }.publish(&e);
    }

    fn decimals(e: Env) -> u32 {
        TokenUtils::new(&e).metadata().get_metadata().decimal
    }

    fn name(e: Env) -> String {
        TokenUtils::new(&e).metadata().get_metadata().name
    }

    fn symbol(e: Env) -> String {
        TokenUtils::new(&e).metadata().get_metadata().symbol
    }
}

mod test;
