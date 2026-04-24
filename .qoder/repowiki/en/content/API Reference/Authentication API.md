# Authentication API

<cite>
**Referenced Files in This Document**
- [auth.controller.js](file://backend/src/controllers/auth.controller.js)
- [auth.routes.js](file://backend/src/routes/auth.routes.js)
- [auth.middleware.js](file://backend/src/middleware/auth.middleware.js)
- [rateLimit.middleware.js](file://backend/src/middleware/rateLimit.middleware.js)
- [validation.middleware.js](file://backend/src/middleware/validation.middleware.js)
- [user.model.js](file://backend/src/models/user.model.js)
- [app.js](file://backend/src/app.js)
- [server.js](file://backend/src/server.js)
- [error.middleware.js](file://backend/src/middleware/error.middleware.js)
- [appError.js](file://backend/src/utils/appError.js)
- [asyncHandler.js](file://backend/src/utils/asyncHandler.js)
- [package.json](file://backend/package.json)
- [docker-compose.yml](file://docker-compose.yml)
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
This document provides comprehensive API documentation for the authentication system. It covers login and token refresh endpoints, JWT token handling, sessionless authentication flow, middleware integration, rate limiting for authentication endpoints, and error handling patterns. It also explains how to properly set authentication headers and outlines security considerations.

## Project Structure
The authentication subsystem is implemented under the backend service and consists of:
- Routes that define the authentication endpoints (/api/auth/login, /api/auth/refresh)
- Controller logic that handles user credentials, password verification, and token issuance
- Middleware for JWT-based authentication and rate limiting
- Validation middleware for request body schemas
- Model representing the user entity
- Application bootstrap wiring rate limiters and routes

```mermaid
graph TB
subgraph "Backend"
R["Routes<br/>auth.routes.js"]
C["Controller<br/>auth.controller.js"]
MW_AUTH["Middleware<br/>auth.middleware.js"]
MW_RATE["Middleware<br/>rateLimit.middleware.js"]
MW_VALID["Middleware<br/>validation.middleware.js"]
M_USER["Model<br/>user.model.js"]
APP["App Bootstrap<br/>app.js"]
SRV["Server<br/>server.js"]
end
SRV --> APP
APP --> R
R --> C
R --> MW_VALID
APP --> MW_RATE
APP --> MW_AUTH
C --> M_USER
```

**Diagram sources**
- [auth.routes.js:1-38](file://backend/src/routes/auth.routes.js#L1-L38)
- [auth.controller.js:1-82](file://backend/src/controllers/auth.controller.js#L1-L82)
- [auth.middleware.js:1-22](file://backend/src/middleware/auth.middleware.js#L1-L22)
- [rateLimit.middleware.js:1-51](file://backend/src/middleware/rateLimit.middleware.js#L1-L51)
- [validation.middleware.js:1-49](file://backend/src/middleware/validation.middleware.js#L1-L49)
- [user.model.js:1-20](file://backend/src/models/user.model.js#L1-L20)
- [app.js:1-55](file://backend/src/app.js#L1-L55)
- [server.js:1-88](file://backend/src/server.js#L1-L88)

**Section sources**
- [auth.routes.js:1-38](file://backend/src/routes/auth.routes.js#L1-L38)
- [auth.controller.js:1-82](file://backend/src/controllers/auth.controller.js#L1-L82)
- [auth.middleware.js:1-22](file://backend/src/middleware/auth.middleware.js#L1-L22)
- [rateLimit.middleware.js:1-51](file://backend/src/middleware/rateLimit.middleware.js#L1-L51)
- [validation.middleware.js:1-49](file://backend/src/middleware/validation.middleware.js#L1-L49)
- [user.model.js:1-20](file://backend/src/models/user.model.js#L1-L20)
- [app.js:1-55](file://backend/src/app.js#L1-L55)
- [server.js:1-88](file://backend/src/server.js#L1-L88)

## Core Components
- Authentication controller: Implements login and refresh token endpoints, JWT signing, and password comparison.
- Authentication route definitions: Exposes POST /api/auth/login and POST /api/auth/refresh.
- JWT authentication middleware: Validates Authorization header and verifies access tokens.
- Rate limiting middleware: Provides global and authentication-specific rate limits.
- Validation middleware: Defines and enforces request schemas for authentication credentials.
- User model: Defines the user entity with email and password fields.
- Application bootstrap: Wires rate limiters and routes into the Express app.

Key implementation references:
- Login endpoint and token issuance: [auth.controller.js:15-52](file://backend/src/controllers/auth.controller.js#L15-L52)
- Token refresh endpoint: [auth.controller.js:57-82](file://backend/src/controllers/auth.controller.js#L57-L82)
- JWT verification middleware: [auth.middleware.js:5-22](file://backend/src/middleware/auth.middleware.js#L5-L22)
- Auth rate limiter configuration: [rateLimit.middleware.js:39-45](file://backend/src/middleware/rateLimit.middleware.js#L39-L45)
- Request validation schema for credentials: [validation.middleware.js:12-16](file://backend/src/middleware/validation.middleware.js#L12-L16)
- User model definition: [user.model.js:3-20](file://backend/src/models/user.model.js#L3-L20)
- Route registration and middleware wiring: [auth.routes.js:26-36](file://backend/src/routes/auth.routes.js#L26-L36), [app.js:21-22](file://backend/src/app.js#L21-L22)

**Section sources**
- [auth.controller.js:15-82](file://backend/src/controllers/auth.controller.js#L15-L82)
- [auth.routes.js:26-36](file://backend/src/routes/auth.routes.js#L26-L36)
- [auth.middleware.js:5-22](file://backend/src/middleware/auth.middleware.js#L5-L22)
- [rateLimit.middleware.js:39-45](file://backend/src/middleware/rateLimit.middleware.js#L39-L45)
- [validation.middleware.js:12-16](file://backend/src/middleware/validation.middleware.js#L12-L16)
- [user.model.js:3-20](file://backend/src/models/user.model.js#L3-L20)
- [app.js:21-22](file://backend/src/app.js#L21-L22)

## Architecture Overview
The authentication flow integrates route handlers, validation, controller logic, and middleware. Requests to authentication endpoints are rate-limited, validated, and processed by the controller, which interacts with the user model and issues JWT tokens. Subsequent protected requests rely on the JWT middleware to validate tokens.

```mermaid
sequenceDiagram
participant Client as "Client"
participant Router as "Express Router<br/>auth.routes.js"
participant Validator as "Validation Middleware<br/>validation.middleware.js"
participant Controller as "Auth Controller<br/>auth.controller.js"
participant UserModel as "User Model<br/>user.model.js"
participant JWT as "JWT Library"
Client->>Router : "POST /api/auth/login"
Router->>Validator : "Validate request body"
Validator-->>Router : "Validation result"
Router->>Controller : "Invoke login()"
Controller->>UserModel : "Find user by email"
UserModel-->>Controller : "User record"
Controller->>Controller : "Compare passwords"
Controller->>JWT : "Sign access token"
Controller->>JWT : "Sign refresh token"
Controller-->>Router : "JSON response {token, refreshToken, expiresIn}"
Router-->>Client : "200 OK"
```

**Diagram sources**
- [auth.routes.js:26](file://backend/src/routes/auth.routes.js#L26)
- [validation.middleware.js:24-41](file://backend/src/middleware/validation.middleware.js#L24-L41)
- [auth.controller.js:15-52](file://backend/src/controllers/auth.controller.js#L15-L52)
- [user.model.js:3-20](file://backend/src/models/user.model.js#L3-L20)

## Detailed Component Analysis

### Authentication Endpoints
- Endpoint: POST /api/auth/login
  - Purpose: Authenticate admin user and issue access and refresh tokens.
  - Request body schema: [validation.middleware.js:12-16](file://backend/src/middleware/validation.middleware.js#L12-L16)
  - Response: Access token, refresh token, and expiration in seconds.
  - Security: Requires Authorization header for subsequent protected requests after login.
  - Implementation: [auth.controller.js:15-52](file://backend/src/controllers/auth.controller.js#L15-L52)
  - Route binding: [auth.routes.js:26](file://backend/src/routes/auth.routes.js#L26)

- Endpoint: POST /api/auth/refresh
  - Purpose: Issue a new access token using a valid refresh token.
  - Request body: { refreshToken: string }
  - Response: New access token and expiration.
  - Implementation: [auth.controller.js:57-82](file://backend/src/controllers/auth.controller.js#L57-L82)
  - Route binding: [auth.routes.js:36](file://backend/src/routes/auth.routes.js#L36)

```mermaid
sequenceDiagram
participant Client as "Client"
participant Router as "Express Router<br/>auth.routes.js"
participant Controller as "Auth Controller<br/>auth.controller.js"
participant JWT as "JWT Library"
Client->>Router : "POST /api/auth/refresh"
Router->>Controller : "Invoke refreshToken()"
Controller->>JWT : "Verify refresh token"
JWT-->>Controller : "Decoded payload"
Controller->>JWT : "Sign new access token"
Controller-->>Router : "JSON response {token, expiresIn}"
Router-->>Client : "200 OK"
```

**Diagram sources**
- [auth.routes.js:36](file://backend/src/routes/auth.routes.js#L36)
- [auth.controller.js:57-82](file://backend/src/controllers/auth.controller.js#L57-L82)

**Section sources**
- [auth.routes.js:26-36](file://backend/src/routes/auth.routes.js#L26-L36)
- [auth.controller.js:15-82](file://backend/src/controllers/auth.controller.js#L15-L82)
- [validation.middleware.js:12-16](file://backend/src/middleware/validation.middleware.js#L12-L16)

### Token Management
- Access token:
  - Issued on successful login.
  - Expires in 1 hour.
  - Verified by the JWT middleware for protected routes.
  - Reference: [auth.controller.js:32-36](file://backend/src/controllers/auth.controller.js#L32-L36), [auth.middleware.js:14](file://backend/src/middleware/auth.middleware.js#L14)

- Refresh token:
  - Issued alongside access token on login.
  - Expires in 7 days.
  - Used to obtain a new access token via /api/auth/refresh.
  - Reference: [auth.controller.js:38-42](file://backend/src/controllers/auth.controller.js#L38-L42), [auth.controller.js:64-67](file://backend/src/controllers/auth.controller.js#L64-L67)

- Logout:
  - No dedicated logout endpoint exists.
  - Access tokens can be discarded client-side; refresh tokens are long-lived.
  - Consider implementing token blacklisting or short-lived sessions for stricter logout semantics.

**Section sources**
- [auth.controller.js:32-42](file://backend/src/controllers/auth.controller.js#L32-L42)
- [auth.controller.js:64-73](file://backend/src/controllers/auth.controller.js#L64-L73)
- [auth.middleware.js:14](file://backend/src/middleware/auth.middleware.js#L14)

### Security Middleware Integration
- JWT authentication middleware:
  - Extracts Authorization header, expects "Bearer <token>".
  - Verifies token signature and decodes payload.
  - Attaches user info to request for downstream handlers.
  - Reference: [auth.middleware.js:5-22](file://backend/src/middleware/auth.middleware.js#L5-L22)

- Protected routes:
  - Apply the JWT middleware to endpoints requiring authentication.
  - Reference: [auth.middleware.js:5](file://backend/src/middleware/auth.middleware.js#L5)

- Error handling for invalid/expired tokens:
  - Returns 401 with a descriptive message.
  - Reference: [auth.middleware.js:20](file://backend/src/middleware/auth.middleware.js#L20)

**Section sources**
- [auth.middleware.js:5-22](file://backend/src/middleware/auth.middleware.js#L5-L22)

### Rate Limiting for Authentication Endpoints
- Global rate limiter:
  - Applied to all routes to prevent abuse.
  - Configurable via environment variables.
  - Reference: [app.js:21](file://backend/src/app.js#L21), [rateLimit.middleware.js:31-37](file://backend/src/middleware/rateLimit.middleware.js#L31-L37)

- Authentication-specific rate limiter:
  - Stricter limits for /api/auth routes.
  - Configurable via AUTH_RATE_LIMIT_* environment variables.
  - Reference: [app.js:22](file://backend/src/app.js#L22), [rateLimit.middleware.js:39-45](file://backend/src/middleware/rateLimit.middleware.js#L39-L45)

- Response on rate limit hit:
  - JSON payload with success flag, message, and retryAfterSeconds.
  - Reference: [rateLimit.middleware.js:18-28](file://backend/src/middleware/rateLimit.middleware.js#L18-L28)

**Section sources**
- [app.js:21-22](file://backend/src/app.js#L21-L22)
- [rateLimit.middleware.js:31-45](file://backend/src/middleware/rateLimit.middleware.js#L31-L45)

### Request/Response Schemas
- Login request body:
  - email: string, required, valid email format
  - password: string, required, minimum length 8
  - Reference: [validation.middleware.js:12-16](file://backend/src/middleware/validation.middleware.js#L12-L16)

- Login response:
  - token: string (access token)
  - refreshToken: string (refresh token)
  - expiresIn: number (seconds until access token expiry)
  - Reference: [auth.controller.js:44-48](file://backend/src/controllers/auth.controller.js#L44-L48)

- Refresh request body:
  - refreshToken: string (required)
  - Reference: [auth.controller.js:59](file://backend/src/controllers/auth.controller.js#L59)

- Refresh response:
  - token: string (new access token)
  - expiresIn: number (seconds until access token expiry)
  - Reference: [auth.controller.js:75-78](file://backend/src/controllers/auth.controller.js#L75-L78)

- Validation error response:
  - Fields: success=false, error="Validation failed", details=[{field, message}]
  - Reference: [validation.middleware.js:31-37](file://backend/src/middleware/validation.middleware.js#L31-L37)

- Generic error response:
  - Fields: success=false, status, message, optional details and stack in development
  - Reference: [error.middleware.js:36-53](file://backend/src/middleware/error.middleware.js#L36-L53)

**Section sources**
- [validation.middleware.js:12-16](file://backend/src/middleware/validation.middleware.js#L12-L16)
- [auth.controller.js:44-48](file://backend/src/controllers/auth.controller.js#L44-L48)
- [auth.controller.js:59](file://backend/src/controllers/auth.controller.js#L59)
- [auth.controller.js:75-78](file://backend/src/controllers/auth.controller.js#L75-L78)
- [validation.middleware.js:31-37](file://backend/src/middleware/validation.middleware.js#L31-L37)
- [error.middleware.js:36-53](file://backend/src/middleware/error.middleware.js#L36-L53)

### Authentication Header Usage
- Protected requests must include:
  - Authorization: Bearer <access_token>
- Example:
  - Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.x.y
- Reference: [auth.middleware.js:9-12](file://backend/src/middleware/auth.middleware.js#L9-L12)

**Section sources**
- [auth.middleware.js:9-12](file://backend/src/middleware/auth.middleware.js#L9-L12)

### Error Handling Patterns
- Validation failures:
  - 400 Bad Request with details array containing field and message.
  - Reference: [validation.middleware.js:31-37](file://backend/src/middleware/validation.middleware.js#L31-L37)

- Authentication errors:
  - 401 Unauthorized for missing/invalid Authorization header.
  - 401 Invalid or expired token for JWT verification failure.
  - Reference: [auth.middleware.js:10](file://backend/src/middleware/auth.middleware.js#L10), [auth.middleware.js:20](file://backend/src/middleware/auth.middleware.js#L20)

- General error normalization:
  - Converts various errors into a consistent response shape.
  - Includes stack trace in development mode.
  - Reference: [error.middleware.js:36-53](file://backend/src/middleware/error.middleware.js#L36-L53)

**Section sources**
- [validation.middleware.js:31-37](file://backend/src/middleware/validation.middleware.js#L31-L37)
- [auth.middleware.js:10](file://backend/src/middleware/auth.middleware.js#L10)
- [auth.middleware.js:20](file://backend/src/middleware/auth.middleware.js#L20)
- [error.middleware.js:36-53](file://backend/src/middleware/error.middleware.js#L36-L53)

## Dependency Analysis
- Route-to-controller mapping:
  - /api/auth/login -> authController.login
  - /api/auth/refresh -> authController.refreshToken
  - Reference: [auth.routes.js:26](file://backend/src/routes/auth.routes.js#L26), [auth.routes.js:36](file://backend/src/routes/auth.routes.js#L36)

- Controller dependencies:
  - bcrypt for password comparison
  - jsonwebtoken for token signing/verification
  - user.model for user lookup
  - Reference: [auth.controller.js:1-3](file://backend/src/controllers/auth.controller.js#L1-L3)

- Middleware dependencies:
  - express-rate-limit for rate limiting
  - joi for request validation
  - jsonwebtoken for JWT operations
  - Reference: [rateLimit.middleware.js:1](file://backend/src/middleware/rateLimit.middleware.js#L1), [validation.middleware.js:1](file://backend/src/middleware/validation.middleware.js#L1), [auth.middleware.js:1](file://backend/src/middleware/auth.middleware.js#L1)

```mermaid
graph LR
R["auth.routes.js"] --> C["auth.controller.js"]
C --> U["user.model.js"]
C --> B["bcrypt"]
C --> J["jsonwebtoken"]
APP["app.js"] --> RL["rateLimit.middleware.js"]
APP --> AMW["auth.middleware.js"]
APP --> VMW["validation.middleware.js"]
```

**Diagram sources**
- [auth.routes.js:26](file://backend/src/routes/auth.routes.js#L26)
- [auth.routes.js:36](file://backend/src/routes/auth.routes.js#L36)
- [auth.controller.js:1-3](file://backend/src/controllers/auth.controller.js#L1-L3)
- [user.model.js:3-20](file://backend/src/models/user.model.js#L3-L20)
- [rateLimit.middleware.js:1](file://backend/src/middleware/rateLimit.middleware.js#L1)
- [auth.middleware.js:1](file://backend/src/middleware/auth.middleware.js#L1)
- [validation.middleware.js:1](file://backend/src/middleware/validation.middleware.js#L1)
- [app.js:21-22](file://backend/src/app.js#L21-L22)

**Section sources**
- [auth.routes.js:26](file://backend/src/routes/auth.routes.js#L26)
- [auth.routes.js:36](file://backend/src/routes/auth.routes.js#L36)
- [auth.controller.js:1-3](file://backend/src/controllers/auth.controller.js#L1-L3)
- [user.model.js:3-20](file://backend/src/models/user.model.js#L3-L20)
- [rateLimit.middleware.js:1](file://backend/src/middleware/rateLimit.middleware.js#L1)
- [auth.middleware.js:1](file://backend/src/middleware/auth.middleware.js#L1)
- [validation.middleware.js:1](file://backend/src/middleware/validation.middleware.js#L1)
- [app.js:21-22](file://backend/src/app.js#L21-L22)

## Performance Considerations
- Token lifetimes:
  - Access tokens expire in 1 hour; refresh tokens expire in 7 days.
  - Reference: [auth.controller.js:9-10](file://backend/src/controllers/auth.controller.js#L9-L10)

- Rate limiting:
  - Authentication endpoints are rate-limited more strictly than global limits.
  - Tune AUTH_RATE_LIMIT_MAX and AUTH_RATE_LIMIT_WINDOW_MS to balance usability and protection.
  - Reference: [rateLimit.middleware.js:39-45](file://backend/src/middleware/rateLimit.middleware.js#L39-L45)

- Validation overhead:
  - Joi validation adds minimal CPU cost but improves error clarity.
  - Reference: [validation.middleware.js:24-41](file://backend/src/middleware/validation.middleware.js#L24-L41)

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
- 400 Validation Error on login:
  - Ensure email is valid and password is at least 8 characters.
  - Reference: [validation.middleware.js:12-16](file://backend/src/middleware/validation.middleware.js#L12-L16)

- 401 Unauthorized on protected routes:
  - Verify Authorization header is present and formatted as "Bearer <token>".
  - Reference: [auth.middleware.js:9-12](file://backend/src/middleware/auth.middleware.js#L9-L12)

- 401 Invalid or expired token:
  - Obtain a new access token using the refresh endpoint or re-authenticate.
  - Reference: [auth.middleware.js:20](file://backend/src/middleware/auth.middleware.js#L20)

- Too many requests:
  - Respect retryAfterSeconds and reduce request frequency.
  - Reference: [rateLimit.middleware.js:18-28](file://backend/src/middleware/rateLimit.middleware.js#L18-L28)

- Environment variables:
  - Ensure JWT secrets and database URIs are configured.
  - Reference: [auth.controller.js:5-7](file://backend/src/controllers/auth.controller.js#L5-L7), [server.js:35-36](file://backend/src/server.js#L35-L36)

**Section sources**
- [validation.middleware.js:12-16](file://backend/src/middleware/validation.middleware.js#L12-L16)
- [auth.middleware.js:9-12](file://backend/src/middleware/auth.middleware.js#L9-L12)
- [auth.middleware.js:20](file://backend/src/middleware/auth.middleware.js#L20)
- [rateLimit.middleware.js:18-28](file://backend/src/middleware/rateLimit.middleware.js#L18-L28)
- [auth.controller.js:5-7](file://backend/src/controllers/auth.controller.js#L5-L7)
- [server.js:35-36](file://backend/src/server.js#L35-L36)

## Conclusion
The authentication API provides secure, sessionless access using JWT. Login issues access and refresh tokens, while refresh obtains new access tokens. Strict rate limiting protects auth endpoints, and middleware ensures consistent error handling. Clients should use the Authorization header for protected routes and handle token lifecycle appropriately.

[No sources needed since this section summarizes without analyzing specific files]

## Appendices

### Environment Variables
- JWT_SECRET: Secret for signing access tokens
- JWT_REFRESH_SECRET: Secret for signing refresh tokens
- MONGO_URI: MongoDB connection string
- AUTH_RATE_LIMIT_MAX: Max auth requests per window
- AUTH_RATE_LIMIT_WINDOW_MS: Window size for auth rate limiting
- RATE_LIMIT_MAX: Global max requests per window
- RATE_LIMIT_WINDOW_MS: Global window size for rate limiting

References:
- [auth.controller.js:5-7](file://backend/src/controllers/auth.controller.js#L5-L7)
- [server.js:35-36](file://backend/src/server.js#L35-L36)
- [rateLimit.middleware.js:31-45](file://backend/src/middleware/rateLimit.middleware.js#L31-L45)
- [package.json:10-26](file://backend/package.json#L10-L26)
- [docker-compose.yml:32-36](file://docker-compose.yml#L32-L36)

**Section sources**
- [auth.controller.js:5-7](file://backend/src/controllers/auth.controller.js#L5-L7)
- [server.js:35-36](file://backend/src/server.js#L35-L36)
- [rateLimit.middleware.js:31-45](file://backend/src/middleware/rateLimit.middleware.js#L31-L45)
- [package.json:10-26](file://backend/package.json#L10-L26)
- [docker-compose.yml:32-36](file://docker-compose.yml#L32-L36)