import { request as httpRequest } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { loadAllowedOrigins } from "../../src/auth/cors";
import { HealthState } from "../../src/health";
import type { Relay } from "../../src/relay/pipeline";
import { relayRoutes } from "../../src/relay/route";
import { createWorkerServer } from "../../src/server";
import { serve } from "./helpers/http";

const WEB = "https://botfolio.example";
const ok = { status: 200, body: { ok: true, status: "submitted", txHash: "0x01", relayId: "1" } } as const;

async function worker(relay: Relay | null) {
  const health = new HealthState({ provider: "fake", capUsd: null });
  const routes = relayRoutes({ relay, origins: loadAllowedOrigins({ APP_URL: `${WEB}/` }) });
  return serve(createWorkerServer({ health, routes }));
}

const post = (base: string, body: string, headers: Record<string, string> = { "content-type": "application/json" }) =>
  fetch(`${base}/relay`, { method: "POST", body, headers });

describe("/relay over HTTP (#37)", () => {
  it("answers RELAY_DISABLED when it isn't wired", async () => {
    const res = await post(await worker(null), "{}");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "RELAY_DISABLED" } });
  });

  it.each([
    ["bad JSON", "{", "application/json"],
    ["a form post", "a=b", "application/x-www-form-urlencoded"],
    ["too big", JSON.stringify({ pad: "x".repeat(20_000) }), "application/json"],
  ])("BAD_REQUEST for %s", async (_name, body, type) => {
    const relay = vi.fn<Relay>();
    const res = await post(await worker(relay), body, { "content-type": type });
    expect(res.status).toBe(400);
    expect(relay).not.toHaveBeenCalled();
  });

  it("enforces the cap on chunked bodies with no content-length", async () => {
    const relay = vi.fn<Relay>();
    const url = new URL(`${await worker(relay)}/relay`);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(url, { method: "POST", headers: { "content-type": "application/json" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
        req.destroy();
      });
      req.on("error", reject);
      req.write("x".repeat(9_000));
      req.write("x".repeat(9_000));
    });
    expect(status).toBe(400);
    expect(relay).not.toHaveBeenCalled();
  });

  it("allows the app's preflight with exactly its three headers", async () => {
    const res = await fetch(`${await worker(null)}/relay`, { method: "OPTIONS", headers: { origin: WEB } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(res.headers.get("access-control-allow-headers")).toBe("authorization, content-type, x-botfolio-auth");
    expect(res.headers.get("access-control-allow-methods")).toBe("POST");
  });

  it.each(["https://evil.example", "https://botfolio.example.evil.example", "http://botfolio.example", "null"])(
    "refuses a preflight from %s",
    async (origin) => {
      const res = await fetch(`${await worker(null)}/relay`, { method: "OPTIONS", headers: { origin } });
      expect(res.status).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    },
  );

  it("lets the app read errors, but not another site", async () => {
    const base = await worker(null);
    const read = async (origin: string) =>
      (await post(base, "{}", { "content-type": "application/json", origin })).headers.get("access-control-allow-origin");
    expect(await read(WEB)).toBe(WEB);
    expect(await read("https://evil.example")).toBeNull();
  });

  it("passes headers through and sets Retry-After", async () => {
    const relay = vi.fn<Relay>(async () => ({
      status: 429,
      body: { ok: false, error: { code: "RATE_LIMITED_USER", message: "later", retryAfterSeconds: 42 } },
    }));
    const base = await worker(relay);
    const res = await post(base, "{}", { "content-type": "application/json", "x-botfolio-auth": "siwe" });
    expect(res.headers.get("retry-after")).toBe("42");
    expect(relay.mock.calls[0]![0].headers["x-botfolio-auth"]).toBe("siwe");
    relay.mockResolvedValue(ok);
    expect((await post(base, "{}")).status).toBe(200);
  });

  it("takes several origins from WEB_ORIGINS and no wildcards", () => {
    const origins = loadAllowedOrigins({ WEB_ORIGINS: "*, https://*.vercel.app, https://a.example, http://localhost:3000, http://b.example" });
    expect([...origins]).toEqual(["https://a.example", "http://localhost:3000"]);
  });
});
