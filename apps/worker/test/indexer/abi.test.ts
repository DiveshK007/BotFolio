import { readFileSync } from "node:fs";
import { toEventSelector, toEventSignature, toFunctionSignature, type Abi, type AbiEvent, type AbiFunction } from "viem";
import { describe, expect, it } from "vitest";
import { ADMIN_EVENTS, CONTRACT_EVENTS, CONTRACT_NAMES, REGISTRY_VIEWS, SCORE_VIEWS } from "../../src/indexer/abi";

const contracts = new URL("../../../../packages/contracts/", import.meta.url);
const frozen = (name: string) => JSON.parse(readFileSync(new URL(`abi/${name}.json`, contracts), "utf8")) as Abi;

// The signature plus what decoding depends on: which args are indexed, and what they're called.
const describeEvent = (e: AbiEvent) =>
  `${toEventSignature(e)} ${e.inputs.map((i) => `${i.name}${i.indexed ? "*" : ""}`).join(",")}`;
const describeView = (f: AbiFunction) =>
  `${toFunctionSignature(f)} ${JSON.stringify(f.outputs.map((o) => [o.type, "components" in o ? o.components.map((c) => `${c.type} ${c.name}`) : []]))}`;

describe.each(CONTRACT_NAMES)("%s", (name) => {
  it("every event in the frozen ABI is handled or known admin noise, and we invent none", () => {
    const inAbi = frozen(name).filter((i): i is AbiEvent => i.type === "event").map(describeEvent);
    const ours = CONTRACT_EVENTS[name].map((e) => describeEvent(e as AbiEvent));
    const admin = new Set(ADMIN_EVENTS.map((e) => describeEvent(e as AbiEvent)));

    for (const event of ours) expect(inAbi).toContain(event);
    for (const event of inAbi) {
      if (!admin.has(event)) expect(ours).toContain(event);
    }
  });

  it("topic0 matches packages/contracts/events.md", () => {
    const doc = readFileSync(new URL("events.md", contracts), "utf8");
    for (const event of CONTRACT_EVENTS[name]) expect(doc).toContain(toEventSelector(event));
  });
});

it.each([
  ["BotRegistry", REGISTRY_VIEWS],
  ["TrustScoreRegistry", SCORE_VIEWS],
] as const)("the %s views we read match the frozen ABI", (name, views) => {
  const inAbi = frozen(name).filter((i): i is AbiFunction => i.type === "function").map(describeView);
  for (const view of views) expect(inAbi).toContain(describeView(view as AbiFunction));
});
