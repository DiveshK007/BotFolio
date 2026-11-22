import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { createClientIp, ipKey } from "../../src/auth/client-ip";
import { Throttle } from "../../src/auth/throttle";

const req = (forwarded?: string) =>
  ({ socket: { remoteAddress: "10.0.0.7" }, headers: forwarded ? { "x-forwarded-for": forwarded } : {} }) as unknown as IncomingMessage;

describe("client IP", () => {
  it("ignores X-Forwarded-For by default", () => {
    expect(createClientIp({})(req("1.2.3.4"))).toBe("10.0.0.7");
  });

  it("reads only the entry our proxy appended, whatever the client put in front", () => {
    const ip = createClientIp({ TRUSTED_PROXY_HOPS: "1" });
    expect(ip(req("198.51.100.4"))).toBe("198.51.100.4");
    expect(ip(req("1.1.1.1, 198.51.100.4"))).toBe("198.51.100.4");
    expect(ip(req("9.9.9.9, 8.8.8.8, 198.51.100.4"))).toBe("198.51.100.4");
  });

  it("uses the socket when the chain is shorter or junk", () => {
    expect(createClientIp({ TRUSTED_PROXY_HOPS: "2" })(req("1.1.1.1"))).toBe("10.0.0.7");
    expect(createClientIp({ TRUSTED_PROXY_HOPS: "1" })(req("not-an-ip"))).toBe("10.0.0.7");
    expect(createClientIp({ TRUSTED_PROXY_HOPS: "1" })(req())).toBe("10.0.0.7");
  });

  it.each(["-1", "99", "true", "1.5"])("treats TRUSTED_PROXY_HOPS=%s as 0", (value) => {
    expect(createClientIp({ TRUSTED_PROXY_HOPS: value })(req("1.1.1.1"))).toBe("10.0.0.7");
  });

  it("groups IPv6 by /64 and unwraps mapped IPv4", () => {
    expect(ipKey("2001:db8:1:2:aaaa::1")).toBe(ipKey("2001:0DB8:0001:0002:ffff:ffff:ffff:ffff"));
    expect(ipKey("2001:db8:1:3::1")).not.toBe(ipKey("2001:db8:1:2::1"));
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipKey("::1")).toBe("0:0:0:0::/64");
    expect(ipKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(ipKey("2001:db8:1:2::1.2.3.4")).toBe("2001:db8:1:2::/64");
  });

  it("throttle is bounded and resets after the window", () => {
    let now = 0;
    const throttle = new Throttle(1, 1000, 2, () => now);
    expect(throttle.take("a")).toBeNull();
    expect(throttle.take("a")).toBe(1);
    expect(throttle.take("b")).toBeNull();
    expect(throttle.take("c")).toBeNull(); // evicts a
    expect(throttle.take("a")).toBeNull();
    now = 1000;
    expect(throttle.take("a")).toBeNull();
  });
});
