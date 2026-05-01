# Custom HTTP Headers in Webhook Actions

## Overview

EventHorizon allows you to define custom HTTP headers for webhook actions, enabling you to enrich your webhooks with additional metadata or meet specific endpoint requirements.

## Configuration

Custom headers are configured as part of the trigger definition. Each header consists of a `key` and a `value`.

### Static Headers

Static headers have fixed values that don't change based on the event payload:

```json
{
  "customHeaders": [
    {
      "key": "Content-Type",
      "value": "application/json"
    },
    {
      "key": "X-API-Version",
      "value": "v2"
    }
  ]
}
```

### Dynamic Headers (JSONPath)

Dynamic headers use JSONPath expressions to extract values from the event payload. Any value that starts with `$.` is treated as a JSONPath expression.

```json
{
  "customHeaders": [
    {
      "key": "X-User-ID",
      "value": "$.user.id"
    },
    {
      "key": "X-Event-Type",
      "value": "$.eventName"
    },
    {
      "key": "X-Amount",
      "value": "$.payload.amount"
    }
  ]
}
```

## JSONPath Resolution

When processing a webhook:

1. The event payload is used as the input for JSONPath evaluation
2. Header values starting with `$.` are resolved using the [JSONPath-plus](https://www.npmjs.com/package/jsonpath-plus) library
3. Resolved values are converted to strings and set as HTTP headers

### Examples

Given this payload:
```json
{
  "user": {
    "id": "12345",
    "profile": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  },
  "contractId": "CBTEST...",
  "eventName": "token_transfer",
  "payload": {
    "from": "GBXYZ...",
    "to": "GCABC...",
    "amount": "1000000"
  }
}
```

These headers would resolve to:
- `$.user.id` → `"12345"`
- `$.user.profile.email` → `"john@example.com"`
- `$.contractId` → `"CBTEST..."`
- `$.payload.amount` → `"1000000"`

### Handling Edge Cases

- **Missing paths**: If a JSONPath doesn't match anything in the payload, an empty string is used
- **Multiple matches**: If a JSONPath matches multiple values, only the first value is used
- **Invalid JSONPath**: If JSONPath resolution throws an error, an empty string is used and the error is logged

## Security Considerations

### Header Validation

Certain headers are blocked for security reasons:
- `Host`
- `Content-Length`
- `Content-Type` (already set by the system)
- `User-Agent`
- `Authorization` (use webhook secrets instead)

Header keys must contain only alphanumeric characters, hyphens, and underscores.

### Limits

- Maximum of 50 custom headers per webhook
- Header keys and values must be strings
- Empty header keys are not allowed

## Implementation Details

Custom headers are merged with the standard webhook headers:
- `Content-Type: application/json`
- `X-EventHorizon-Signature`: HMAC-SHA256 signature
- `X-EventHorizon-Timestamp`: ISO timestamp

If there are conflicts between custom headers and standard headers, the custom headers take precedence (except for `Content-Type` which is protected).

## Usage in Code

When creating or updating a trigger via the API, include the `customHeaders` array:

```http
POST /api/v1/triggers
Content-Type: application/json

{
  "contractId": "CBTEST...",
  "eventName": "token_transfer",
  "actionType": "webhook",
  "actionUrl": "https://your-endpoint.com/webhook",
  "customHeaders": [
    {
      "key": "X-User-ID",
      "value": "$.user.id"
    },
    {
      "key": "X-Event-Type",
      "value": "$.eventName"
    }
  ]
}
```

## Testing

Unit tests for header building and validation are located in `__tests__/headerBuilder.test.js`.
Integration tests for webhook execution with headers are in `__tests__/webhook.service.test.js`.

## Best Practices

1. Use descriptive header keys that follow HTTP header conventions
2. Prefer static headers when the value doesn't change
3. Test JSONPath expressions with sample payloads before deploying
4. Monitor webhook logs for any header resolution warnings
5. Avoid sending sensitive data in headers; use the webhook signature for authentication instead