import type { ContractName } from "../abi";
import type { IndexedEvent } from "../decode";
import { challengeHandlers } from "./challenges";
import { dailyCallHandlers } from "./daily-call";
import { forwarderHandlers } from "./forwarder";
import { paperLedgerHandlers } from "./paper-ledger";
import { registryHandlers } from "./registry";
import { seasonLedgerHandlers } from "./season-ledger";
import { trustScoreHandlers } from "./trust-scores";
import type { ContractHandlers, EventContext, Outcome } from "./types";

const HANDLERS: { [C in ContractName]: ContractHandlers<C> } = {
  BotForwarder: forwarderHandlers,
  BotRegistry: registryHandlers,
  PaperLedger: paperLedgerHandlers,
  SeasonLedger: seasonLedgerHandlers,
  TrustScoreRegistry: trustScoreHandlers,
  DailyCall: dailyCallHandlers,
  Challenges: challengeHandlers,
};

export function handleEvent(event: IndexedEvent, ctx: EventContext): Promise<Outcome> {
  // decodeLogs decoded `args` with this same contract's ABI, so name and args match the handler.
  const byName = HANDLERS[event.contract] as unknown as Record<
    string,
    (args: unknown, ctx: EventContext) => Promise<Outcome>
  >;
  return byName[event.name]!(event.args, ctx);
}
