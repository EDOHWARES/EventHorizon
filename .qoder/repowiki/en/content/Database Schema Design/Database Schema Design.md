# Database Schema Design

<cite>
**Referenced Files in This Document**
- [trigger.model.js](file://backend/src/models/trigger.model.js)
- [user.model.js](file://backend/src/models/user.model.js)
- [validation.middleware.js](file://backend/src/middleware/validation.middleware.js)
- [trigger.controller.js](file://backend/src/controllers/trigger.controller.js)
- [auth.controller.js](file://backend/src/controllers/auth.controller.js)
- [auth.middleware.js](file://backend/src/middleware/auth.middleware.js)
- [trigger.routes.js](file://backend/src/routes/trigger.routes.js)
- [auth.routes.js](file://backend/src/routes/auth.routes.js)
- [server.js](file://backend/src/server.js)
- [app.js](file://backend/src/app.js)
- [MIGRATION_GUIDE.md](file://backend/MIGRATION_GUIDE.md)
- [QUEUE_SETUP.md](file://backend/QUEUE_SETUP.md)
- [package.json](file://backend/package.json)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document describes the MongoDB schema design for the EventHorizon project, focusing on the trigger model and user model. It explains field definitions, data types, validation rules, business constraints, entity relationships, indexing strategies, and performance considerations. It also covers data access patterns, caching strategies, aggregation pipelines, data lifecycle management, retention policies, backup procedures, migration strategies, schema evolution, version management, and data security measures.

## Project Structure
The database-related components are primarily located under backend/src/models and backend/src/controllers, with validation and routing supporting the schemas. Authentication and authorization are handled via JWT tokens stored in the User collection. Background job processing for trigger actions is implemented separately with BullMQ and Redis.

```mermaid
graph TB
subgraph "Models"
TM["Trigger Model<br/>trigger.model.js"]
UM["User Model<br/>user.model.js"]
end
subgraph "Controllers"
TC["Trigger Controller<br/>trigger.controller.js"]
AC["Auth Controller<br/>auth.controller.js"]
end
subgraph "Middleware"
VM["Validation Middleware<br/>validation.middleware.js"]
AMW["Auth Middleware<br/>auth.middleware.js"]
end
subgraph "Routes"
TR["Trigger Routes<br/>trigger.routes.js"]
AR["Auth Routes<br/>auth.routes.js"]
end
subgraph "App & Server"
APP["Express App<br/>app.js"]
SRV["Server Boot<br/>server.js"]
end
subgraph "Queue System"
MG["Migration Guide<br/>MIGRATION_GUIDE.md"]
QS["Queue Setup<br/>QUEUE_SETUP.md"]
end
TR --> TC
AR --> AC
TC --> TM
AC --> UM
VM --> TR
AMW --> APP
APP --> SRV
MG --> SRV
QS --> SRV
```

**Diagram sources**
- [trigger.model.js:1-80](file://backend/src/models/trigger.model.js#L1-L80)
- [user.model.js:1-20](file://backend/src/models/user.model.js#L1-L20)
- [validation.middleware.js:1-49](file://backend/src/middleware/validation.middleware.js#L1-L49)
- [trigger.controller.js:1-72](file://backend/src/controllers/trigger.controller.js#L1-L72)
- [auth.controller.js:1-82](file://backend/src/controllers/auth.controller.js#L1-L82)
- [auth.middleware.js:1-22](file://backend/src/middleware/auth.middleware.js#L1-L22)
- [trigger.routes.js:1-92](file://backend/src/routes/trigger.routes.js#L1-L92)
- [auth.routes.js:1-38](file://backend/src/routes/auth.routes.js#L1-L38)
- [app.js:1-55](file://backend/src/app.js#L1-L55)
- [server.js:1-88](file://backend/src/server.js#L1-L88)
- [MIGRATION_GUIDE.md:1-263](file://backend/MIGRATION_GUIDE.md#L1-L263)
- [QUEUE_SETUP.md:1-250](file://backend/QUEUE_SETUP.md#L1-L250)

**Section sources**
- [trigger.model.js:1-80](file://backend/src/models/trigger.model.js#L1-L80)
- [user.model.js:1-20](file://backend/src/models/user.model.js#L1-L20)
- [validation.middleware.js:1-49](file://backend/src/middleware/validation.middleware.js#L1-L49)
- [trigger.controller.js:1-72](file://backend/src/controllers/trigger.controller.js#L1-L72)
- [auth.controller.js:1-82](file://backend/src/controllers/auth.controller.js#L1-L82)
- [auth.middleware.js:1-22](file://backend/src/middleware/auth.middleware.js#L1-L22)
- [trigger.routes.js:1-92](file://backend/src/routes/trigger.routes.js#L1-L92)
- [auth.routes.js:1-38](file://backend/src/routes/auth.routes.js#L1-L38)
- [app.js:1-55](file://backend/src/app.js#L1-L55)
- [server.js:1-88](file://backend/src/server.js#L1-L88)
- [MIGRATION_GUIDE.md:1-263](file://backend/MIGRATION_GUIDE.md#L1-L263)
- [QUEUE_SETUP.md:1-250](file://backend/QUEUE_SETUP.md#L1-L250)

## Core Components
- Trigger Model: Stores event-trigger configurations and execution statistics.
- User Model: Stores admin credentials for authentication and authorization.
- Validation Middleware: Enforces strict input validation for triggers and auth credentials.
- Controllers: Implement CRUD operations for triggers and authentication flows.
- Middleware: Provides JWT-based authentication and request validation.
- Routes: Define API endpoints for triggers and authentication.
- Server/App: Initialize MongoDB connection and expose APIs.

**Section sources**
- [trigger.model.js:1-80](file://backend/src/models/trigger.model.js#L1-L80)
- [user.model.js:1-20](file://backend/src/models/user.model.js#L1-L20)
- [validation.middleware.js:1-49](file://backend/src/middleware/validation.middleware.js#L1-L49)
- [trigger.controller.js:1-72](file://backend/src/controllers/trigger.controller.js#L1-L72)
- [auth.controller.js:1-82](file://backend/src/controllers/auth.controller.js#L1-L82)
- [auth.middleware.js:1-22](file://backend/src/middleware/auth.middleware.js#L1-L22)
- [trigger.routes.js:1-92](file://backend/src/routes/trigger.routes.js#L1-L92)
- [auth.routes.js:1-38](file://backend/src/routes/auth.routes.js#L1-L38)
- [server.js:34-88](file://backend/src/server.js#L34-L88)
- [app.js:16-55](file://backend/src/app.js#L16-L55)

## Architecture Overview
The system uses MongoDB for persistent data and Mongoose ODM for schema modeling. Authentication relies on JWT tokens issued by the Auth controller and validated by the Auth middleware. Trigger actions are executed asynchronously via BullMQ and Redis, separate from the MongoDB schema.

```mermaid
graph TB
Client["Client"]
AuthRoute["Auth Routes<br/>auth.routes.js"]
AuthCtrl["Auth Controller<br/>auth.controller.js"]
JWT["JWT Tokens"]
UserCol["MongoDB Collection: User<br/>user.model.js"]
TriggerRoute["Trigger Routes<br/>trigger.routes.js"]
TriggerCtrl["Trigger Controller<br/>trigger.controller.js"]
TriggerCol["MongoDB Collection: Trigger<br/>trigger.model.js"]
Validator["Validation Middleware<br/>validation.middleware.js"]
QueueSys["BullMQ Queue System<br/>QUEUE_SETUP.md"]
Redis["Redis"]
Client --> AuthRoute --> AuthCtrl
AuthCtrl --> JWT
JWT --> AuthRoute
AuthRoute --> UserCol
Client --> TriggerRoute --> Validator --> TriggerCtrl --> TriggerCol
TriggerCtrl --> QueueSys --> Redis
```

**Diagram sources**
- [auth.routes.js:1-38](file://backend/src/routes/auth.routes.js#L1-L38)
- [auth.controller.js:1-82](file://backend/src/controllers/auth.controller.js#L1-L82)
- [user.model.js:1-20](file://backend/src/models/user.model.js#L1-L20)
- [trigger.routes.js:1-92](file://backend/src/routes/trigger.routes.js#L1-L92)
- [validation.middleware.js:1-49](file://backend/src/middleware/validation.middleware.js#L1-L49)
- [trigger.controller.js:1-72](file://backend/src/controllers/trigger.controller.js#L1-L72)
- [trigger.model.js:1-80](file://backend/src/models/trigger.model.js#L1-L80)
- [QUEUE_SETUP.md:1-250](file://backend/QUEUE_SETUP.md#L1-L250)

## Detailed Component Analysis

### Trigger Model Schema
The Trigger model defines event-driven actions and operational metrics. It includes:
- contractId: String, required, indexed for fast lookup by contract.
- eventName: String, required.
- actionType: Enum of ['webhook', 'discord', 'email', 'telegram'], default 'webhook'.
- actionUrl: String, required, URI validated.
- isActive: Boolean, default true.
- lastPolledLedger: Number, default 0.
- retryConfig: Nested object with maxRetries and retryIntervalMs.
- metadata: Map<String, String>, indexed for tag-like queries.
- Timestamps: createdAt and updatedAt managed automatically.
- Virtuals: healthScore and healthStatus computed from execution counters.

```mermaid
erDiagram
TRIGGER {
string contractId
string eventName
enum actionType
string actionUrl
boolean isActive
number lastPolledLedger
number retryConfig.maxRetries
number retryConfig.retryIntervalMs
map metadata
date createdAt
date updatedAt
}
```

**Diagram sources**
- [trigger.model.js:3-62](file://backend/src/models/trigger.model.js#L3-L62)

**Section sources**
- [trigger.model.js:1-80](file://backend/src/models/trigger.model.js#L1-L80)
- [validation.middleware.js:4-11](file://backend/src/middleware/validation.middleware.js#L4-L11)
- [trigger.controller.js:6-28](file://backend/src/controllers/trigger.controller.js#L6-L28)

### User Model Schema
The User model stores admin credentials:
- email: String, required, unique, lowercased, trimmed.
- password: String, required.
- Timestamps: createdAt and updatedAt managed automatically.

```mermaid
erDiagram
USER {
string email
string password
date createdAt
date updatedAt
}
```

**Diagram sources**
- [user.model.js:3-18](file://backend/src/models/user.model.js#L3-L18)

**Section sources**
- [user.model.js:1-20](file://backend/src/models/user.model.js#L1-L20)
- [validation.middleware.js:12-16](file://backend/src/middleware/validation.middleware.js#L12-L16)
- [auth.controller.js:15-52](file://backend/src/controllers/auth.controller.js#L15-L52)
- [auth.middleware.js:1-22](file://backend/src/middleware/auth.middleware.js#L1-L22)

### Validation Rules and Business Constraints
- Trigger creation requires contractId, eventName, actionUrl, and defaults isActive to true; lastPolledLedger defaults to 0.
- actionType is constrained to predefined values with a default.
- Auth credentials require a valid email and minimum password length.
- Validation middleware returns structured error details for invalid requests.

**Section sources**
- [validation.middleware.js:4-16](file://backend/src/middleware/validation.middleware.js#L4-L16)
- [trigger.controller.js:6-28](file://backend/src/controllers/trigger.controller.js#L6-L28)
- [auth.controller.js:15-52](file://backend/src/controllers/auth.controller.js#L15-L52)

### Entity Relationships
- One-to-many relationship between contractId and triggers: multiple triggers can target the same contract.
- No explicit foreign keys in MongoDB; relationships are implicit via contractId.
- User does not directly reference triggers; authentication controls access to trigger endpoints.

**Section sources**
- [trigger.model.js:4-8](file://backend/src/models/trigger.model.js#L4-L8)
- [trigger.controller.js:6-28](file://backend/src/controllers/trigger.controller.js#L6-L28)
- [auth.controller.js:15-52](file://backend/src/controllers/auth.controller.js#L15-L52)

### Indexing Strategies
- contractId: Single-field index to accelerate filtering by contract.
- metadata: Map field indexed to support tag-based queries.
- Unique constraint on email in User collection ensures one account per email.

**Section sources**
- [trigger.model.js:7-8](file://backend/src/models/trigger.model.js#L7-L8)
- [trigger.model.js:56-57](file://backend/src/models/trigger.model.js#L56-L57)
- [user.model.js](file://backend/src/models/user.model.js#L8)

### Performance Considerations
- Query patterns:
  - Find triggers by contractId: efficient due to single-field index.
  - Filter by isActive: boolean index recommended for frequent toggling.
  - Tag queries via metadata: leverage Map index for tag-based filtering.
- Aggregation pipelines:
  - Compute healthScore and healthStatus using virtuals; consider precomputing for heavy dashboards.
  - Group by actionType or contractId for reporting.
- Caching:
  - Cache frequently accessed trigger configurations keyed by contractId and eventName.
  - Cache JWT public keys or token introspection results if needed.
- Background processing:
  - Use BullMQ queue for trigger actions to avoid blocking the poller and improve resilience.

**Section sources**
- [trigger.model.js:65-77](file://backend/src/models/trigger.model.js#L65-L77)
- [QUEUE_SETUP.md:20-27](file://backend/QUEUE_SETUP.md#L20-L27)

### Data Access Patterns
- Create trigger: POST /api/triggers with validated payload.
- List triggers: GET /api/triggers returning all documents.
- Delete trigger: DELETE /api/triggers/:id with 404 handling.
- Authenticate admin: POST /api/auth/login returning access and refresh tokens.
- Refresh token: POST /api/auth/refresh using refresh token.

**Section sources**
- [trigger.routes.js:57-89](file://backend/src/routes/trigger.routes.js#L57-L89)
- [auth.routes.js:26-36](file://backend/src/routes/auth.routes.js#L26-L36)
- [trigger.controller.js:6-71](file://backend/src/controllers/trigger.controller.js#L6-L71)
- [auth.controller.js:15-82](file://backend/src/controllers/auth.controller.js#L15-L82)

### Caching Strategies
- Application-level caches:
  - Store trigger configurations keyed by contractId+eventName to reduce DB reads.
  - Invalidate cache on trigger updates/deletes.
- Token caching:
  - Cache JWT public keys or token revocation lists if integrating with external systems.
- CDN/static assets:
  - Not applicable for schema data but relevant for static UI resources.

[No sources needed since this section provides general guidance]

### Aggregation Pipelines
- Compute health metrics:
  - Use aggregation to group by contractId and compute success/failure ratios.
- Tag analytics:
  - Unwind metadata tags and compute counts per tag for observability.
- Time-series stats:
  - Bucket executions by time windows for trend analysis.

[No sources needed since this section provides general guidance]

### Data Lifecycle Management, Retention, and Backup
- Trigger data retention:
  - Retain trigger configurations indefinitely; purge only upon explicit deletion.
- Execution logs and metrics:
  - Offload detailed execution logs to external systems (e.g., logs DB or object storage).
- Queue job retention:
  - BullMQ jobs retained for 24h (completed) and 7 days (failed); clean periodically.
- Backups:
  - Schedule MongoDB backups (logical or physical) and test restore procedures.
  - For Redis, enable persistence (AOF/RDB) and snapshot backups.

**Section sources**
- [QUEUE_SETUP.md:95-96](file://backend/QUEUE_SETUP.md#L95-L96)
- [MIGRATION_GUIDE.md:235-246](file://backend/MIGRATION_GUIDE.md#L235-L246)

### Migration Strategies, Schema Evolution, and Version Management
- Current state:
  - Trigger schema includes nested retryConfig and Map metadata.
- Evolution approach:
  - Add new fields with defaults; keep backward compatibility.
  - Use optional fields and schema versioning if evolving frequently.
- Migration steps:
  - Introduce BullMQ queue system: install Redis, configure environment, initialize worker on startup.
  - Update poller to enqueue actions instead of executing synchronously.
  - Keep API endpoints unchanged for developer and user continuity.

**Section sources**
- [MIGRATION_GUIDE.md:25-88](file://backend/MIGRATION_GUIDE.md#L25-L88)
- [server.js:46-58](file://backend/src/server.js#L46-L58)
- [QUEUE_SETUP.md:79-88](file://backend/QUEUE_SETUP.md#L79-L88)

### Data Security Measures and Access Control
- Authentication:
  - Admin login issues access and refresh tokens; verify tokens in middleware.
- Authorization:
  - Protect sensitive endpoints with auth middleware; enforce role-based access if extended.
- Secrets:
  - Store JWT secrets and Redis credentials in environment variables.
- Transport:
  - Use HTTPS/TLS for API exposure; secure Redis network access.
- Privacy:
  - Avoid storing sensitive data in triggers; keep actionUrl and metadata minimal.

**Section sources**
- [auth.controller.js:5-10](file://backend/src/controllers/auth.controller.js#L5-L10)
- [auth.middleware.js:3-4](file://backend/src/middleware/auth.middleware.js#L3-L4)
- [auth.routes.js:26-36](file://backend/src/routes/auth.routes.js#L26-L36)
- [server.js:35-42](file://backend/src/server.js#L35-L42)

## Dependency Analysis
- Models depend on Mongoose for schema definition and virtuals.
- Controllers depend on models and middleware for validation and auth.
- Routes depend on controllers and validation middleware.
- Server initializes Mongoose connection and loads worker/queue system.
- Package dependencies include mongoose, bullmq, ioredis, joi, dotenv.

```mermaid
graph LR
Mongoose["mongoose"]
BullMQ["bullmq"]
Redis["ioredis"]
Joi["joi"]
Dotenv["dotenv"]
TM["trigger.model.js"] --> Mongoose
UM["user.model.js"] --> Mongoose
AC["auth.controller.js"] --> Mongoose
TC["trigger.controller.js"] --> TM
TR["trigger.routes.js"] --> TC
AR["auth.routes.js"] --> AC
AMW["auth.middleware.js"] --> AC
VM["validation.middleware.js"] --> Joi
SRV["server.js"] --> Mongoose
SRV --> BullMQ
SRV --> Redis
APP["app.js"] --> VM
APP --> AMW
PKG["package.json"] --> Mongoose
PKG --> BullMQ
PKG --> Redis
PKG --> Joi
PKG --> Dotenv
```

**Diagram sources**
- [trigger.model.js](file://backend/src/models/trigger.model.js#L1)
- [user.model.js](file://backend/src/models/user.model.js#L1)
- [auth.controller.js:1-2](file://backend/src/controllers/auth.controller.js#L1-L2)
- [trigger.controller.js](file://backend/src/controllers/trigger.controller.js#L1)
- [trigger.routes.js:1-2](file://backend/src/routes/trigger.routes.js#L1-L2)
- [auth.routes.js:1-2](file://backend/src/routes/auth.routes.js#L1-L2)
- [auth.middleware.js](file://backend/src/middleware/auth.middleware.js#L1)
- [validation.middleware.js](file://backend/src/middleware/validation.middleware.js#L1)
- [server.js:1-2](file://backend/src/server.js#L1-L2)
- [app.js:1-2](file://backend/src/app.js#L1-L2)
- [package.json:10-26](file://backend/package.json#L10-L26)

**Section sources**
- [package.json:10-26](file://backend/package.json#L10-L26)
- [server.js:1-88](file://backend/src/server.js#L1-L88)
- [app.js:1-55](file://backend/src/app.js#L1-L55)

## Performance Considerations
- Database:
  - Ensure indexes exist for contractId and metadata.Map keys.
  - Use capped collections or TTL for ephemeral logs if needed.
- Application:
  - Batch reads/writes for bulk operations.
  - Use lean queries for read-heavy endpoints.
- Queue:
  - Tune worker concurrency and backoff policies.
  - Monitor queue stats and failed job rates.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
- MongoDB connection failures:
  - Verify MONGO_URI and network connectivity.
- Authentication errors:
  - Confirm JWT secrets and token validity.
- Queue system issues:
  - Check Redis connectivity and worker logs; restart worker if stuck.

**Section sources**
- [server.js:80-87](file://backend/src/server.js#L80-L87)
- [auth.middleware.js:19-21](file://backend/src/middleware/auth.middleware.js#L19-L21)
- [QUEUE_SETUP.md:204-220](file://backend/QUEUE_SETUP.md#L204-L220)

## Conclusion
The EventHorizon schema centers on two primary collections: Trigger and User. The Trigger model supports contract-based event detection, flexible action delivery, and operational health tracking. The User model secures administrative access via JWT. Validation and middleware ensure robust input handling, while the BullMQ queue system offloads asynchronous actions for improved reliability. Proper indexing, caching, and lifecycle management are essential for performance and maintainability.

## Appendices

### Sample Data Structures
- Trigger document
  - Fields: contractId, eventName, actionType, actionUrl, isActive, lastPolledLedger, retryConfig, metadata, timestamps.
  - Example composition: see [trigger.model.js:3-62](file://backend/src/models/trigger.model.js#L3-L62).
- User document
  - Fields: email, password, timestamps.
  - Example composition: see [user.model.js:3-18](file://backend/src/models/user.model.js#L3-L18).

**Section sources**
- [trigger.model.js:3-62](file://backend/src/models/trigger.model.js#L3-L62)
- [user.model.js:3-18](file://backend/src/models/user.model.js#L3-L18)

### API Endpoints Related to Schema
- Triggers
  - POST /api/triggers (validated)
  - GET /api/triggers
  - DELETE /api/triggers/:id
- Auth
  - POST /api/auth/login
  - POST /api/auth/refresh

**Section sources**
- [trigger.routes.js:57-89](file://backend/src/routes/trigger.routes.js#L57-L89)
- [auth.routes.js:26-36](file://backend/src/routes/auth.routes.js#L26-L36)