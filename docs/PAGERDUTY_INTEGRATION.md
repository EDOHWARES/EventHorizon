# PagerDuty Integration

EventHorizon supports automated PagerDuty incident creation for critical service failures. This ensures your on-call rotation is immediately notified if core infrastructure becomes unavailable.

## Configuration

To enable PagerDuty integration, you need an integration key (also known as a routing key) from your PagerDuty service.

1. In PagerDuty, navigate to **Services** -> **Service Directory** and select the service you want to route events to.
2. Go to the **Integrations** tab and add a new integration of type **Events API V2**.
3. Copy the **Integration Key**.
4. In your EventHorizon `.env` file, add the following line:

   ```
   PAGERDUTY_INTEGRATION_KEY=your_integration_key_here
   ```

5. Restart your server.

## Health Monitoring

Once configured, the EventHorizon server will periodically check the health of its core dependencies (by default every 60 seconds).

The following checks are currently performed:
- **Database Health**: Checks if the MongoDB connection is alive.
- **Worker Health**: Checks if the background worker poller is functioning.

### Automated Incident Creation
- If a health check fails, an incident with a `critical` severity is triggered in PagerDuty.
- Incidents use a deduplication key (`dedup_key`) to prevent spamming your on-call rotation. Only one open incident per failing component will be created.

### Automated Resolution
- When the failing component recovers (e.g., the database reconnects), the system will automatically send a `resolve` event to PagerDuty.
- This will resolve the corresponding incident, stopping on-call escalations.
