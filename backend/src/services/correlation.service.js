const Redis = require('ioredis');
const logger = require('../config/logger');
const { passesFilters } = require('../utils/filterEvaluator');

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
});

class CorrelationService {
    async checkSequence(trigger, event) {
        if (!trigger.sequence) {
            return { shouldFire: false };
        }

        const { steps, maxTimeMs } = trigger.sequence;
        if (!steps || steps.length === 0) {
            return { shouldFire: false };
        }

        // Find matching sessions
        const pattern = `correlation:${trigger._id}:*`;
        const keys = await redis.keys(pattern);
        let foundSession = false;

        for (const key of keys) {
            const sessionDataStr = await redis.get(key);
            if (!sessionDataStr) continue;

            let sessionData;
            try {
                sessionData = JSON.parse(sessionDataStr);
            } catch (e) {
                continue;
            }

            const currentStepIndex = sessionData.currentStep;
            if (currentStepIndex >= steps.length - 1) continue; // Already completed

            const nextStep = steps[currentStepIndex + 1];
            if (event.contractId !== trigger.contractId || event.eventName !== nextStep.eventName) {
                continue;
            }

            if (!passesFilters(event, nextStep.filters || [])) {
                continue;
            }

            // Update session
            sessionData.currentStep = currentStepIndex + 1;
            sessionData.lastEventTime = Date.now();
            sessionData.events.push(event);
            sessionData.steps[currentStepIndex + 1].completed = true;
            foundSession = true;

            if (sessionData.currentStep >= steps.length - 1) {
                // Sequence completed
                await redis.del(key);
                logger.info('Sequence completed', { sessionId: key, triggerId: trigger._id });
                return { shouldFire: true, eventPayload: sessionData.events };
            } else {
                // Update session
                const remainingTime = Math.ceil((maxTimeMs - (Date.now() - sessionData.startTime)) / 1000);
                if (remainingTime > 0) {
                    await redis.setex(key, remainingTime, JSON.stringify(sessionData));
                }
            }
        }

        // If no session updated, check if it matches the first step to start new
        if (!foundSession) {
            const firstStep = steps[0];
            if (event.contractId === trigger.contractId && event.eventName === firstStep.eventName && passesFilters(event, firstStep.filters || [])) {
                // Start a new correlation session
                const sessionId = `${trigger._id}:${event.ledger}:${event.txHash}`;
                const sessionKey = `correlation:${sessionId}`;
                const sessionData = {
                    currentStep: 0,
                    steps: steps.map(step => ({ ...step, completed: false })),
                    startTime: Date.now(),
                    lastEventTime: Date.now(),
                    events: [event]
                };
                sessionData.steps[0].completed = true;

                await redis.setex(sessionKey, Math.ceil(maxTimeMs / 1000), JSON.stringify(sessionData));

                logger.info('Started correlation session', { sessionId, triggerId: trigger._id });
            }
        }

        return { shouldFire: false };
    }
}

module.exports = new CorrelationService();