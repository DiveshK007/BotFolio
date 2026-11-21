/**
 * Relay interface: what the app signs, what it POSTs to the Render service, and what comes back.
 * FROZEN INTERFACE (SPEC §12.2). Change only through one announced PR.
 *
 * Sources: SPEC §4.1 (BotForwarder), §4.3 (ApprovedOrder), §4.7 (DailyCall bot view), §11 (allowlist, auth, limits).
 * Every user action is an EIP-712 ForwardRequest signed by the user and sent by our relayer, which pays gas.
 */
import { encodeAbiParameters, keccak256, pad, type Address, type Hex, type TypedDataDefinition } from "viem";

/** QIE mainnet chain id. Every EIP-712 domain below is bound to it. */
export const QIE_CHAIN_ID = 1990 as const;

// ---------------------------------------------------------------------------------------------------
// 1. BotForwarder (OZ 5.0.2 ERC2771Forwarder, domain "BotFolio" / "1", SPEC §4.1)
// ---------------------------------------------------------------------------------------------------

/**
 * Struct passed to `BotForwarder.execute(ForwardRequestData)`. Matches OZ 5.0.2 `ERC2771Forwarder.ForwardRequestData`
 * field for field: no nonce here (the forwarder reads `nonces(from)` itself), signature appended.
 * viem maps uint48 → number and uint256 → bigint.
 */
export interface ForwardRequest {
  from: Address;
  to: Address;
  value: bigint;
  gas: bigint;
  /** uint48 unix seconds. The relayer refuses anything more than RELAY_LIMITS.maxDeadlineSeconds ahead. */
  deadline: number;
  data: Hex;
  signature: Hex;
}

/** The EIP-712 message the user signs: ForwardRequest without the signature, plus the forwarder nonce. */
export interface ForwardRequestMessage {
  from: Address;
  to: Address;
  value: bigint;
  gas: bigint;
  nonce: bigint;
  deadline: number;
  data: Hex;
}

/** OZ 5.0.2 typehash: `ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)`. */
export const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const;

export const FORWARDER_DOMAIN_NAME = "BotFolio";
export const FORWARDER_DOMAIN_VERSION = "1";

export function forwarderDomain(verifyingContract: Address) {
  return { name: FORWARDER_DOMAIN_NAME, version: FORWARDER_DOMAIN_VERSION, chainId: QIE_CHAIN_ID, verifyingContract } as const;
}

/** Ready for viem `signTypedData` / `hashTypedData` / `verifyTypedData`. */
export function forwardRequestTypedData(
  forwarder: Address,
  message: ForwardRequestMessage,
): TypedDataDefinition<typeof FORWARD_REQUEST_TYPES, "ForwardRequest"> & { domain: ReturnType<typeof forwarderDomain> } {
  return { domain: forwarderDomain(forwarder), types: FORWARD_REQUEST_TYPES, primaryType: "ForwardRequest", message };
}

/** Drop the nonce and attach the signature to get the struct `execute` takes. */
export function toForwardRequest(message: ForwardRequestMessage, signature: Hex): ForwardRequest {
  const { nonce: _nonce, ...rest } = message;
  return { ...rest, signature };
}

// ---------------------------------------------------------------------------------------------------
// 2. ApprovedOrder (PaperLedger.executeApproved, domain "BotFolio PaperLedger" / "1", SPEC §4.3)
// ---------------------------------------------------------------------------------------------------

/** `struct ApprovedOrder { uint256 botId; uint8 asset; bool buy; uint16 bps; bytes32 decisionId; uint8 actionIndex; uint64 deadline; }` */
export interface ApprovedOrder {
  botId: bigint;
  /** Asset index 0..4 = BTC, ETH, SOL, XRP, GOLD (see ASSETS in assets.ts). */
  asset: number;
  buy: boolean;
  /** BUY: share of cash; SELL: share of the holding. 1..10000. */
  bps: number;
  decisionId: Hex;
  /** Position of the action in the decision's actions[] (0-based, max 2). */
  actionIndex: number;
  /** uint64 unix seconds (now + 2 h, BIG_MOVE_TTL_MIN). */
  deadline: bigint;
}

