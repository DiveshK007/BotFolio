import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createQiePublicClient } from "../src/chain";

const servers: Server[] = [];

function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const s = createServer(handler);
  servers.push(s);
  return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe("createQiePublicClient failover", () => {
  it("moves to the next RPC when the first drops the connection", async () => {
    // Like rpc1/rpc2 dropping TLS: the socket is closed with no response.
    const broken = await listen((req) => req.socket.destroy());
    let healthyHits = 0;
    const healthy = await listen((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        healthyHits++;
        const { id } = JSON.parse(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result: "0x7c6" })); // 1990
      });
    });

    const client = createQiePublicClient({ chainId: 1990, rpcUrls: [broken, healthy] });
    expect(await client.getChainId()).toBe(1990);
    expect(healthyHits).toBe(1);
  });
});
