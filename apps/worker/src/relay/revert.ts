import { decodeErrorResult, type Abi, type Hex } from "viem";
import { RelayRefusal } from "./errors";
import { TARGET_ABIS } from "./abis";

const ERRORS = Object.values(TARGET_ABIS).flatMap((abi) => abi.filter((item) => item.type === "error")) as Abi;

const PLAIN_WORDS: Record<string, string> = {
  PriceTooOld: "Price too old. Try again in a few minutes.",
  AlreadyHasBot: "This wallet already has a bot. It's one bot per person.",
  LimitsOutOfBounds: "Those bot limits are out of range.",
  BotBanned: "This bot has been stopped by the moderators.",
  NotBotOwner: "Only the bot's owner can do that.",
  NotOwnerOrAdmin: "Only the bot's owner can do that.",
  UnknownBot: "We couldn't find that bot.",
  ApprovalExpired: "That approval expired.",
  OrderRejected: "That trade can't go through any more.",
  CorrectionCapReached: "You've hit today's limit on corrections for this bot.",
  BadVersion: "That version is out of date. Refresh and try again.",
  AlreadyCalled: "You've already made today's call.",
  CallsClosed: "Today's call is closed.",
  TooManyOpen: "This bot already has the most open challenges allowed.",
  BadStatus: "That challenge can't be accepted any more.",
  SameOwner: "You can't challenge your own bot.",
  SeasonNotJoinable: "That season can't be joined any more.",
};

/**
 * Turns revert data into a 422 the app can show. Only the error's name or a short cleaned Error(string) leaves
 * the server: never raw data, arguments or the node's message.
 */
export function wouldRevert(data: Hex | undefined): RelayRefusal {
  if (!data || data.length < 10) return new RelayRefusal("WOULD_REVERT");
  try {
    const { errorName, args } = decodeErrorResult({ abi: ERRORS, data });
    const reason =
      errorName === "Error" ? String(args?.[0] ?? "").replace(/[^\x20-\x7e]/g, " ").slice(0, 120) : errorName;
    return new RelayRefusal("WOULD_REVERT", {
      revertReason: reason,
      ...(Object.hasOwn(PLAIN_WORDS, errorName) && { message: PLAIN_WORDS[errorName] }),
    });
  } catch {
    return new RelayRefusal("WOULD_REVERT");
  }
}
