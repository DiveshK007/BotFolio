import { formatEther, parseEther, type Address } from "viem";
import type { Env } from "../auth/env";
import type { HealthState } from "../health";
import { errorLabel, type Log } from "../scheduler/log";
import { systemAccount, type SystemKey } from "../system/key";

/** A stuck condition repeats at most this often per kind. */
export const ALERT_COOLDOWN_MS = 60 * 60_000;

export interface Alerts {
  /** Never throws. `text` must be ours: addresses, balances, job names, reason codes. No secrets, no LLM text. */
  notify(kind: string, text: string): Promise<void>;
}

interface AlertsOptions {
  env: Env;
  log: Log;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

/**
 * POSTs `{text, content, kind, at}` to ALERT_WEBHOOK_URL. `text` is what Slack incoming webhooks read and
 * `content` what Discord webhooks read (both UNVERIFIED against a live hook). Unset: logs once, sends nothing.
 * The URL carries the hook's token, so it is never logged.
 */
export function createAlerts({ env, log, fetch = globalThis.fetch, now = Date.now }: AlertsOptions): Alerts {
  const raw = env.ALERT_WEBHOOK_URL?.trim() ?? "";
  const url = URL.canParse(raw) && new URL(raw).protocol === "https:" ? raw : null;
  if (!url) log.warn("alerts.disabled", { env: "ALERT_WEBHOOK_URL" });
  const lastSent = new Map<string, number>();

  return {
    async notify(kind, text) {
      const at = now();
      const last = lastSent.get(kind);
      if (last !== undefined && at - last < ALERT_COOLDOWN_MS) return;
      lastSent.set(kind, at);
      log.warn("alerts.notify", { kind, sent: url !== null });
      if (!url) return;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, content: text, kind, at: new Date(at).toISOString() }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw Object.assign(new Error(), { code: `http_${res.status}` });
      } catch (error) {
        lastSent.delete(kind); // try again on the next check
        log.warn("alerts.send_failed", { kind, error: errorLabel(error) });
      }
    },
  };
}

export interface HotWallet {
  label: string;
  address: Address;
}

const HOT_WALLETS: Record<string, SystemKey> = {
  relayer: "RELAYER_PRIVATE_KEY",
  runner: "RUNNER_PRIVATE_KEY",
  committer: "COMMITTER_PRIVATE_KEY",
};

/** The hot wallets this deploy has keys for (SPEC §11). Only addresses leave this function. */
export function hotWallets(env: Env): HotWallet[] {
  return Object.entries(HOT_WALLETS).flatMap(([label, key]) => {
    const account = systemAccount(env, key);
    return account ? [{ label, address: account.address }] : [];
  });
}

/** LOW_BALANCE_ALERT_QIE in wei; SPEC §4 says alert below 2 QIE. Null if it isn't a number. */
export function lowBalanceWei(env: Env): bigint | null {
  const raw = env.LOW_BALANCE_ALERT_QIE?.trim() || "2";
  try {
    return /^\d+(\.\d+)?$/.test(raw) ? parseEther(raw) : null;
  } catch {
    return null;
  }
}

export interface AlertCheckDeps {
  alerts: Alerts;
  health: HealthState;
  wallets: HotWallet[];
  minWei: bigint | null;
  getBalance: (address: Address) => Promise<bigint>;
  log: Log;
}

/**
 * One pass over what needs a human: hot wallets under the float, the LLM budget past 80 % or used up
 * (as HealthState has it from src/budget), and jobs that failed or never started. Routine stale-oracle holds
 * are not failures and don't alert. `seen` keeps one-off events from repeating: each failed run, each
 * budget state per month and each start problem alert once.
 */
export async function checkAlerts(deps: AlertCheckDeps, seen: Map<string, string>, now: Date = new Date()): Promise<void> {
  const { alerts, health, log } = deps;
  const once = (key: string, value: string, kind: string, text: string) => {
    if (seen.get(key) === value) return;
    seen.set(key, value);
    return alerts.notify(kind, text);
  };
  const sends: (Promise<void> | undefined)[] = [];
  const snap = health.snapshot(now);

  const { budget, spentUsd, capUsd, month } = snap.llm;
  if (budget === "alert" || budget === "resting") {
    const spend = `$${spentUsd.toFixed(2)} of $${capUsd} in ${month}`;
    const text = budget === "resting" ? `LLM budget used up, bots resting: ${spend}` : `LLM budget above 80 %: ${spend}`;
    sends.push(once("llm_budget", `${month}:${budget}`, `llm_budget_${budget}`, text));
  }

  for (const [name, job] of Object.entries(snap.jobs)) {
    if (job.state === "not_started") {
      sends.push(once(`not_started:${name}`, "1", `job_not_started:${name}`, `${name} job not started: ${job.detail ?? "unknown"}`));
    }
    const run = job.lastRun;
    if (run?.problem) sends.push(once(`job:${name}`, run.at, `job_failed:${name}`, `${name} job ${run.problem} at ${run.at}`));
  }

  if (deps.minWei !== null) {
    const min = deps.minWei;
    for (const { label, address } of deps.wallets) {
      sends.push(
        deps.getBalance(address).then(
          (wei) => {
            if (wei >= min) return;
            return alerts.notify(
              `low_balance:${label}`,
              `Low balance: ${label} wallet ${address} has ${formatEther(wei)} QIE (alert below ${formatEther(min)} QIE)`,
            );
          },
          (error: unknown) => log.warn("alerts.balance_unreadable", { wallet: label, error: errorLabel(error) }),
        ),
      );
    }
  }
  await Promise.all(sends);
}

/** Checks every `intervalMs`, starting now, like the oracle monitor. */
export function startAlertMonitor(deps: AlertCheckDeps, intervalMs: number): () => void {
  if (deps.minWei === null) deps.log.warn("alerts.balance_check_off", { env: "LOW_BALANCE_ALERT_QIE" });
  const seen = new Map<string, string>();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await checkAlerts(deps, seen);
    } catch (error) {
      deps.log.warn("alerts.check_failed", { error: errorLabel(error) });
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
