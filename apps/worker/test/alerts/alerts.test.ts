import { parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALERT_COOLDOWN_MS, checkAlerts, createAlerts, hotWallets, lowBalanceWei, startedText, type Alerts } from "../../src/alerts";
import { HealthState } from "../../src/health";
import type { Log } from "../../src/scheduler/log";

const HOOK = "https://hooks.example.test/T000/secret-token";
const KEY = `0x${"11".repeat(32)}`;
const silent: Log = { info: () => {}, warn: () => {} };

function hook(status = 204) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status }));
}

describe("createAlerts", () => {
  it("posts {text, content, kind, at} to the webhook", async () => {
    const fetch = hook();
    const alerts = createAlerts({ env: { ALERT_WEBHOOK_URL: HOOK }, log: silent, fetch, now: () => Date.parse("2026-11-25T10:00:00Z") });
    await alerts.notify("low_balance:runner", "Low balance");
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(HOOK);
    expect(JSON.parse(init!.body as string)).toEqual({
      text: "Low balance",
      content: "Low balance",
      kind: "low_balance:runner",
      at: "2026-11-25T10:00:00.000Z",
    });
  });

  it("sends a kind at most once per cooldown, other kinds independently", async () => {
    let t = 0;
    const fetch = hook();
    const alerts = createAlerts({ env: { ALERT_WEBHOOK_URL: HOOK }, log: silent, fetch, now: () => t });
    await alerts.notify("a", "1");
    t = ALERT_COOLDOWN_MS - 1;
    await alerts.notify("a", "2");
    await alerts.notify("b", "3");
    t = ALERT_COOLDOWN_MS;
    await alerts.notify("a", "4");
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init!.body as string).text)).toEqual(["1", "3", "4"]);
  });

  it("retries a failed send on the next call and never logs the URL", async () => {
    const logs: string[] = [];
    const log: Log = { info: () => {}, warn: (event, fields) => logs.push(JSON.stringify({ event, ...fields })) };
    const fetch = hook(500);
    const alerts = createAlerts({ env: { ALERT_WEBHOOK_URL: HOOK }, log, fetch, now: () => 0 });
    await alerts.notify("a", "1");
    await alerts.notify("a", "1");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(logs.some((l) => l.includes("http_500"))).toBe(true);
    expect(logs.join("\n")).not.toContain("secret-token");
  });

  it("is a no-op that logs once when the webhook is unset or not https", async () => {
    for (const env of [{}, { ALERT_WEBHOOK_URL: "http://hooks.example.test/x" }, { ALERT_WEBHOOK_URL: "nope" }]) {
      const warn = vi.fn();
      const fetch = hook();
      const alerts = createAlerts({ env, log: { info: () => {}, warn }, fetch });
      await alerts.notify("a", "1");
      expect(fetch).not.toHaveBeenCalled();
      expect(warn.mock.calls.filter(([event]) => event === "alerts.disabled")).toHaveLength(1);
    }
  });
});

describe("hotWallets and lowBalanceWei", () => {
  it("gives addresses only, for the keys that are set", () => {
    const wallets = hotWallets({ RUNNER_PRIVATE_KEY: KEY, COMMITTER_PRIVATE_KEY: "replace-me" });
    expect(wallets).toEqual([{ label: "runner", address: privateKeyToAccount(KEY as `0x${string}`).address }]);
    expect(JSON.stringify(wallets)).not.toContain("1111111111");
  });

  it("defaults to 2 QIE and rejects junk", () => {
    expect(lowBalanceWei({})).toBe(parseEther("2"));
    expect(lowBalanceWei({ LOW_BALANCE_ALERT_QIE: "0.5" })).toBe(parseEther("0.5"));
    expect(lowBalanceWei({ LOW_BALANCE_ALERT_QIE: "-1" })).toBeNull();
    expect(lowBalanceWei({ LOW_BALANCE_ALERT_QIE: "two" })).toBeNull();
  });
});

