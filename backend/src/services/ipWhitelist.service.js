const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const ipaddr = require('ipaddr.js');
const IpWhitelist = require('../models/ipWhitelist.model');

const ENFORCEMENT_DISABLED = process.env.IP_WHITELIST_ENFORCE === 'false';
const ALLOW_PRIVATE = process.env.IP_WHITELIST_ALLOW_PRIVATE === 'true';

const DENIED_RANGES = [
    '0.0.0.0/8',
    '10.0.0.0/8',
    '100.64.0.0/10',
    '127.0.0.0/8',
    '169.254.0.0/16',
    '172.16.0.0/12',
    '192.0.0.0/24',
    '192.168.0.0/16',
    '198.18.0.0/15',
    '224.0.0.0/4',
    '240.0.0.0/4',
    '::/128',
    '::1/128',
    'fc00::/7',
    'fe80::/10',
    'ff00::/8',
].map((range) => ipaddr.parseCIDR(range));

class WebhookDestinationBlockedError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'WebhookDestinationBlockedError';
        this.code = 'WEBHOOK_DESTINATION_BLOCKED';
        this.statusCode = 400;
        this.details = details;
    }
}

function parseAddress(value) {
    return ipaddr.process(value);
}

function normalizeHostname(hostname) {
    const value = String(hostname || '').trim();
    if (value.startsWith('[') && value.endsWith(']')) {
        return value.slice(1, -1);
    }
    return value;
}

function parseCidr(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        throw new Error('CIDR or IP address is required');
    }

    if (trimmed.includes('/')) {
        const [address, prefix] = ipaddr.parseCIDR(trimmed);
        return [ipaddr.process(address.toString()), prefix];
    }

    const address = parseAddress(trimmed);
    return [address, address.kind() === 'ipv4' ? 32 : 128];
}

function normalizeCidr(value) {
    const [address, prefix] = parseCidr(value);
    return `${address.toString()}/${prefix}`;
}

function matchesRange(address, range) {
    return address.kind() === range[0].kind() && address.match(range);
}

function isDeniedAddress(address) {
    return DENIED_RANGES.some((range) => matchesRange(address, range));
}

function matchesWhitelist(address, entries) {
    return entries.some((entry) => matchesRange(address, parseCidr(entry.cidr)));
}

function parseWebhookUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch (_error) {
        throw new WebhookDestinationBlockedError('Webhook URL is invalid', { url });
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new WebhookDestinationBlockedError('Webhook URL must use http or https', {
            url,
            protocol: parsed.protocol,
        });
    }

    if (!parsed.hostname) {
        throw new WebhookDestinationBlockedError('Webhook URL must include a hostname', { url });
    }

    return parsed;
}

async function resolveHostname(hostname) {
    const normalizedHostname = normalizeHostname(hostname);

    if (ipaddr.isValid(normalizedHostname)) {
        const address = parseAddress(normalizedHostname);
        return [{ address: address.toString(), family: address.kind() === 'ipv4' ? 4 : 6 }];
    }

    return dns.lookup(normalizedHostname, { all: true, verbatim: true });
}

function createPinnedAgents(hostname, resolvedTarget) {
    const normalizedHostname = normalizeHostname(hostname);
    const lookup = (lookupHostname, _options, callback) => {
        if (lookupHostname === hostname || normalizeHostname(lookupHostname) === normalizedHostname) {
            callback(null, resolvedTarget.address, resolvedTarget.family);
            return;
        }

        dns.lookup(lookupHostname)
            .then((result) => callback(null, result.address, result.family))
            .catch(callback);
    };

    return {
        httpAgent: new http.Agent({ lookup }),
        httpsAgent: new https.Agent({ lookup }),
    };
}

async function getEnabledEntries(organizationId) {
    return IpWhitelist.find({
        organization: organizationId,
        enabled: true,
    }).lean();
}

async function validateResolvedAddresses(url, organizationId, resolvedAddresses) {
    const entries = organizationId ? await getEnabledEntries(organizationId) : [];

    for (const resolved of resolvedAddresses) {
        const address = parseAddress(resolved.address);

        if (!ALLOW_PRIVATE && isDeniedAddress(address)) {
            throw new WebhookDestinationBlockedError('Webhook destination resolves to a blocked private or internal IP', {
                url,
                address: address.toString(),
            });
        }

        if (entries.length > 0 && !matchesWhitelist(address, entries)) {
            throw new WebhookDestinationBlockedError('Webhook destination IP is not in the organization whitelist', {
                url,
                address: address.toString(),
            });
        }
    }
}

async function validateUrl(url, organizationId, options = {}) {
    const parsed = parseWebhookUrl(url);

    if (ENFORCEMENT_DISABLED) {
        return { url: parsed.toString(), warnings: ['IP whitelist enforcement is disabled'] };
    }

    let resolvedAddresses;
    try {
        resolvedAddresses = await resolveHostname(parsed.hostname);
    } catch (error) {
        if (options.allowDnsFailure) {
            return {
                url: parsed.toString(),
                warnings: [`DNS resolution failed: ${error.message}`],
            };
        }
        throw new WebhookDestinationBlockedError('Webhook destination could not be resolved', {
            url,
            hostname: parsed.hostname,
            reason: error.message,
        });
    }

    await validateResolvedAddresses(parsed.toString(), organizationId, resolvedAddresses);

    const pinnedTarget = resolvedAddresses[0];
    return {
        url: parsed.toString(),
        hostname: parsed.hostname,
        resolvedAddresses,
        pinnedAddress: pinnedTarget.address,
        pinnedFamily: pinnedTarget.family,
        agents: createPinnedAgents(parsed.hostname, pinnedTarget),
        warnings: [],
    };
}

async function createEntry({ organizationId, cidr, label, enabled = true, addedBy }) {
    const normalized = normalizeCidr(cidr);
    const entry = new IpWhitelist({
        organization: organizationId,
        cidr: normalized,
        label,
        enabled,
        addedBy,
    });
    await entry.save();
    return entry;
}

module.exports = {
    WebhookDestinationBlockedError,
    createEntry,
    getEnabledEntries,
    isDeniedAddress,
    matchesWhitelist,
    normalizeCidr,
    parseCidr,
    validateUrl,
};
