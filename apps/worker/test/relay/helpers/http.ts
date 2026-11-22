import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach } from "vitest";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => {
      s.closeAllConnections();
      return new Promise((resolve) => s.close(resolve));
    }),
  );
});

export function serve(server: Server): Promise<string> {
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
}

export type RpcAnswer = { result: unknown } | { error: { code: number; message: string; data?: string } } | "drop";

/** A JSON-RPC node that answers from `answer` and records what it was asked. */
export async function fakeNode(answer: (method: string, params: any[]) => RpcAnswer) {
  const calls: { method: string; params: any[] }[] = [];
  const listener: RequestListener = (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      calls.push({ method, params });
      const reply = answer(method, params);
      if (reply === "drop") return void req.socket.destroy();
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id, ...reply }));
    });
  };
  return { url: await serve(createServer(listener)), calls };
}
