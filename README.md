# @lazysuperheroes/hedera-verify

Verify Hedera smart contracts on **Sourcify** (`sourcify.dev`) — the engine, CLI, and deploy-time hook, in one small package you can drop into any Hardhat-based Hedera repo.

HashScan retired its self-hosted Sourcify and now points at the public Sourcify, which natively supports Hedera **mainnet (chain 295)** and **testnet (chain 296)**. Sourcify also retired its V1 `/verify` API — this package speaks the current **V2 job-based API**. Everything it needs is already in your Hardhat `build-info`, so there's no source flattening or metadata hand-assembly.

## Install

```bash
yarn add -D @lazysuperheroes/hedera-verify
# or: npm i -D @lazysuperheroes/hedera-verify
```

Requires Node ≥ 18. Reads `.env` from the current directory. **No private key needed** — verification is read-only (mirror node + Sourcify).

## Quick start (CLI)

```bash
# Verify one contract, by Hedera ID or EVM address:
npx hedera-verify LazySecureTrade 0.0.7540226
npx hedera-verify BidderContractFactory 0xabc...123

# Verify everything in your verify.config.js registry that has a deployed id in .env:
npx hedera-verify harness

# Plus ad-hoc targets and filters:
npx hedera-verify harness LazyRebatePool=0.0.123456 --only LazySecureTrade,LazyGasStation

# Inspect:
npx hedera-verify list             # config registry + which .env ids are set
npx hedera-verify list-artifacts   # every compiled contract (to build your config)
```

`ENVIRONMENT` (from `.env`, e.g. `test`/`main`) selects the chain; override with `--env`.

## Config

Copy [`verify.config.example.js`](./verify.config.example.js) to `verify.config.js` in your repo root and map each contract to the `.env` var(s) holding its deployed Hedera ID:

```js
module.exports = {
  registry: [
    { contractName: 'MyContract', envVars: ['MY_CONTRACT_ID'] },
    { contractName: 'Legacy', envVars: ['LEGACY_ID'], sourceName: 'contracts/legacy/Legacy.sol' },
  ],
};
```

Run `npx hedera-verify list-artifacts` to see every compiled contract and its `sourceName`. A `"hederaVerify"` key in `package.json` works as an alternative to the file.

## Deploy-time hook (runtime verification)

Call the engine straight from your deploy script, right after the contract is created. The wait + retry covers the few seconds the mirror node / Sourcify's RPC need to index a fresh contract:

```js
const { verifyContract } = require('@lazysuperheroes/hedera-verify');

const [contractId] = await contractDeployFunction(client, bytecode, gas, params);

if (process.env.VERIFY_ON_DEPLOY === 'true') {
  await verifyContract({
    contractName: 'MyContract',
    env: process.env.ENVIRONMENT,
    contractId,            // Hedera ID or { address: '0x..' }
    initialDelayMs: 10000, // let the network index it
    attempts: 4,           // re-submit on transient "not yet indexed" failures
  });
}
```

## Hardhat plugin fallback

For a manual `npx hardhat verify`, add a `sourcify` block and Hedera `networks` to `hardhat.config.js`:

```js
networks: {
  testnet: { url: 'https://testnet.hashio.io/api', chainId: 296 },
  mainnet: { url: 'https://mainnet.hashio.io/api', chainId: 295 },
},
sourcify: { enabled: true, apiUrl: 'https://sourcify.dev/server', browserUrl: 'https://repo.sourcify.dev' },
// requires @nomicfoundation/hardhat-verify >= 2.0; then add: etherscan: { enabled: false }
```

This package's direct V2 path is the recommended route — the plugin is just a convenience fallback. Older `hardhat-verify@1.1.x` (bundled by hardhat-toolbox v3) only registers an Etherscan-oriented task and has no clean Hedera Sourcify path; bump to `^2.0.0`.

## Foundry repos

This package reads Hardhat build-info. For a Foundry project, verify directly with forge:

```bash
forge verify-contract --chain-id 296 \
  --verifier sourcify --verifier-url https://sourcify.dev/server \
  <0xADDRESS> src/MyContract.sol:MyContract
```

## API

```js
const v = require('@lazysuperheroes/hedera-verify');
```

### `verifyContract(opts) → Promise<Result>`
Verify one contract. Key options:
- `contractName` *(string, required unless `build` is given)*
- `env` *(string, required)* — `test|main|preview|local`
- `contractId` *(string)* — Hedera `0.0.x`, resolved to its EVM address via the mirror node
- `address` *(string)* — `0x…` EVM address (takes precedence over `contractId`)
- `sourceName` *(string)* — disambiguate when the source path ≠ `contracts/<Name>.sol`
- `build` *(object)* — pre-resolved `{ stdJsonInput, compilerVersion, contractIdentifier }` to verify a non-Hardhat build
- `creationTransactionHash` *(string)* — optional, improves match grade
- `skipIfVerified` *(bool, default true)*, `initialDelayMs`, `attempts`, `retryDelayMs`, `pollIntervalMs` *(4000)*, `maxPollAttempts` *(45)*, `apiUrl`, `browserUrl`, `artifactsRoot`, `quiet`

**Result**: `{ contractName, contractIdentifier, address, chainId, env, status, match, creationMatch, runtimeMatch, repoUrl, hashscanUrl, message, raw }`.

`status` ∈ `verified | already_verified | pending | failed | error`. `match` ∈ `exact_match | match | null`.

### `verifyContracts(targets, shared) → Promise<Result[]>`
Verify many (sequential). Each target is a `verifyContract` opts object; `shared` is merged into all.

### Helpers
`resolveBuildInfo({contractName, sourceName?, artifactsRoot?})`, `listArtifacts(artifactsRoot?)`, `resolveEvmAddress({env, address?, contractId?})`, `getContractEvmAddress(env, id)`, `checkVerified({apiUrl?, chainId, address})`, `chainIdForEnv(env)`, `hashscanNetwork(env)`, `loadConfig(cwd?)`, `buildRegistryTargets(registry, {only?})`, `parseAdHocTarget(token)`.

## Match grades

- **`exact_match`** — full match including metadata. The strongest grade.
- **`match`** (partial) — runtime bytecode matches and source is fully shown, but the embedded metadata hash differs (e.g. the contract compiled in a separate build-info unit). Still verified; the difference is cosmetic.

## Gotchas

- **Async jobs.** Big `viaIR` contracts can take longer than the default poll window. A local poll timeout returns `pending` — the job keeps running on Sourcify, and a re-run's already-verified precheck will confirm it. Raise `--poll-attempts` if you want a single pass to wait longer.
- **Right after deploy**, the mirror node needs a few seconds to index a new contract. Use `initialDelayMs` + `attempts` in the deploy hook.
- **Legacy / old deployments** compiled with different settings than current source will report `bytecode_length_mismatch` — that's a real "won't match", not a bug.

## Migrating an existing repo

See [`AGENT-MIGRATION.md`](./AGENT-MIGRATION.md) — a ready-to-paste prompt for an AI coding agent (e.g. Claude Code) that installs this package, builds the `verify.config.js` from your repo's deploy scripts/`.env`, wires the deploy-time hook, and runs the harness.

## License

ISC
