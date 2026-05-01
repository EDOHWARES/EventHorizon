'use strict';

const logger = require('./logger');

/**
 * Registry mapping semver -> on-chain SCHEMA_VERSION integer for known
 * LiquifactEscrow wasm deployments.
 *
 * Add a new entry here whenever a new wasm is deployed to production.
 * Keys are semver strings; values are the u32 SCHEMA_VERSION stored in
 * the contract's persistent storage.
 */
const VERSION_REGISTRY = Object.freeze({
  '1.0.0': 1,
  '1.1.0': 2,
  '2.0.0': 3,
});

/**
 * Returns the semver string for a given on-chain SCHEMA_VERSION, or null
 * if the version is not in the registry.
 *
 * @param {number} schemaVersion
 * @returns {string|null}
 */
function semverForSchemaVersion(schemaVersion) {
  for (const [semver, sv] of Object.entries(VERSION_REGISTRY)) {
    if (sv === schemaVersion) return semver;
  }
  return null;
}

/**
 * Returns the latest known SCHEMA_VERSION in the registry.
 *
 * @returns {number}
 */
function latestKnownSchemaVersion() {
  return Math.max(...Object.values(VERSION_REGISTRY));
}

/**
 * Fetches the current SCHEMA_VERSION from the on-chain LiquifactEscrow
 * contract and compares it against the registry.
 *
 * Requires:
 *   LIQUIFACT_ESCROW_CONTRACT_ID  – Soroban contract address
 *   SOROBAN_RPC_URL               – RPC endpoint (falls back to testnet)
 *   NETWORK_PASSPHRASE            – Stellar network passphrase
 *
 * @param {{ fetchSchemaVersion?: Function }} [deps] - injectable for testing
 * @returns {Promise<{
 *   onChainVersion: number,
 *   semver: string|null,
 *   isLatest: boolean,
 *   latestKnown: number
 * }>}
 */
async function checkOnChainVersion(deps = {}) {
  const contractId = process.env.LIQUIFACT_ESCROW_CONTRACT_ID;
  if (!contractId) {
    throw new Error('LIQUIFACT_ESCROW_CONTRACT_ID is not set');
  }

  const rpcUrl =
    process.env.SOROBAN_RPC_URL ||
    'https://soroban-testnet.stellar.org';

  const fetchFn = deps.fetchSchemaVersion || _fetchSchemaVersionFromChain;

  const onChainVersion = await fetchFn(contractId, rpcUrl);
  const semver = semverForSchemaVersion(onChainVersion);
  const latestKnown = latestKnownSchemaVersion();

  logger.info('LiquifactEscrow version check', {
    contractId,
    onChainVersion,
    semver,
    latestKnown,
    isLatest: onChainVersion >= latestKnown,
  });

  return {
    onChainVersion,
    semver,
    isLatest: onChainVersion >= latestKnown,
    latestKnown,
  };
}

/**
 * Reads SCHEMA_VERSION from the contract's persistent storage via
 * simulateTransaction (read-only, no fee required).
 *
 * @param {string} contractId
 * @param {string} rpcUrl
 * @returns {Promise<number>}
 */
async function _fetchSchemaVersionFromChain(contractId, rpcUrl) {
  // Lazy-require to keep startup fast and allow mocking in tests.
  const { SorobanRpc, Contract, xdr, nativeToScVal } =
    require('@stellar/stellar-sdk');

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: true });
  const contract = new Contract(contractId);

  // Call the view function `schema_version()` which returns a u32.
  const tx = contract.call('schema_version');

  const result = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(
      `Contract simulation failed: ${result.error}`
    );
  }

  const returnVal = result.result?.retval;
  if (!returnVal) {
    throw new Error('Contract returned no value for schema_version()');
  }

  // retval is an xdr.ScVal; extract the u32 integer.
  const scVal = xdr.ScVal.fromXDR(returnVal.toXDR());
  return scVal.u32();
}

module.exports = {
  VERSION_REGISTRY,
  semverForSchemaVersion,
  latestKnownSchemaVersion,
  checkOnChainVersion,
};
