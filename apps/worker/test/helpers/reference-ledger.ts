import { ASSETS } from "@botfolio/shared";
import type { LedgerOrder, SkipReason } from "../../src/interfaces";
import type { GateBot, GateInput, Portfolio } from "../../src/gate/types";

/**
 * A test-only executeBatch written from SPEC §4.3 and IPaperLedger's natspec, deliberately NOT using the
 * gate's math. There is no PaperLedger implementation on main yet, so this is what the gate is checked against.
 * UNVERIFIED against the Solidity implementation.
 */
export function executeBatch(
  bot: GateBot,
  start: Portfolio,
  prices: GateInput["prices"],
  orders: readonly LedgerOrder[],
): { skips: { actionIndex: number; reason: SkipReason }[]; portfolio: Portfolio } {
  let cash = start.cashE8;
  const units = { ...start.unitsE18 };
  let trades = bot.tradesToday;
  const used = new Set<string>();
  const skips: { actionIndex: number; reason: SkipReason }[] = [];

  for (const o of orders) {
    const skip = (reason: SkipReason) => skips.push({ actionIndex: o.actionIndex, reason });
    const key = `${o.decisionId}:${o.actionIndex}`;
    const asset = ASSETS.find((a) => a.index === o.asset)?.id;
    if (used.has(key)) {
      skip("USED");
      continue;
    }
    if (!bot.active || !asset) {
      skip("INACTIVE");
      continue;
    }
    const { priceE8: answer, fresh } = prices[asset];
    if (!fresh || answer <= 0n) {
      skip("STALE");
      continue;
    }
    if (trades >= bot.maxTradesPerDay || o.bps > 10_000) {
      skip("LIMIT");
      continue;
    }
    if (o.bps === 0) {
      skip("ZERO");
      continue;
    }

    if (o.buy) {
      const spend = (cash * BigInt(o.bps)) / 10_000n;
      const got = (spend * 10n ** 18n) / answer;
      if (got === 0n) {
        skip("ZERO");
        continue;
      }
      let total = cash - spend;
      let position = 0n;
      for (const { id } of ASSETS) {
        const held = id === asset ? units[id] + got : units[id];
        const p = prices[id].priceE8 > 0n ? prices[id].priceE8 : 0n;
        const worth = (held * p) / 10n ** 18n;
        if (id === asset) position = worth;
        total += worth;
      }
      if (position * 10_000n > total * BigInt(bot.maxPerCoinBps)) {
        skip("LIMIT");
        continue;
      }
      cash -= spend;
      units[asset] += got;
    } else {
      const out = (units[asset] * BigInt(o.bps)) / 10_000n;
      if (out === 0n) {
        skip("ZERO");
        continue;
      }
      cash += (out * answer) / 10n ** 18n;
      units[asset] -= out;
    }
    trades++;
    used.add(key);
  }
  return { skips, portfolio: { cashE8: cash, unitsE18: units } };
}
