import { createServer, type Server } from "node:http";
import {
  SIWE_STATEMENT,
  forwardRequestToJson,
  forwardRequestTypedData,
  toForwardRequest,
  type AuthNonceResponse,
  type ForwardRequestJson,
  type RelayResponse,
} from "@botfolio/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSiweMessage } from "viem/siwe";
import { encodeFunctionData, toHex, type Abi, type Address, type Hex, type LocalAccount } from "viem";
import type { HDAccount } from "viem/accounts";
import { authRoutes } from "../../src/auth/routes";
import { setUpAuth, type AuthSetup } from "../../src/auth/setup";
import { HealthState } from "../../src/health";
import { FORWARDER_ABI } from "../../src/relay/abis";
import { CANCEL_AFTER_MS, NonceManager } from "../../src/relay/nonce-manager";
import { RelayRpc } from "../../src/relay/rpc";
import { relayRoutes } from "../../src/relay/route";
import { setUpRelayer, type RelayerService } from "../../src/relay/setup";
import { createWorkerServer } from "../../src/server";
import { anvilReady, buildArtifacts, deploy, forkClients, startFork } from "./helpers/anvil";
import { testDb } from "./helpers/db";
import { RELAYER, fakeReservation, lower, testAccount } from "./helpers/fakes";

const WEB = "https://botfolio.example";
/** From Anvil's public test mnemonic. */
const RELAYER_KEY = () => toHex(RELAYER.getHdKey().privateKey!);

