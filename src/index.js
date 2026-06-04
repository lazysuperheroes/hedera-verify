'use strict';

/**
 * @lazysuperheroes/hedera-verify
 *
 * Programmatic + CLI verification of Hedera smart contracts on Sourcify
 * (sourcify.dev V2 API). The engine reads Hardhat build-info and resolves
 * EVM addresses from the mirror node, so it works for both SDK-deployed and
 * CREATE2-deployed contracts.
 *
 * Typical use in a deploy script:
 *   const { verifyContract } = require('@lazysuperheroes/hedera-verify');
 *   await verifyContract({ contractName: 'MyContract', env: 'test', contractId, initialDelayMs: 10000, attempts: 4 });
 */

const { verifyContract, verifyContracts, checkVerified } = require('./sourcify');
const { resolveBuildInfo, findDbgFiles, listArtifacts, defaultArtifactsRoot } = require('./buildInfo');
const { resolveEvmAddress, getContractEvmAddress } = require('./mirror');
const { chainIdForEnv, hashscanNetwork, mirrorBaseUrl, DEFAULT_API_URL, DEFAULT_BROWSER_URL } = require('./chains');
const { loadConfig, buildRegistryTargets, parseAdHocTarget } = require('./config');
const {
	minimalProxyRuntime,
	parseMinimalProxyImplementation,
	isMinimalProxyFor,
	getOnchainRuntimeBytecode,
	resolveProxyStatus,
} = require('./proxy');

module.exports = {
	// core
	verifyContract,
	verifyContracts,
	checkVerified,
	// EIP-1167 minimal-proxy / clone resolution
	minimalProxyRuntime,
	parseMinimalProxyImplementation,
	isMinimalProxyFor,
	getOnchainRuntimeBytecode,
	resolveProxyStatus,
	// build artifacts
	resolveBuildInfo,
	findDbgFiles,
	listArtifacts,
	defaultArtifactsRoot,
	// address resolution
	resolveEvmAddress,
	getContractEvmAddress,
	// chains
	chainIdForEnv,
	hashscanNetwork,
	mirrorBaseUrl,
	DEFAULT_API_URL,
	DEFAULT_BROWSER_URL,
	// config
	loadConfig,
	buildRegistryTargets,
	parseAdHocTarget,
};
