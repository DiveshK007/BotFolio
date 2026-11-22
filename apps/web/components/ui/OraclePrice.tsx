import { ASSETS, type AssetId } from "@botfolio/shared";
import { formatE8 } from "@/lib/format";
import { PriceAge } from "./PriceAge";

interface OraclePriceProps {
  asset: AssetId;
  /** latestRoundData().answer, 8 decimals. */
  answerE8: bigint;
  roundId: bigint | string;
  /** latestRoundData().updatedAt, unix seconds. */
  updatedAt: number;
}

/**
 * SPEC §5.7 display: "BTC $63,922.95 (USDT, QIE oracle round 50887, 1m old)".
 * Crypto feeds quote USDT, gold quotes USD (SPEC §0.2).
 */
export function OraclePrice({ asset, answerE8, roundId, updatedAt }: OraclePriceProps) {
  const feed = ASSETS.find((a) => a.id === asset);
  const decimals = asset === "XRP" ? 4 : 2;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span className="font-semibold">{asset === "GOLD" ? "Gold" : asset}</span>
      <span className="tabular-nums">${formatE8(answerE8, decimals)}</span>
      <span className="text-xs text-muted">
        ({feed?.quote ?? "USD"}, QIE oracle round {roundId.toString()},{" "}
      </span>
      <PriceAge asset={asset} updatedAt={updatedAt} />
      <span className="text-xs text-muted">)</span>
    </span>
  );
}
