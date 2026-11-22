# Contract events (frozen interface)

Every event BotFolio's contracts emit, from SPEC §4. The source of truth is the interfaces in `src/interfaces/`. This file follows them and is written by hand. WS B's indexer and WS D's Verify-on-QIE panel read this file.

How to read it:
- **Declaration** is the exact Solidity, with the `indexed` fields. Indexed fields are topics 1..3, in order. Everything else is ABI-encoded in `data`.
- **topic0** = `keccak256` of the signature. Check with `cast keccak "<signature>"`.
- **Who**: *user* means the tx came through `BotForwarder` and the actor is `_msgSender()`, the user's own signature. It counts as user activity (SPEC §11 `/stats`). *system* means a runner or committer tx. Never present system txs as user activity.
- Units: `...E8` = 8 decimals (play USDT, the same scale as the feeds). `...E18` = asset units with 18 decimals. Assets: `0 BTC, 1 ETH, 2 SOL, 3 XRP, 4 GOLD`. Day = IST day number `(timestamp + 19800) / 86400`.

## BotForwarder (OZ 5.0.2 `ERC2771Forwarder`)

| Declaration | topic0 | Who |
|---|---|---|
| `event ExecutedForwardRequest(address indexed signer, uint256 nonce, bool success)` | `0x842fb24a83793558587a3dab2be7674da4a51d09c5542d6dd354e5d0ea70813c` | user (`signer` = user) |
| `event EIP712DomainChanged()` | `0x0a6387c9ea3628b88a633bb4f3b151770f70085117a15f9bf3787cda53f13d31` | never emitted (ERC-5267, domain is fixed) |

EIP-712 domain: name `"BotFolio"`, version `"1"`, chainId `1990`, verifyingContract = forwarder. Type the user signs:
`ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)`

## BotRegistry

| Declaration | topic0 | Who |
|---|---|---|
| `event BotCreated(uint256 indexed botId, address indexed owner, bytes32 personaHash, uint16 maxPerCoinBps, uint8 maxTradesPerDay)` | `0xe8f994f62cb0dca8132fd24e1cc2c0d0f81eba4d1c05ffd2f3a49102fcb5f276` | user (`createBot`); admin for house bots (`createHouseBot`) |
| `event BotLimitsChanged(uint256 indexed botId, uint32 version, uint16 maxPerCoinBps, uint8 maxTradesPerDay)` | `0xc787461bb443282e5f886502ab83079370cd7f6523ea7d40aff0cdd534fdcf53` | user (emitted inside `SeasonLedger.commitVersion`) |
| `event BotActiveChanged(uint256 indexed botId, bool active)` | `0x01cf67f2af7cfd2c3150308b321022c42dfeb926a0d562c4fc49b1f0ddd493aa` | user (pause) or admin (ban) |

- A house bot emits the same `BotCreated`. Read `bots(botId).house` to tell them apart.
- `createBot` also opens the portfolio in PaperLedger. That emits no event of its own; the start cash is `PaperLedger.START_CASH_E8()`.
- `BotLimitsChanged.version` is the bot's new version. It is always emitted in the same tx as `SeasonLedger.VersionCommitted` for that version.

## PaperLedger

| Declaration | topic0 | Who |
|---|---|---|
| `event Trade(uint256 indexed botId, uint8 indexed asset, bool buy, uint256 cashE8, uint256 unitsE18, uint256 priceE8, uint80 roundId, uint256 updatedAt, bytes32 indexed decisionId, uint8 actionIndex)` | `0xcb7d8d9ad6a94667a2ef9df880300b31e16d62ed0b3781c0ff8efffb3ced35bd` | system (`executeBatch`) or user (`executeApproved`) |
| `event ApprovedTrade(uint256 indexed botId, bytes32 indexed decisionId, uint8 actionIndex, address indexed owner)` | `0xef8b8699e1d11107f7fe51bbc721646d5de1eb3658615fb84725a54b1e7076bb` | user |
| `event OrderSkipped(uint256 indexed botId, uint8 indexed asset, bytes32 indexed decisionId, uint8 actionIndex, uint8 reason)` | `0x224658835ada506975787253a991787a2d4dccb2e5f7f7a9ea1cd219039ee2b2` | system |
| `event EIP712DomainChanged()` | `0x0a6387c9ea3628b88a633bb4f3b151770f70085117a15f9bf3787cda53f13d31` | never emitted |

