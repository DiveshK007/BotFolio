import { forwardRequestFromJson } from "@botfolio/shared";
import { describe, expect, it } from "vitest";
import { concat, encodeErrorResult, numberToHex, pad, parseAbi, type Hex } from "viem";
import { ForwarderChain, intrinsicGas } from "../../src/relay/chain";
import { RelayRpc } from "../../src/relay/rpc";
import { CREATE_BOT, FORWARDER, REGISTRY, RELAYER, USER, lower, signedRequest } from "./helpers/fakes";
import { fakeNode, type RpcAnswer } from "./helpers/http";

const YES = { result: pad("0x01") };
const reverted = (data?: Hex): RpcAnswer =>
  data
    ? { error: { code: 3, message: "execution reverted", data } }
    : { error: { code: -32000, message: "execution reverted" } };

interface Node {
  verify?: RpcAnswer;
  inner?: RpcAnswer;
  estimate?: RpcAnswer;
}

async function prepare(node: Node, gas = 300_000n) {
  const { url, calls } = await fakeNode((method, [call]) => {
    if (method === "eth_estimateGas") return node.estimate ?? { result: numberToHex(120_000) };
    return call.from ? (node.inner ?? { result: "0x" }) : (node.verify ?? YES);
  });
  const signed = forwardRequestFromJson(await signedRequest({ gas }));
  const request = { ...signed, from: lower(signed.from) };
  const result = new ForwarderChain(new RelayRpc([url]), FORWARDER, RELAYER.address).prepare(request);
  return { result, calls, request };
}

describe("pre-checks before spending gas (#37)", () => {
  it("simulates the ERC-2771 sender, the 20-byte suffix and the gas limit", async () => {
    const { result, calls } = await prepare({});
    await result;
    const data = concat([CREATE_BOT, lower(USER.address)]);
    expect(calls.map((c) => c.method)).toEqual(["eth_call", "eth_call", "eth_estimateGas"]);
    expect(calls[1]!.params[0]).toEqual({
      from: FORWARDER,
      to: REGISTRY,
      data,
      gas: numberToHex(300_000n + intrinsicGas(data)),
    });
    expect(calls[2]!.params[0]).toMatchObject({ from: RELAYER.address, to: FORWARDER });
  });

  it.each([
    ["false", { result: pad("0x00") }],
    ["a word that isn't exactly true", { result: pad("0x02") }],
    ["a revert", reverted()],
  ])("INVALID_SIGNATURE when verify returns %s, with no further calls", async (_name, verify) => {
    const { result, calls } = await prepare({ verify });
    await expect(result).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    expect(calls).toHaveLength(1);
  });

  // PaperLedger.executeApproved and DailyCall.call both revert on a stale price, with different selectors (#151).
  it.each([
    ["PaperLedger", encodeErrorResult({ abi: parseAbi(["error PriceTooOld(uint8 asset)"]), args: [2] })],
    ["DailyCall", encodeErrorResult({ abi: parseAbi(["error PriceTooOld()"]) })],
  ])("WOULD_REVERT with plain words for %s's stale-price error", async (_name, data) => {
    const { result, calls } = await prepare({ inner: reverted(data) });
    await expect(result).rejects.toMatchObject({
      code: "WOULD_REVERT",
      details: { revertReason: "PriceTooOld", message: "Price too old. Try again in a few minutes." },
    });
    expect(calls.some((c) => c.method === "eth_estimateGas")).toBe(false);
  });

  it.each([
    reverted(),
    { error: { code: -32000, message: "rpc error: code = Internal desc = out of gas" } },
    { error: { code: -32000, message: "rpc error: code = Internal desc = apply message: intrinsic gas too low" } },
  ])("WOULD_REVERT for the failures QIE reports without data (%j)", async (inner) => {
    await expect((await prepare({ inner })).result).rejects.toMatchObject({ code: "WOULD_REVERT" });
  });

  it("cleans and truncates Error(string)", async () => {
    const data = encodeErrorResult({ abi: parseAbi(["error Error(string)"]), args: [`bad\n‮${"x".repeat(500)}`] });
    const error = await (await prepare({ inner: reverted(data) })).result.catch((e) => e);
    expect(error.details.revertReason).toMatch(/^[ -~]{1,120}$/);
  });

  it("WOULD_REVERT when only the whole execute fails", async () => {
    await expect((await prepare({ estimate: reverted() })).result).rejects.toMatchObject({ code: "WOULD_REVERT" });
  });

  it.each([
    ["verify", { verify: "drop" }],
    ["verify garbage", { verify: { result: "0x" } }],
    ["inner", { inner: "drop" }],
    ["estimate", { estimate: "drop" }],
    ["node fault", { inner: { error: { code: -32603, message: "internal error" } } }],
  ] as [string, Node][])("RPC_UNAVAILABLE when %s can't be checked", async (_name, node) => {
    await expect((await prepare(node)).result).rejects.toMatchObject({ code: "RPC_UNAVAILABLE" });
  });

  it("sizes the limit from the estimate, capped by request.gas", async () => {
    expect((await (await prepare({})).result).gas).toBe(165_000n);
    const small = await (await prepare({ estimate: { result: numberToHex(190_000) } }, 50_000n)).result;
    expect(small.gas).toBeLessThan(225_000n);
  });

  it("uses the ceiling when the node answers with bare intrinsic gas (#339)", async () => {
    const { result, request } = await prepare({ estimate: { result: numberToHex(21_544) } });
    const prepared = await result;
    expect(prepared.gas).toBe(intrinsicGas(prepared.data) + (request.gas * 64n) / 63n + 120_000n);
  });

  it("refuses an absurd estimate", async () => {
    const { result } = await prepare({ estimate: { result: numberToHex(30_000_000) } });
    await expect(result).rejects.toMatchObject({ reason: "gas_estimate_above_ceiling" });
  });

  it("fails over to the next RPC, then remembers the dead one", async () => {
    const dead = await fakeNode(() => "drop");
    const live = await fakeNode(() => YES);
    const rpc = new RelayRpc([dead.url, live.url]);
    const read = () => rpc.read("eth_call", [{}, "latest"], (v): v is string => typeof v === "string");
    await read();
    await read();
    expect(live.calls).toHaveLength(2);
    expect(dead.calls).toHaveLength(1);
  });
});
