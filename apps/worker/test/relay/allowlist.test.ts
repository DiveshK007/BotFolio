import { RELAY_ALLOWLIST, RELAY_LIMITS, forwardRequestFromJson, type ForwardRequestMessage } from "@botfolio/shared";
import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { TARGET_ABIS } from "../../src/relay/abis";
import { loadRelayContracts, selectorsFromAbis } from "../../src/relay/allowlist";
import { MIN_SECONDS_LEFT, checkPolicy } from "../../src/relay/policy";
import { parseRelayBody } from "../../src/relay/request";
import { FORWARDER, NOW_S, REGISTRY, TARGETS, fakeRelay, relayInput, signedRequest } from "./helpers/fakes";

describe("allowlist comes from packages/contracts/abi (#38)", () => {
  it("derives exactly the 8 signatures and selectors in relay.ts", () => {
    expect(selectorsFromAbis()).toEqual(
      RELAY_ALLOWLIST.map(({ contract, fn, signature, selector }) => ({ contract, fn, signature, selector })),
    );
    expect(RELAY_ALLOWLIST).toHaveLength(8);
  });

  it("refuses to load when an ABI changes a parameter type", () => {
    const BotRegistry = parseAbi(["function createBot(bytes32,uint16,uint16)", "function setActive(uint256,bool)"]);
    expect(() => selectorsFromAbis({ ...TARGET_ABIS, BotRegistry })).toThrow(/selector differs/);
  });

  it("refuses to load when a function disappears or turns payable", () => {
    expect(() => selectorsFromAbis({ ...TARGET_ABIS, Challenges: [] })).toThrow(/expected 1/);
    const BotRegistry = parseAbi(["function createBot(bytes32,uint16,uint8) payable"]);
    expect(() => selectorsFromAbis({ ...TARGET_ABIS, BotRegistry })).toThrow(/nonpayable/);
  });
});

async function decide(over: Partial<ForwardRequestMessage>): Promise<unknown> {
  try {
    return checkPolicy(forwardRequestFromJson(await signedRequest(over)), TARGETS, NOW_S);
  } catch (e) {
    return (e as { code: string }).code;
  }
}

const forbidden: [string, Address, Hex][] = [
  ["BotRegistry.setLimits", REGISTRY, selector("function setLimits(uint256,uint16,uint8)")],
  ["BotRegistry.createHouseBot", REGISTRY, selector("function createHouseBot(bytes32,uint16,uint8)")],
  ["grantRole", REGISTRY, selector("function grantRole(bytes32,address)")],
  ["renounceRole", TARGETS.PaperLedger, selector("function renounceRole(bytes32,address)")],
  ["an unknown selector", REGISTRY, "0xdeadbeef"],
  ["empty calldata", REGISTRY, "0x"],
  ["3 bytes", REGISTRY, "0xf429b0"],
];

function selector(signature: string): Hex {
  const abi = parseAbi([signature] as readonly string[]) as any;
  const args = abi[0].inputs.map(({ type }: { type: string }) =>
    type === "bool" ? true : type === "address" ? FORWARDER : type === "bytes32" ? `0x${"00".repeat(32)}` : type === "uint256" ? 1n : 1,
  );
  return encodeFunctionData({ abi, args }) as Hex;
}

