# Kill Switch System

## Overview

The Kill Switch system provides a comprehensive mechanism to pause action executions across the EventHorizon platform. This feature enhances security by allowing administrators to quickly halt all or specific action executions in response to potential security threats or system issues.

## Features

### Global Kill Switch
- **Purpose**: Pause all action executions system-wide
- **Use Case**: Emergency response to critical security incidents
- **Scope**: Affects all organizations and all action types

### Per-Organization Kill Switch
- **Purpose**: Pause action executions for specific organizations
- **Use Case**: Isolate problematic organizations without affecting others
- **Scope**: Affects all actions for the specified organization

### Per-Provider Kill Switch
- **Purpose**: Pause action executions for specific providers
- **Use Case**: Handle provider-specific issues (e.g., webhook endpoint problems, rate limiting)
- **Scope**: Affects all organizations using the specified provider

## API Endpoints

### Get Kill Switch Status
```
GET /api/kill-switch
```

**Response:**
```json
{
  "global": false,
  "perOrganization": {
    "org1": true,
    "org2": false
  },
  "perProvider": {
    "webhook": false,
    "telegram": true
  },
  "_id": "...",
  "updatedBy": "...",
  "createdAt": "...",
  "updatedAt": "..."
}
```

### Update Kill Switch
```
PUT /api/kill-switch
```

**Request Body:**
```json
{
  "global": true,  // Optional: Enable/disable global kill switch
  "perOrganization": {  // Optional: Organization-specific settings
    "org1": true,
    "org2": false
  },
  "perProvider": {  // Optional: Provider-specific settings
    "webhook": false,
    "telegram": true
  }
}
```

## Permissions

Access to the Kill Switch API is restricted to users with the `manage_kill_switch` permission. This permission should only be granted to super-administrators.

## Implementation Details

### Action Execution Flow
1. When a trigger action is queued for execution, the processor checks the kill switch status
2. If any applicable kill switch is enabled, the action is blocked with an error
3. Blocked actions are logged for audit purposes
4. The system continues processing other actions normally

### Supported Providers
- `webhook`
- `telegram`
- `discord`
- `email`

### Database Schema
The kill switch configuration is stored in a MongoDB collection with the following structure:
- `global`: Boolean flag for system-wide pause
- `perOrganization`: Map of organization IDs to boolean flags
- `perProvider`: Map of provider names to boolean flags
- `updatedBy`: Reference to the user who last updated the configuration

## Security Considerations

1. **Access Control**: Only super-administrators can modify kill switch settings
2. **Audit Logging**: All kill switch changes are logged with user information
3. **Fail-Safe**: In case of database errors, the system defaults to allowing actions
4. **Granular Control**: Multiple levels of control allow for precise incident response

## Usage Examples

### Emergency Global Pause
```bash
curl -X PUT /api/kill-switch \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"global": true}'
```

### Pause Specific Organization
```bash
curl -X PUT /api/kill-switch \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"perOrganization": {"org123": true}}'
```

### Resume Operations
```bash
curl -X PUT /api/kill-switch \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"global": false}'
```

## Monitoring

- Blocked actions are logged with warning level
- Kill switch status can be monitored via the GET endpoint
- Changes to kill switch configuration trigger audit logs