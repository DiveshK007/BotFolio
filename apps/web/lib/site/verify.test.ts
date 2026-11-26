import { describe, expect, it } from "vitest";
import { encodeEventTopics, encodeAbiParameters, type Abi, type Hex } from "viem";
import paperLedgerJson from "../../../../packages/contracts/abi/PaperLedger.json";
import { decodeTrades } from "./verify";

const ABI = paperLedgerJson as Abi;
const PL = `0x${"a".repeat(40)}`;
const DEC = `0x${"d".repeat(64)}` as Hex;

const tradeLog = (address: string) => ({
  address,
  topics: encodeEventTopics({ abi: ABI, eventName: "Trade", args: { botId: 7n, asset: 0, decisionId: DEC } }) as Hex[],
  data: encodeAbiParameters(
    [{ type: "bool" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }, { type: "uint256" }, { type: "uint8" }],
    [true, 10_000_000_000n, 1_500_000_000_000_000n, 6_392_295_000_000n, 50887n, 1_795_000_000n, 1],
  ),
});
const approvedLog = {
  address: PL,
  topics: encodeEventTopics({ abi: ABI, eventName: "ApprovedTrade", args: { botId: 7n, decisionId: DEC, owner: `0x${"1".repeat(40)}` } }) as Hex[],
  data: encodeAbiParameters([{ type: "uint8" }], [1]),
};

describe("decodeTrades (Verify any tx)", () => {
  it("decodes a runner Trade from PaperLedger: round, price, asset", () => {
    const [t] = decodeTrades([tradeLog(PL)], PL);
    expect(t).toMatchObject({ botId: "7", asset: "BTC", side: "BUY", priceE8: "6392295000000", roundId: "50887", ownerApproved: false });
    expect(t!.oracleUpdatedAt).toBe(new Date(1_795_000_000_000).toISOString());
  });
  it("marks it owner-signed when ApprovedTrade for the same order is in the tx", () => {
    expect(decodeTrades([tradeLog(PL), approvedLog], PL)[0]!.ownerApproved).toBe(true);
  });
  it("ignores look-alike logs from other contracts, and decodes nothing without the address", () => {
    expect(decodeTrades([tradeLog(`0x${"b".repeat(40)}`)], PL)).toEqual([]);
    expect(decodeTrades([tradeLog(PL)], undefined)).toEqual([]);
  });
});
