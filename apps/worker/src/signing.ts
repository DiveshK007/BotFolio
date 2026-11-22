import type { Address, Hex, LocalAccount } from "viem";
import {
  APPROVED_ORDER_TYPES,
  DAILY_CALL_BOT_VIEW_TYPES,
  dailyCallDomain,
  istDay,
  paperLedgerDomain,
  type ApprovedOrder,
  type SignedDailyCallBotView,
} from "./interfaces";

/**
 * The runner's EIP-712 signature over a big move (SPEC §4.3, §6.4 step 9). It signs the whole struct,
 * so the owner can only approve exactly this orderId, size and deadline.
 * The account is passed in; the key only ever comes from Render env.
 */
export function signApprovedOrder(runner: LocalAccount, paperLedger: Address, order: ApprovedOrder): Promise<Hex> {
  return runner.signTypedData({
    domain: paperLedgerDomain(paperLedger),
    types: APPROVED_ORDER_TYPES,
    primaryType: "ApprovedOrder",
    message: order,
  });
}

/**
 * The bot's Daily Call view for the IST day of its decision, signed so the user can't choose the bot's
 * answer (SPEC §4.7, §6.4.1). `decidedAt` is the slot time, so a late retry still signs the slot's day.
 */
export async function signDailyCallView(
  runner: LocalAccount,
  dailyCall: Address,
  view: { botId: bigint; decidedAt: Date; btcUp: boolean },
): Promise<SignedDailyCallBotView> {
  const message = { botId: view.botId, day: istDay(Math.floor(view.decidedAt.getTime() / 1000)), botUp: view.btcUp };
  const botSig = await runner.signTypedData({
    domain: dailyCallDomain(dailyCall),
    types: DAILY_CALL_BOT_VIEW_TYPES,
    primaryType: "BotView",
    message,
  });
  return { ...message, botId: view.botId.toString(), botSig };
}
