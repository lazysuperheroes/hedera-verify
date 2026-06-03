'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Default artifacts root: the CONSUMING repo's ./artifacts (the package is run
 * from the repo root via the CLI or required by repo scripts). Override via the
 * `artifactsRoot` option or HEDERA_VERIFY_ARTIFACTS env var.
 */
function defaultArtifactsRoot() {
	return process.env.HEDERA_VERIFY_ARTIFACTS || path.join(process.cwd(), 'artifacts');
}

/**
 * Recursively find a contract's `.dbg.json` under <artifactsRoot>/contracts.
 * Hardhat names the artifact folder after the SOURCE file and the json after
 * the CONTRACT, so `<ContractName>.dbg.json` is unique per (file, contract).
 * @returns {string[]} absolute paths of every match
 */
function findDbgFiles(root, contractName) {
	const target = `${contractName}.dbg.json`;
	const matches = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		}
		catch (_e) {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name === target) matches.push(full);
		}
	};
	// Only the project's own sources need verifying — skip node_modules deps
	// pulled into artifacts/@openzeppelin etc.
	walk(path.join(root, 'contracts'));
	return matches;
}

/**
 * List every compiled contract under <artifactsRoot>/contracts as
 * { contractName, sourceName }. Handy for building a verify.config registry.
 * @param {string} [artifactsRoot]
 * @returns {{contractName: string, sourceName: string}[]}
 */
function listArtifacts(artifactsRoot = defaultArtifactsRoot()) {
	const out = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		}
		catch (_e) {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith('.dbg.json')) {
				const contractName = entry.name.slice(0, -'.dbg.json'.length);
				const sourceName = path.relative(artifactsRoot, path.dirname(full)).split(path.sep).join('/');
				out.push({ contractName, sourceName });
			}
		}
	};
	walk(path.join(artifactsRoot, 'contracts'));
	return out;
}

/**
 * Load the Standard JSON input + long compiler version for a contract, ready to
 * POST to Sourcify. Everything comes from the Hardhat build-info file, located
 * via the contract's `.dbg.json` pointer (there can be several build-info files
 * from separate compile jobs — the dbg pointer disambiguates).
 *
 * @param {object} opts
 * @param {string} opts.contractName  e.g. "LazySecureTrade"
 * @param {string} [opts.sourceName]  e.g. "contracts/legacy/Foo.sol" — set to
 *        disambiguate if the same contract name exists in two files.
 * @param {string} [opts.artifactsRoot]
 * @returns {{ stdJsonInput: object, compilerVersion: string, contractIdentifier: string, sourceName: string }}
 */
function resolveBuildInfo({ contractName, sourceName, artifactsRoot = defaultArtifactsRoot() } = {}) {
	if (!contractName) throw new Error('resolveBuildInfo: contractName is required');

	let dbgPath;
	if (sourceName) {
		dbgPath = path.join(artifactsRoot, sourceName, `${contractName}.dbg.json`);
		if (!fs.existsSync(dbgPath)) {
			throw new Error(`No artifact for ${sourceName}:${contractName} at ${dbgPath} — compile first (npx hardhat compile)`);
		}
	}
	else {
		const found = findDbgFiles(artifactsRoot, contractName);
		if (found.length === 0) {
			throw new Error(`No compiled artifact for contract '${contractName}' under ${artifactsRoot}/contracts — compile first, or pass sourceName`);
		}
		if (found.length > 1) {
			const rels = found.map(f => path.relative(artifactsRoot, f));
			throw new Error(`Contract name '${contractName}' is ambiguous (${found.length} matches): ${rels.join(', ')} — pass sourceName to disambiguate`);
		}
		dbgPath = found[0];
		sourceName = path.relative(artifactsRoot, path.dirname(dbgPath)).split(path.sep).join('/');
	}

	const dbg = JSON.parse(fs.readFileSync(dbgPath, 'utf8'));
	const buildInfoPath = path.resolve(path.dirname(dbgPath), dbg.buildInfo);
	if (!fs.existsSync(buildInfoPath)) {
		throw new Error(`build-info referenced by ${dbgPath} not found at ${buildInfoPath} — recompile to regenerate`);
	}

	const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
	if (!buildInfo.input || !buildInfo.solcLongVersion) {
		throw new Error(`build-info at ${buildInfoPath} is missing input/solcLongVersion`);
	}

	return {
		stdJsonInput: buildInfo.input,
		compilerVersion: buildInfo.solcLongVersion,
		contractIdentifier: `${sourceName}:${contractName}`,
		sourceName,
	};
}

module.exports = { resolveBuildInfo, findDbgFiles, listArtifacts, defaultArtifactsRoot };
