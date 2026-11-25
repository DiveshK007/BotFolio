import { describe, expect, it } from "vitest";
import { clientIp, limitByIp, RateLimit } from "./rate-limit";

describe("RateLimit", () => {
  it("allows the limit per window, then says how long to wait, then resets", () => {
    let now = 0;
    const r = new RateLimit(2, 60_000, 10, () => now);
    expect(r.take("a")).toBeNull();
    expect(r.take("a")).toBeNull();
    expect(r.take("b")).toBeNull();
    now = 15_000;
    expect(r.take("a")).toBe(45);
    now = 60_000;
    expect(r.take("a")).toBeNull();
  });

  it("stays bounded by dropping the oldest key", () => {
    const r = new RateLimit(1, 60_000, 2, () => 0);
    expect(r.take("a")).toBeNull();
    expect(r.take("b")).toBeNull();
    expect(r.take("c")).toBeNull(); // drops "a"
    expect(r.take("a")).toBeNull();
    expect(r.take("c")).not.toBeNull();
  });
});

describe("clientIp", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("prefers x-real-ip, then the first x-forwarded-for entry, else one shared bucket", () => {
    expect(clientIp(h({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(h({ "x-forwarded-for": "2001:DB8::1" }))).toBe("2001:db8::1");
    expect(clientIp(h({}))).toBe("unknown");
  });
});

describe("limitByIp", () => {
  it("answers 429 with retry-after once an IP is over, and leaves other IPs alone", async () => {
    const r = new RateLimit(1, 60_000, 10, () => 0);
    const req = (ip: string) => new Request("https://botfolio.example/api/v1/x", { headers: { "x-real-ip": ip } });
    expect(limitByIp(req("1.1.1.1"), r)).toBeNull();
    const res = limitByIp(req("1.1.1.1"), r, { "access-control-allow-origin": "*" })!;
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toMatchObject({ error: { code: "RATE_LIMITED", retryAfterSeconds: 60 } });
    expect(limitByIp(req("2.2.2.2"), r)).toBeNull();
  });
});
