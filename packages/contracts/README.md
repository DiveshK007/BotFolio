# packages/contracts — WS A (Chain)

Foundry project for BotFolio's 7 contracts (SPEC §4.9): `BotForwarder`, `BotRegistry`, `PaperLedger`, `SeasonLedger`, `TrustScoreRegistry`, `DailyCall`, `Challenges`.

## Setup
```bash
cd packages/contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2 --no-commit   # pinned: 5.6.x uses mcopy (SPEC §0.3)
forge build
forge test --fork-url qie -vv
```

## Hard rules
- solc 0.8.24, `evm_version = "shanghai"` (set in `foundry.toml`). No `mcopy`, `tstore`/`tload`.
- Oracle feed addresses and max ages are fixed at deploy, no setters (SPEC §4.6). Addresses in `packages/shared/src/assets.ts`.
- After any interface change: export ABIs to `abi/` and update `events.md`, in one announced PR (frozen interface).
