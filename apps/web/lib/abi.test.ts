import { toEventSignature, toFunctionSignature, type Abi, type AbiEvent, type AbiFunction } from "viem";
import { expect, it } from "vitest";
import forwarderJson from "../../../packages/contracts/abi/BotForwarder.json";
import registryJson from "../../../packages/contracts/abi/BotRegistry.json";
import { FORWARDER_ABI, REGISTRY_ABI } from "./create-bot";

// Signature plus everything decoding depends on: which event args are indexed, and what functions return.
function describeItem(item: AbiEvent | AbiFunction): string {
  if (item.type === "event") return `${toEventSignature(item)} indexed=${item.inputs.map((i) => Boolean(i.indexed))}`;
  return `${toFunctionSignature(item)} returns=${item.outputs.map((o) => o.type)} ${item.stateMutability}`;
}

it.each([
  ["BotRegistry", REGISTRY_ABI, registryJson],
  ["BotForwarder", FORWARDER_ABI, forwarderJson],
] as const)("the %s items S2 uses match the frozen ABI", (_name, used, json) => {
  const frozen = (json as Abi).filter((i): i is AbiEvent | AbiFunction => i.type === "event" || i.type === "function");
  const known = frozen.map(describeItem);
  for (const item of used) expect(known).toContain(describeItem(item));
});
