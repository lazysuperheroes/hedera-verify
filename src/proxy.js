'use strict';

const axios = require('axios');
const { mirrorBaseUrl, hashscanNetwork, chainIdForEnv } = require('./chains');
const { checkVerified } = require('./sourcify');

/**
 * EIP-1167 minimal-proxy helpers.
 *
 * Clone factories (e.g. OpenZeppelin `Clones.cloneDeterministic`) deploy each
 * instance as a ~45-byte EIP-1167 minimal proxy whose runtime embeds the
 * implementation address. Such clones CANNOT be source-verified on Sourcify
 * (there is no .sol that compiles to the bare proxy), so the right model is:
 * verify the implementation once, then resolve clones to it. These helpers do
 * that resolution + integrity checking, and are browser-safe (axios + string
 * ops only — no fs).
 *
 * Canonical EIP-1167 runtime (45 bytes):
 *   363d3d373d3d3d363d73 <20-byte impl> 5af43d82803e903d91602b57fd5bf3
 */

const EIP1167_PREFIX = '363d3d373d3d3d363d73';
const EIP1167_SUFFIX = '5af43d82803e903d91602b57fd5bf3';
const EIP1167_HEX_LEN = EIP1167_PREFIX.length + 40 + EIP1167_SUFFIX.length; // 90 hex = 45 bytes

function normalizeHex(s) {
	return (s || '').toLowerCase().replace(/^0x/, '');
}

/**
 * The canonical EIP-1167 runtime bytecode for a given implementation.
 * @param {string} implAddress  20-byte 0x address
 * @returns {string} 0x-prefixed runtime hex
 */
function minimalProxyRuntime(implAddress) {
	const impl = normalizeHex(implAddress);
	if (impl.length !== 40) throw new Error('minimalProxyRuntime: implAddress must be a 20-byte hex address');
	return '0x' + EIP1167_PREFIX + impl + EIP1167_SUFFIX;
}

/**
 * If `bytecode` is a canonical EIP-1167 minimal proxy, return the embedded
 * implementation address (0x, lowercase); otherwise null.
 * @param {string} bytecode  runtime bytecode hex
 * @returns {string|null}
 */
function parseMinimalProxyImplementation(bytecode) {
	const code = normalizeHex(bytecode);
	if (code.length !== EIP1167_HEX_LEN) return null;
	if (!code.startsWith(EIP1167_PREFIX) || !code.endsWith(EIP1167_SUFFIX)) return null;
	return '0x' + code.slice(EIP1167_PREFIX.length, EIP1167_PREFIX.length + 40);
}

/**
 * True iff `bytecode` is the canonical EIP-1167 minimal proxy for `implAddress`.
 * @param {string} bytecode
 * @param {string} implAddress  20-byte 0x address
 * @returns {boolean}
 */
function isMinimalProxyFor(bytecode, implAddress) {
	const impl = parseMinimalProxyImplementation(bytecode);
	return impl !== null && impl === '0x' + normalizeHex(implAddress);
}

/**
 * Fetch a contract's runtime bytecode from the Hedera mirror node. Accepts a
 * Hedera ID (0.0.x) or an EVM address.
 * @param {string} env
 * @param {string} addressOrId
 * @returns {Promise<string|null>}
 */
async function getOnchainRuntimeBytecode(env, addressOrId) {
	const baseUrl = mirrorBaseUrl(env);
	const url = `${baseUrl}/api/v1/contracts/${addressOrId}`;
	const res = await axios.get(url, { timeout: 30000, validateStatus: () => true });
	if (res.status !== 200 || !res.data) return null;
	return res.data.runtime_bytecode || null;
}

/**
 * Resolve a clone/proxy address to its implementation and report integrity +
 * verification status — the function a DApp uses to present a stash with its
 * implementation's name/ABI, and the audit script uses to validate stashes.
 *
 * @param {object} opts
 * @param {string} opts.env
 * @param {string} [opts.address]   proxy address (0x) — or pass contractId
 * @param {string} [opts.contractId]  proxy Hedera ID (0.0.x)
 * @param {string} [opts.expectedImplementation]  if given, isCanonical checks the
 *        proxy points at exactly this impl (integrity invariant)
 * @param {string} [opts.apiUrl]   Sourcify server override
 * @param {boolean} [opts.checkImplementationVerified=true]
 * @returns {Promise<object>} {
 *   address, isProxy, proxyType, implementation, isCanonical,
 *   expectedImplementation, implementationVerified, implementationMatch,
 *   bytecode, hashscanUrl
 * }
 */
async function resolveProxyStatus({ env, address, contractId, expectedImplementation, apiUrl, checkImplementationVerified = true } = {}) {
	if (!env) throw new Error('resolveProxyStatus: env is required');
	const target = address || contractId;
	if (!target) throw new Error('resolveProxyStatus: provide address or contractId');

	const bytecode = await getOnchainRuntimeBytecode(env, target);
	const implementation = parseMinimalProxyImplementation(bytecode);
	const isProxy = implementation !== null;
	const expected = expectedImplementation ? '0x' + normalizeHex(expectedImplementation) : null;
	const isCanonical = expected ? (isProxy && implementation === expected) : isProxy;

	let implementationVerified = null;
	let implementationMatch = null;
	if (isProxy && checkImplementationVerified) {
		const v = await checkVerified({ apiUrl, chainId: chainIdForEnv(env), address: implementation });
		implementationVerified = !!v;
		implementationMatch = v ? (v.match || v.runtimeMatch || null) : null;
	}

	return {
		address: target,
		isProxy,
		proxyType: isProxy ? 'EIP1167' : null,
		implementation,
		isCanonical,
		expectedImplementation: expected,
		implementationVerified,
		implementationMatch,
		bytecode,
		hashscanUrl: `https://hashscan.io/${hashscanNetwork(env)}/contract/${target}`,
	};
}

module.exports = {
	minimalProxyRuntime,
	parseMinimalProxyImplementation,
	isMinimalProxyFor,
	getOnchainRuntimeBytecode,
	resolveProxyStatus,
};
