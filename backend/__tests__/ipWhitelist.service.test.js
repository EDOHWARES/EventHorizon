const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns').promises;
const IpWhitelist = require('../src/models/ipWhitelist.model');
const ipWhitelistService = require('../src/services/ipWhitelist.service');

const originalLookup = dns.lookup;
const originalFind = IpWhitelist.find;

function mockEntries(entries) {
    IpWhitelist.find = () => ({
        lean: async () => entries,
    });
}

test.afterEach(() => {
    dns.lookup = originalLookup;
    IpWhitelist.find = originalFind;
});

test('normalizes exact IPs and CIDR ranges', () => {
    assert.equal(ipWhitelistService.normalizeCidr('203.0.113.10'), '203.0.113.10/32');
    assert.equal(ipWhitelistService.normalizeCidr('203.0.113.0/24'), '203.0.113.0/24');
    assert.equal(ipWhitelistService.normalizeCidr('2001:db8::1'), '2001:db8::1/128');
});

test('rejects private and metadata destinations even when allowlist is empty', async () => {
    mockEntries([]);

    await assert.rejects(
        ipWhitelistService.validateUrl('http://169.254.169.254/latest/meta-data', 'org-1'),
        (error) => error.code === 'WEBHOOK_DESTINATION_BLOCKED'
            && /private or internal IP/.test(error.message)
    );
});

test('rejects IPv6 loopback literal destinations', async () => {
    mockEntries([]);

    await assert.rejects(
        ipWhitelistService.validateUrl('http://[::1]/hook', 'org-1'),
        (error) => error.code === 'WEBHOOK_DESTINATION_BLOCKED'
            && /private or internal IP/.test(error.message)
    );
});

test('allows public destinations when the organization allowlist is empty', async () => {
    mockEntries([]);
    dns.lookup = async () => [{ address: '203.0.113.42', family: 4 }];

    const result = await ipWhitelistService.validateUrl('https://hooks.example.com/path', 'org-1');

    assert.equal(result.pinnedAddress, '203.0.113.42');
    assert.equal(result.pinnedFamily, 4);
});

test('rejects public destinations outside a configured organization allowlist', async () => {
    mockEntries([{ cidr: '198.51.100.0/24' }]);
    dns.lookup = async () => [{ address: '203.0.113.42', family: 4 }];

    await assert.rejects(
        ipWhitelistService.validateUrl('https://hooks.example.com/path', 'org-1'),
        (error) => error.code === 'WEBHOOK_DESTINATION_BLOCKED'
            && /not in the organization whitelist/.test(error.message)
    );
});

test('accepts destinations inside a configured CIDR allowlist', async () => {
    mockEntries([{ cidr: '203.0.113.0/24' }]);
    dns.lookup = async () => [{ address: '203.0.113.42', family: 4 }];

    const result = await ipWhitelistService.validateUrl('https://hooks.example.com/path', 'org-1');

    assert.equal(result.pinnedAddress, '203.0.113.42');
});

test('save-time validation can return a DNS warning without allowing send-time bypass', async () => {
    mockEntries([]);
    dns.lookup = async () => {
        throw new Error('temporary DNS failure');
    };

    const saveResult = await ipWhitelistService.validateUrl(
        'https://temporarily-down.example.com/hook',
        'org-1',
        { allowDnsFailure: true }
    );
    assert.match(saveResult.warnings[0], /DNS resolution failed/);

    await assert.rejects(
        ipWhitelistService.validateUrl('https://temporarily-down.example.com/hook', 'org-1'),
        (error) => error.code === 'WEBHOOK_DESTINATION_BLOCKED'
            && /could not be resolved/.test(error.message)
    );
});

test('pinned agent lookup returns the validated IP for the original hostname', async () => {
    mockEntries([]);
    dns.lookup = async () => [{ address: '203.0.113.42', family: 4 }];

    const result = await ipWhitelistService.validateUrl('https://hooks.example.com/path', 'org-1');

    await new Promise((resolve, reject) => {
        result.agents.httpsAgent.options.lookup('hooks.example.com', {}, (error, address, family) => {
            if (error) {
                reject(error);
                return;
            }
            try {
                assert.equal(address, '203.0.113.42');
                assert.equal(family, 4);
                resolve();
            } catch (assertionError) {
                reject(assertionError);
            }
        });
    });
});
