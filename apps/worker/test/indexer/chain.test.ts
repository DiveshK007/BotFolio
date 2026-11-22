import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { ChainError, createChainSource } from "../../src/indexer/chain";
import { ADDRESSES } from "./helpers/fake-chain";

type Call = { method: string; params: unknown[] };

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

/** A JSON-RPC server. `answer` returns the result, or throws for an RPC error. */
async function rpc(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      calls.push({ method, params });
      let reply: object;
      try {
        reply = { result: answer({ method, params }) };
      } catch {
        reply = { error: { code: -32602, message: "no" } };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, ...reply }));
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/?apikey=secret-key`, calls };
}

it("filters getLogs to the seven configured addresses and the exact range", async () => {
  const { url, calls } = await rpc(() => []);
  await createChainSource(url, ADDRESSES).logs(256n, 512n);
  expect(calls[0]!.method).toBe("eth_getLogs");
  expect(calls[0]!.params[0]).toMatchObject({
    address: Object.values(ADDRESSES),
    fromBlock: "0x100",
    toBlock: "0x200",
  });
});

it("asks for a fresh head every time (viem caches it for 4 s)", async () => {
  let head = 10;
  const { url } = await rpc(() => `0x${(head++).toString(16)}`);
  const source = createChainSource(url, ADDRESSES);
  expect(await source.head()).toBe(10n);
  expect(await source.head()).toBe(11n);
});

it("refuses another chain", async () => {
  const { url } = await rpc(() => "0x1");
  await expect(createChainSource(url, ADDRESSES).check()).rejects.toThrow(/chain 1, not 1990/);
});

it("refuses an address with no contract, which would otherwise look like a quiet chain", async () => {
  const { url } = await rpc(({ method, params }) => {
    if (method === "eth_chainId") return "0x7c6";
    return params[0] === ADDRESSES.DailyCall ? "0x" : "0x6001";
  });
  await expect(createChainSource(url, ADDRESSES).check()).rejects.toThrow(/no code at the DailyCall/);
});

it("turns RPC errors into ChainError without the URL, which can hold an API key", async () => {
  const { url } = await rpc(() => {
    throw new Error("no");
  });
  const error = await createChainSource(url, ADDRESSES).logs(1n, 2n).catch((e: Error) => e);
  expect(error).toBeInstanceOf(ChainError);
  expect((error as Error).message).not.toContain("secret-key");
});

it("refuses pending logs", async () => {
  const { url } = await rpc(() => [
    {
      address: ADDRESSES.BotRegistry,
      topics: [],
      data: "0x",
      blockNumber: null,
      transactionHash: null,
      logIndex: null,
    },
  ]);
  await expect(createChainSource(url, ADDRESSES).logs(1n, 2n)).rejects.toThrow(/pending log/);
});
