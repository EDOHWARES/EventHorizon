# Webhook Destination IP Whitelisting

EventHorizon validates outbound webhook destinations before dispatching user-configured webhook actions. The goal is to prevent slow or malicious destinations from becoming an SSRF path into private networks, local services, cloud metadata endpoints, or organization-restricted integrations.

## Defaults

IP validation is enabled by default.

```env
IP_WHITELIST_ENFORCE=true
IP_WHITELIST_ALLOW_PRIVATE=false
```

With the default settings:

- Private, loopback, link-local, multicast, and reserved internal ranges are always blocked.
- The cloud metadata address `169.254.169.254` is blocked through the link-local denylist.
- If an organization has no enabled whitelist entries, public destinations are allowed.
- If an organization has one or more enabled whitelist entries, the resolved destination IP must match an enabled entry.

`IP_WHITELIST_ALLOW_PRIVATE=true` is intended only for local development environments.

## Admin API

Whitelist entries are scoped to the authenticated user's organization and require `manage_organization`.

### List entries

```http
GET /api/admin/ip-whitelist
Authorization: Bearer <token>
```

### Add an entry

```http
POST /api/admin/ip-whitelist
Authorization: Bearer <token>
Content-Type: application/json

{
  "cidr": "203.0.113.0/24",
  "label": "Partner webhook provider",
  "enabled": true
}
```

Exact IPs are accepted and normalized to host CIDR form, for example `203.0.113.10` becomes `203.0.113.10/32`.

### Update an entry

```http
PATCH /api/admin/ip-whitelist/<entry-id>
Authorization: Bearer <token>
Content-Type: application/json

{
  "enabled": false
}
```

### Delete an entry

```http
DELETE /api/admin/ip-whitelist/<entry-id>
Authorization: Bearer <token>
```

## Validation Points

Webhook destinations are validated twice:

1. Trigger create/update validates the URL and, when DNS is available, the resolved IP. DNS resolution failures are returned as warnings so a temporary resolver issue does not block saving a trigger.
2. Webhook dispatch validates again and treats DNS failures or blocked destinations as hard failures.

Send-time validation protects against DNS changes after a trigger is saved.

## DNS Rebinding Protection

The webhook service resolves the destination hostname, validates the resolved IP, then uses a per-request HTTP(S) agent that connects to that validated IP for the original hostname. This prevents a second DNS lookup from returning a different private IP between validation and connection.

## Blocked Destination Example

If a webhook points at the cloud metadata endpoint:

```json
{
  "success": false,
  "status": "fail",
  "message": "Webhook destination resolves to a blocked private or internal IP",
  "details": {
    "url": "http://169.254.169.254/latest/meta-data",
    "address": "169.254.169.254"
  }
}
```

## Operational Notes

- Use CIDR entries for webhook providers that publish stable egress ranges.
- Keep entries disabled instead of deleting them when temporarily pausing a partner destination.
- Avoid enabling private destinations in shared or production environments.
