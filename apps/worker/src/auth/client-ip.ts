import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import type { Env } from "./env";

/**
 * The client IP for per-IP limits.
 *
 * X-Forwarded-For is client-controlled on the left, and proxies append on the right. So we only read the entry
 * our own proxies wrote: TRUSTED_PROXY_HOPS from the right. The default is 0 (ignore the header, use the socket).
 * Behind Render that lumps users together, which is too strict rather than spoofable.
 *
 * UNVERIFIED: how many hops Render adds. Read one real header after deploy before setting the variable: a value
 * that is too high would trust an entry the client wrote.
 */
export function createClientIp(env: Env): (req: IncomingMessage) => string {
  const raw = env.TRUSTED_PROXY_HOPS?.trim() ?? "";
  const hops = /^[0-5]$/.test(raw) ? Number(raw) : 0;

  return (req) => {
    const socket = req.socket.remoteAddress ?? "unknown";
    if (hops === 0) return ipKey(socket);
    const header = req.headers["x-forwarded-for"];
    const chain = (Array.isArray(header) ? header.join(",") : (header ?? "")).split(",").map((s) => s.trim());
    const candidate = chain[chain.length - hops];
    return ipKey(candidate && isIP(candidate) ? candidate : socket);
  };
}

/** IPv4 as is, IPv6 by /64: one subscriber usually owns a whole /64. */
export function ipKey(address: string): string {
  const ip = address.split("%")[0]!.toLowerCase();
  if (isIP(ip) !== 6) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return mapped[1]!;
  // An embedded IPv4 is two hextets, and only matters below the /64 we keep.
  const [head = "", tail] = ip.replace(/\d+\.\d+\.\d+\.\d+$/, "0:0").split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const gap = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill("0");
  return `${[...left, ...gap, ...right].slice(0, 4).map((h) => parseInt(h, 16).toString(16)).join(":")}::/64`;
}
