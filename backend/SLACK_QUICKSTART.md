# Slack App Integration - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Create Slack App (2 minutes)

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name: "EventHorizon Alerts"
4. Select your workspace
5. Go to "Incoming Webhooks" → Enable
6. Click "Add New Webhook to Workspace"
7. Select a channel (e.g., #alerts)
8. Click "Allow"
9. **Copy the webhook URL** (you'll need this)

### Step 2: Configure Environment (1 minute)

Add to your `.env` file:

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
HEALTH_CHECK_INTERVAL_MS=300000
FRONTEND_URL=http://localhost:3000
```

### Step 3: Start Backend (1 minute)

```bash
cd backend
npm install
npm run dev
```

Watch for this log message:
```
✅ Health check scheduler started
```

### Step 4: Initialize Default Alerts (1 minute)

```bash
curl -X POST http://localhost:3000/api/admin/alerts/initialize-defaults \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

Response:
```json
{
  "success": true,
  "message": "Default alert rules created",
  "data": [
    { "name": "High Failed Jobs", ... },
    { "name": "Database Unavailable", ... },
    ...
  ]
}
```

### ✅ Done! 

You should now receive Slack alerts when system health issues occur.

---

## 📊 Check System Health

```bash
curl http://localhost:3000/api/admin/health/current \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Example response:
```json
{
  "success": true,
  "data": {
    "overallStatus": "healthy",
    "healthScore": 95,
    "queue": { "failedCount": 2, "activeCount": 5, ... },
    "database": { "connected": true, "responseTimeMs": 125 },
    "api": { "errorCount": 0, "avgResponseTimeMs": 42 },
    "webhooks": { "successCount": 150, "failureCount": 2 }
  }
}
```

---

## 🚨 View Active Alerts

```bash
curl http://localhost:3000/api/admin/alerts/rules \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected output: 5 default alert rules

---

## 🎯 Create Custom Alert

```bash
curl -X POST http://localhost:3000/api/admin/alerts/rules \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Queue Backup",
    "alertType": "queue_backed_up",
    "severity": "critical",
    "conditions": [{
      "metric": "queue.waitingCount",
      "operator": "gt",
      "value": 1000
    }],
    "notificationChannels": ["slack"],
    "slackConfig": {
      "webhookUrl": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
    }
  }'
```

---

## 🧪 Test an Alert

```bash
curl -X POST http://localhost:3000/api/admin/alerts/test/{ruleId} \
  -H "Authorization: Bearer YOUR_TOKEN"
```

You should receive a test alert in Slack!

---

## 📋 Key Endpoints Cheat Sheet

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/admin/health/current` | Get current health status |
| GET | `/api/admin/health/history` | Get health history (24h default) |
| GET | `/api/admin/alerts/rules` | List all alert rules |
| POST | `/api/admin/alerts/rules` | Create new alert rule |
| PUT | `/api/admin/alerts/rules/{id}` | Update alert rule |
| DELETE | `/api/admin/alerts/rules/{id}` | Delete alert rule |
| POST | `/api/admin/alerts/acknowledge/{id}` | Acknowledge alert |
| GET | `/api/admin/alerts/history` | Get alert history |
| POST | `/api/admin/alerts/test/{id}` | Send test alert |

---

## 📈 Available Metrics for Alert Rules

### Queue Metrics
- `queue.activeCount` - Jobs being processed
- `queue.waitingCount` - Jobs waiting
- `queue.failedCount` - Failed jobs
- `queue.delayedCount` - Delayed jobs

### Database Metrics
- `database.connected` - Connection status (boolean)
- `database.responseTimeMs` - Query response time

### API Metrics
- `api.errorCount` - Total errors
- `api.avgResponseTimeMs` - Average response time
- `api.p95ResponseTimeMs` - 95th percentile response time
- `api.requestCount` - Total requests

### Webhook Metrics
- `webhooks.failureCount` - Failed webhook calls
- `webhooks.rateLimitedCount` - Rate limited calls
- `webhooks.successCount` - Successful calls

### Overall Metrics
- `healthScore` - Overall health (0-100)
- `overallStatus` - System status

---

## 🔍 Example Alert Conditions

### High Failed Jobs Alert
```json
"conditions": [{
  "metric": "queue.failedCount",
  "operator": "gt",
  "value": 50
}]
```

### Slow API Response Alert
```json
"conditions": [{
  "metric": "api.avgResponseTimeMs",
  "operator": "gt",
  "value": 2000
}]
```

### Low Health Score Alert
```json
"conditions": [{
  "metric": "healthScore",
  "operator": "lt",
  "value": 50
}]
```

### Multi-condition Alert
```json
"conditions": [
  {
    "metric": "database.connected",
    "operator": "eq",
    "value": false
  },
  {
    "metric": "queue.failedCount",
    "operator": "gt",
    "value": 100
  }
]
```

---

## 🎮 Interactive Slack Buttons

Your alerts include 3 interactive buttons:

1. **Acknowledge** - Mark alert as seen
2. **View Dashboard** - Link to health dashboard
3. **Retry** - Manually re-evaluate alert

---

## 📝 Default Alert Rules

| Name | Trigger | Severity |
|------|---------|----------|
| High Failed Jobs | Failed count > 50 | ⚠️ Warning |
| Database Unavailable | Not connected | 🚨 Critical |
| High Webhook Failures | Failures > 20 | ⚠️ Warning |
| Slow API Response | Avg response > 2000ms | ⚠️ Warning |
| Low Health Score | Score < 50 | 🚨 Critical |

---

## 🔧 Configuration Tips

### Adjust Health Check Frequency
```bash
# More frequent (1 minute)
HEALTH_CHECK_INTERVAL_MS=60000

# Less frequent (10 minutes)
HEALTH_CHECK_INTERVAL_MS=600000
```

### Prevent Alert Spam
Enable throttling in alert rules:
```json
"throttleConfig": {
  "enabled": true,
  "minIntervalMinutes": 30
}
```

### Multiple Notification Channels
```json
"notificationChannels": ["slack", "discord", "email"]
```

---

## 🐛 Troubleshooting

### "Health check scheduler started" not appearing?
- Check MongoDB is running
- Check `npm install` completed
- Look for errors in console

### Not receiving Slack alerts?
1. Verify webhook URL is correct: `curl -d "test=1" YOUR_WEBHOOK_URL`
2. Check alert rule conditions match actual metrics
3. View health metrics: `GET /api/admin/health/current`
4. Test alert: `POST /api/admin/alerts/test/{ruleId}`

### High memory usage?
- Increase `HEALTH_CHECK_INTERVAL_MS` to reduce frequency
- Or restart backend service

---

## 📚 Full Documentation

For complete documentation, see:
- `docs/slack_integration_guide.md` - Comprehensive guide
- `SLACK_IMPLEMENTATION_SUMMARY.md` - Technical details
- `/api/docs` - Interactive API documentation

---

## ✨ What's Working

✅ Real-time system health monitoring  
✅ Automated Slack alerts  
✅ Interactive buttons in Slack  
✅ Customizable alert rules  
✅ Health score calculation  
✅ Alert throttling to prevent spam  
✅ Multiple metric types  
✅ Complete API  
✅ Unit tests included  
✅ Production ready  

---

## 🎓 Learn More

- **API Docs**: http://localhost:5000/api/docs
- **Slack API**: https://api.slack.com/messaging
- **EventHorizon Docs**: See main README.md

---

**Happy monitoring! 🚀**

For help, check the comprehensive guides or review the test file:
`backend/__tests__/systemHealth.test.js`
