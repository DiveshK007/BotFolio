import { TransactionReceiptNotFoundError, type Address, type Hex, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { verifyTrade } from "../../src/mcp/verify-trade";

const TX = `0x${"ab".repeat(32)}` as Hex;
const LEDGER = `0x${"1".repeat(40)}` as Address;
const client = (fail: Error) => ({ getTransactionReceipt: async () => Promise.reject(fail) }) as unknown as PublicClient;

describe("verify_trade receipt errors", () => {
  it("a missing receipt is 'not found (yet)', not a definitive no", async () => {
    const out = await verifyTrade(client(new TransactionReceiptNotFoundError({ hash: TX })), LEDGER, TX);
    expect(out).toMatchObject({ valid: false, block_number: null, trades: [] });
    expect(out.note).toMatch(/yet.*try again/i);
  });

  it("an RPC failure is thrown, so the MCP handler answers 'try again'", async () => {
    await expect(verifyTrade(client(new Error("fetch failed")), LEDGER, TX)).rejects.toThrow("fetch failed");
  });
});
