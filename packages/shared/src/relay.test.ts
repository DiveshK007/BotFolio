import { describe, expect, it } from "vitest";
import {
  concat,
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  toBytes,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  APPROVED_ORDER_TYPES,
  DAILY_CALL_BOT_VIEW_TYPES,
  RELAY_ALLOWLIST,
  approvedOrderFromJson,
  approvedOrderToJson,
  approvedOrderTypedData,
  dailyCallBotViewTypedData,
  decisionIdFromUuid,
  findAllowlisted,
  forwardRequestFromJson,
  forwardRequestToJson,
  forwardRequestTypedData,
  istDay,
  orderIdOf,
  toForwardRequest,
  uuidFromDecisionId,
  type ApprovedOrder,
  type ForwardRequestMessage,
} from "./relay";

// Fixed fixtures. The key is a throwaway test value, never used on any network.
const TEST_KEY: Hex = `0x${"11".repeat(32)}`;
const FORWARDER: Address = "0x00000000000000000000000000000000000f0a2d";
const PAPER_LEDGER: Address = "0x0000000000000000000000000000000000001ed6";
const DAILY_CALL: Address = "0x00000000000000000000000000000000000dca11";

const message: ForwardRequestMessage = {
  from: privateKeyToAccount(TEST_KEY).address,
  to: "0x000000000000000000000000000000000000b075",
  value: 0n,
  gas: 250_000n,
  nonce: 7n,
  deadline: 1_795_000_000,
  data: "0xf429b088abcdef",
};

// Independent EIP-712 digest, built by hand from the spec'd typehash (not from the TYPES constant).
function manualForwardDigest(m: ForwardRequestMessage, forwarder: Address): Hex {
  const domainTypehash = keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [domainTypehash, keccak256(toBytes("BotFolio")), keccak256(toBytes("1")), 1990n, forwarder],
    ),
  );
  const typehash = keccak256(
    toBytes("ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"),
  );
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" },
        { type: "uint256" }, { type: "uint256" }, { type: "uint48" }, { type: "bytes32" },
      ],
      [typehash, m.from, m.to, m.value, m.gas, m.nonce, m.deadline, keccak256(m.data)],
    ),
  );
  return keccak256(concat(["0x1901", domainSeparator, structHash]));
}

describe("ForwardRequest EIP-712", () => {
  it("hashes deterministically and matches the OZ 5.0.2 typehash built by hand", () => {
    const h1 = hashTypedData(forwardRequestTypedData(FORWARDER, message));
    const h2 = hashTypedData(forwardRequestTypedData(FORWARDER, { ...message }));
    expect(h1).toBe(h2);
    expect(h1).toBe(manualForwardDigest(message, FORWARDER));
    // Golden value: if this changes, the frozen interface changed.
    expect(h1).toMatchInlineSnapshot(`"0x55b2e7fbb6739c88a8887c94bf6ae3c247c1a9d87940f0417e3350d034b31e0e"`);
  });

  it("is bound to chain 1990 and the forwarder address", () => {
    const td = forwardRequestTypedData(FORWARDER, message);
    expect(td.domain).toEqual({ name: "BotFolio", version: "1", chainId: 1990, verifyingContract: FORWARDER });
    expect(hashTypedData(forwardRequestTypedData(PAPER_LEDGER, message))).not.toBe(hashTypedData(td));
  });

  it("signature recovers to `from`", async () => {
    const account = privateKeyToAccount(TEST_KEY);
    const td = forwardRequestTypedData(FORWARDER, message);
    const signature = await account.signTypedData(td);
    expect(await recoverTypedDataAddress({ ...td, signature })).toBe(account.address);
    const req = toForwardRequest(message, signature);
    expect(req).not.toHaveProperty("nonce");
    expect(forwardRequestFromJson(JSON.parse(JSON.stringify(forwardRequestToJson(req))))).toEqual(req);
  });
});

