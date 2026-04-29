# Automated Health Checks and Failure Notifications

EventHorizon includes a robust monitoring system designed to ensure high availability and proactive failure handling for all Soroban-to-Web2 triggers.

## Overview

The monitoring system consists of three main components:
1.  **Continuous Health Monitoring**: Tracks successes and failures of real event triggers.
2.  **Automated Health Checks (No-Op)**: Periodically tests trigger connectivity using lightweight "No-Op" actions.
3.  **Auto-Disable & Notifications**: Automatically disables unstable triggers and notifies owners.

## Health Monitoring

Every time a trigger is executed, its status is updated in the database:
-   **Successful Execution**: Resets the `consecutiveFailures` counter to 0 and updates `lastSuccessAt`.
-   **Failed Execution**: Increments the `consecutiveFailures` counter and updates `failedExecutions`.

## Automated Health Checks (No-Op)

The `HealthWorker` periodically selects triggers that are due for a health check based on their `healthCheckConfig.intervalMs` (default: 1 hour).

For each trigger, a "No-Op" action is performed:
-   **Webhooks**: Sends a POST request with `isHealthCheck: true` and an `X-EventHorizon-Health-Check: true` header.
-   **Messaging (Discord, Telegram, Slack)**: Sends a lightweight connectivity test message.
-   **Email**: Sends a simple connectivity verification email to the trigger owner.

## Auto-Disable Logic

To prevent resource waste and notify users of persistent issues, triggers are automatically disabled after **5 consecutive failures**.

When a trigger is auto-disabled:
1.  The `isActive` flag is set to `false`.
2.  The `healthStatus` virtual property transitions to `critical`.
3.  An automated notification is sent to the trigger owner via email, detailing the failure reason and the number of consecutive attempts.

## Configuration

Trigger health checks can be configured via the API:

```json
{
  "healthCheckConfig": {
    "enabled": true,
    "intervalMs": 3600000
  }
}
```

### Fields

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `enabled` | Boolean | `true` | Whether automated health checks are active for this trigger. |
| `intervalMs` | Number | `3600000` | Frequency of "No-Op" health checks in milliseconds. |

## Administrative Audit Logs

All auto-disable events are recorded in the system's audit logs for compliance and debugging purposes. These can be accessed via the `/api/admin/audit/logs` endpoint by authorized administrators.
