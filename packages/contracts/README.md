# packages/contracts — WS A (Chain)

Foundry project for BotFolio's 7 contracts (SPEC §4.9): `BotForwarder`, `BotRegistry`, `PaperLedger`, `SeasonLedger`, `TrustScoreRegistry`, `DailyCall`, `Challenges`.

## Setup
```bash
cd packages/contracts
git submodule update --init --recursive   # OZ pinned at v5.0.2 (5.6.x uses mcopy, SPEC §0.3) + forge-std; see foundry.lock
forge build
forge test --fork-url qie -vv
```

`forge test --fork-url qie` hits rpc3 (the `qie` endpoint). Local staging — Anvil on port 8545, deploy with `forge script`, apps pointed at that node — is [`docs/anvil-fork.md`](../../docs/anvil-fork.md). The `anvil` endpoint in `foundry.toml` is that node.

## Hard rules
- solc 0.8.24, `evm_version = "shanghai"` (set in `foundry.toml`). No `mcopy`, `tstore`/`tload`.
- Oracle feed addresses and max ages are fixed at deploy, no setters (SPEC §4.6). Addresses in `packages/shared/src/assets.ts`.
- After any interface change: export ABIs to `abi/` and update `events.md`, in one announced PR (frozen interface).

## ABIs
`abi/<Contract>.json` is generated from `src/interfaces/I<Contract>.sol` (the frozen surface), never edited by hand:
```bash
script/export-abi.sh   # needs jq
```
`test/AbiExport.t.sol` runs in CI and fails if a committed file differs from a fresh build.

Import from the other packages (`resolveJsonModule` is already on in `tsconfig.base.json`):
```ts
import BotRegistryAbi from "<path>/packages/contracts/abi/BotRegistry.json" with { type: "json" };
// viem: abi: BotRegistryAbi as Abi
```