describe("ApprovedOrder and DailyCall EIP-712", () => {
  const order: ApprovedOrder = {
    botId: 42n,
    asset: 4,
    buy: true,
    bps: 3500,
    decisionId: decisionIdFromUuid("0b5e3f6c-2a1d-4c3e-9f8a-7b6c5d4e3f2a"),
    actionIndex: 1,
    deadline: 1_795_007_200n,
  };

  it("ApprovedOrder has the SPEC §4.3 fields in order, incl. actionIndex", () => {
    expect(APPROVED_ORDER_TYPES.ApprovedOrder.map((f) => `${f.type} ${f.name}`).join(",")).toBe(
      "uint256 botId,uint8 asset,bool buy,uint16 bps,bytes32 decisionId,uint8 actionIndex,uint64 deadline",
    );
    const td = approvedOrderTypedData(PAPER_LEDGER, order);
    expect(td.domain).toEqual({ name: "BotFolio PaperLedger", version: "1", chainId: 1990, verifyingContract: PAPER_LEDGER });
    expect(hashTypedData(td)).toMatchInlineSnapshot(`"0xb1a7898126d7fc041d7c03b390546a4f24d93068c5906757771e51c5f4fc9c54"`);
    expect(approvedOrderFromJson(JSON.parse(JSON.stringify(approvedOrderToJson(order))))).toEqual(order);
  });

  it("runner-signed DailyCall bot view recovers to the runner", async () => {
    const runner = privateKeyToAccount(TEST_KEY);
    const td = dailyCallBotViewTypedData(DAILY_CALL, { botId: 42n, day: istDay(1_795_000_000), botUp: true });
    expect(DAILY_CALL_BOT_VIEW_TYPES.BotView.map((f) => `${f.type} ${f.name}`).join(",")).toBe(
      "uint256 botId,uint32 day,bool botUp",
    );
    expect(td.domain).toEqual({ name: "BotFolio DailyCall", version: "1", chainId: 1990, verifyingContract: DAILY_CALL });
    const signature = await runner.signTypedData(td);
    expect(await recoverTypedDataAddress({ ...td, signature })).toBe(runner.address);
  });
});

describe("helpers", () => {
  it("orderId = keccak256(abi.encode(decisionId, actionIndex))", () => {
    const d: Hex = `0x${"ab".repeat(32)}`;
    expect(orderIdOf(d, 2)).toBe(keccak256(concat([d, `0x${"00".repeat(31)}02`])));
    expect(orderIdOf(d, 0)).not.toBe(orderIdOf(d, 1));
  });

  it("decisionId <-> uuid round-trips", () => {
    const uuid = "0b5e3f6c-2a1d-4c3e-9f8a-7b6c5d4e3f2a";
    const id = decisionIdFromUuid(uuid);
    expect(id).toBe(`0x${"0".repeat(32)}0b5e3f6c2a1d4c3e9f8a7b6c5d4e3f2a`);
    expect(uuidFromDecisionId(id)).toBe(uuid);
    expect(() => decisionIdFromUuid("nope")).toThrow();
  });

  it("istDay flips at IST midnight, not UTC midnight", () => {
    const istMidnight = Date.parse("2026-11-26T00:00:00+05:30") / 1000;
    expect(istDay(istMidnight)).toBe(istDay(istMidnight - 1) + 1);
  });

  it("allowlist: 8 pairs, selectors match their signatures", () => {
    expect(RELAY_ALLOWLIST).toHaveLength(8);
    for (const e of RELAY_ALLOWLIST) expect(e.selector).toBe(toFunctionSelector(`function ${e.signature}`));
  });

  it("findAllowlisted matches (to, selector) only", () => {
    const addresses = {
      BotRegistry: "0x000000000000000000000000000000000000b075",
      SeasonLedger: "0x0000000000000000000000000000000000005ea5",
      PaperLedger: PAPER_LEDGER,
      DailyCall: DAILY_CALL,
      Challenges: "0x000000000000000000000000000000000000c4a1",
    } as const;
    expect(findAllowlisted(addresses, addresses.BotRegistry, "0xf429b088ff")?.fn).toBe("createBot");
    // right selector, wrong contract
    expect(findAllowlisted(addresses, addresses.SeasonLedger, "0xf429b088ff")).toBeNull();
    // admin-only function on an allowlisted contract
    expect(findAllowlisted(addresses, addresses.BotRegistry, toFunctionSelector("function createHouseBot(bytes32,uint16,uint8)"))).toBeNull();
  });
});
