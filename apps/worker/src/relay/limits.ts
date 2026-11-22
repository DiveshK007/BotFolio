import type { Env } from "../auth/env";

export interface RelayRateLimits {
  perWalletPerDay: number;
  perHourGlobal: number;
  newBotsPerIpPerDay: number;
}

const LIMIT_ENV: Record<keyof RelayRateLimits, { name: string; fallback: number }> = {
  perWalletPerDay: { name: "RELAY_MAX_PER_USER_PER_DAY", fallback: 30 },
  perHourGlobal: { name: "RELAY_MAX_GLOBAL_PER_HOUR", fallback: 2000 },
  newBotsPerIpPerDay: { name: "NEW_BOTS_PER_IP_PER_DAY", fallback: 3 },
};

/**
 * SPEC §10's env, defaulting to §11's numbers. A value that doesn't parse is reported rather than guessed:
 * "Infinity" or a typo must not become "no limit".
 */
export function loadRateLimits(env: Env): { ok: true; limits: RelayRateLimits } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const read = ({ name, fallback }: { name: string; fallback: number }): number => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    if (/^[1-9]\d{0,5}$/.test(raw)) return Number(raw);
    problems.push(name);
    return 0;
  };
  const limits: RelayRateLimits = {
    perWalletPerDay: read(LIMIT_ENV.perWalletPerDay),
    perHourGlobal: read(LIMIT_ENV.perHourGlobal),
    newBotsPerIpPerDay: read(LIMIT_ENV.newBotsPerIpPerDay),
  };
  return problems.length ? { ok: false, problems } : { ok: true, limits };
}
