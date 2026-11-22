import { describe, expect, it } from "vitest";
import { loadWorkerConfig, orderRpcUrls } from "../src/config";

const DEFAULT = [1, 2, 3, 4, 5].map((n) => `https://rpc${n}mainnet.qie.digital`);

describe("orderRpcUrls", () => {
  it("uses rpc3 → rpc4 → rpc5 → rpc1 → rpc2", () => {
    expect(orderRpcUrls(DEFAULT)).toEqual([3, 4, 5, 1, 2].map((n) => `https://rpc${n}mainnet.qie.digital`));
  });

  it("keeps a local fork URL first", () => {
    expect(orderRpcUrls(["http://127.0.0.1:8545"])).toEqual(["http://127.0.0.1:8545"]);
  });
});

describe("loadWorkerConfig", () => {
  it("has sane defaults with an empty env", () => {
    const cfg = loadWorkerConfig({});
    expect(cfg.chainId).toBe(1990);
    expect(cfg.rpcUrls[0]).toBe("https://rpc3mainnet.qie.digital");
    expect(cfg.feeds.map((f) => f.asset)).toEqual(["BTC", "ETH", "SOL", "XRP", "GOLD"]);
    expect(cfg.feeds.find((f) => f.asset === "GOLD")?.maxAgeSeconds).toBe(21600);
    expect(cfg.bigMove).toEqual({ buyWeightBps: 3000, sellBps: 5000, ttlMs: 120 * 60_000 });
  });

  it("reads QIE_RPC_URLS and the big-move env", () => {
    const cfg = loadWorkerConfig({
      QIE_RPC_URLS: DEFAULT.join(","),
      BIG_MOVE_BUY_WEIGHT_BPS: "3500",
      BIG_MOVE_SELL_BPS: "6000",
      BIG_MOVE_TTL_MIN: "60",
    });
    expect(cfg.rpcUrls).toHaveLength(5);
    expect(cfg.rpcUrls.slice(-2)).toEqual(["https://rpc1mainnet.qie.digital", "https://rpc2mainnet.qie.digital"]);
    expect(cfg.bigMove).toEqual({ buyWeightBps: 3500, sellBps: 6000, ttlMs: 60 * 60_000 });
  });

  it("refuses any chain other than 1990", () => {
    expect(() => loadWorkerConfig({ QIE_CHAIN_ID: "1" })).toThrow(/1990/);
  });
});
