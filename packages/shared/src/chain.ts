import { defineChain } from "viem";

/** QIE mainnet. Verified Nov 19 2026 (SPEC §0.1). rpc1/rpc2 drop TLS sometimes — always use failover. */
export const QIE_RPC_URLS = [
  "https://rpc1mainnet.qie.digital",
  "https://rpc2mainnet.qie.digital",
  "https://rpc3mainnet.qie.digital",
  "https://rpc4mainnet.qie.digital",
  "https://rpc5mainnet.qie.digital",
] as const;

export const qieMainnet = defineChain({
  id: 1990,
  name: "QIE Mainnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: { default: { http: [...QIE_RPC_URLS] } },
  blockExplorers: { default: { name: "QIE Explorer", url: "https://mainnet.qie.digital" } },
});

export const explorerTx = (hash: string) => `https://mainnet.qie.digital/tx/${hash}`;
export const explorerAddress = (addr: string) => `https://mainnet.qie.digital/address/${addr}`;
