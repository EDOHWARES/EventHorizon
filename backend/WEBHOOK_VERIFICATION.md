# Webhook HMAC Verification

EventHorizon signs all outbound webhooks using HMAC-SHA256 to ensure payload integrity and authenticity. This prevents tampering and replay attacks.

## Headers

Each webhook request includes the following headers:

- `X-EventHorizon-Signature`: Hex-encoded HMAC-SHA256 signature
- `X-EventHorizon-Timestamp`: ISO 8601 timestamp when the webhook was sent
- `Content-Type`: `application/json`

## Signature Generation

The signature is generated using the following format:

```
HMAC-SHA256(webhook_secret, timestamp + "." + JSON.stringify(payload))
```

Where:
- `webhook_secret` is your unique secret (64-character hex string)
- `timestamp` is the ISO 8601 timestamp from the `X-EventHorizon-Timestamp` header
- `payload` is the exact JSON payload received in the request body

## Verification Steps

1. Extract the timestamp from `X-EventHorizon-Timestamp` header
2. Verify timestamp is within acceptable tolerance (recommended: 5 minutes)
3. Create the message: `timestamp + "." + JSON.stringify(payload)`
4. Compute HMAC-SHA256 using your webhook secret
5. Compare with the signature from `X-EventHorizon-Signature` using constant-time comparison

## Code Examples

### Node.js

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(signature, timestamp, payload, secret, toleranceMs = 300000) {
    // Check timestamp tolerance
    const now = Date.now();
    const timestampMs = new Date(timestamp).getTime();
    if (Math.abs(now - timestampMs) > toleranceMs) {
        throw new Error('Timestamp outside tolerance window');
    }

    // Generate expected signature
    const message = `${timestamp}.${JSON.stringify(payload)}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(message).digest('hex');

    // Use constant-time comparison
    return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
    );
}

// Usage in Express middleware
app.post('/webhook', express.json(), (req, res) => {
    const signature = req.headers['x-eventhorizon-signature'];
    const timestamp = req.headers['x-eventhorizon-timestamp'];
    const payload = req.body;
    const secret = process.env.WEBHOOK_SECRET; // Your webhook secret

    if (!signature || !timestamp) {
        return res.status(400).json({ error: 'Missing signature or timestamp' });
    }

    try {
        const isValid = verifyWebhookSignature(signature, timestamp, payload, secret);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        // Process webhook
        console.log('Valid webhook received:', payload);
        res.status(200).json({ status: 'ok' });
    } catch (error) {
        console.error('Webhook verification failed:', error.message);
        res.status(400).json({ error: error.message });
    }
});
```

### Python

```python
import hmac
import hashlib
import json
from datetime import datetime, timezone

def verify_webhook_signature(signature: str, timestamp: str, payload: dict, secret: str, tolerance_seconds: int = 300) -> bool:
    # Check timestamp tolerance
    now = datetime.now(timezone.utc)
    timestamp_dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
    if abs((now - timestamp_dt).total_seconds()) > tolerance_seconds:
        raise ValueError('Timestamp outside tolerance window')

    # Generate expected signature
    message = f"{timestamp}.{json.dumps(payload, separators=(',', ':'))}"
    expected_signature = hmac.new(
        secret.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    # Use constant-time comparison
    return hmac.compare_digest(signature, expected_signature)

# Usage in Flask
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/webhook', methods=['POST'])
def handle_webhook():
    signature = request.headers.get('X-EventHorizon-Signature')
    timestamp = request.headers.get('X-EventHorizon-Timestamp')
    payload = request.get_json()
    secret = os.environ['WEBHOOK_SECRET']  # Your webhook secret

    if not signature or not timestamp:
        return jsonify({'error': 'Missing signature or timestamp'}), 400

    try:
        is_valid = verify_webhook_signature(signature, timestamp, payload, secret)
        if not is_valid:
            return jsonify({'error': 'Invalid signature'}), 401

        # Process webhook
        print('Valid webhook received:', payload)
        return jsonify({'status': 'ok'}), 200
    except ValueError as e:
        print('Webhook verification failed:', str(e))
        return jsonify({'error': str(e)}), 400
```

## Security Best Practices

1. **Store secrets securely**: Never expose webhook secrets in client-side code or logs
2. **Use HTTPS**: Always verify webhooks over HTTPS to prevent MITM attacks
3. **Validate timestamps**: Reject webhooks with timestamps outside your tolerance window
4. **Use constant-time comparison**: Prevent timing attacks by using `crypto.timingSafeEqual` or `hmac.compare_digest`
5. **Log verification failures**: Monitor for suspicious activity
6. **Rotate secrets**: Regularly rotate webhook secrets for enhanced security

## Payload Structure

### Single Event Webhook
```json
{
  "contractId": "CBQ2J...",
  "eventName": "transfer",
  "payload": {
    "from": "GBX...",
    "to": "GDX...",
    "amount": "1000000"
  }
}
```

### Batch Event Webhook
```json
{
  "contractId": "CBQ2J...",
  "eventName": "transfer",
  "payload": {
    "from": "GBX...",
    "to": "GDX...",
    "amount": "1000000"
  },
  "batchIndex": 0,
  "batchSize": 5,
  "batchPayloads": [
    { "from": "GBX...", "to": "GDX...", "amount": "1000000" },
    { "from": "GDY...", "to": "GEX...", "amount": "500000" },
    // ... more events
  ]
}
```

## Error Handling

If signature verification fails, return appropriate HTTP status codes:
- `400 Bad Request`: Missing headers or malformed timestamp
- `401 Unauthorized`: Invalid signature
- `403 Forbidden`: Timestamp outside tolerance window

Always log verification failures for monitoring and debugging purposes.