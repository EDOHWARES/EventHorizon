#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, vec, Address, Env, Error, IntoVal, InvokeError, Symbol, Val, Vec,
};

/// Result of a single simulation call.
#[soroban_sdk::contracttype]
pub struct SimResult {
    /// Caller-supplied identifier, echoed back.
    pub call_id: u32,
    /// Whether the inner call succeeded.
    pub success: bool,
}

/// Event emitted after every simulated call.
#[contractevent]
pub struct SimResultEvent {
    /// Matches the `call_id` supplied to `simulate`.
    pub call_id: u32,
    /// The target contract that was called.
    pub target: Address,
    /// `true` if the inner call succeeded, `false` if it panicked/errored.
    pub success: bool,
    /// Placeholder for resource usage (CPU/Memory).
    /// In Soroban, this is populated by off-chain simulation tools.
    pub resource_usage: u64,
}

#[contract]
pub struct GasEstimator;

#[contractimpl]
impl GasEstimator {
    /// Simulate a single cross-contract call.
    ///
    /// Uses `try_invoke_contract` so this function **never reverts** regardless
    /// of what the target does. A `SimResultEvent` is always emitted so that
    /// EventHorizon (and Soroban RPC `simulateTransaction`) can capture it.
    pub fn simulate(
        env: Env,
        call_id: u32,
        contract: Address,
        func: Symbol,
        args: Vec<Val>,
    ) -> SimResult {
        let outcome: Result<Result<Val, _>, Result<Error, InvokeError>> =
            env.try_invoke_contract::<Val, Error>(&contract, &func, args);

        let (success, _result) = match outcome {
            Ok(Ok(val)) => (true, val),
            Ok(Err(_)) => (
                false,
                Error::from_type_and_code(
                    soroban_sdk::xdr::ScErrorType::WasmVm,
                    soroban_sdk::xdr::ScErrorCode::InvalidAction,
                )
                .into_val(&env),
            ),
            Err(_) => (
                false,
                Error::from_type_and_code(
                    soroban_sdk::xdr::ScErrorType::Context,
                    soroban_sdk::xdr::ScErrorCode::InternalError,
                )
                .into_val(&env),
            ),
        };

        SimResultEvent {
            call_id,
            target: contract.clone(),
            success,
            resource_usage: 0,
        }
        .publish(&env);

        SimResult {
            call_id,
            success,
        }
    }

    /// Batch-simulate multiple calls.
    ///
    /// Each entry: `(call_id, contract_address, func_name, args)`.
    /// Individual failures do **not** abort the batch.
    pub fn simulate_batch(
        env: Env,
        calls: Vec<(u32, Address, Symbol, Vec<Val>)>,
    ) -> Vec<SimResult> {
        let mut results: Vec<SimResult> = vec![&env];
        for call in calls.iter() {
            let (call_id, contract, func, args) = call;
            results.push_back(Self::simulate(env.clone(), call_id, contract, func, args));
        }
        results
    }

    /// Returns the contract version.
    pub fn version(_env: Env) -> u32 {
        100 // v1.0.0
    }
}

mod test;
