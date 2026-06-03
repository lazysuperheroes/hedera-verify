'use strict';

const axios = require('axios');
const { resolveBuildInfo } = require('./buildInfo');
const { resolveEvmAddress } = require('./mirror');
const { chainIdForEnv, hashscanNetwork, DEFAULT_API_URL, DEFAULT_BROWSER_URL } = require('./chains');

/**
 * Sourcify V2 job-based verification API:
 *   POST {server}/v2/verify/{chainId}/{address}   -> 202 { verificationId }   (409 if already verified)
 *   GET  {server}/v2/verify/{verificationId}       -> { isJobCompleted, contract, error }
 *   GET  {server}/v2/contract/{chainId}/{address}  -> existing verification (404/null if none)
 */

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Look up an existing verification. Returns the contract record on a hit, or
 * null if unverified / unreachable. Never throws — best-effort short-circuit.
 */
async function checkVerified({ apiUrl = DEFAULT_API_URL, chainId, address }) {
	try {
		const url = `${apiUrl}/v2/contract/${chainId}/${address}`;
		const res = await axios.get(url, { timeout: 30000, validateStatus: () => true });
		if (res.status === 200 && res.data && (res.data.match || res.data.runtimeMatch || res.data.creationMatch)) {
			return res.data;
		}
		return null;
	}
	catch (_e) {
		return null;
	}
}

/** Poll a verification job until it completes (or attempts run out). */
async function pollJob({ apiUrl, verificationId, pollIntervalMs = 4000, maxPollAttempts = 45 }) {
	const url = `${apiUrl}/v2/verify/${verificationId}`;
	let last;
	for (let i = 0; i < maxPollAttempts; i++) {
		const res = await axios.get(url, { timeout: 30000, validateStatus: () => true });
		last = res.data;
		if (res.status === 200 && last && last.isJobCompleted) return last;
		await sleep(pollIntervalMs);
	}
	return last || { isJobCompleted: false, error: { message: 'verification job did not complete in time' } };
}

function makeResult({ contractName, contractIdentifier, address, chainId, env, browserUrl, status, match, creationMatch, runtimeMatch, message, raw }) {
	const repoUrl = match ? `${browserUrl || DEFAULT_BROWSER_URL}/${chainId}/${address}` : null;
	return {
		contractName,
		contractIdentifier,
		address,
		chainId,
		env,
		status, // 'verified' | 'already_verified' | 'pending' | 'failed' | 'error'
		match: match || null, // 'exact_match' | 'match' | null
		creationMatch: creationMatch || null,
		runtimeMatch: runtimeMatch || null,
		repoUrl,
		hashscanUrl: `https://hashscan.io/${hashscanNetwork(env)}/contract/${address}`,
		message: message || null,
		raw,
	};
}

/** One submit + poll cycle. Returns a result object; no retry decisions here. */
async function submitAndPoll({ apiUrl, browserUrl, chainId, address, env, contractName, build, creationTransactionHash, pollIntervalMs, maxPollAttempts }) {
	const url = `${apiUrl}/v2/verify/${chainId}/${address}`;
	const body = {
		stdJsonInput: build.stdJsonInput,
		compilerVersion: build.compilerVersion,
		contractIdentifier: build.contractIdentifier,
	};
	if (creationTransactionHash) body.creationTransactionHash = creationTransactionHash;

	const res = await axios.post(url, body, {
		timeout: 60000,
		maxBodyLength: Infinity,
		maxContentLength: Infinity,
		headers: { 'Content-Type': 'application/json' },
		validateStatus: () => true,
	});

	const base = { contractName, contractIdentifier: build.contractIdentifier, address, chainId, env, browserUrl };

	// 409 => already verified (terminal, treat as success).
	if (res.status === 409 || res.data?.customCode === 'already_verified') {
		const existing = await checkVerified({ apiUrl, chainId, address });
		return makeResult({
			...base,
			status: 'already_verified',
			match: existing?.match || 'match',
			creationMatch: existing?.creationMatch,
			runtimeMatch: existing?.runtimeMatch,
			message: res.data?.message || 'already verified',
			raw: res.data,
		});
	}

	if (res.status !== 202 || !res.data?.verificationId) {
		return makeResult({
			...base,
			status: 'error',
			message: `submit failed (HTTP ${res.status}): ${res.data?.message || JSON.stringify(res.data)}`,
			raw: res.data,
		});
	}

	const verificationId = res.data.verificationId;
	const job = await pollJob({ apiUrl, verificationId, pollIntervalMs, maxPollAttempts });

	if (!job.isJobCompleted) {
		// Async job — keeps running on Sourcify after we stop polling. Report
		// 'pending' (not an error): a later run's already-verified precheck
		// will confirm it.
		return makeResult({
			...base,
			status: 'pending',
			message: `submitted (verificationId=${verificationId}); still processing on Sourcify — re-run to confirm`,
			raw: job,
		});
	}

	if (job.error) {
		return makeResult({
			...base,
			status: 'failed',
			message: `${job.error.customCode || 'error'}: ${job.error.message}`,
			raw: job,
		});
	}

	const c = job.contract || {};
	const matched = c.match || c.runtimeMatch || c.creationMatch || null;
	return makeResult({
		...base,
		status: matched ? 'verified' : 'failed',
		match: c.match,
		creationMatch: c.creationMatch,
		runtimeMatch: c.runtimeMatch,
		message: matched ? 'verified' : 'job completed without a bytecode match',
		raw: job,
	});
}

// A failure whose message implies the chain hasn't indexed the contract yet
// (common right after deploy) is worth re-submitting once the mirror node /
// Sourcify's RPC catches up.
const TRANSIENT_RE = /bytecode|not\s*found|no\s*(matching\s*)?contract|deployed|does not exist/i;