describe("policy (#38)", () => {
  it.each(RELAY_ALLOWLIST.map((e) => [`${e.contract}.${e.fn}`, e] as const))("allows %s", async (_name, e) => {
    expect(await decide({ to: TARGETS[e.contract], data: e.selector })).toBe(e);
  });

  it.each(RELAY_ALLOWLIST.map((e) => [`${e.contract}.${e.fn}`, e] as const))(
    "refuses %s's selector on every other target",
    async (_name, e) => {
      for (const to of [...Object.values(TARGETS), FORWARDER].filter((a) => a !== TARGETS[e.contract])) {
        expect(await decide({ to, data: e.selector })).toBe("NOT_ALLOWLISTED");
      }
    },
  );

  it.each(forbidden)("refuses %s", async (_name, to, data) => {
    expect(await decide({ to, data })).toBe("NOT_ALLOWLISTED");
  });

  it("refuses any value", async () => {
    expect(await decide({ value: 1n })).toBe("VALUE_NOT_ZERO");
  });

  it("caps gas at exactly the §11 limit", async () => {
    expect(await decide({ gas: RELAY_LIMITS.maxGas })).toMatchObject({ fn: "createBot" });
    expect(await decide({ gas: RELAY_LIMITS.maxGas + 1n })).toBe("GAS_TOO_HIGH");
  });

  it("keeps the deadline between now + margin and now + 10 min", async () => {
    expect(await decide({ deadline: NOW_S + MIN_SECONDS_LEFT })).toMatchObject({ fn: "createBot" });
    expect(await decide({ deadline: NOW_S + MIN_SECONDS_LEFT - 1 })).toBe("DEADLINE_EXPIRED");
    expect(await decide({ deadline: NOW_S + 600 })).toMatchObject({ fn: "createBot" });
    expect(await decide({ deadline: NOW_S + 601 })).toBe("DEADLINE_TOO_FAR");
    expect(await decide({ deadline: 2 ** 48 - 1 })).toBe("DEADLINE_TOO_FAR");
  });

  it("can't be dodged with upper-case hex", async () => {
    const request = await signedRequest();
    const parsed = parseRelayBody({ request: { ...request, data: `0x${request.data.slice(2).toUpperCase()}` } });
    expect(checkPolicy(parsed, TARGETS, NOW_S).fn).toBe("createBot");
  });

  it.each([
    ["wrong target", { to: FORWARDER }, "NOT_ALLOWLISTED", 403],
    ["value", { value: 1n }, "VALUE_NOT_ZERO", 400],
    ["gas", { gas: 300_001n }, "GAS_TOO_HIGH", 400],
    ["expired", { deadline: NOW_S }, "DEADLINE_EXPIRED", 400],
    ["too far", { deadline: NOW_S + 601 }, "DEADLINE_TOO_FAR", 400],
    // Two faults at once: the first in RELAY_ERROR_CODES order wins.
    ["target + value + gas", { to: FORWARDER, value: 1n, gas: 900_000n }, "NOT_ALLOWLISTED", 403],
    ["value + gas + deadline", { value: 1n, gas: 900_000n, deadline: NOW_S }, "VALUE_NOT_ZERO", 400],
  ] as [string, Partial<ForwardRequestMessage>, string, number][])(
    "%s is refused with no RPC, reservation or send",
    async (_name, over, code, status) => {
      const f = fakeRelay();
      const result = await f.relay(relayInput(await signedRequest(over)));
      expect(result).toMatchObject({ status, body: { error: { code } } });
      expect(f.guard.reserve).not.toHaveBeenCalled();
      expect(f.guard.recordRefusal).toHaveBeenCalledOnce();
      expect(f.chain.prepare).not.toHaveBeenCalled();
      expect(f.sender.send).not.toHaveBeenCalled();
    },
  );
});

describe("relay contract addresses from env", () => {
  const env = {
    FORWARDER_ADDRESS: FORWARDER,
    BOT_REGISTRY_ADDRESS: TARGETS.BotRegistry,
    SEASON_LEDGER_ADDRESS: TARGETS.SeasonLedger,
    PAPER_LEDGER_ADDRESS: TARGETS.PaperLedger,
    DAILY_CALL_ADDRESS: TARGETS.DailyCall,
    CHALLENGES_ADDRESS: TARGETS.Challenges,
  };

  it("loads all six", () => {
    expect(loadRelayContracts(env)).toEqual({ ok: true, contracts: { forwarder: FORWARDER, targets: TARGETS } });
  });

  it.each([
    ["missing", ""],
    ["placeholder", "replace-me"],
    ["zero", `0x${"0".repeat(40)}`],
    ["same as the forwarder", FORWARDER],
  ])("refuses a %s address", (_name, value) => {
    expect(loadRelayContracts({ ...env, DAILY_CALL_ADDRESS: value })).toEqual({
      ok: false,
      problems: ["DAILY_CALL_ADDRESS"],
    });
  });
});