- `Trade`: `priceE8`, `roundId` and `updatedAt` are the oracle round the contract read in that tx. Anyone can recheck them with `getRoundData(roundId)` on `feed(asset)`. `cashE8` is cash spent (BUY) or received (SELL). `unitsE18` is units bought or sold.
- To tell a user-approved trade from a runner trade, look for `ApprovedTrade` in the same tx. It is emitted right after its `Trade`.
- Replay key: `orderId = keccak256(abi.encode(decisionId, actionIndex))` (`orderIdOf()` on-chain, `trades.order_id` in the DB). Each orderId emits at most one `Trade` in total, across both paths.
- `OrderSkipped.reason` (`IPaperLedger.SkipReason`):

| Code | Name | Meaning |
|---|---|---|
| 0 | STALE | price older than `maxAge(asset)` (1800 s crypto, 21600 s gold), `answer ≤ 0`, `answeredInRound < roundId`, or the feed call failed. The bot holds (SPEC §5.4) |
| 1 | LIMIT | trades-per-IST-day cap reached, BUY would push the asset over `maxPerCoinBps`, or `bps > 10000` |
| 2 | INACTIVE | bot paused, banned or unknown, or asset index > 4 |
| 3 | ZERO | `bps == 0`, SELL with nothing held, or the order rounds to 0 units or cash |
| 4 | USED | this orderId already executed (batch retry or already approved by the owner) |

- A skipped order does **not** use up its orderId, so a STALE skip can be retried at +5/+10/+15 min with the same `decisionId`/`actionIndex`.
- `ApprovedOrder` EIP-712 domain: name `"BotFolio PaperLedger"`, version `"1"`, chainId `1990`, verifyingContract = PaperLedger. Type the runner signs:
  `ApprovedOrder(uint256 botId,uint8 asset,bool buy,uint16 bps,bytes32 decisionId,uint8 actionIndex,uint64 deadline)`

## SeasonLedger

| Declaration | topic0 | Who |
|---|---|---|
| `event VersionCommitted(uint256 indexed botId, uint32 indexed version, bytes32 hash, uint32 season)` | `0x4ca0e638fd0b38ac31f86bc28b66a0b0df7ca54188529f0bc7a3b5eb70d24c56` | user (admin for house bots) |
| `event CallCorrected(uint256 indexed botId, bytes32 indexed decisionId, bytes32 noteHash, uint8 chip, uint32 season)` | `0xc243022727d75e3a9537d3cdd154cffaa9aff2596b1ec8e05b54d443d9d5250a` | user |
| `event SeasonOpened(uint32 indexed n, uint64 start, uint64 end)` | `0x7aeae4c91f6a2ef7e609adef9357bd54e67ba0a8cec8bb73ae971db1f8027866` | system (committer) |
| `event SeasonClosed(uint32 indexed n, bytes32 dataRoot, string dataURI)` | `0x42e5a0e1eff47edf3677bb6a392e5437e427cfd18cb791868a89563519056365` | system (committer) |

- `season` in `VersionCommitted`/`CallCorrected` is `currentSeason()` at that moment (the most recently opened season). Seasons are numbered from 0 (S0).
- `hash` = keccak256 of the version config JSON (`bot_versions.config_hash`). `noteHash` = keccak256 of the note text (`corrections.note_hash`).
- `dataRoot` = Merkle root (keccak256, sorted pairs) over the replay file's line hashes (SPEC §6.5).

## TrustScoreRegistry

| Declaration | topic0 | Who |
|---|---|---|
| `event RulesPublished(bytes32 indexed version, string uri, bytes32 docHash)` | `0xd021e25834a8a5473f7861ea4e00d17b79a38fa70f4ed1d8986c187e49bffd13` | system (admin) |
| `event ScoresCommitted(uint32 indexed season, bytes32 indexed rulesVersion, bytes32 root, string uri)` | `0xbf3f2287c8959a668f6a973b44e5ae94d6d134e6b906ee7cad08b3cbff78cb5e` | system (committer) |

