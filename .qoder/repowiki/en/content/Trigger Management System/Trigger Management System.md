# Trigger Management System

<cite>
**Referenced Files in This Document**
- [trigger.model.js](file://backend/src/models/trigger.model.js)
- [trigger.controller.js](file://backend/src/controllers/trigger.controller.js)
- [trigger.routes.js](file://backend/src/routes/trigger.routes.js)
- [validation.middleware.js](file://backend/src/middleware/validation.middleware.js)
- [error.middleware.js](file://backend/src/middleware/error.middleware.js)
- [poller.js](file://backend/src/worker/poller.js)
- [processor.js](file://backend/src/worker/processor.js)
- [queue.js](file://backend/src/worker/queue.js)
- [slack.service.js](file://backend/src/services/slack.service.js)
- [telegram.service.js](file://backend/src/services/telegram.service.js)
- [filterEvaluator.js](file://backend/src/utils/filterEvaluator.js)
- [jsonpathValidator.js](file://backend/src/utils/jsonpathValidator.js)
- [app.js](file://backend/src/app.js)
- [queue-usage.js](file://backend/examples/queue-usage.js)
- [trigger.controller.test.js](file://backend/__tests__/trigger.controller.test.js)
- [filterEvaluator.test.js](file://backend/__tests__/filterEvaluator.test.js)
- [jsonpathValidator.test.js](file://backend/__tests__/jsonpathValidator.test.js)
- [package.json](file://backend/package.json)
</cite>

## Update Summary
**Changes Made**
- Added comprehensive JSONPath filtering system documentation
- Updated trigger model schema to include filters field
- Added filter validation and security measures
- Integrated filter evaluation into poller workflow
- Added new filter operators and evaluation logic
- Enhanced validation middleware with filter schema support

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [JSONPath Filtering System](#jsonpath-filtering-system)
7. [Dependency Analysis](#dependency-analysis)
8. [Performance Considerations](#performance-considerations)
9. [Troubleshooting Guide](#troubleshooting-guide)
10. [Conclusion](#conclusion)
11. [Appendices](#appendices)

## Introduction
This document explains the Trigger Management System that monitors Soroban contract events and executes configured actions (webhook, Slack, Telegram, Discord, email). It covers the complete lifecycle from creation to deletion, activation/deactivation workflows, bulk operations, the trigger model schema with advanced JSONPath filtering capabilities, controller implementation, validation and error handling, practical configuration examples, optimization and monitoring, and the relationship with the queue system for asynchronous processing.

## Project Structure
The trigger system spans models, controllers, routes, middleware, workers, services, queue infrastructure, and new filtering utilities. The backend is an Express application that exposes REST endpoints for triggers and integrates with a polling worker, optional BullMQ queue, and advanced JSONPath filtering system.

```mermaid
graph TB
subgraph "API Layer"
Routes["Routes<br/>trigger.routes.js"]
Controller["Controller<br/>trigger.controller.js"]
Validation["Validation Middleware<br/>validation.middleware.js"]
ErrorMW["Error Middleware<br/>error.middleware.js"]
App["Express App<br/>app.js"]
end
subgraph "Domain Model"
TriggerModel["Trigger Model<br/>trigger.model.js"]
end
subgraph "Filtering System"
FilterEval["Filter Evaluator<br/>filterEvaluator.js"]
JSONPathValidator["JSONPath Validator<br/>jsonpathValidator.js"]
end
subgraph "Workers"
Poller["Poller<br/>poller.js"]
Processor["Processor<br/>processor.js"]
Queue["Queue<br/>queue.js"]
end
subgraph "Services"
Slack["Slack Service<br/>slack.service.js"]
Telegram["Telegram Service<br/>telegram.service.js"]
end
App --> Routes
Routes --> Validation
Routes --> Controller
Controller --> TriggerModel
TriggerModel --> FilterEval
FilterEval --> JSONPathValidator
Poller --> TriggerModel
Poller --> FilterEval
Poller --> Queue
Poller --> Slack
Poller --> Telegram
Processor --> Queue
Processor --> Slack
Processor --> Telegram
```

**Diagram sources**
- [app.js:1-55](file://backend/src/app.js#L1-L55)
- [trigger.routes.js:1-92](file://backend/src/routes/trigger.routes.js#L1-L92)
- [trigger.controller.js:1-72](file://backend/src/controllers/trigger.controller.js#L1-L72)
- [validation.middleware.js:1-49](file://backend/src/middleware/validation.middleware.js#L1-L49)
- [error.middleware.js:1-59](file://backend/src/middleware/error.middleware.js#L1-L59)
- [trigger.model.js:1-80](file://backend/src/models/trigger.model.js#L1-L80)
- [filterEvaluator.js:1-111](file://backend/src/utils/filterEvaluator.js#L1-L111)
- [jsonpathValidator.js:1-128](file://backend/src/utils/jsonpathValidator.js#L1-L128)
- [poller.js:1-335](file://backend/src/worker/poller.js#L1-L335)
- [processor.js:1-174](file://backend/src/worker/processor.js#L1-L174)
- [queue.js:1-164](file://backend/src/worker/queue.js#L1-L164)
- [slack.service.js:1-165](file://backend/src/services/slack.service.js#L1-L165)
- [telegram.service.js:1-74](file://backend/src/services/telegram.service.js#L1-L74)

**Section sources**
- [app.js:1-55](file://backend/src/app.js#L1-L55)
- [trigger.routes.js:1-92](file://backend/src/routes/trigger.routes.js#L1-L92)
- [trigger.controller.js:1-72](file://backend/src/controllers/trigger.controller.js#L1-L72)
- [trigger.model.js:1-80](file://backend/src/models/trigger.model.js#L1-L80)
- [filterEvaluator.js:1-111](file://backend/src/utils/filterEvaluator.js#L1-L111)
- [jsonpathValidator.js:1-128](file://backend/src/utils/jsonpathValidator.js#L1-L128)
- [poller.js:1-335](file://backend/src/worker/poller.js#L1-L335)
- [processor.js:1-174](file://backend/src/worker/processor.js#L1-L174)
- [queue.js:1-164](file://backend/src/worker/queue.js#L1-L164)
- [slack.service.js:1-165](file://backend/src/services/slack.service.js#L1-L165)
- [telegram.service.js:1-74](file://backend/src/services/telegram.service.js#L1-L74)

## Core Components
- Trigger Model: Defines schema, indexes, virtuals for health metrics, metadata, and filter configurations.
- Controller: Implements create, list, and delete operations with logging and error propagation.
- Routes: Exposes REST endpoints with OpenAPI comments and validation middleware including filter validation.
- Validation Middleware: Uses Joi to validate incoming payloads including filter schemas with security validation.
- Error Middleware: Normalizes errors and responds consistently.
- Filter Evaluator: Advanced JSONPath evaluation engine with operator support and security validation.
- JSONPath Validator: Comprehensive security validation against ReDoS attacks and malicious patterns.
- Poller: Scans Soroban events, matches triggers with filters, and dispatches actions with retries.
- Queue: Optional BullMQ queue for background processing with stats and cleanup.
- Processor: Worker that executes queued actions.
- Services: Integrations for Slack and Telegram notifications.

**Section sources**
- [trigger.model.js:1-80](file://backend/src/models/trigger.model.js#L1-L80)
- [trigger.controller.js:1-72](file://backend/src/controllers/trigger.controller.js#L1-L72)
- [trigger.routes.js:1-92](file://backend/src/routes/trigger.routes.js#L1-L92)
- [validation.middleware.js:1-49](file://backend/src/middleware/validation.middleware.js#L1-L49)
- [error.middleware.js:1-59](file://backend/src/middleware/error.middleware.js#L1-L59)
- [filterEvaluator.js:1-111](file://backend/src/utils/filterEvaluator.js#L1-L111)
- [jsonpathValidator.js:1-128](file://backend/src/utils/jsonpathValidator.js#L1-L128)
- [poller.js:1-335](file://backend/src/worker/poller.js#L1-L335)
- [queue.js:1-164](file://backend/src/worker/queue.js#L1-L164)
- [processor.js:1-174](file://backend/src/worker/processor.js#L1-L174)
- [slack.service.js:1-165](file://backend/src/services/slack.service.js#L1-L165)
- [telegram.service.js:1-74](file://backend/src/services/telegram.service.js#L1-L74)

## Architecture Overview
The system consists of:
- REST API for trigger CRUD with filter validation
- Advanced JSONPath filtering system for event filtering
- Poller that queries Soroban RPC for events and executes actions
- Optional queue for background processing
- Services for external integrations

```mermaid
sequenceDiagram
participant Client as "Client"
participant API as "Express App"
participant Routes as "Trigger Routes"
participant Ctrl as "Trigger Controller"
participant Model as "Trigger Model"
participant FilterEval as "Filter Evaluator"
participant Poller as "Poller"
participant Queue as "BullMQ Queue"
participant Proc as "Processor"
participant Slack as "Slack Service"
participant Tele as "Telegram Service"
Client->>API : "POST /api/triggers (with filters)"
API->>Routes : "Dispatch route"
Routes->>Ctrl : "createTrigger()"
Ctrl->>Model : "Save trigger with filters"
Model-->>Ctrl : "Persisted trigger"
Ctrl-->>Client : "201 Created"
Note over Poller : "Periodic polling"
Poller->>Model : "Find active triggers"
Poller->>Poller : "Fetch events from Soroban RPC"
Poller->>FilterEval : "passesFilters(event, trigger.filters)"
FilterEval-->>Poller : "Filter result (true/false)"
Poller->>Queue : "enqueueAction(trigger, payload) if true"
Queue-->>Proc : "Job delivered"
Proc->>Slack : "Send Slack alert"
Proc->>Tele : "Send Telegram message"
Proc-->>Queue : "Acknowledge completion"
Poller->>Model : "Update stats and lastPolledLedger"
```

**Diagram sources**
- [app.js:1-55](file://backend/src/app.js#L1-L55)
- [trigger.routes.js:1-92](file://backend/src/routes/trigger.routes.js#L1-L92)
- [trigger.controller.js:1-72](file://backend/src/controllers/trigger.controller.js#L1-L72)
- [trigger.model.js:1-80](file://backend/src/models/trigger.model.js#L1-L80)
- [filterEvaluator.js:96-104](file://backend/src/utils/filterEvaluator.js#L96-L104)
- [poller.js:1-335](file://backend/src/worker/poller.js#L1-L335)
- [queue.js:1-164](file://backend/src/worker/queue.js#L1-L164)
- [processor.js:1-174](file://backend/src/worker/processor.js#L1-L174)
- [slack.service.js:1-165](file://backend/src/services/slack.service.js#L1-L165)
- [telegram.service.js:1-74](file://backend/src/services/telegram.service.js#L1-L74)

## Detailed Component Analysis

### Trigger Model Schema and Health Metrics
The trigger model defines the structure and behavior of triggers, including:
- Identity: contractId, eventName
- Action: actionType (webhook, discord, email, telegram), actionUrl
- Control: isActive, lastPolledLedger
- Stats & Health: totalExecutions, failedExecutions, lastSuccessAt, healthScore virtual, healthStatus virtual
- Configuration: retryConfig (maxRetries, retryIntervalMs), metadata Map
- Filters: Array of filter objects with path, operator, and value
- Indexes: contractId, metadata Map

Health metrics:
- healthScore: computed percentage of successful executions
- healthStatus: healthy/degraded/critical derived from healthScore

```mermaid
erDiagram
TRIGGER {
string contractId
string eventName
enum actionType
string actionUrl
boolean isActive
number lastPolledLedger
number totalExecutions
number failedExecutions
date lastSuccessAt
number retryConfig_maxRetries
number retryConfig_retryIntervalMs
map metadata
array filters_path
array filters_operator
array filters_value
}
```

**Diagram sources**
- [trigger.model.js:3-79](file://backend/src/models/trigger.model.js#L3-L79)

**Section sources**
- [trigger.model.js:1-80](file://backend/src/models/trigger.model.js#L1-L80)

### Controller Implementation: CRUD Operations
- createTrigger: Logs creation, persists trigger with filters, returns 201 with data
- getTriggers: Lists all triggers, logs count
- deleteTrigger: Removes by ID; throws 404 AppError if missing
- updateTrigger: Updates trigger including filter configurations

Logging and error propagation:
- Uses asyncHandler to forward exceptions to error middleware
- Logs IP, user agent, and trigger identifiers for auditability

**Section sources**
- [trigger.controller.js:1-72](file://backend/src/controllers/trigger.controller.js#L1-L72)
- [error.middleware.js:1-59](file://backend/src/middleware/error.middleware.js#L1-L59)

### Routes and Validation
- POST /api/triggers: Validates payload using Joi schema including filter validation, then invokes controller
- GET /api/triggers: Returns all triggers
- DELETE /api/triggers/:id: Deletes trigger by ID
- Validation schema enforces:
  - contractId, eventName required
  - actionType limited to supported values
  - actionUrl required and must be a URI
  - isActive defaults to true
  - lastPolledLedger defaults to 0
  - filters array with security validation

**Section sources**
- [trigger.routes.js:1-92](file://backend/src/routes/trigger.routes.js#L1-L92)
- [validation.middleware.js:1-49](file://backend/src/middleware/validation.middleware.js#L1-L49)

### Poller and Action Execution
Key responsibilities:
- Find active triggers
- Query Soroban RPC for events within a sliding ledger window per trigger
- Paginate and filter by contractId and event topic
- Apply JSONPath filters using passesFilters() before dispatching actions
- Dispatch actions via queue when enabled, or execute directly with retries
- Update lastPolledLedger and stats on success/failure

Filter evaluation:
- Uses passesFilters() to evaluate all filters for each event
- Supports AND semantics where all filters must pass
- Applies security validation before evaluation

Retry strategy:
- Per-action retry with exponential backoff based on trigger.retryConfig
- Per-RPC request retry with exponential backoff for network and server errors

```mermaid
flowchart TD
Start(["Poll Cycle"]) --> FindActive["Find active triggers"]
FindActive --> ForEachTrigger{"For each trigger"}
ForEachTrigger --> GetTip["Get latest ledger"]
GetTip --> Bounds["Compute start/end ledger window"]
Bounds --> Fetch["Fetch events (paginate)"]
Fetch --> Found{"Events found?"}
Found --> |Yes| FilterCheck["Apply JSONPath filters"]
FilterCheck --> FilterResult{"passesFilters() == true?"}
FilterResult --> |Yes| Exec["Execute action with retry"]
FilterResult --> |No| NextEvent["Next event"]
Exec --> UpdateStats["Update stats and lastPolledLedger"]
UpdateStats --> NextEvent
NextEvent --> Found
Found --> |No| NextTrigger["Next trigger"]
NextTrigger --> ForEachTrigger
ForEachTrigger --> End(["Cycle Complete"])
```

**Diagram sources**
- [poller.js:177-310](file://backend/src/worker/poller.js#L177-L310)
- [filterEvaluator.js:96-104](file://backend/src/utils/filterEvaluator.js#L96-L104)

**Section sources**
- [poller.js:1-335](file://backend/src/worker/poller.js#L1-L335)

### Queue System and Background Processing
- Queue module wraps BullMQ Queue with default job options:
  - Attempts with exponential backoff
  - Cleanup policies for completed/failed jobs
- enqueueAction adds jobs with priority and unique job IDs
- getQueueStats reports waiting, active, completed, failed, delayed counts
- Processor consumes jobs concurrently with rate limiting and logs outcomes

```mermaid
sequenceDiagram
participant Poller as "Poller"
participant Queue as "BullMQ Queue"
participant Worker as "Processor"
participant Slack as "Slack Service"
participant Tele as "Telegram Service"
Poller->>Queue : "enqueueAction(trigger, payload)"
Queue-->>Worker : "Deliver job"
Worker->>Slack : "Send Slack alert"
Worker->>Tele : "Send Telegram message"
Worker-->>Queue : "Mark completed"
```

**Diagram sources**
- [queue.js:1-164](file://backend/src/worker/queue.js#L1-L164)
- [processor.js:1-174](file://backend/src/worker/processor.js#L1-L174)
- [poller.js:55-147](file://backend/src/worker/poller.js#L55-L147)

**Section sources**
- [queue.js:1-164](file://backend/src/worker/queue.js#L1-L164)
- [processor.js:1-174](file://backend/src/worker/processor.js#L1-L174)
- [poller.js:55-147](file://backend/src/worker/poller.js#L55-L147)

### Services: Slack and Telegram
- SlackService builds rich Block Kit payloads and sends via webhook, handling rate limits and common errors.
- TelegramService sends MarkdownV2 messages and escapes special characters.

**Section sources**
- [slack.service.js:1-165](file://backend/src/services/slack.service.js#L1-L165)
- [telegram.service.js:1-74](file://backend/src/services/telegram.service.js#L1-L74)

### Practical Trigger Configuration Examples
Below are example configurations for different notification channels. Use these as templates when creating triggers via the API.

- Webhook
  - actionType: "webhook"
  - actionUrl: "https://your-service.com/webhooks/soroban"
  - contractId: "your-contract-id"
  - eventName: "SwapExecuted"

- Slack
  - actionType: "slack"
  - actionUrl: "https://hooks.slack.com/workflows/YOUR-WEBHOOK-ID"
  - contractId: "your-contract-id"
  - eventName: "TokensVested"

- Telegram
  - actionType: "telegram"
  - actionUrl: "YOUR_CHAT_ID" (chat ID stored in actionUrl)
  - contractId: "your-contract-id"
  - eventName: "StakeCreated"

- Advanced Filtered Triggers
  - Webhook with JSONPath filters
  - Filters array with multiple conditions
  - Complex nested path expressions

Notes:
- For Slack, ensure the webhook URL is configured and the service can render rich blocks.
- For Telegram, ensure TELEGRAM_BOT_TOKEN is set and the chat ID is valid.
- Filters support advanced JSONPath expressions for complex event filtering.

**Section sources**
- [queue-usage.js:9-85](file://backend/examples/queue-usage.js#L9-L85)
- [poller.js:114-131](file://backend/src/worker/poller.js#L114-L131)

### Activation/Deactivation and Bulk Operations
- Activation/Deactivation: Toggle isActive in the trigger record; only active triggers are polled.
- Bulk Operations:
  - List all triggers via GET /api/triggers
  - Delete individual triggers via DELETE /api/triggers/:id
  - For bulk updates, update records in bulk using the model and re-save; the poller reads isActive on each cycle.

**Section sources**
- [trigger.controller.js:30-71](file://backend/src/controllers/trigger.controller.js#L30-L71)
- [trigger.routes.js:57-89](file://backend/src/routes/trigger.routes.js#L57-L89)
- [trigger.model.js:22-25](file://backend/src/models/trigger.model.js#L22-L25)

### Error Handling Strategies
- Validation failures: Joi validation returns 400 with details including filter validation errors
- Cast/unique/DB errors: Normalized via error middleware to consistent shape
- Route not found: 404 handled centrally
- Operational vs non-operational errors: Logged with stack traces in development

**Section sources**
- [validation.middleware.js:18-41](file://backend/src/middleware/validation.middleware.js#L18-L41)
- [error.middleware.js:5-30](file://backend/src/middleware/error.middleware.js#L5-L30)
- [error.middleware.js:32-53](file://backend/src/middleware/error.middleware.js#L32-L53)

## JSONPath Filtering System

### Overview
The JSONPath filtering system enables sophisticated event filtering using JSONPath expressions with comprehensive security validation. This system allows triggers to filter events based on complex criteria extracted from event payloads.

### Filter Operators
The system supports the following operators:

- **eq**: Equality comparison (supports string coercion)
- **neq**: Not equal comparison (supports string coercion)
- **gt**: Greater than (numeric comparison)
- **gte**: Greater than or equal (numeric comparison)
- **lt**: Less than (numeric comparison)
- **lte**: Less than or equal (numeric comparison)
- **contains**: Contains operator (works with arrays, strings, objects)
- **in**: Membership test (requires array value)
- **exists**: Presence test (detects field existence)

### Security Features
The filtering system includes comprehensive security measures to prevent ReDoS attacks and malicious patterns:

- **Timeout Protection**: 50ms evaluation budget per filter
- **Path Length Limits**: Maximum 200 characters per path
- **Recursive Pattern Blocking**: Prevents $..* wildcards
- **Regex Pattern Blocking**: Blocks regex expressions in paths
- **Eval Function Blocking**: Prevents eval(), Function(), require() calls
- **Process Access Blocking**: Blocks access to process environment
- **Bracket Balance Validation**: Ensures balanced brackets and parentheses
- **Character Whitelist**: Allows only safe characters in paths

### Filter Schema
Each filter object consists of:
- **path**: JSONPath expression (string, required)
- **operator**: Comparison operator (string, required)
- **value**: Comparison value (mixed, optional for exists/in operators)

### Integration Points
- **Trigger Model**: Filters array field with validation
- **Validation Middleware**: Joi schema with custom security validation
- **Poller**: Uses passesFilters() to evaluate filters during event processing
- **Filter Evaluator**: Core evaluation engine with operator logic
- **JSONPath Validator**: Security validation and sanitization

### Usage Examples
Basic filters:
- `{ path: '$.value.amount', operator: 'gt', value: 1000 }`
- `{ path: '$.value.currency', operator: 'eq', value: 'USDC' }`
- `{ path: '$.topics[0]', operator: 'exists' }`

Complex filters:
- `{ path: '$.items[*].price', operator: 'gt', value: 50 }`
- `{ path: '$.nested.level1.level2.target', operator: 'eq', value: 'deep-value' }`
- `{ path: '$.value.tags', operator: 'contains', value: 'transfer' }`

**Section sources**
- [filterEvaluator.js:1-111](file://backend/src/utils/filterEvaluator.js#L1-L111)
- [jsonpathValidator.js:1-128](file://backend/src/utils/jsonpathValidator.js#L1-L128)
- [trigger.model.js:15-29](file://backend/src/models/trigger.model.js#L15-L29)
- [validation.middleware.js:7-27](file://backend/src/middleware/validation.middleware.js#L7-L27)
- [poller.js:250](file://backend/src/worker/poller.js#L250)

## Dependency Analysis
External dependencies relevant to triggers:
- @stellar/stellar-sdk: Interacts with Soroban RPC
- bullmq/ioredis: Background queue and Redis connectivity
- axios: HTTP calls for webhooks and Telegram
- joi: Request validation
- mongoose: Trigger persistence
- jsonpath-plus: JSONPath evaluation engine

```mermaid
graph LR
TriggerModel["@stellar/stellar-sdk"] --> Poller["poller.js"]
BullMQ["bullmq"] --> Queue["queue.js"]
Redis["ioredis"] --> Queue
Axios["axios"] --> Poller
Axios --> Processor["processor.js"]
Joi["joi"] --> Validation["validation.middleware.js"]
Mongoose["mongoose"] --> TriggerModel
JSONPathPlus["jsonpath-plus"] --> FilterEval["filterEvaluator.js"]
FilterEval --> JSONPathValidator["jsonpathValidator.js"]
```

**Diagram sources**
- [package.json:10-22](file://backend/package.json#L10-L22)
- [poller.js:1-335](file://backend/src/worker/poller.js#L1-L335)
- [queue.js:1-164](file://backend/src/worker/queue.js#L1-L164)
- [processor.js:1-174](file://backend/src/worker/processor.js#L1-L174)
- [validation.middleware.js:1-49](file://backend/src/middleware/validation.middleware.js#L1-L49)
- [trigger.model.js:1-80](file://backend/src/models/trigger.model.js#L1-L80)
- [filterEvaluator.js:1](file://backend/src/utils/filterEvaluator.js#L1)
- [jsonpathValidator.js:1](file://backend/src/utils/jsonpathValidator.js#L1)

**Section sources**
- [package.json:10-22](file://backend/package.json#L10-L22)

## Performance Considerations
- Polling Window: Limits per-trigger scan to reduce RPC load and memory usage.
- Pagination: Fetches events in pages to avoid oversized responses.
- Delays: Inter-page and inter-trigger delays to respect rate limits.
- Filter Evaluation Budget: 50ms timeout prevents expensive evaluations.
- Queue Mode: Prefer queue mode for high-volume workloads; configure concurrency and backoff appropriately.
- Stats Tracking: Use healthScore and healthStatus to monitor reliability.
- Cleanup: Periodically clean completed/failed jobs to control queue size.
- Filter Optimization: Use simple paths and minimal filter count for best performance.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Validation errors on create: Ensure contractId, eventName, actionType, and actionUrl conform to schema.
- Filter validation errors: Check JSONPath syntax and operator compatibility.
- Missing credentials for integrations:
  - Slack: Verify webhook URL is present.
  - Telegram: Ensure TELEGRAM_BOT_TOKEN and a valid chat ID are configured.
- Poller failures:
  - RPC connectivity or timeouts: Check SOROBAN_RPC_URL and network conditions.
  - Excessive rate limits: Reduce POLL_INTERVAL_MS or enable queue mode.
  - Filter evaluation timeouts: Simplify JSONPath expressions or reduce filter complexity.
- Queue issues:
  - Redis connectivity: Verify REDIS_HOST/PORT/PASSWORD.
  - Backlog growth: Increase WORKER_CONCURRENCY or adjust job backoff.
- Security validation failures:
  - Complex JSONPath expressions blocked: Simplify paths or remove unsupported patterns.
  - Recursive wildcards rejected: Use explicit path expressions instead of $..*.
- Monitoring:
  - Use queue stats to observe waiting/active/completed/failed counts.
  - Inspect job details and retry failed jobs via queue helpers.
  - Monitor filter evaluation performance and adjust complexity.

**Section sources**
- [error.middleware.js:5-30](file://backend/src/middleware/error.middleware.js#L5-L30)
- [poller.js:27-51](file://backend/src/worker/poller.js#L27-L51)
- [queue.js:126-156](file://backend/src/worker/queue.js#L126-L156)
- [queue-usage.js:87-180](file://backend/examples/queue-usage.js#L87-L180)

## Conclusion
The Trigger Management System provides a robust pipeline to monitor Soroban events and deliver notifications through multiple channels. Its design emphasizes reliability with retries, observability via health metrics and queue stats, scalability via background processing, and security through comprehensive JSONPath filtering with ReDoS protection. The advanced filtering system enables precise event targeting while maintaining performance and security standards. Proper configuration of credentials, queue infrastructure, polling parameters, and filter complexity ensures efficient operation under varying loads.

[No sources needed since this section summarizes without analyzing specific files]

## Appendices

### API Endpoints Summary
- POST /api/triggers: Create a trigger with validation including filter validation
- GET /api/triggers: List all triggers
- DELETE /api/triggers/:id: Delete a trigger by ID

**Section sources**
- [trigger.routes.js:57-89](file://backend/src/routes/trigger.routes.js#L57-L89)

### Filter Operators Reference
- **eq**: Equality comparison (string coercion supported)
- **neq**: Not equal comparison (string coercion supported)
- **gt**: Greater than (numeric comparison)
- **gte**: Greater than or equal (numeric comparison)
- **lt**: Less than (numeric comparison)
- **lte**: Less than or equal (numeric comparison)
- **contains**: Contains operator (arrays, strings, objects)
- **in**: Membership test (requires array value)
- **exists**: Presence test (field detection)

**Section sources**
- [filterEvaluator.js:28-69](file://backend/src/utils/filterEvaluator.js#L28-L69)
- [jsonpathValidator.js:4-14](file://backend/src/utils/jsonpathValidator.js#L4-L14)

### Testing Notes
- Controller tests validate success payload wrapping and error forwarding for missing resources.
- Filter evaluator tests cover all operators and edge cases.
- JSONPath validator tests verify security measures and validation logic.

**Section sources**
- [trigger.controller.test.js:16-59](file://backend/__tests__/trigger.controller.test.js#L16-L59)
- [filterEvaluator.test.js:1-255](file://backend/__tests__/filterEvaluator.test.js#L1-L255)
- [jsonpathValidator.test.js:1-130](file://backend/__tests__/jsonpathValidator.test.js#L1-L130)