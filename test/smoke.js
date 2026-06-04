'use strict';

/**
 * Offline smoke test — no network, no artifacts required. Validates that the
 * public API loads and the pure helpers behave. Run: `node test/smoke.js`.
 */

const assert = require('assert');
const api = require('../src/index');
const { parseAdHocTarget } = require('../src/config');

let failures = 0;
function check(name, fn) {
	try {
		fn();
		console.log(`  ok  ${name}`);
	}
	catch (e) {
		failures++;
		console.log(`  ERR ${name}: ${e.message}`);
	}
}

console.log('hedera-verify smoke test');

check('exports present', () => {
	for (const k of ['verifyContract', 'verifyContracts', 'resolveBuildInfo', 'resolveEvmAddress', 'chainIdForEnv', 'listArtifacts', 'loadConfig']) {
		assert.strictEqual(typeof api[k], 'function', `${k} should be a function`);
	}
});

check('chainIdForEnv maps Hedera networks', () => {
	assert.strictEqual(api.chainIdForEnv('test'), 296);
	assert.strictEqual(api.chainIdForEnv('testnet'), 296);
	assert.strictEqual(api.chainIdForEnv('main'), 295);
	assert.strictEqual(api.chainIdForEnv('preview'), 297);
	assert.strictEqual(api.chainIdForEnv('local'), 298);
});

check('chainIdForEnv rejects unknown env', () => {
	assert.throws(() => api.chainIdForEnv('mars'));
});

check('hashscanNetwork slug', () => {
	assert.strictEqual(api.hashscanNetwork('main'), 'mainnet');
	assert.strictEqual(api.hashscanNetwork('test'), 'testnet');
});

check('resolveEvmAddress normalises a 0x address', async () => {
	const a = await api.resolveEvmAddress({ address: '0x00000000000000000000000000000000008A48C9' });
	assert.strictEqual(a, '0x00000000000000000000000000000000008a48c9');
});

check('resolveEvmAddress rejects a bad address', () => {
	assert.rejects(() => api.resolveEvmAddress({ address: '0xnothex' }));
});

check('parseAdHocTarget id form', () => {
	const t = parseAdHocTarget('Foo=0.0.1234');
	assert.strictEqual(t.contractName, 'Foo');
	assert.strictEqual(t.contractId, '0.0.1234');
	assert.strictEqual(t.address, undefined);
});

check('parseAdHocTarget address + sourceName form', () => {
	const t = parseAdHocTarget('Foo=0x00000000000000000000000000000000008a48c9:contracts/legacy/Foo.sol');
	assert.strictEqual(t.contractName, 'Foo');
	assert.strictEqual(t.address, '0x00000000000000000000000000000000008a48c9');
	assert.strictEqual(t.sourceName, 'contracts/legacy/Foo.sol');
});

const IMPL = '0x00000000000000000000000000000000008a48c2';
const PROXY = '0x363d3d373d3d3d363d7300000000000000000000000000000000008a48c25af43d82803e903d91602b57fd5bf3';

check('minimalProxyRuntime builds the canonical EIP-1167 runtime', () => {
	assert.strictEqual(api.minimalProxyRuntime(IMPL), PROXY);
});

check('parseMinimalProxyImplementation extracts the impl', () => {
	assert.strictEqual(api.parseMinimalProxyImplementation(PROXY), IMPL);
	assert.strictEqual(api.parseMinimalProxyImplementation('0xdeadbeef'), null);
});

check('isMinimalProxyFor matches only the right impl', () => {
	assert.strictEqual(api.isMinimalProxyFor(PROXY, IMPL), true);
	assert.strictEqual(api.isMinimalProxyFor(PROXY, '0x0000000000000000000000000000000000000001'), false);
});

if (failures) {
	console.log(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nall checks passed');
