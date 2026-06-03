'use strict';

const axios = require('axios');
const { mirrorBaseUrl } = require('./chains');

/**
 * Fetch a contract's canonical EVM address from the Hedera mirror node.
 * Correct for both HAPI/SDK-deployed contracts (long-zero address) and
 * CREATE2-deployed clones (aliased address) — we always read what the network
 * actually records rather than computing the long-zero form.
 *
 * @param {string} env  test|main|preview|local
 * @param {string} contractId  Hedera ID like "0.0.1234"
 * @returns {Promise<string|null>} 0x-prefixed address, or null if not found
 */
async function getContractEvmAddress(env, contractId) {
	const baseUrl = mirrorBaseUrl(env);
	const url = `${baseUrl}/api/v1/contracts/${contractId.toString()}`;
	try {
		const res = await axios.get(url, { timeout: 30000 });
		return res.data && res.data.evm_address ? res.data.evm_address : null;
	}
	catch (_e) {
		return null;
	}
}

/**
 * Normalise a target into a 0x EVM address. Accepts a 0x address (returned
 * lower-cased as-is) or a Hedera contract ID (0.0.x) resolved via the mirror
 * node.
 *
 * @param {object} opts
 * @param {string} [opts.env]  required when contractId is supplied
 * @param {string} [opts.address]  0x EVM address (takes precedence)
 * @param {string} [opts.contractId]  Hedera ID like "0.0.1234"
 * @returns {Promise<string>} 0x-prefixed lowercase address
 */
async function resolveEvmAddress({ env, address, contractId } = {}) {
	if (address) {
		const a = String(address).trim();
		if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
			throw new Error(`'${address}' is not a valid 0x EVM address`);
		}
		return a.toLowerCase();
	}
	if (!contractId) throw new Error('resolveEvmAddress: provide either address or contractId');
	if (!env) throw new Error('resolveEvmAddress: env is required to resolve a Hedera contract ID');

	const evm = await getContractEvmAddress(env, contractId);
	if (!evm) {
		throw new Error(`Mirror node returned no evm_address for ${contractId} on ${env} — is it deployed/indexed yet?`);
	}
	return evm.startsWith('0x') ? evm.toLowerCase() : `0x${evm.toLowerCase()}`;
}

module.exports = { getContractEvmAddress, resolveEvmAddress };