export const APPROVED_ORDER_TYPES = {
  ApprovedOrder: [
    { name: "botId", type: "uint256" },
    { name: "asset", type: "uint8" },
    { name: "buy", type: "bool" },
    { name: "bps", type: "uint16" },
    { name: "decisionId", type: "bytes32" },
    { name: "actionIndex", type: "uint8" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const PAPER_LEDGER_DOMAIN_NAME = "BotFolio PaperLedger";
export const PAPER_LEDGER_DOMAIN_VERSION = "1";

export function paperLedgerDomain(verifyingContract: Address) {
  return { name: PAPER_LEDGER_DOMAIN_NAME, version: PAPER_LEDGER_DOMAIN_VERSION, chainId: QIE_CHAIN_ID, verifyingContract } as const;
}

/** The runner signs this (gate() step 9); the owner then relays `executeApproved(order, runnerSig)`. */
export function approvedOrderTypedData(
  paperLedger: Address,
  message: ApprovedOrder,
): TypedDataDefinition<typeof APPROVED_ORDER_TYPES, "ApprovedOrder"> & { domain: ReturnType<typeof paperLedgerDomain> } {
  return { domain: paperLedgerDomain(paperLedger), types: APPROVED_ORDER_TYPES, primaryType: "ApprovedOrder", message };
}

/** ApprovedOrder on the wire (big-move Allow prompt): uint256/uint64 as decimal strings. */
export interface ApprovedOrderJson {
  botId: string;
  asset: number;
  buy: boolean;
  bps: number;
  decisionId: Hex;
  actionIndex: number;
  deadline: string;
}

export function approvedOrderToJson(o: ApprovedOrder): ApprovedOrderJson {
  return { ...o, botId: o.botId.toString(), deadline: o.deadline.toString() };
}

export function approvedOrderFromJson(j: ApprovedOrderJson): ApprovedOrder {
  return { ...j, botId: BigInt(j.botId), deadline: BigInt(j.deadline) };
}

/** What the worker hands the app for a pending big move; the app relays `executeApproved(order, runnerSig)`. */
export interface SignedApprovedOrder {
  order: ApprovedOrderJson;
  runnerSig: Hex;
}

/** Per-order replay key (SPEC §3): `keccak256(abi.encode(decisionId, actionIndex))`. Shared by executeBatch and executeApproved. */
export function orderIdOf(decisionId: Hex, actionIndex: number): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint8" }], [decisionId, actionIndex]));
}

/**
 * PROPOSAL, pending WS A agreement (see PR spec questions): the DB keys decisions by uuid (SPEC §3) while the contracts
 * take `bytes32 decisionId`. On-chain decisionId = the uuid's 16 bytes left-padded to 32. Lossless both ways.
 */
export function decisionIdFromUuid(uuid: string): Hex {
  const hex = uuid.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`not a uuid: ${uuid}`);
  return pad(`0x${hex}`, { size: 32 });
}

export function uuidFromDecisionId(decisionId: Hex): string {
  const hex = decisionId.toLowerCase().replace(/^0x/, "");
  if (!/^0{32}[0-9a-f]{32}$/.test(hex)) throw new Error(`decisionId is not a padded uuid: ${decisionId}`);
  const u = hex.slice(32);
  return `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`;
}

// ---------------------------------------------------------------------------------------------------
// 3. DailyCall bot view (runner-signed, domain "BotFolio DailyCall" / "1", SPEC §4.7, §6.4.1)
// ---------------------------------------------------------------------------------------------------

/** What the runner signs over: `(botId, day, botUp)`. `day` = IST day number, see istDay(). */
export interface DailyCallBotView {
  botId: bigint;
  /** uint32 IST day number. */
  day: number;
  botUp: boolean;
}

/**
 * Struct name `BotView` is our choice (SPEC §4.7 names only the fields). UNVERIFIED until WS A's DailyCall
 * uses the same typehash: `BotView(uint256 botId,uint32 day,bool botUp)`.
 */
export const DAILY_CALL_BOT_VIEW_TYPES = {
  BotView: [
    { name: "botId", type: "uint256" },
    { name: "day", type: "uint32" },
    { name: "botUp", type: "bool" },
  ],
} as const;

export const DAILY_CALL_DOMAIN_NAME = "BotFolio DailyCall";
export const DAILY_CALL_DOMAIN_VERSION = "1";

export function dailyCallDomain(verifyingContract: Address) {
  return { name: DAILY_CALL_DOMAIN_NAME, version: DAILY_CALL_DOMAIN_VERSION, chainId: QIE_CHAIN_ID, verifyingContract } as const;
}

export function dailyCallBotViewTypedData(
  dailyCall: Address,
  message: DailyCallBotView,
): TypedDataDefinition<typeof DAILY_CALL_BOT_VIEW_TYPES, "BotView"> & { domain: ReturnType<typeof dailyCallDomain> } {
  return { domain: dailyCallDomain(dailyCall), types: DAILY_CALL_BOT_VIEW_TYPES, primaryType: "BotView", message };
}

/**
 * Bot view + runner signature as the worker serves it. The app reveals botUp only after the user picks (§2.2);
 * then the user relays `DailyCall.call(botId, userUp, botUp, botSig)`.
 */
export interface SignedDailyCallBotView {
  botId: string;
  day: number;
  botUp: boolean;
  botSig: Hex;
}

/** IST day number, same formula as the contracts: `(block.timestamp + 19800) / 86400`. */
export function istDay(unixSeconds: number): number {
  return Math.floor((unixSeconds + 19800) / 86400);
}

// ---------------------------------------------------------------------------------------------------
// 4. Relayer allowlist and limits (SPEC §11)
// ---------------------------------------------------------------------------------------------------

export type RelayTargetContract = "BotRegistry" | "SeasonLedger" | "PaperLedger" | "DailyCall" | "Challenges";

export interface RelayAllowlistEntry {
  contract: RelayTargetContract;
  fn: string;
  /** Canonical signature from SPEC §4. UNVERIFIED until checked against packages/contracts/abi (#4). */
  signature: string;
  /** First 4 bytes of keccak256(signature). The unit test recomputes these. */
  selector: Hex;
}

/** The only 8 (contract, function) pairs the relayer will forward. Anything else → NOT_ALLOWLISTED. */
export const RELAY_ALLOWLIST = [
  { contract: "BotRegistry", fn: "createBot", signature: "createBot(bytes32,uint16,uint8)", selector: "0xf429b088" },
  { contract: "BotRegistry", fn: "setActive", signature: "setActive(uint256,bool)", selector: "0xe60a955d" },
  { contract: "SeasonLedger", fn: "commitVersion", signature: "commitVersion(uint256,uint32,bytes32,uint16,uint8)", selector: "0x01cf7571" },
  { contract: "SeasonLedger", fn: "recordCorrection", signature: "recordCorrection(uint256,bytes32,bytes32,uint8)", selector: "0xc29536cc" },
  { contract: "PaperLedger", fn: "executeApproved", signature: "executeApproved((uint256,uint8,bool,uint16,bytes32,uint8,uint64),bytes)", selector: "0x0f485a11" },
  { contract: "DailyCall", fn: "call", signature: "call(uint256,bool,bool,bytes)", selector: "0xe405cb14" },
  { contract: "Challenges", fn: "create", signature: "create(uint256,uint32)", selector: "0xeffab51d" },
  { contract: "Challenges", fn: "accept", signature: "accept(bytes32,uint256)", selector: "0x9d14cb64" },
] as const satisfies readonly RelayAllowlistEntry[];

export type RelayAllowlisted = (typeof RELAY_ALLOWLIST)[number];

/** Deployed addresses of the 5 relay targets (from env). */
export type RelayTargetAddresses = Record<RelayTargetContract, Address>;

/** Find the allowlist entry for `(request.to, selector of request.data)`, or null if not allowed. */
export function findAllowlisted(addresses: RelayTargetAddresses, to: Address, data: Hex): RelayAllowlisted | null {
  const selector = data.slice(0, 10).toLowerCase();
  return (
    RELAY_ALLOWLIST.find((e) => addresses[e.contract].toLowerCase() === to.toLowerCase() && e.selector === selector) ?? null
  );
}

/**
 * Hard limits from SPEC §11. The server may be stricter (gas "tune after gas report") but never looser.
 * Rate limits (30/wallet/day, 3 new bots/IP/day, 2000/hour global) are env config, see SPEC §10.
 */
export const RELAY_LIMITS = {
  /** request.value must equal this. */
  value: 0n,
  maxGas: 300_000n,
  /** deadline ≤ now + 10 min. */
  maxDeadlineSeconds: 600,
} as const;

// ---------------------------------------------------------------------------------------------------
// 5. POST /relay (Render service)
// ---------------------------------------------------------------------------------------------------

export const RELAY_PATH = "/relay";

/**
 * Auth (SPEC §11, #186): `Authorization: Bearer <token>` plus `X-BotFolio-Auth` saying which kind the token is:
 * a Privy session token (verified server-side) or the 15-min SIWE JWT from POST /auth/verify.
 * Either way the token's wallet must equal `request.from` (else SIGNER_MISMATCH).
 */
export type RelayAuthKind = "privy" | "siwe";
export const RELAY_AUTH_KIND_HEADER = "x-botfolio-auth";

export interface RelayAuthHeaders {
  authorization: `Bearer ${string}`;
  "x-botfolio-auth": RelayAuthKind;
}

/** ForwardRequest on the wire: uint256 fields as decimal strings (JSON has no bigint). */
export interface ForwardRequestJson {
  from: Address;
  to: Address;
  value: string;
  gas: string;
  deadline: number;
  data: Hex;
  signature: Hex;
}

export function forwardRequestToJson(r: ForwardRequest): ForwardRequestJson {
  return { ...r, value: r.value.toString(), gas: r.gas.toString() };
}

export function forwardRequestFromJson(j: ForwardRequestJson): ForwardRequest {
  return { ...j, value: BigInt(j.value), gas: BigInt(j.gas) };
}

/** Body of POST /relay. The relayer decodes the target function from `request.to` + `request.data` itself. */
export interface RelayRequestBody {
  request: ForwardRequestJson;
}

export interface RelaySuccess {
  ok: true;
  /** Accepted and broadcast; the app waits for the receipt over RPC (chain block time ~3.6 s). */
  status: "submitted";
  txHash: Hex;
  /** relay_log.id, for support/debugging. */
  relayId: string;
}

/** Every reason POST /relay can refuse, in the order the relayer checks them (SPEC §11). */
export const RELAY_ERROR_CODES = [
  "RELAY_DISABLED", // RELAY_ENABLED=false pause switch
  "BAD_REQUEST", // body didn't parse / wrong field types
  "UNAUTHORIZED", // missing, invalid or expired Privy token / SIWE JWT
  "SIGNER_MISMATCH", // token wallet ≠ request.from
  "NOT_ALLOWLISTED", // (to, selector) not in RELAY_ALLOWLIST
  "VALUE_NOT_ZERO",
  "GAS_TOO_HIGH", // gas > RELAY_LIMITS.maxGas
  "DEADLINE_EXPIRED",
  "DEADLINE_TOO_FAR", // deadline > now + 10 min
  "RATE_LIMITED_USER", // 30 relays/wallet/day
  "RATE_LIMITED_IP", // 3 new bots per IP/day (createBot only)
  "RATE_LIMITED_GLOBAL", // 2000 relays/hour
  "INVALID_SIGNATURE", // forwarder.verify() returned false (bad sig, wrong nonce, wrong domain)
  "WOULD_REVERT", // eth_call of the inner request reverted (e.g. stale price, second bot) — nothing sent
  "RPC_UNAVAILABLE", // all 5 QIE RPCs failed
  "INTERNAL",
] as const;

export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[number];

export const RELAY_ERROR_HTTP_STATUS: Record<RelayErrorCode, number> = {
  RELAY_DISABLED: 503,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  SIGNER_MISMATCH: 403,
  NOT_ALLOWLISTED: 403,
  VALUE_NOT_ZERO: 400,
  GAS_TOO_HIGH: 400,
  DEADLINE_EXPIRED: 400,
  DEADLINE_TOO_FAR: 400,
  RATE_LIMITED_USER: 429,
  RATE_LIMITED_IP: 429,
  RATE_LIMITED_GLOBAL: 429,
  INVALID_SIGNATURE: 400,
  WOULD_REVERT: 422,
  RPC_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export interface RelayError {
  ok: false;
  error: {
    code: RelayErrorCode;
    /** Plain words, safe to show the user (e.g. "Price too old — try again in a few minutes"). */
    message: string;
    /** Set for RATE_LIMITED_*. */
    retryAfterSeconds?: number;
    /** Set for WOULD_REVERT: decoded revert reason from the eth_call, if any. */
    revertReason?: string;
  };
}

export type RelayResponse = RelaySuccess | RelayError;

// ---------------------------------------------------------------------------------------------------
// 6. SIWE-style login for QIE Wallet users (EIP-4361 → 15-min JWT, SPEC §11)
// ---------------------------------------------------------------------------------------------------

export const AUTH_NONCE_PATH = "/auth/nonce";
export const AUTH_VERIFY_PATH = "/auth/verify";

/** Lifetime of the relay JWT. */
export const RELAY_JWT_TTL_SECONDS = 900;
/** How long a nonce from GET /auth/nonce stays usable (single use). Our choice; SPEC doesn't fix it. */
export const SIWE_NONCE_TTL_SECONDS = 300;
/** EIP-4361 statement line. Plain words: signing in is not a transaction and costs nothing. */
export const SIWE_STATEMENT = "Sign in to BotFolio. This is not a transaction and costs no gas. Play money only.";

/** GET /auth/nonce → */
export interface AuthNonceResponse {
  /** EIP-4361 nonce: ≥ 8 alphanumeric chars, single use. */
  nonce: string;
  /** ISO 8601. */
  issuedAt: string;
  /** ISO 8601, issuedAt + SIWE_NONCE_TTL_SECONDS. */
  expiresAt: string;
}

/**
 * Fields the app puts in the EIP-4361 message (build it with viem's `createSiweMessage` from "viem/siwe").
 * The server checks domain === SIWE_DOMAIN env, chainId === 1990, and that the nonce is one it issued.
 */
export interface SiweMessageFields {
  domain: string;
  address: Address;
  statement: typeof SIWE_STATEMENT;
  uri: string;
  version: "1";
  chainId: typeof QIE_CHAIN_ID;
  nonce: string;
  issuedAt: Date;
  expirationTime?: Date;
}

/** POST /auth/verify body. */
export interface AuthVerifyRequest {
  /** The full EIP-4361 message text that was signed. */
  message: string;
  /** personal_sign (EIP-191) signature over `message`. */
  signature: Hex;
}

export interface AuthVerifySuccess {
  ok: true;
  /** HS256 JWT signed with RELAY_JWT_SECRET; send as `Authorization: Bearer <token>` with `x-botfolio-auth: siwe`. */
  token: string;
  address: Address;
  /** ISO 8601, issue time + RELAY_JWT_TTL_SECONDS. */
  expiresAt: string;
}

export const AUTH_ERROR_CODES = [
  "BAD_REQUEST", // message didn't parse as EIP-4361
  "DOMAIN_MISMATCH", // domain ≠ SIWE_DOMAIN
  "CHAIN_MISMATCH", // chainId ≠ 1990
  "INVALID_NONCE", // unknown or already used
  "NONCE_EXPIRED",
  "INVALID_SIGNATURE", // signature doesn't recover to message.address
  "INTERNAL",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export interface AuthVerifyError {
  ok: false;
  error: { code: AuthErrorCode; message: string };
}

export type AuthVerifyResponse = AuthVerifySuccess | AuthVerifyError;

/** Claims inside the relay JWT. Bound to one address; the relayer checks `sub` against request.from. */
export interface RelayJwtClaims {
  /** Wallet address, lowercase. */
  sub: Address;
  aud: "botfolio-relay";
  kind: "siwe";
  /** Unix seconds. */
  iat: number;
  /** iat + RELAY_JWT_TTL_SECONDS. */
  exp: number;
}
