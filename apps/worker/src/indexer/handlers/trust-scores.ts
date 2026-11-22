import { hexToString, type Hex } from "viem";
import type { EventContext } from "./types";
import { bytes, ignored, pgText, waiting, written, type ContractHandlers } from "./types";

export const trustScoreHandlers: ContractHandlers<"TrustScoreRegistry"> = {
  async RulesPublished() {
    return ignored("no table for published rules");
  },

  async ScoresCommitted({ season, rulesVersion, root }, ctx) {
    // A season can get a root a day and the latest one counts.
    const current = await ctx.chain.scores(season, ctx.stateBlock);
    if (current.root !== root || current.rulesVersion !== rulesVersion) return ignored("a later root replaced it");

    const { rows } = await ctx.db.query<{ tx: Hex | null }>(
      "select scores_tx as tx from seasons where id = $1::int for update",
      [season],
    );
    const stored = rows[0];
    if (!stored) return waiting("no seasons row (seed it)");
    // The same root can be committed twice. A replay of the first must not take the second's place.
    if (stored.tx && stored.tx !== ctx.txHash && (await isLater(stored.tx, ctx))) {
      return ignored("a later commit of the same root is stored");
    }

    await ctx.db.query(
      `update seasons set scores_root = $2::bytea, trust_rules_version = $3::text, scores_tx = $4::text
       where id = $1::int`,
      [season, bytes(root), pgText(hexToString(rulesVersion, { size: 32 })), ctx.txHash],
    );
    return written;
  },
};

async function isLater(stored: Hex, ctx: EventContext): Promise<boolean> {
  const other = await ctx.chain.txPosition(stored);
  if (!other) return false; // not on the chain (dropped or reorged out)
  if (other.block !== ctx.block) return other.block > ctx.block;
  const own = await ctx.chain.txPosition(ctx.txHash);
  return own !== null && other.index > own.index;
}