/**
 * Verify a single contract on Sourcify.
 *
 * @param {object} opts
 * @param {string} opts.contractName  (required unless `build` is supplied)
 * @param {string} [opts.sourceName]
 * @param {string} opts.env  test|main|preview|local (required)
 * @param {string} [opts.contractId]  Hedera ID "0.0.x"
 * @param {string} [opts.address]  0x EVM address (takes precedence over contractId)
 * @param {object} [opts.build]  pre-resolved { stdJsonInput, compilerVersion, contractIdentifier }
 *        — supply this to verify a non-Hardhat build without resolveBuildInfo.
 * @param {string} [opts.artifactsRoot]
 * @param {string} [opts.creationTransactionHash]
 * @param {string} [opts.apiUrl]
 * @param {string} [opts.browserUrl]
 * @param {boolean} [opts.skipIfVerified=true]
 * @param {number} [opts.initialDelayMs=0]  wait before first attempt (post-deploy indexing)
 * @param {number} [opts.attempts=1]  re-submit count for transient failures
 * @param {number} [opts.retryDelayMs=6000]
 * @param {number} [opts.pollIntervalMs=4000]
 * @param {number} [opts.maxPollAttempts=45]
 * @param {boolean} [opts.quiet=false]
 * @returns {Promise<object>} result object (see makeResult)
 */
async function verifyContract(opts = {}) {
	const {
		contractName,
		sourceName,
		env,
		contractId,
		address,
		build: providedBuild,
		artifactsRoot,
		creationTransactionHash,
		apiUrl = DEFAULT_API_URL,
		browserUrl = DEFAULT_BROWSER_URL,
		skipIfVerified = true,
		initialDelayMs = 0,
		attempts = 1,
		retryDelayMs = 6000,
		pollIntervalMs = 4000,
		maxPollAttempts = 45,
		quiet = false,
	} = opts;

	const log = quiet ? () => {} : (...a) => console.log(...a);

	if (!env) throw new Error('verifyContract: env is required');
	if (!contractName && !providedBuild) throw new Error('verifyContract: contractName (or a pre-resolved build) is required');

	const chainId = chainIdForEnv(env);

	let build, resolvedAddress;
	try {
		build = providedBuild || resolveBuildInfo({ contractName, sourceName, artifactsRoot });
		resolvedAddress = await resolveEvmAddress({ env, address, contractId });
	}
	catch (e) {
		return makeResult({
			contractName: contractName || (providedBuild && providedBuild.contractIdentifier),
			contractIdentifier: (providedBuild && providedBuild.contractIdentifier) || (sourceName ? `${sourceName}:${contractName}` : contractName),
			address: address || contractId || '?', chainId, env, browserUrl,
			status: 'error', message: e.message, raw: null,
		});
	}

	const displayName = contractName || build.contractIdentifier;
	log(`\n[verify] ${build.contractIdentifier}`);
	log(`         chain ${chainId} (${env}) @ ${resolvedAddress}`);
	log(`         solc  ${build.compilerVersion}`);

	if (initialDelayMs > 0) {
		log(`         waiting ${initialDelayMs}ms for the contract to be indexed...`);
		await sleep(initialDelayMs);
	}

	if (skipIfVerified) {
		const existing = await checkVerified({ apiUrl, chainId, address: resolvedAddress });
		if (existing) {
			log(`         already verified (${existing.match || existing.runtimeMatch || 'match'}) — skipping`);
			return makeResult({
				contractName: displayName, contractIdentifier: build.contractIdentifier, address: resolvedAddress, chainId, env, browserUrl,
				status: 'already_verified',
				match: existing.match, creationMatch: existing.creationMatch, runtimeMatch: existing.runtimeMatch,
				message: 'already verified', raw: existing,
			});
		}
	}

	let result;
	for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
		log(`         submitting${attempts > 1 ? ` (attempt ${attempt}/${attempts})` : ''}...`);
		try {
			result = await submitAndPoll({
				apiUrl, browserUrl, chainId, address: resolvedAddress, env, contractName: displayName, build,
				creationTransactionHash, pollIntervalMs, maxPollAttempts,
			});
		}
		catch (e) {
			result = makeResult({
				contractName: displayName, contractIdentifier: build.contractIdentifier, address: resolvedAddress, chainId, env, browserUrl,
				status: 'error', message: e.message, raw: null,
			});
		}

		if (result.status === 'verified' || result.status === 'already_verified') break;

		const transient = TRANSIENT_RE.test(result.message || '');
		if (attempt < attempts && transient) {
			log(`         transient failure ("${result.message}") — retrying in ${retryDelayMs}ms`);
			await sleep(retryDelayMs);
			continue;
		}
		break;
	}

	const tag = {
		verified: '✅ verified',
		already_verified: '✅ already verified',
		pending: '⏳ pending (submitted, still processing)',
		failed: '❌ failed',
		error: '⚠️  error',
	}[result.status] || result.status;
	log(`         ${tag}${result.match ? ` (${result.match})` : ''}${result.message && result.status !== 'verified' ? ` — ${result.message}` : ''}`);
	if (result.repoUrl) log(`         ${result.repoUrl}`);

	return result;
}

/**
 * Verify many contracts and return all results. Sequential by default — the
 * Sourcify server recompiles each submission, so parallelism only risks rate
 * limits with no real speedup.
 * @param {object[]} targets  array of verifyContract opts
 * @param {object} [shared]   options merged into every target
 * @returns {Promise<object[]>}
 */
async function verifyContracts(targets, shared = {}) {
	const results = [];
	for (const t of targets) {
		results.push(await verifyContract({ ...shared, ...t }));
	}
	return results;
}

module.exports = { verifyContract, verifyContracts, checkVerified };
