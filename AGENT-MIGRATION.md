# Agent migration prompt — add Hedera Sourcify verification to a repo

**How to use this (human):** Open the target repo in your AI coding agent (e.g. Claude Code) and paste everything in the fenced block below as your prompt. The agent will install `@lazysuperheroes/hedera-verify`, wire it into *that* repo's conventions, and run a verification pass. It makes outward-facing calls to the public Sourcify (which publishes your already-deployed source) — that's the goal of verification, but only run it on contracts you intend to verify publicly.

The package already carries the engine, CLI, and the Sourcify/Hedera facts — so the agent's job is just **integration**, not re-deriving how verification works.

---

```
You are adding Hedera smart-contract verification to THIS repository using the
published package `@lazysuperheroes/hedera-verify`. Do NOT re-implement a
Sourcify client — the package already does verification. Your job is to install
it and wire it into this repo's specific conventions, then prove it works.

BACKGROUND (treat as ground truth):
- Hedera contract verification now goes to the public Sourcify (sourcify.dev),
  which natively supports Hedera mainnet (chainId 295) and testnet (296).
  Sourcify's V1 API is retired; the package uses the V2 job API. HashScan reads
  from Sourcify, so a Sourcify-verified contract shows as verified on HashScan.
- The package reads Hardhat build-info (artifacts/build-info via each contract's
  .dbg.json) — no source flattening. It resolves a contract's EVM address from
  the Hedera mirror node, so it works for both SDK/HAPI-deployed contracts
  (long-zero address) and CREATE2 clones (aliased address).
- Verification is READ-ONLY: no private key, no gas, no signing.

STEP 0 — Detect the build system.
- If this is a FOUNDRY repo (foundry.toml, no Hardhat artifacts): do NOT install
  the package. Instead document/run the forge path for each contract:
    forge verify-contract --chain-id <295|296> --verifier sourcify \
      --verifier-url https://sourcify.dev/server <0xADDRESS> src/X.sol:X
  Then stop after reporting. The rest of these steps are for Hardhat repos.
- If HARDHAT (hardhat.config.js/ts): continue.

STEP 1 — Install.
  Add `@lazysuperheroes/hedera-verify` as a dev dependency using whatever package
  manager the repo uses (yarn if yarn.lock present, else npm). Ensure the repo
  has compiled artifacts (run the project's compile, e.g. `npx hardhat compile`,
  if artifacts/ is missing).

STEP 2 — Build verify.config.js.
  Inspect this repo to learn how contracts and their deployed IDs are named:
    - Read the deploy scripts (look for ContractCreateFlow / contractDeployFunction
      / ethers deploy) to find every deployable contract and its source file.
    - Read .env / .env.example for the variable names that hold deployed contract
      IDs (commonly *_CONTRACT_ID). Note any legacy/alias names too.
    - Run `npx hedera-verify list-artifacts` to confirm contract names + sourceName.
  Then create `verify.config.js` in the repo root:
    module.exports = {
      registry: [
        { contractName: '<Name>', envVars: ['<PRIMARY_ID_VAR>', '<legacy alias>'] },
        // add sourceName: 'contracts/<sub>/<File>.sol' only when the source path
        // is NOT contracts/<ContractName>.sol
      ],
    };
  Include every production contract. Skip pure test/mock contracts unless asked.

STEP 3 — Wire the deploy-time hook (opt-in).
  In each deploy script, right AFTER a contract is created, add an opt-in verify
  call gated on VERIFY_ON_DEPLOY. Use the real ContractId you get back — first
  confirm the deploy helper's return shape (e.g. if it returns
  [contractId, address], destructure it; do not call .toSolidityAddress() on an
  array). Pattern:
    const { verifyContract } = require('@lazysuperheroes/hedera-verify');
    ...
    if (process.env.VERIFY_ON_DEPLOY === 'true' || process.env.VERIFY_ON_DEPLOY === '1') {
      await verifyContract({
        contractName: '<Name>', env: process.env.ENVIRONMENT,
        contractId, initialDelayMs: 10000, attempts: 4, retryDelayMs: 8000,
      });
    }
  (TypeScript repos: use `import`.) Keep it opt-in — never verify unconditionally
  inside a deploy.

STEP 4 — Hardhat plugin fallback (optional, only if the repo wants `npx hardhat verify`).
  Add to hardhat.config: a `networks` block (testnet url https://testnet.hashio.io/api
  chainId 296; mainnet https://mainnet.hashio.io/api chainId 295 — no `accounts`
  needed) and `sourcify: { enabled: true, apiUrl: 'https://sourcify.dev/server',
  browserUrl: 'https://repo.sourcify.dev' }`. If @nomicfoundation/hardhat-verify
  is < 2.0 (toolbox v3 bundles 1.1.x), recommend bumping to ^2.0.0 and then add
  `etherscan: { enabled: false }`. Do NOT add `etherscan: { enabled: false }`
  under 1.1.x — it fails config validation. Verify the config still loads
  (`npx hardhat help verify`) so you don't break compile/test.

STEP 5 — Run a verification pass and report.
  Confirm with the human that publishing source to public Sourcify is intended,
  then run `npx hedera-verify harness` (ENVIRONMENT must be set in .env). Present
  the resulting matrix. Interpret statuses honestly:
    - verified / already_verified  -> success (exact_match is best; `match`/partial
      is still verified, difference is cosmetic metadata).
    - pending  -> submitted; the async job is still running on Sourcify. Re-run to
      confirm (the already-verified precheck will catch it), or raise
      --poll-attempts. NOT a failure.
    - failed (bytecode_length_mismatch / no match) -> the on-chain bytecode does
      not match current source — usually an old deployment compiled with different
      settings/version. Flag it; it is a real mismatch, not a tooling bug.
    - error -> config/network problem; read the message.

CONSTRAINTS:
- Match the repo's existing code style, module system (CJS vs ESM), and lint rules.
- Don't introduce new deps beyond the package. Don't change deploy logic except
  the minimal hook (+ any deploy-helper return-shape fix the hook depends on).
- Keep all changes scoped to verification. Summarise what you changed and the
  verification matrix at the end.
```

---

## After the agent runs

- Commit `verify.config.js`, the deploy-script hook, and any `hardhat.config` additions.
- Verified contracts appear at `https://repo.sourcify.dev/<chainId>/<address>` and as verified on HashScan.
- Re-run `npx hedera-verify harness` any time; already-verified contracts short-circuit instantly.
