# Auth0 Enterprise SSO and SAML Integration

This document describes how to configure and use Auth0 for Enterprise SSO and SAML 2.0 in the EventHorizon platform.

## Configuration

Add the following environment variables to your `.env` file:

```env
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret
```

## SSO Flow

EventHorizon uses an OIDC flow with Auth0. To authenticate via SSO:

1.  **Authorization**: The frontend redirects the user to Auth0.
2.  **Callback**: After successful authentication, Auth0 redirects back with an `id_token`.
3.  **Token Exchange**: The frontend sends the `id_token` to `/api/auth/sso/callback`.
4.  **User Provisioning**: EventHorizon verifies the token and creates a user profile if it doesn't exist (Just-In-Time provisioning).
5.  **Session**: EventHorizon returns its own JWTs for subsequent requests.

## RBAC Mapping

Roles are mapped from Auth0 custom claims. Ensure your Auth0 "Action" or "Rule" adds the roles to the `id_token`:

**Auth0 Claim Name**: `https://eventhorizon.app/roles`

| Auth0 Role | EventHorizon Role |
| :--- | :--- |
| `eh_admin` | `Owner` |
| `eh_editor` | `Member` |
| (others) | `Member` (default) |

## SAML 2.0 Support

SAML 2.0 is supported via Auth0 Enterprise Connections. Once configured in the Auth0 dashboard, it works seamlessly through the same OIDC flow. No additional backend changes are required for new SAML providers.
