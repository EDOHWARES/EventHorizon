const axios = require('axios');
const logger = require('../config/logger');

class PagerDutyService {
    constructor() {
        this.integrationKey = process.env.PAGERDUTY_INTEGRATION_KEY;
        this.baseUrl = 'https://events.pagerduty.com/v2/enqueue';
    }

    isEnabled() {
        return !!this.integrationKey;
    }

    async triggerIncident(title, source, details = {}, dedupKey) {
        if (!this.isEnabled()) {
            logger.debug('PagerDuty integration is disabled. Incident not triggered.', { title, source });
            return null;
        }

        try {
            const payload = {
                routing_key: this.integrationKey,
                event_action: 'trigger',
                dedup_key: dedupKey,
                payload: {
                    summary: title,
                    source: source,
                    severity: 'critical',
                    custom_details: details,
                },
            };

            const response = await axios.post(this.baseUrl, payload);
            logger.info('PagerDuty incident triggered successfully', {
                title,
                source,
                dedupKey,
                pdResponseId: response.data?.dedup_key || dedupKey
            });

            return response.data;
        } catch (error) {
            logger.error('Failed to trigger PagerDuty incident', {
                error: error.message,
                responseData: error.response?.data,
                title
            });
            throw error;
        }
    }

    async resolveIncident(dedupKey) {
        if (!this.isEnabled()) {
            return null;
        }

        if (!dedupKey) {
            logger.warn('resolveIncident called without dedupKey');
            return null;
        }

        try {
            const payload = {
                routing_key: this.integrationKey,
                event_action: 'resolve',
                dedup_key: dedupKey,
            };

            const response = await axios.post(this.baseUrl, payload);
            logger.info('PagerDuty incident resolved successfully', { dedupKey });
            return response.data;
        } catch (error) {
            logger.error('Failed to resolve PagerDuty incident', {
                error: error.message,
                responseData: error.response?.data,
                dedupKey
            });
            throw error;
        }
    }
}

module.exports = new PagerDutyService();