describe("checkAlerts", () => {
  const RUNNER = "0x00000000000000000000000000000000000000aa" as Address;
  const RELAYER = "0x00000000000000000000000000000000000000bb" as Address;
  const NOW = new Date("2026-11-25T10:00:00Z");

  function setup(capUsd: number | null = 1) {
    const sent: { kind: string; text: string }[] = [];
    const alerts: Alerts = { notify: async (kind, text) => void sent.push({ kind, text }) };
    const health = new HealthState({ provider: "xai", capUsd });
    const balances: Record<string, bigint> = { [RUNNER]: parseEther("1.5"), [RELAYER]: parseEther("10") };
    const deps = {
      alerts,
      health,
      wallets: [
        { label: "runner", address: RUNNER },
        { label: "relayer", address: RELAYER },
      ],
      minWei: parseEther("2"),
      getBalance: async (a: Address) => balances[a]!,
      log: silent,
    };
    return { sent, health, deps, seen: new Map<string, string>() };
  }

  it("alerts a wallet below the threshold, not one above", async () => {
    const { sent, deps, seen } = setup();
    await checkAlerts(deps, seen, NOW);
    expect(sent).toEqual([
      { kind: "low_balance:runner", text: `Low balance: runner wallet ${RUNNER} has 1.5 QIE (alert below 2 QIE)` },
    ]);
  });

  it("skips the balance check when the threshold is invalid, and survives an unreadable balance", async () => {
    const { sent, deps, seen } = setup();
    await checkAlerts({ ...deps, minWei: null }, seen, NOW);
    await checkAlerts({ ...deps, getBalance: () => Promise.reject(new Error("rpc down")) }, seen, NOW);
    expect(sent).toEqual([]);
  });

  it("alerts the LLM budget once at 80 % and once more when bots rest", async () => {
    const { sent, health, deps, seen } = setup();
    deps.wallets = [];
    health.setLlmSpend(0.85, NOW);
    await checkAlerts(deps, seen, NOW);
    await checkAlerts(deps, seen, NOW);
    health.setLlmSpend(1.2, NOW);
    await checkAlerts(deps, seen, NOW);
    expect(sent).toEqual([
      { kind: "llm_budget_alert", text: "LLM budget above 80 %: $0.85 of $1 in 2026-11" },
      { kind: "llm_budget_resting", text: "LLM budget used up, bots resting: $1.20 of $1 in 2026-11" },
    ]);
  });

  it("alerts each failed slot run once, and each start problem once", async () => {
    const { sent, health, deps, seen } = setup(null);
    deps.wallets = [];
    health.addStartProblem("daily_call job not started: needs COMMITTER_PRIVATE_KEY");
    health.addStartProblem("relay not started: needs RELAY_ENABLED");
    health.recordJobRun("slot", { at: "2026-11-25T06:00:05Z", problem: "failed for 2 bot(s)" });
    await checkAlerts(deps, seen, NOW);
    await checkAlerts(deps, seen, NOW);
    health.recordJobRun("slot", { at: "2026-11-25T12:00:05Z" });
    await checkAlerts(deps, seen, NOW);
    health.recordJobRun("slot", { at: "2026-11-25T18:00:05Z", problem: "failed" });
    await checkAlerts(deps, seen, NOW);
    expect(sent).toEqual([
      {
        kind: "not_started:daily_call job not started: needs COMMITTER_PRIVATE_KEY",
        text: "Not running: daily_call job not started: needs COMMITTER_PRIVATE_KEY",
      },
      { kind: "not_started:relay not started: needs RELAY_ENABLED", text: "Not running: relay not started: needs RELAY_ENABLED" },
      { kind: "job_failed:slot", text: "slot job failed for 2 bot(s) at 2026-11-25T06:00:05Z" },
      { kind: "job_failed:slot", text: "slot job failed at 2026-11-25T18:00:05Z" },
    ]);
  });

  describe("missed-slot watchdog", () => {
    // 09:00 IST = 03:30 UTC; its window closes at 03:50, so it counts as missed from 04:15.
    const SLOT = "2026-11-25T03:30:00.000Z";
    const at = (iso: string) => new Date(iso);
    afterEach(() => vi.useRealTimers());

    function started(iso: string) {
      vi.useFakeTimers({ now: at(iso) });
      const s = setup(null);
      s.deps.wallets = [];
      s.health.setJob("slot", "scheduled");
      return s;
    }

    it("alerts once when no run was recorded 25 min after the window", async () => {
      const { sent, deps, seen } = started("2026-11-25T01:00:00Z");
      await checkAlerts(deps, seen, at("2026-11-25T04:14:59Z"));
      expect(sent).toEqual([]);
      await checkAlerts(deps, seen, at("2026-11-25T04:15:00Z"));
      await checkAlerts(deps, seen, at("2026-11-25T06:00:00Z"));
      expect(sent).toEqual([{ kind: "missed_slot", text: `slot job missed the ${SLOT} slot: no run recorded` }]);
    });

    it("stays quiet when the slot ran or failed (that alerts on its own)", async () => {
      const ran = started("2026-11-25T01:00:00Z");
      ran.health.recordSlotRun({ slotId: "7", kind: "scheduled", slotTime: SLOT, finishedAt: "2026-11-25T03:31:00Z" });
      await checkAlerts(ran.deps, ran.seen, at("2026-11-25T05:00:00Z"));
      expect(ran.sent).toEqual([]);

      const failed = started("2026-11-25T01:00:00Z");
      failed.health.recordJobRun("slot", { at: "2026-11-25T03:30:02Z", problem: "failed" });
      await checkAlerts(failed.deps, failed.seen, at("2026-11-25T05:00:00Z"));
      expect(failed.sent.map(({ kind }) => kind)).toEqual(["job_failed:slot"]);
    });

    it("stays quiet after a deploy past the window, and when the slot job can't run", async () => {
      const late = started("2026-11-25T03:50:00Z");
      await checkAlerts(late.deps, late.seen, at("2026-11-25T05:00:00Z"));
      expect(late.sent).toEqual([]);

      const off = started("2026-11-25T01:00:00Z");
      off.health.setJob("slot", "not_started", "needs RUNNER_PRIVATE_KEY");
      await checkAlerts(off.deps, off.seen, at("2026-11-25T05:00:00Z"));
      expect(off.sent).toEqual([]);
    });

    it("looks back across midnight to the 21:00 IST slot", async () => {
      const { sent, deps, seen } = started("2026-11-25T12:00:00Z");
      await checkAlerts(deps, seen, at("2026-11-26T00:30:00Z"));
      expect(sent).toEqual([{ kind: "missed_slot", text: "slot job missed the 2026-11-25T15:30:00.000Z slot: no run recorded" }]);
    });
  });
});

describe("startedText", () => {
  it("names the commit Render deployed, and nothing else", () => {
    expect(startedText({ RENDER_GIT_COMMIT: "5ac9411e0f3b2c1d" })).toBe("worker_started 5ac9411e0f3b");
    expect(startedText({})).toBe("worker_started");
    expect(startedText({ RENDER_GIT_COMMIT: "not a sha <@everyone>" })).toBe("worker_started");
  });
});
