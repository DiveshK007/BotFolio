import { describe, expect, it } from "vitest";
import { parseCreateConfig, parseOwnerConfig, parseRpcUrls } from "./config";

const forwarder = `0x${"11".repeat(20)}`;
const registry = `0x${"22".repeat(20)}`;
const parse = (relayUrl?: string) => parseCreateConfig({ relayUrl, forwarder, registry });

describe("parseCreateConfig", () => {
  it.each([
    "https://worker.example",
    "https://worker.example/",
    "https://worker.example/relay",
    "https://worker.example/relay/",
  ])("accepts %s as the Render service", (url) => {
    expect(parse(url)?.workerUrl).toBe("https://worker.example");
  });

  it("allows plain http only for local dev", () => {
    expect(parse("http://localhost:10000")?.workerUrl).toBe("http://localhost:10000");
    expect(parse("http://worker.example")).toBeNull();
  });

  it("is null, not guessed, when anything is missing", () => {
    expect(parse()).toBeNull();
    expect(parse("not a url")).toBeNull();
    expect(parseCreateConfig({ relayUrl: "https://worker.example", registry })).toBeNull();
    expect(parseCreateConfig({ relayUrl: "https://worker.example", forwarder, registry: "" })).toBeNull();
  });
});

describe("parseOwnerConfig", () => {
  it("keeps each deployed target and drops a bad or missing one", () => {
    expect(parseOwnerConfig({ relayUrl: "https://worker.example/relay", forwarder, BotRegistry: registry, DailyCall: "0xnope" })).toEqual({
      workerUrl: "https://worker.example",
      forwarder,
      targets: { BotRegistry: registry },
    });
  });

  it("is null without a worker or a forwarder", () => {
    expect(parseOwnerConfig({ forwarder })).toBeNull();
    expect(parseOwnerConfig({ relayUrl: "https://worker.example" })).toBeNull();
  });
});

describe("parseRpcUrls", () => {
  it("defaults to the 5 mainnet RPCs, rpc3 first", () => {
    expect(parseRpcUrls(undefined)).toEqual([
      "https://rpc3mainnet.qie.digital",
      "https://rpc4mainnet.qie.digital",
      "https://rpc5mainnet.qie.digital",
      "https://rpc1mainnet.qie.digital",
      "https://rpc2mainnet.qie.digital",
    ]);
    expect(parseRpcUrls(" , ")).toHaveLength(5);
  });

  it("keeps the given order and drops what isn't https (local http allowed)", () => {
    expect(parseRpcUrls("https://a.example, http://evil.example,nonsense, http://127.0.0.1:8545")).toEqual([
      "https://a.example",
      "http://127.0.0.1:8545",
    ]);
  });
});
