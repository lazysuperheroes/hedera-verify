'use strict';

/**
 * Hedera network constants + env→chain mapping for Sourcify verification.
 *
 * HashScan retired its self-hosted Sourcify; verification now goes to the
 * public Sourcify (sourcify.dev), which natively supports Hedera mainnet (295)
 * and testnet (296). Previewnet (297) may not be indexed there.
 */

const DEFAULT_API_URL = process.env.SOURCIFY_API_URL || 'https://sourcify.dev/server';
const DEFAULT_BROWSER_URL = process.env.SOURCIFY_BROWSER_URL || 'https://repo.sourcify.dev';

/**
 * Map an ENVIRONMENT string to the EVM chainId Sourcify keys on.
 * Accepts the short forms used across the LSH tooling (test|main|preview|local)
 * and the "-net" variants.
 * @param {string} env
 * @returns {number}
 */
function chainIdForEnv(env) {
	switch ((env || '').toLowerCase()) {
	case 'main':
	case 'mainnet':
		return 295;
	case 'test':
	case 'testnet':
		return 296;
	case 'preview':
	case 'previewnet':
		return 297;
	case 'local':
		return 298;
	default:
		throw new Error(`Cannot map ENVIRONMENT '${env}' to a chainId (expected test|main|preview|local)`);
	}
}

/**
 * HashScan network slug for building a human-friendly explorer link.
 * @param {string} env
 * @returns {string}
 */
function hashscanNetwork(env) {
	switch ((env || '').toLowerCase()) {
	case 'main':
	case 'mainnet':
		return 'mainnet';
	case 'preview':
	case 'previewnet':
		return 'previewnet';
	default:
		return 'testnet';
	}
}

/**
 * Public Hedera mirror-node base URL for an env.
 * @param {string} env
 * @returns {string}
 */
function mirrorBaseUrl(env) {
	switch ((env || '').toLowerCase()) {
	case 'main':
	case 'mainnet':
		return 'https://mainnet-public.mirrornode.hedera.com';
	case 'preview':
	case 'previewnet':
		return 'https://previewnet.mirrornode.hedera.com';
	case 'local':
		return 'http://localhost:8000';
	case 'test':
	case 'testnet':
		return 'https://testnet.mirrornode.hedera.com';
	default:
		throw new Error(`Cannot map ENVIRONMENT '${env}' to a mirror node (expected test|main|preview|local)`);
	}
}

module.exports = {
	chainIdForEnv,
	hashscanNetwork,
	mirrorBaseUrl,
	DEFAULT_API_URL,
	DEFAULT_BROWSER_URL,
};
