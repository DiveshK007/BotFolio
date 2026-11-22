import { parseAbi, toEventSelector } from "viem";

/**
 * Only what the indexer uses. parseAbi rather than the JSON so viem infers the argument types;
 * test/indexer/abi.test.ts checks every item against packages/contracts/abi, in both directions for events.
 */
export const CONTRACT_EVENTS = {
  BotForwarder: parseAbi(["event ExecutedForwardRequest(address indexed signer, uint256 nonce, bool success)"]),
  BotRegistry: parseAbi([
    "event BotCreated(uint256 indexed botId, address indexed owner, bytes32 personaHash, uint16 maxPerCoinBps, uint8 maxTradesPerDay)",
    "event BotLimitsChanged(uint256 indexed botId, uint32 version, uint16 maxPerCoinBps, uint8 maxTradesPerDay)",
    "event BotActiveChanged(uint256 indexed botId, bool active)",
  ]),
  PaperLedger: parseAbi([
    "event Trade(uint256 indexed botId, uint8 indexed asset, bool buy, uint256 cashE8, uint256 unitsE18, uint256 priceE8, uint80 roundId, uint256 updatedAt, bytes32 indexed decisionId, uint8 actionIndex)",
    "event ApprovedTrade(uint256 indexed botId, bytes32 indexed decisionId, uint8 actionIndex, address indexed owner)",
    "event OrderSkipped(uint256 indexed botId, uint8 indexed asset, bytes32 indexed decisionId, uint8 actionIndex, uint8 reason)",
  ]),
  SeasonLedger: parseAbi([
    "event VersionCommitted(uint256 indexed botId, uint32 indexed version, bytes32 hash, uint32 season)",
    "event CallCorrected(uint256 indexed botId, bytes32 indexed decisionId, bytes32 noteHash, uint8 chip, uint32 season)",
    "event SeasonOpened(uint32 indexed n, uint64 start, uint64 end)",
    "event SeasonClosed(uint32 indexed n, bytes32 dataRoot, string dataURI)",
  ]),
  TrustScoreRegistry: parseAbi([
    "event RulesPublished(bytes32 indexed version, string uri, bytes32 docHash)",
    "event ScoresCommitted(uint32 indexed season, bytes32 indexed rulesVersion, bytes32 root, string uri)",
  ]),
  DailyCall: parseAbi([
    "event Called(uint256 indexed botId, uint32 indexed day, bool userUp, bool botUp, int256 price, uint80 roundId)",
    "event Settled(uint256 indexed botId, uint32 indexed day, int256 price, uint80 roundId, bool userCorrect, bool botCorrect)",
  ]),
  Challenges: parseAbi([
    "event ChallengeCreated(bytes32 indexed code, uint256 indexed myBot, uint32 season)",
    "event ChallengeAccepted(bytes32 indexed code, uint256 indexed theirBot)",
    "event ChallengeSettled(bytes32 indexed code, uint256 indexed winnerBot)",
    "event ChallengeExpired(bytes32 indexed code)",
  ]),
} as const;

export type ContractName = keyof typeof CONTRACT_EVENTS;
export const CONTRACT_NAMES = Object.keys(CONTRACT_EVENTS) as ContractName[];

/** OZ housekeeping (roles, ERC-5267). Nothing in the schema follows it. */
export const ADMIN_EVENTS = parseAbi([
  "event EIP712DomainChanged()",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole)",
]);
export const ADMIN_TOPICS: ReadonlySet<string> = new Set(ADMIN_EVENTS.map((event) => toEventSelector(event)));

/** State the events don't carry: the house flag, pause vs ban, and which scores root is current. */
export const REGISTRY_VIEWS = parseAbi([
  "struct Bot { address owner; bytes32 personaHash; uint16 maxPerCoinBps; uint8 maxTradesPerDay; uint32 version; uint64 createdAt; bool active; bool house; }",
  "function getBot(uint256 botId) view returns (Bot)",
  "function banned(uint256 botId) view returns (bool)",
]);
export const SCORE_VIEWS = parseAbi([
  "function scoresRoot(uint32 season) view returns (bytes32)",
  "function rulesVersionOf(uint32 season) view returns (bytes32)",
]);