- `version` / `rulesVersion` are short strings as `bytes32`, left-aligned and zero-padded, e.g. `bytes32("trust-v1-sprint")`, `bytes32("trust-v1")`.
- A season can get more than one `ScoresCommitted` (optional daily roots). The latest one is `scoresRoot(season)`.
- Leaf = `keccak256(abi.encode(season, botId, fRules, fDrawdown, fConsistency, fExplains, total))`. Every value is ABI-encoded as a 32-byte word. The tree is keccak256 over sorted pairs (OZ `MerkleProof`).

## DailyCall

| Declaration | topic0 | Who |
|---|---|---|
| `event Called(uint256 indexed botId, uint32 indexed day, bool userUp, bool botUp, int256 price, uint80 roundId)` | `0x71f59b421f5ad2c79ee4aa88c5f192e7277b552e6bea7d803ea0607d9da57d4d` | user |
| `event Settled(uint256 indexed botId, uint32 indexed day, int256 price, uint80 roundId, bool userCorrect, bool botCorrect)` | `0x0ec898afd2dede75733eeadd749ec7239d68d3df6382433f8aa5c4c777c803aa` | system (committer) |
| `event EIP712DomainChanged()` | `0x0a6387c9ea3628b88a633bb4f3b151770f70085117a15f9bf3787cda53f13d31` | never emitted |

- `Called.price`/`roundId` are the BTC/USDT round read at call time. `Settled.price`/`roundId` are the round used to settle; its `updatedAt` is at or after 21:00 IST that day.
- Equal price at settle gives `userCorrect = botCorrect = false` (no winner).
- If `settle` finds no fresh BTC round at or after 21:00 IST, it emits nothing and does not revert. No `Settled` event means "settles late" (SPEC §4.7, §6.1).
- Bot view EIP-712 domain: name `"BotFolio DailyCall"`, version `"1"`, chainId `1990`, verifyingContract = DailyCall. Type the runner signs:
  `BotView(uint256 botId,uint32 day,bool botUp)`

## Challenges

| Declaration | topic0 | Who |
|---|---|---|
| `event ChallengeCreated(bytes32 indexed code, uint256 indexed myBot, uint32 season)` | `0x178028b91cbd7ba9f0fc8995834460f0a217a2118791a3e410172720b4fcdfd7` | user |
| `event ChallengeAccepted(bytes32 indexed code, uint256 indexed theirBot)` | `0x67b36308e827788045679a6441f98d28e092b17c0a4586fbffa1dd0bd67f8ebb` | user |
| `event ChallengeSettled(bytes32 indexed code, uint256 indexed winnerBot)` | `0x6398a9badc563815e40e2e6068dbb1616e5e1f57d9c1108770d77f938b8daeb0` | system (committer) |
| `event ChallengeExpired(bytes32 indexed code)` | `0xfed12f4bda99a495bd010e46ca4f7d5ccd4bfd6ad82e229605a9604097655dd6` | anyone (system in practice) |

- `code = keccak256(abi.encode(creator, nonce))`, derived by the contract. Share links use the first 8 bytes of `code`, hex-encoded. The indexer stores the full code so short links resolve.
- Status codes (`IChallenges.Status`): `0 NONE, 1 OPEN, 2 ACCEPTED, 3 SETTLED, 4 EXPIRED`.

## AccessControl (every contract except BotForwarder)

| Declaration | topic0 |
|---|---|
| `event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)` | `0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d` |
| `event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)` | `0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b` |
| `event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole)` | `0xbd79b86ffe0ab8e8776151514217cd7cacd52c909f66475c3af44e129f0b00ff` |

Roles: `DEFAULT_ADMIN_ROLE` (`0x00…00`, cold key), `RUNNER_ROLE`, `COMMITTER_ROLE`, `REGISTRY_ROLE` (PaperLedger → BotRegistry contract), `SEASON_LEDGER_ROLE` (BotRegistry → SeasonLedger contract). Each role id is `keccak256("<NAME>")`. The relayer has no role.
