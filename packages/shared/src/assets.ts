/**
 * QIE oracle feeds used by BotFolio (Chainlink AggregatorV3 interface). Verified live Nov 19 2026 (SPEC §0.2).
 * Crypto feeds are quoted in USDT, gold in USD. All have 8 decimals.
 * Wording rule: "settled against QIE's official mainnet oracle" — never "trustless".
 */
export type AssetId = "BTC" | "ETH" | "SOL" | "XRP" | "GOLD";

export interface AssetFeed {
  id: AssetId;
  /** Index used on-chain (uint8 asset). Must match the contracts. */
  index: number;
  label: string;
  quote: "USDT" | "USD";
  feed: `0x${string}`;
  decimals: 8;
  /** Max price age before a slot skips this asset (SPEC §5). */
  maxAgeSeconds: number;
}

export const ASSETS: readonly AssetFeed[] = [
  { id: "BTC", index: 0, label: "Bitcoin", quote: "USDT", feed: "0x9E596d809a20A272c788726f592c0d1629755440", decimals: 8, maxAgeSeconds: 1800 },
  { id: "ETH", index: 1, label: "Ethereum", quote: "USDT", feed: "0x4bb7012Fbc79fE4Ae9B664228977b442b385500d", decimals: 8, maxAgeSeconds: 1800 },
  { id: "SOL", index: 2, label: "Solana", quote: "USDT", feed: "0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21", decimals: 8, maxAgeSeconds: 1800 },
  { id: "XRP", index: 3, label: "XRP", quote: "USDT", feed: "0x804582B1f8Fea73919e7c737115009f668f97528", decimals: 8, maxAgeSeconds: 1800 },
  { id: "GOLD", index: 4, label: "Gold", quote: "USD", feed: "0x9aD0199a67588ee293187d26bA1BE61cb07A214c", decimals: 8, maxAgeSeconds: 21600 },
] as const;

// NOTE: asset index order is a proposal from the backbone. WS A confirms it against the contract enum on Day 1.
