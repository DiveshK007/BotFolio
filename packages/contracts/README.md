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

## Asset index
The `uint8 asset` in every contract, event and order (`QieFeeds.Asset`). It is the same as `ASSETS[].index` in `packages/shared/src/assets.ts`.

| Index | Asset | Feed | `description()` | Decimals | Max age |
|---:|---|---|---|---:|---:|
| 0 | BTC | `0x9E596d809a20A272c788726f592c0d1629755440` | BTC / USDT | 8 | 1800 s |
| 1 | ETH | `0x4bb7012Fbc79fE4Ae9B664228977b442b385500d` | ETH / USDT | 8 | 1800 s |
| 2 | SOL | `0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21` | SOL / USDT | 8 | 1800 s |
| 3 | XRP | `0x804582B1f8Fea73919e7c737115009f668f97528` | XRP / USDT | 8 | 1800 s |
| 4 | GOLD | `0x9aD0199a67588ee293187d26bA1BE61cb07A214c` | Gold / USD | 8 | 21600 s |

Confirmed Nov 22 2026 with `cast call <feed> "description()(string)"` and `decimals()` on rpc3 (block 12,091,128) and rpc4 (block 12,091,130). The table in SPEC §0.2 lists XRP before SOL, but that is only its row order: the index comes from the enum in §4.3, where **SOL is 2 and XRP is 3**. `test/AssetIndex.fork.t.sol` checks the contracts, `assets.ts` and the live feeds against each other.

## Deploy
`script/Deploy.s.sol` deploys the 7 contracts in this order and wires them: Forwarder, PaperLedger, BotRegistry, SeasonLedger, TrustScoreRegistry, DailyCall, Challenges. It refuses any chain but 1990 and never reads a private key.

| Env | What |
|---|---|
| `ADMIN_ADDRESS` | cold key. Gets `DEFAULT_ADMIN_ROLE` on every contract. If the deployer is a different address, the deployer renounces at the end |
| `RUNNER_ADDRESS` | `RUNNER_ROLE` on PaperLedger and DailyCall |
| `COMMITTER_ADDRESS` | `COMMITTER_ROLE` on SeasonLedger, TrustScoreRegistry, DailyCall and Challenges |
| `RELAYER_ADDRESS` | gets **no** role. Passed so the script can prove it |
| `START_CASH_E8` | optional, default `107800000000` |

The four addresses must differ, and the deployer can't be one of the three hot wallets.

```bash
# simulate: no key, nothing sent
ADMIN_ADDRESS=0x... RUNNER_ADDRESS=0x... COMMITTER_ADDRESS=0x... RELAYER_ADDRESS=0x... \
  forge script script/Deploy.s.sol --fork-url qie
```
Or `script/dry-run.sh`: the same simulation with throwaway addresses and RPC failover. It takes no arguments, so a `--broadcast` can't slip in.

A real deploy is issue #25, run by a person with the signer on the command line.

Contract-to-contract roles: PaperLedger grants `REGISTRY_ROLE` to BotRegistry, and BotRegistry grants `SEASON_LEDGER_ROLE` to SeasonLedger. The two contracts know each other through immutables. The ledger is given the registry's CREATE address before the registry exists, and the script checks that it matched.

**Start cash:** 1,078 play USDT per bot, about INR 1,00,000. USD/INR was 92.68 (frankfurter.dev, Nov 20 2026) and 92.89 (open.er-api.com, Nov 22 2026). Recheck on deploy day; it can't change after the deploy. The display is a ratio (SPEC §3), so it shows exactly INR 1,00,000 at the start either way.

## Admin scripts
`script/Admin.s.sol` has three. None reads a private key. The commands below only simulate (`--sender` stands in for the signer). A person does the real run by adding their signer and `--broadcast`.

**Open a season** (committer). `SEASON` must be `SeasonLedger.nextSeason()`. Times are unix seconds. S0 is Nov 24 00:00 to Nov 25 21:00 IST (SPEC §1):
```bash
SEASON_LEDGER_ADDRESS=0x... SEASON=0 SEASON_START=1795458600 SEASON_END=1795620600 \
  forge script script/Admin.s.sol:OpenSeason --fork-url qie --sender $COMMITTER_ADDRESS
```

**Close a season** (committer). This can't be undone, so the script refuses before the season's end, and refuses an empty root or URI:
```bash
SEASON_LEDGER_ADDRESS=0x... SEASON=0 DATA_ROOT=0x... DATA_URI=https://.../season-0.jsonl \
  forge script script/Admin.s.sol:CloseSeason --fork-url qie --sender $COMMITTER_ADDRESS
```
The worker normally closes seasons. This is the manual fallback.

**Publish trust rules** (admin cold key). Run once for `trust-v1-sprint` and once for `trust-v1`. A version can never be edited, so publish only the final doc:
```bash
# keccak256 of the exact bytes behind RULES_URI
RULES_DOC_HASH=$(cast keccak "0x$(xxd -p trust-rules.md | tr -d '\n')")

TRUST_REGISTRY_ADDRESS=0x... RULES_VERSION=trust-v1-sprint RULES_URI=https://... RULES_DOC_HASH=$RULES_DOC_HASH \
  forge script script/Admin.s.sol:PublishRules --fork-url qie --sender $ADMIN_ADDRESS
```

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
