'use strict';

/**
 * hedera-verify config — copy to `verify.config.js` in your repo root and edit.
 *
 * The harness (`npx hedera-verify harness`) and `npx hedera-verify list` read
 * this. `registry` maps each contract to the .env var(s) that may hold its
 * deployed Hedera ID — the first present var wins. `sourceName` is only needed
 * when the source file path differs from `contracts/<ContractName>.sol`.
 *
 * `env` here is optional; if omitted, ENVIRONMENT from .env is used.
 *
 * Tip: run `npx hedera-verify list-artifacts` to see every compiled contract
 * (and its sourceName) to populate this list.
 */

module.exports = {
	// env: 'test',                       // optional — overrides ENVIRONMENT
	// apiUrl: 'https://sourcify.dev/server',
	// browserUrl: 'https://repo.sourcify.dev',
	// artifactsRoot: './artifacts',      // optional — defaults to <cwd>/artifacts

	registry: [
		// --- Example registry from the LazySecureTrade repo ---
		{ contractName: 'LazySecureTrade', envVars: ['LAZY_SECURE_TRADE_CONTRACT_ID', 'LST_CONTRACT_ID'] },
		{ contractName: 'BidderContractFactory', envVars: ['BIDDER_FACTORY_CONTRACT_ID'] },
		{ contractName: 'BidderContract', envVars: ['BIDDER_IMPL_CONTRACT_ID', 'BIDDER_CONTRACT_IMPL_ID'] },
		{ contractName: 'LazyGasStation', envVars: ['LAZY_GAS_STATION_CONTRACT_ID', 'LGS_CONTRACT_ID'] },
		{ contractName: 'LazyDelegateRegistry', envVars: ['LAZY_DELEGATE_REGISTRY_CONTRACT_ID', 'LDR_CONTRACT_ID'] },
		{
			contractName: 'LAZYTokenCreator',
			envVars: ['LAZY_SCT_CONTRACT_ID'],
			sourceName: 'contracts/legacy/LAZYTokenCreator.sol',
		},
	],
};