describe.skipIf(!anvilReady)("relayer end to end on a QIE mainnet fork (#40)", () => {
  let url: string;
  let stop = () => {};
  let server: Server;
  let base: string;
  let auth: AuthSetup;
  let service: RelayerService;
  let sql: Awaited<ReturnType<typeof testDb>>["pg"];
  let forwarder: Address;
  let registry: Address;
  let abi: Abi;
  const log = vi.fn();

  beforeAll(async () => {
    const built = buildArtifacts();
    ({ url, stop } = await startFork(["--block-time", "1"]));
    forwarder = await deploy(url, built.forwarder);
    const targets: Address[] = [];
    for (let i = 0; i < 5; i++) targets.push(await deploy(url, built.target, [forwarder]));
    registry = targets[0]!;
    abi = built.target.abi;

    const env = {
      RELAY_ENABLED: "true",
      RELAYER_PRIVATE_KEY: RELAYER_KEY(),
      DATABASE_URL: "postgres://unused@127.0.0.1/unused", // PGlite is injected below
      RELAY_JWT_SECRET: "anvil-test-only-signing-key-0123456789abcdef",
      SIWE_DOMAIN: "botfolio.example",
      NEXT_PUBLIC_PRIVY_APP_ID: "cltestappid0000000000000",
      PRIVY_APP_SECRET: "test-privy-app-secret-not-real",
      FORWARDER_ADDRESS: forwarder,
      BOT_REGISTRY_ADDRESS: registry,
      SEASON_LEDGER_ADDRESS: targets[1],
      PAPER_LEDGER_ADDRESS: targets[2],
      DAILY_CALL_ADDRESS: targets[3],
      CHALLENGES_ADDRESS: targets[4],
    };
    const { db, pg } = await testDb();
    sql = pg;
    // /relay needs the 18+ and Terms row (#219), which POST /persona writes in the app.
    for (let i = 1; i <= 80; i++) {
      await pg.query("insert into users (wallet_address, terms_accepted_at) values ($1, now())", [lower(testAccount(i).address)]);
    }
    auth = setUpAuth(env);
    service = setUpRelayer({ env, auth, rpcUrls: [url], log, openDatabase: () => ({ ...db, close: async () => {} }) });
    service.start();

    const origins = new Set([WEB]);
    const clientIp = () => "203.0.113.9";
    const routes = {
      ...authRoutes({ origins, clientIp, log, siwe: auth.siwe }),
      ...relayRoutes({ relay: service.relay, origins, clientIp }),
    };
    server = createWorkerServer({ health: new HealthState({ provider: "fake", capUsd: null }), routes });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }, 180_000);

  afterAll(async () => {
    await service?.stop();
    server?.closeAllConnections();
    server?.close();
    stop();
  });

  const call = (fn: string, args: unknown[]) => encodeFunctionData({ abi, functionName: fn, args });

  async function sign(account: HDAccount, data: Hex): Promise<ForwardRequestJson> {
    const { publicClient } = forkClients(url);
    const nonce = (await publicClient.readContract({
      address: forwarder,
      abi: FORWARDER_ABI,
      functionName: "nonces",
      args: [account.address],
    })) as bigint;
    const deadline = Math.floor(Date.now() / 1000) + 300;
    const message = { from: account.address, to: registry, value: 0n, gas: 300_000n, nonce, deadline, data };
    const signature = await account.signTypedData(forwardRequestTypedData(forwarder, message));
    return forwardRequestToJson(toForwardRequest(message, signature));
  }

  async function post(request: ForwardRequestJson, token: string): Promise<RelayResponse> {
    const res = await fetch(`${base}/relay`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-botfolio-auth": "siwe", origin: WEB },
      body: JSON.stringify({ request }),
    });
    return (await res.json()) as RelayResponse;
  }

  const tokenFor = async (account: HDAccount) => (await auth.siwe!.jwt.sign(lower(account.address))).token;

  async function settled(): Promise<void> {
    await vi.waitFor(
      async () => {
        const { rows } = await sql.query<{ n: number }>("select count(*)::int as n from relay_log where status = 'submitted'");
        expect(rows[0]!.n).toBe(0);
      },
      { timeout: 60_000, interval: 500 },
    );
  }

  it("QIE Wallet path: nonce → sign → JWT → createBot, mined and logged as confirmed", async () => {
    const user = testAccount(5);
    const issued = (await (await fetch(`${base}/auth/nonce`)).json()) as AuthNonceResponse;
    const message = createSiweMessage({
      domain: "botfolio.example",
      address: user.address,
      statement: SIWE_STATEMENT,
      uri: `${WEB}/create`,
      version: "1",
      chainId: 1990,
      nonce: issued.nonce,
      issuedAt: new Date(issued.issuedAt),
    });
    const verified = await fetch(`${base}/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature: await user.signMessage({ message }) }),
    });
    const { token } = (await verified.json()) as { token: string };

    const result = await post(await sign(user, call("createBot", [`0x${"11".repeat(32)}`, 4000, 3])), token);
    if (!result.ok) throw new Error(result.error.code);
    await settled();

    const { publicClient } = forkClients(url);
    const receipt = await publicClient.getTransactionReceipt({ hash: result.txHash });
    expect(receipt.status).toBe("success");
    expect(await publicClient.readContract({ address: registry, abi, functionName: "botOf", args: [user.address] })).toBe(1n);

    const { rows } = await sql.query<Record<string, unknown>>("select * from relay_log where id = $1", [result.relayId]);
    expect(rows[0]).toMatchObject({ status: "confirmed", tx_hash: result.txHash, user_wallet: lower(user.address) });
    expect(Number(rows[0]!.gas_used)).toBe(Number(receipt.gasUsed));
  });

  it("refuses a revert before spending gas", async () => {
    const { publicClient } = forkClients(url);
    const user = testAccount(6);
    const before = await publicClient.getTransactionCount({ address: RELAYER.address, blockTag: "pending" });
    const result = await post(await sign(user, call("setActive", [404n, true])), await tokenFor(user));
    expect(result).toMatchObject({ ok: false, error: { code: "WOULD_REVERT", revertReason: "PriceTooOld" } });
    expect(await publicClient.getTransactionCount({ address: RELAYER.address, blockTag: "pending" })).toBe(before);
  });

  it("50 parallel relays: no nonce collisions, all mined, all counted as the users'", async () => {
    const { publicClient } = forkClients(url);
    const users = Array.from({ length: 50 }, (_, i) => testAccount(20 + i));
    const jobs = await Promise.all(
      users.map(async (user) => ({ request: await sign(user, call("setActive", [1n, true])), token: await tokenFor(user) })),
    );
    const first = await publicClient.getTransactionCount({ address: RELAYER.address, blockTag: "pending" });

    const results = await Promise.all(jobs.map((job) => post(job.request, job.token)));
    expect(results.filter((r) => !r.ok)).toEqual([]);
    await settled();

    const hashes = results.map((r) => (r.ok ? r.txHash : ("0x" as Hex)));
    const receipts = await Promise.all(hashes.map((hash) => publicClient.getTransactionReceipt({ hash })));
    expect(receipts.every((r) => r.status === "success")).toBe(true);
    const txs = await Promise.all(hashes.map((hash) => publicClient.getTransaction({ hash })));
    expect(txs.map((tx) => tx.nonce).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => first + i));
    for (const user of users) {
      expect(await publicClient.readContract({ address: registry, abi, functionName: "actions", args: [user.address] })).toBe(1n);
    }

    const stats = await sql.query<{ user_signed_txs: number; unique_signers: number }>("select * from site_activity_stats");
    expect(Number(stats.rows[0]!.user_signed_txs)).toBe(51);
    expect(Number(stats.rows[0]!.unique_signers)).toBe(51);
    const own = await sql.query("select 1 from relay_log where user_wallet = $1", [lower(RELAYER.address)]);
    expect(own.rows).toHaveLength(0);
  });

  it("the same signed request 15 times at once lands once", async () => {
    const { publicClient } = forkClients(url);
    const user = testAccount(80);
    const request = await sign(user, call("setActive", [1n, true]));
    const token = await tokenFor(user);
    const before = await publicClient.getTransactionCount({ address: RELAYER.address, blockTag: "pending" });
    const results = await Promise.all(Array.from({ length: 15 }, () => post(request, token)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    await settled();
    expect(await publicClient.getTransactionCount({ address: RELAYER.address })).toBe(before + 1);
  });
});

describe.skipIf(!anvilReady)("nonce manager against a real node (#40)", () => {
  let url: string;
  let stop = () => {};

  beforeAll(async () => {
    ({ url, stop } = await startFork());
  }, 120_000);
  afterAll(() => stop());

  const rpc = async (method: string, params: unknown[] = []) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    return (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })).json()) as {
      result: any;
    };
  };

  const send = (manager: NonceManager, reservation = fakeReservation(), now = Date.now()) =>
    manager.send({ to: testAccount(9).address, data: "0x", gas: 30_000n, deadline: Math.floor(now / 1000) + 300, reservation });

  it("a lost broadcast answer doesn't double send", async () => {
    let dropped = false;
    const proxy = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", async () => {
        const body = Buffer.concat(chunks).toString();
        const answer = await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })).text();
        if (!dropped && body.includes("eth_sendRawTransaction")) {
          dropped = true;
          return void req.socket.destroy(); // the node has it, we never hear back
        }
        res.writeHead(200, { "content-type": "application/json" }).end(answer);
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    try {
      const proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
      const manager = new NonceManager({ rpc: new RelayRpc([proxyUrl]), account: RELAYER as LocalAccount, log: vi.fn() });
      const start = Number((await rpc("eth_getTransactionCount", [RELAYER.address, "latest"])).result);
      const lost = await send(manager);
      const next = await send(manager);
      expect(dropped).toBe(true);
      expect(lost.txHash).not.toBe(next.txHash);
      await vi.waitFor(async () => {
        expect(Number((await rpc("eth_getTransactionCount", [RELAYER.address, "latest"])).result)).toBe(start + 2);
      });
      expect(Number((await rpc("eth_getTransactionByHash", [lost.txHash])).result.nonce)).toBe(start);
    } finally {
      proxy.closeAllConnections();
      proxy.close();
    }
  });

  it("a priced-out head is replaced by the no-op and is never confirmed", async () => {
    let time = Date.now();
    const manager = new NonceManager({ rpc: new RelayRpc([url]), account: RELAYER as LocalAccount, log: vi.fn(), now: () => time });
    await rpc("evm_setAutomine", [false]);
    const reservation = fakeReservation();
    const { txHash } = await send(manager, reservation, time);

    const pending = (await rpc("eth_getTransactionByHash", [txHash])).result;
    const aboveItsCap = toHex(BigInt(pending.maxFeePerGas) + 1n);
    await rpc("anvil_setNextBlockBaseFeePerGas", [aboveItsCap]);
    await rpc("evm_mine");
    await manager.tick();
    time += CANCEL_AFTER_MS;
    await manager.tick();
    await rpc("anvil_setNextBlockBaseFeePerGas", [aboveItsCap]);
    await rpc("evm_mine");
    await manager.tick();

    expect((await rpc("eth_getTransactionReceipt", [txHash])).result).toBeNull();
    expect(reservation.recordOutcome).toHaveBeenCalledExactlyOnceWith("cancelled", 21_000n, expect.any(String));
  });
});
