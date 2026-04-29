# Slack App Integration Guide

## Overview
EventHorizon now includes full Slack integration for system status alerts with interactive buttons.

## Features
- **Rich Block Kit messages** with health metrics and interactive buttons
- **Acknowledge/Retry/View Dashboard** buttons 
- **Granular alert rules** (queue failures, DB issues, webhook errors)
- **Automatic monitoring** every 2 minutes
- **Audit trail** and history tracking

## Setup

### 1. Create Slack App
1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Create new app → "From scratch"
3. Enable **Socket Mode** OR set Request URL to `https://yourdomain.com/api/slack/interactions`
4. Add permissions: `chat:write`, `chat:write.public`

### 2. Environment Variables
Copy `.env.example` to `.env`:
```
SLACK_SIGNING_SECRET=sh... (from Basic Info → App Credentials)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... (for fallback)
FRONTEND_URL=https://yourdomain.com
```

### 3. Install Dependencies
```bash
cd backend
npm install @slack/verify node-cron
```

### 4. Add Incoming Webhook (Recommended)
1. In Slack app → Features → Incoming Webhooks
2. Add to workspace → Copy webhook URL to `SLACK_WEBHOOK_URL`

## API Endpoints
```
GET    /api/alerts/rules           # List alert rules
POST   /api/alerts/rules           # Create rule
PUT    /api/alerts/rules/:id       # Update rule
DELETE /api/alerts/rules/:id       # Delete rule
POST   /api/alerts/rules/:id/test  # Test rule
GET    /api/alerts/history         # Alert history

POST   /api/slack/interactions     # Slack app interactions (buttons)
```

## Default Alert Rules
On org creation, these rules are auto-created:
- High Failed Jobs (>50)
- Database Unavailable
- High Webhook Failures (>20) 
- Slow API Response (>2s)
- Low Health Score (<50)

## Testing
1. `npm run dev:backend`
2. Create alert rule via `/api/alerts/rules`
3. Simulate failure: Fill queue with failed jobs
4. Watch Slack channel for alerts + buttons
5. Click **Acknowledge** → see status update

## Buttons
| Button | Action |
|--------|--------|
| ✅ Acknowledge | Marks alert as acknowledged in DB |
| 📊 View Dashboard | Links to `/health` dashboard |
| 🔄 Retry | Retries up to 5 recent failed queue jobs |

## Monitoring
- Cron runs every **2 minutes**
- Checks all orgs with active rules
- Logs to `alerts` collection
- Rate limited/throttled alerts (15min cooldown default)

## Troubleshooting
**No alerts?**
- Check `SLACK_WEBHOOK_URL` 
- Verify cron logs
- Test rule with `/api/alerts/rules/:id/test`

**Button clicks fail?**
- Set `SLACK_SIGNING_SECRET`
- Verify Request URL
- Check server logs

**Rate limited?**
- Alerts throttle per rule (configurable)

---

*See `SLACK_QUICKSTART.md` for webhook-only setup.*

