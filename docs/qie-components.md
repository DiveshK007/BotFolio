# QIE components: what we use and what's checked

Source of truth for status is SPEC §0.6. This file records what the code does and what has been checked live.

| Component | Used where | Status |
|---|---|---|
| **QIE Wallet connect** (EIP-1193 `window.ethereum`) | `/create` "Connect QIE Wallet" (`apps/web/lib/wallet-adapters.ts`) | Connect LIVE (SPEC §0.6, Nov 20 2026) |
| QIE Wallet `wallet_switchEthereumChain` / `wallet_addEthereumChain` for chain 1990 | same | **UNVERIFIED** with QIE Wallet. Tested only against a mocked EIP-1193 provider (MetaMask behaviour) |
| QIE Wallet `personal_sign` of the EIP-4361 (SIWE) message | same, then worker `POST /auth/verify` | **UNVERIFIED** with QIE Wallet. Message format tested against the worker's own `verifySiwe` |
| QIE Wallet `eth_signTypedData_v4` (BotForwarder `ForwardRequest`, chain 1990) | every QIE Wallet relay (createBot first) | **UNVERIFIED** (#189). Until checked on a real QIE Wallet the UI says "still being tested" |

When #189 is done, replace the UNVERIFIED cells with the date, wallet version and the tx hash of a relayed createBot.
