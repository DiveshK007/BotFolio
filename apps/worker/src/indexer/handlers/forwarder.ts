import { ignored, written, type ContractHandlers } from "./types";

export const forwarderHandlers: ContractHandlers<"BotForwarder"> = {
  /**
   * `signer` is _msgSender, what §11 counts. It only confirms a relay our relayer logged for that same wallet
   * and tx. It never inserts: anyone can call the forwarder, with any target, and could pad /stats that way.
   */
  async ExecutedForwardRequest({ signer, success }, ctx) {
    const { rows } = await ctx.db.query(
      `update relay_log set status = case when $3::boolean then 'confirmed' else 'reverted' end::relay_status
       where tx_hash = $1::text and user_wallet = $2::text and status = 'submitted'
       returning id`,
      [ctx.txHash, signer.toLowerCase(), success],
    );
    return rows.length > 0 ? written : ignored("no submitted relay_log row");
  },
};
