const healthService = require('../src/services/health.service');
const Trigger = require('../src/models/trigger.model');
const mongoose = require('mongoose');

// Mock Trigger model methods if needed, but we can also use a real memory DB if available.
// For this simple test, we will mock the database calls.

async function testHealthChecks() {
    console.log('Testing Health Check Service...');

    // Mock Trigger.find
    const originalFind = Trigger.find;
    Trigger.find = function() {
        return {
            populate: function() {
                return [
                    {
                        _id: 'trigger-1',
                        actionType: 'webhook',
                        actionUrl: 'https://example.com/webhook',
                        contractId: 'C123',
                        eventName: 'test',
                        isActive: true,
                        consecutiveFailures: 0,
                        organization: new mongoose.Types.ObjectId(),
                        createdBy: { email: 'owner@example.com' },
                        save: async function() { console.log('Trigger 1 saved'); },
                        handleFailure: async function(err) {
                            this.consecutiveFailures += 1;
                            this.isActive = this.consecutiveFailures < 5;
                            return { autoDisabled: !this.isActive, consecutiveFailures: this.consecutiveFailures };
                        }
                    },
                    {
                        _id: 'trigger-2',
                        actionType: 'email',
                        actionUrl: 'owner@example.com',
                        contractId: 'C456',
                        eventName: 'test2',
                        isActive: true,
                        consecutiveFailures: 4, // Next failure should disable
                        organization: new mongoose.Types.ObjectId(),
                        createdBy: { email: 'owner@example.com' },
                        save: async function() { console.log('Trigger 2 saved'); },
                        handleFailure: async function(err) {
                            this.consecutiveFailures += 1;
                            this.isActive = this.consecutiveFailures < 5;
                            return { autoDisabled: !this.isActive, consecutiveFailures: this.consecutiveFailures };
                        }
                    }
                ];
            }
        };
    };

    // Mock services
    const webhookService = require('../src/services/webhook.service');
    const originalSendWebhook = webhookService.sendSignedWebhook;
    webhookService.sendSignedWebhook = async () => {
        console.log('Mock Webhook sent successfully');
        return { status: 200 };
    };

    const emailService = require('../src/services/email.service');
    const originalSendEmail = emailService.sendEmail;
    emailService.sendEmail = async (opts) => {
        console.log(`Mock Email sent to ${opts.to}: ${opts.subject}`);
        return { success: true };
    };

    // Test successful health check
    console.log('\n--- Test 1: Successful Health Check ---');
    const trigger1 = (await Trigger.find().populate())[0];
    await healthService.checkTriggerHealth(trigger1);
    console.log('Trigger 1 status:', trigger1.isActive ? 'Active' : 'Disabled');

    // Test failed health check with auto-disable
    console.log('\n--- Test 2: Failed Health Check with Auto-Disable ---');
    const trigger2 = (await Trigger.find().populate())[1];
    
    // Force email service to fail for this trigger
    emailService.sendEmail = async () => {
        throw new Error('SMTP Connection Failed');
    };

    try {
        await healthService.checkTriggerHealth(trigger2);
    } catch (error) {
        console.log('Health check failed as expected:', error.message);
    }
    
    console.log('Trigger 2 consecutive failures:', trigger2.consecutiveFailures);
    console.log('Trigger 2 status:', trigger2.isActive ? 'Active' : 'Disabled');

    // Restore mocks
    Trigger.find = originalFind;
    webhookService.sendSignedWebhook = originalSendWebhook;
    emailService.sendEmail = originalSendEmail;

    console.log('\nTests completed.');
}

if (require.main === module) {
    testHealthChecks().catch(err => {
        console.error('Test failed:', err);
        process.exit(1);
    });
}

module.exports = { testHealthChecks };
