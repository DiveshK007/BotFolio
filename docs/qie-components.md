# QIE components: what we use and what's checked

Source of truth for status is SPEC §0.6. This file records what the code does and what has been checked live.

| Component | Used where | Status |
|---|---|---|
| **QIE Wallet connect** (EIP-1193 `window.ethereum`) | `/create` "Connect QIE Wallet" (`apps/web/lib/wallet-adapters.ts`) | Connect LIVE (SPEC §0.6, Nov 20 2026) |
| QIE Wallet `wallet_switchEthereumChain` / `wallet_addEthereumChain` for chain 1990 | same | **UNVERIFIED** with QIE Wallet. Tested only against a mocked EIP-1193 provider (MetaMask behaviour) |
| QIE Wallet `personal_sign` of the EIP-4361 (SIWE) message | same, then worker `POST /auth/verify` | **UNVERIFIED** with QIE Wallet. Message format tested against the worker's own `verifySiwe` |
| QIE Wallet `eth_signTypedData_v4` (BotForwarder `ForwardRequest`, chain 1990) | every QIE Wallet relay (createBot first) | **UNVERIFIED** (#189, #99). Until checked on a real QIE Wallet the UI says "still being tested" and /judges says IN TESTING |
| **QIE Wallet MCP** (`https://mcp.qie.digital/mcp`, Streamable HTTP, no session or key) | worker `apps/worker/src/qie-names/sweeper.ts` calls `qie_reverse_lookup` | Checked live Nov 27 2026, 02:10 IST: `tools/list` returns 6 tools, all `readOnlyHint: true`: `qie_get_balances`, `qie_resolve_name`, `qie_reverse_lookup`, `qie_get_tx_status`, `qie_list_tokens`, `qie_get_network_info`. We use only `qie_reverse_lookup` |
| **QIE ID / `.qie` names** (reverse lookup) | owner names on bot pages and boards, cached 24 h in `qie_names` (decisions.md, Nov 26) | Checked live Nov 26 2026 with `qie.qie` and `test.qie` (decisions.md). Re-checked Nov 27 2026, 02:10 IST: `qie_resolve_name("qie.qie")` → `0x172083F7f31f82e4B57bA8aCf9822C72BB35b174`, and `qie_reverse_lookup` of that address → `qie.qie` (`source: default-name`), so the name resolves back to the same address |
| **QIE Pass** ("verified human" badge) | not used in code | **UNVERIFIED**. Needs partner access; never gates play. /judges says COMING |

When #189 is done, replace the UNVERIFIED QIE Wallet cells with the date, wallet version and the tx hash of a relayed createBot.
