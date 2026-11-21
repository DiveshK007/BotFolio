# Local mainnet-fork staging (Anvil)

Staging is a local fork of QIE mainnet. Testnet staging was dropped on Nov 20 ([decisions.md](decisions.md)): the testnet RPC is unreliable and the testnet feed addresses are unknown. Submissions still deploy to QIE mainnet (SPEC §13). This fork is for local testing.

Chain id is **1990** (`QIE_CHAIN_ID` in `.env.example`, SPEC §0.1). `foundry.toml` does not set a chain id. Pass `1990` to Anvil so `eth_chainId` and the EIP-712 domains match mainnet.

## Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

`foundryup` installs `forge`, `cast`, and `anvil`. `packages/contracts/foundry.toml` pins solc 0.8.24 and `evm_version = "shanghai"`. Forge downloads that compiler on the first build.

## Start the fork

The fork URL is the `qie` endpoint in `packages/contracts/foundry.toml`: `https://rpc3mainnet.qie.digital`. That is rpc3 inside `QIE_RPC_URLS` (`.env.example`). rpc1 and rpc2 drop TLS (SPEC §0.1). Anvil takes one URL. `QIE_RPC_URLS` is the comma-separated list the apps use on mainnet.

```bash
anvil --fork-url https://rpc3mainnet.qie.digital --chain-id 1990 --port 8545
```

Foundry calls this node `anvil` (`http://127.0.0.1:8545` in `foundry.toml`).

## Deploy the contracts onto the fork

From `packages/contracts`, broadcast the deploy script in `script/` (SPEC §16.1). That directory is empty until the deploy script lands. `DEPLOYER_PRIVATE_KEY` is local only (`.env.example`). Use the local fork key, separate from the mainnet deployer.

```bash
cd packages/contracts
forge script <deploy-script> --rpc-url anvil --broadcast --private-key "$DEPLOYER_PRIVATE_KEY"
```

Copy the addresses the script prints into the contract vars in the local env: `FORWARDER_ADDRESS`, `BOT_REGISTRY_ADDRESS`, `PAPER_LEDGER_ADDRESS`, `SEASON_LEDGER_ADDRESS`, `TRUST_REGISTRY_ADDRESS`, `DAILY_CALL_ADDRESS`, `CHALLENGES_ADDRESS`, and the matching `NEXT_PUBLIC_*_ADDRESS` values.

## Point the apps at the fork

In the local `.env` (worker) and `.env.local` (web), set the existing RPC var to the Anvil URL. Leave the chain id at 1990.

```bash
QIE_RPC_URLS=http://127.0.0.1:8545
QIE_CHAIN_ID=1990
NEXT_PUBLIC_QIE_CHAIN_ID=1990
```

The apps already read `QIE_RPC_URLS`. On mainnet that var is the five-RPC failover list. On this fork it is the single Anvil URL. `QIE_EXPLORER_URL` stays `https://mainnet.qie.digital` for real deploys. Transactions on the fork are local to Anvil.

## Fund test accounts

Anvil's default accounts start funded. The relayer, runner, and committer are separate local keys (`RELAYER_PRIVATE_KEY`, `RUNNER_PRIVATE_KEY`, `COMMITTER_PRIVATE_KEY`). Fund those addresses with `anvil_setBalance`. The amount is wei. QIE has 18 decimals (SPEC §0.1). `0x3635C9ADC5DEA00000` is 1000 × 10^18.

```bash
cast wallet address --private-key "$RELAYER_PRIVATE_KEY"
cast rpc anvil_setBalance <address> 0x3635C9ADC5DEA00000 --rpc-url http://127.0.0.1:8545
```

Repeat for the runner and committer keys, and for any user account that will sign a forwarded request. Use the local fork keys only.

## Tests against a fork

Contract tests that read the live feeds use the `qie` endpoint (rpc3), which is a Foundry fork of mainnet, separate from the Anvil process above:

```bash
cd packages/contracts
forge test --fork-url qie -vv
```

Gas numbers come from that same remote fork (SPEC §4.10). The Anvil node on port 8545 is where the deploy script and the worker and web run together.
