#!/usr/bin/env node
'use strict';

/**
 * hedera-verify — CLI for verifying Hedera contracts on Sourcify.
 *
 *   hedera-verify <Name> <0.0.x | 0xaddr> [opts]   verify a single contract
 *   hedera-verify harness [Name=id ...] [opts]      verify the config registry (+ ad-hoc)
 *   hedera-verify list                              show the config registry + env presence
 *   hedera-verify list-artifacts                    list every compiled contract
 *   hedera-verify help
 *
 * Options:
 *   --env <env>           override ENVIRONMENT (test|main|preview|local)
 *   --source <path>       source file when it differs from the contract name
 *   --creation-tx <hash>  creation tx hash (optional, improves match grade)
 *   --no-skip             re-submit even if already verified
 *   --api <url>           override Sourcify server URL
 *   --browser <url>       override Sourcify repo browser URL
 *   --artifacts <dir>     override artifacts root (default <cwd>/artifacts)
 *   --config <path>       explicit verify.config.js path
 *   --only <CSV>          (harness) restrict registry to these contract names
 *   --targets <file>      (harness) JSON array of verifyContract opts to append
 *   --poll-attempts <n>   max status polls per contract (default 45)
 *   --poll-interval <ms>  delay between polls (default 4000)
 *
 * Reads .env from the current directory. No private key needed — verification
 * is read-only (mirror node + Sourcify).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
	verifyContract,
	verifyContracts,
	listArtifacts,
	loadConfig,
	buildRegistryTargets,
	parseAdHocTarget,
} = require('../src/index');

function parseArgs(argv) {
	const positional = [];
	const flags = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--no-skip') flags.noSkip = true;
		else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
		else positional.push(a);
	}
	return { positional, flags };
}

function sharedOpts(flags, cfg) {
	return {
		apiUrl: flags.api || (cfg && cfg.apiUrl),
		browserUrl: flags.browser || (cfg && cfg.browserUrl),
		artifactsRoot: flags.artifacts || (cfg && cfg.artifactsRoot),
		skipIfVerified: !flags.noSkip,
		maxPollAttempts: flags['poll-attempts'] ? Number(flags['poll-attempts']) : undefined,
		pollIntervalMs: flags['poll-interval'] ? Number(flags['poll-interval']) : undefined,
	};
}

function resolveEnv(flags, cfg) {
	const env = flags.env || (cfg && cfg.env) || process.env.ENVIRONMENT;
	if (!env) {
		console.error('ERROR: ENVIRONMENT not set in .env, config, or --env (test|main|preview|local)');
		process.exit(1);
	}
	return env;
}

function pad(s, n) {
	s = String(s == null ? '' : s);
	return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printMatrix(results, skipped = []) {
	const cols = { name: 24, addr: 44, status: 18, match: 12 };
	const line = '='.repeat(112);
	console.log('\n' + line);
	console.log('VERIFICATION MATRIX');
	console.log(line);
	console.log(pad('Contract', cols.name) + pad('Address', cols.addr) + pad('Status', cols.status) + pad('Match', cols.match) + 'Note');
	console.log('-'.repeat(112));
	for (const r of results) {
		const ok = r.status === 'verified' || r.status === 'already_verified';
		const note = ok ? (r.repoUrl || '') : (r.message || '');
		console.log(pad(r.contractName, cols.name) + pad(r.address, cols.addr) + pad(r.status, cols.status) + pad(r.match || '-', cols.match) + note);
	}
	for (const s of skipped) {
		console.log(pad(s.contractName, cols.name) + pad('-', cols.addr) + pad('skipped', cols.status) + pad('-', cols.match) + s.reason);
	}
	console.log(line);
	const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
	const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
	console.log(`Summary: ${summary || 'nothing attempted'}${skipped.length ? `, ${skipped.length} skipped` : ''}\n`);
}

function usage() {
	console.log(fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8').split('## API')[0]);
}

async function runSingle(positional, flags) {
	if (positional.length < 2) {
		console.error('Usage: hedera-verify <ContractName> <0.0.x | 0xaddr> [options]\n       (or: hedera-verify harness | list | list-artifacts | help)');
		process.exit(1);
	}
	const cfg = flags.config ? require(path.resolve(flags.config)) : loadConfig();
	const env = resolveEnv(flags, cfg);
	const [contractName, target] = positional;
	const isAddress = /^0x[0-9a-fA-F]{40}$/.test(target);

	const result = await verifyContract({
		contractName,
		sourceName: flags.source,
		env,
		address: isAddress ? target : undefined,
		contractId: isAddress ? undefined : target,
		creationTransactionHash: flags['creation-tx'],
		...sharedOpts(flags, cfg),
	});

	const ok = result.status === 'verified' || result.status === 'already_verified';
	process.exit(ok ? 0 : 1);
}

async function runHarness(positional, flags) {
	const cfg = flags.config ? require(path.resolve(flags.config)) : loadConfig();
	const env = resolveEnv(flags, cfg);

	let targets = [];
	let skipped = [];
	if (cfg && Array.isArray(cfg.registry)) {
		({ targets, skipped } = buildRegistryTargets(cfg.registry, { only: flags.only }));
	}
	else if (flags.only) {
		console.error('WARN: --only given but no verify.config.js registry found; ignoring.');
	}

	for (const token of positional) targets.push(parseAdHocTarget(token));

	if (flags.targets) {
		const extra = JSON.parse(fs.readFileSync(flags.targets, 'utf8'));
		if (!Array.isArray(extra)) throw new Error('--targets file must contain a JSON array');
		targets.push(...extra);
	}

	if (targets.length === 0) {
		console.log('Nothing to verify. Add a verify.config.js registry, pass Name=id args, or use --targets.');
		printMatrix([], skipped);
		process.exit(0);
	}

	console.log(`Verifying ${targets.length} contract(s) on '${env}' via Sourcify...`);
	const results = await verifyContracts(targets, { env, ...sharedOpts(flags, cfg) });
	printMatrix(results, skipped);

	const bad = results.some(r => r.status === 'failed' || r.status === 'error');
	process.exit(bad ? 1 : 0);
}

function runList(flags) {
	const cfg = flags.config ? require(path.resolve(flags.config)) : loadConfig();
	if (!cfg || !Array.isArray(cfg.registry)) {
		console.log('No verify.config.js (or package.json "hederaVerify") registry found.');
		console.log('Create one — see verify.config.example.js in this package.');
		process.exit(0);
	}
	console.log('\nConfigured registry (contract -> .env id var; ✓ = currently set):');
	for (const e of cfg.registry) {
		const hit = (e.envVars || []).find(v => process.env[v]);
		const mark = hit ? `✓ ${hit}=${process.env[hit]}` : `· (${(e.envVars || []).join(' / ') || 'no envVars'})`;
		console.log(`  ${pad(e.contractName, 26)} ${mark}${e.sourceName ? `   [${e.sourceName}]` : ''}`);
	}
	console.log('');
	process.exit(0);
}

function runListArtifacts(flags) {
	const arts = listArtifacts(flags.artifacts);
	if (arts.length === 0) {
		console.log('No compiled artifacts found. Run your build (e.g. npx hardhat compile) first.');
		process.exit(0);
	}
	console.log(`\n${arts.length} compiled contract(s):`);
	for (const a of arts) console.log(`  ${pad(a.contractName, 30)} ${a.sourceName}`);
	console.log('');
	process.exit(0);
}

async function main() {
	const { positional, flags } = parseArgs(process.argv.slice(2));
	const sub = positional[0];

	if (!sub || sub === 'help' || flags.help || flags.h) { usage(); process.exit(sub ? 0 : 1); }
	if (sub === 'harness') return runHarness(positional.slice(1), flags);
	if (sub === 'list') return runList(flags);
	if (sub === 'list-artifacts') return runListArtifacts(flags);
	return runSingle(positional, flags);
}

main().catch((err) => {
	console.error('\n❌ hedera-verify crashed:', err.message || err);
	process.exit(1);
});
