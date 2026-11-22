import { RELAY_ALLOWLIST, type RelayTargetAddresses, type RelayTargetContract } from "@botfolio/shared";
import { toFunctionSelector, toFunctionSignature, type AbiFunction, type Address } from "viem";
import { TARGET_ABIS } from "./abis";

/**
 * Re-derives each allowlisted selector from the exported ABIs and refuses to load if one differs from relay.ts
 * (#38: "not hand-typed"). An ABI change can't silently allow, or drop, a different function.
 */
export function selectorsFromAbis(abis: typeof TARGET_ABIS = TARGET_ABIS) {
  return RELAY_ALLOWLIST.map((entry) => {
    const matches = abis[entry.contract].filter(
      (item): item is AbiFunction => item.type === "function" && item.name === entry.fn,
    );
    const fn = matches[0];
    if (!fn || matches.length !== 1) throw new Error(`${entry.contract}.${entry.fn}: expected 1 function in the ABI`);
    if (fn.stateMutability !== "nonpayable") throw new Error(`${entry.contract}.${entry.fn} is not nonpayable`);
    const selector = toFunctionSelector(fn);
    if (selector !== entry.selector) throw new Error(`${entry.contract}.${entry.fn}: ABI selector differs from relay.ts`);
    return { contract: entry.contract, fn: entry.fn, signature: toFunctionSignature(fn), selector };
  });
}

selectorsFromAbis();

const TARGET_ENV: Record<RelayTargetContract, string> = {
  BotRegistry: "BOT_REGISTRY_ADDRESS",
  SeasonLedger: "SEASON_LEDGER_ADDRESS",
  PaperLedger: "PAPER_LEDGER_ADDRESS",
  DailyCall: "DAILY_CALL_ADDRESS",
  Challenges: "CHALLENGES_ADDRESS",
};

export interface RelayContracts {
  forwarder: Address;
  targets: RelayTargetAddresses;
}

/**
 * All six addresses or none: a missing, zero or repeated one means the deploy env is wrong.
 * `problems` holds variable names only.
 */
export function loadRelayContracts(
  env: Record<string, string | undefined>,
): { ok: true; contracts: RelayContracts } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const seen = new Set<string>();
  const read = (name: string): Address => {
    const value = (env[name] ?? "").trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(value) || /^0x0+$/.test(value) || seen.has(value)) problems.push(name);
    seen.add(value);
    return value as Address;
  };
  const forwarder = read("FORWARDER_ADDRESS");
  const targets = Object.fromEntries(
    Object.entries(TARGET_ENV).map(([contract, name]) => [contract, read(name)]),
  ) as RelayTargetAddresses;
  return problems.length ? { ok: false, problems } : { ok: true, contracts: { forwarder, targets } };
}
