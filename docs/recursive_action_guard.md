# Recursive Action Guard

The `RecursiveActionGuard` contract is a security component for the EventHorizon platform. It tracks call depth per `(caller, action)` pair on-chain and blocks any trigger execution that would exceed the configured maximum depth, preventing infinite trigger loops.

## Features

- **Per-pair depth tracking**: Each `(caller, action)` combination has its own independent counter, so one trigger's recursion does not affect others.
- **Configurable max depth**: Admin can update the limit at any time without redeployment.
- **Security warning events**: Emits a `LoopDetected` event before panicking, giving EventHorizon's off-chain worker a structured signal to act on.
- **Temporary storage**: Depth counters use Soroban temporary storage, so they are automatically cleaned up after their TTL — no manual housekeeping needed.

## Contract Interface

### `initialize(admin, max_depth)`
One-time setup. Panics if called again.
- `max_depth`: Maximum allowed call depth before a trigger is blocked (must be > 0).

### `enter(caller, action) -> u32`
Called before executing a trigger action. Increments the depth counter for `(caller, action)` and returns the new depth. **Panics with `"Recursive loop detected"`** if the current depth is already at `max_depth`, emitting a `LoopDetected` event first.

### `exit(caller, action) -> u32`
Called after a trigger action completes (whether it succeeded or failed). Decrements the depth counter and returns the remaining depth. Panics if there is no active entry to exit.

### `get_depth(caller, action) -> u32`
Returns the current call depth for a `(caller, action)` pair. Returns `0` if no entry exists.

### `get_max_depth() -> u32`
Returns the currently configured maximum depth.

### `set_max_depth(max_depth)`
Admin-only. Updates the maximum allowed depth.

## Events

| Event | Fields | Emitted when |
|---|---|---|
| `ActionEntered` | `caller, action, depth` | A trigger successfully enters (depth incremented) |
| `ActionExited` | `caller, action, depth` | A trigger exits (depth decremented) |
| `LoopDetected` | `caller, action, depth, max_depth` | A recursive loop is detected and blocked |

The `LoopDetected` event is the primary hook for EventHorizon triggers. Configure an alert trigger on this event to receive real-time security notifications.

## Usage Pattern

The guard is designed to wrap every trigger execution in the EventHorizon worker:

```
1. Call enter(caller, action)   → proceeds if depth < max_depth, panics otherwise
2. Execute the trigger action
3. Call exit(caller, action)    → always call this, even on failure
```

Because `enter` panics on loop detection, the worker's transaction is rolled back and the action is never executed.

## EventHorizon Integration

Configure a trigger with:
- **Contract ID**: deployed `RecursiveActionGuard` address
- **Event name**: `LoopDetected`
- **Action**: webhook or Discord alert

This surfaces recursive loop attempts to operators in real time.

## Security Notes

- Depth counters are scoped to `(caller, action)` — different callers or different action names are fully independent.
- Temporary storage TTL means counters will expire if `exit` is never called (e.g., due to a crash), preventing permanent lockout.
- `set_max_depth` requires admin auth; the default `MAX_DEPTH` constant is `5`.
