/**
 * Shared configuration for all k6 load test scripts.
 * Override BASE_URL and credentials via environment variables:
 *   k6 run -e BASE_URL=http://localhost:3000 -e TEST_EMAIL=user@test.com -e TEST_PASSWORD=pass script.js
 */
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const TEST_USER = {
  email: __ENV.TEST_EMAIL || 'loadtest@eventhorizon.dev',
  password: __ENV.TEST_PASSWORD || 'LoadTest@123',
  firstName: 'Load',
  lastName: 'Test',
  organizationName: 'LoadTestOrg',
};

export const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || 'test-admin-token';

/** Sample trigger payload used across tests */
export const TRIGGER_PAYLOAD = {
  contractId: 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
  eventName: 'transfer',
  actionType: 'webhook',
  actionUrl: 'https://webhook.site/test-load',
  network: 'testnet',
};
