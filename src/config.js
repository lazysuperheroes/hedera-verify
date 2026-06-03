'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Load a per-repo verify config. Resolution order:
 *   1. <cwd>/verify.config.js   (module.exports = { ... })
 *   2. <cwd>/package.json "hederaVerify" key
 *   3. null  (caller falls back to ad-hoc CLI targets)
 *
 * Config shape:
 *   {
 *     env?: string,            // overrides ENVIRONMENT
 *     apiUrl?: string,
 *     browserUrl?: string,
 *     artifactsRoot?: string,
 *     registry: [ { contractName, envVars: string[], sourceName? } ]
 *   }
 * @param {string} [cwd]
 * @returns {object|null}
 */
function loadConfig(cwd = process.cwd()) {
	const jsPath = path.join(cwd, 'verify.config.js');
	if (fs.existsSync(jsPath)) {
		// eslint-disable-next-line global-require, import/no-dynamic-require
		return require(jsPath);
	}
	const pkgPath = path.join(cwd, 'package.json');
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
			if (pkg.hederaVerify) return pkg.hederaVerify;
		}
		catch (_e) { /* ignore malformed package.json */ }
	}
	return null;
}

/**
 * Turn a config registry into verifyContract targets, resolving each contract's
 * deployed ID from the first present env var.
 * @param {Array} registry  [{ contractName, envVars, sourceName? }]
 * @returns {{ targets: object[], skipped: {contractName: string, reason: string}[] }}
 */
function buildRegistryTargets(registry = [], { only } = {}) {
	const filter = only ? new Set(only.split(',').map(s => s.trim())) : null;
	const targets = [];
	const skipped = [];
	for (const entry of registry) {
		if (filter && !filter.has(entry.contractName)) continue;
		const envVars = entry.envVars || [];
		const hit = envVars.find(v => process.env[v]);
		if (!hit) {
			skipped.push({ contractName: entry.contractName, reason: `no .env id (${envVars.join(' / ') || 'no envVars configured'})` });
			continue;
		}
		targets.push({
			contractName: entry.contractName,
			sourceName: entry.sourceName,
			contractId: process.env[hit],
			_via: hit,
		});
	}
	return { targets, skipped };
}

/**
 * Parse an ad-hoc CLI target token: "Name=0.0.x" or "Name=0xabc[:contracts/Foo.sol]".
 */
function parseAdHocTarget(token) {
	const eq = token.indexOf('=');
	if (eq === -1) throw new Error(`Bad target '${token}' — expected Name=<id|addr>[:sourceName]`);
	const contractName = token.slice(0, eq);
	let value = token.slice(eq + 1);
	let sourceName;
	const colon = value.indexOf(':');
	if (colon !== -1) {
		sourceName = value.slice(colon + 1);
		value = value.slice(0, colon);
	}
	const isAddress = /^0x[0-9a-fA-F]{40}$/.test(value);
	return {
		contractName,
		sourceName,
		address: isAddress ? value : undefined,
		contractId: isAddress ? undefined : value,
	};
}

module.exports = { loadConfig, buildRegistryTargets, parseAdHocTarget };
