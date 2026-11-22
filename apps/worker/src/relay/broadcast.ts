import type { Hex } from "viem";
import type { RelayRpc, RpcReply } from "./rpc";

export type BroadcastResult =
  /** A node took it. */
  | "accepted"
  /** Someone may have it. Never sign this call again under another nonce. */
  | "maybe"
  /** Nobody has it: the nonce is already used by another tx. */
  | "nonce_used"
  /** Nobody has it: a node refused it for a reason that isn't the nonce. */
  | "rejected";

type Verdict = BroadcastResult | "gap";

// The first pattern that matches wins. Anything we don't recognise is "maybe": a wrong "rejected" could double send.
// Wordings from geth, Anvil and Cosmos-EVM nodes. UNVERIFIED on QIE: checking means sending mainnet txs.
const KNOWN = /already known|known transaction|already imported|already in (?:the )?(?:mempool|cache)|tx already exists/i;
const USED = /nonce too low|nonce has already been used|replacement transaction underpriced/i;
const GAP = /nonce too high|nonce gap/i;
const REFUSED =
  /insufficient funds|insufficient balance|insufficient fee|gas price too low|transaction underpriced|fee cap less than|max fee per gas less than|intrinsic gas too low|exceeds block gas limit|invalid chain id|invalid sender|mempool is full/i;
const GOT_EXPECTED = /invalid nonce; got (\d+), expected (\d+)/i;
const EXPECTED_GOT = /account sequence mismatch, expected (\d+), got (\d+)/i;

export function classifySend(reply: RpcReply, hash: Hex): Verdict {
  if (reply.kind === "no_answer") return "maybe";
  // A result with another hash isn't proof of anything either way.
  if (reply.kind === "result") return String(reply.result).toLowerCase() === hash ? "accepted" : "maybe";

  const { message } = reply;
  if (KNOWN.test(message)) return "accepted";
  const gotFirst = GOT_EXPECTED.exec(message);
  if (gotFirst) return Number(gotFirst[1]) < Number(gotFirst[2]) ? "nonce_used" : "gap";
  const expectedFirst = EXPECTED_GOT.exec(message);
  if (expectedFirst) return Number(expectedFirst[2]) < Number(expectedFirst[1]) ? "nonce_used" : "gap";
  if (USED.test(message)) return "nonce_used";
  if (GAP.test(message)) return "gap";
  return REFUSED.test(message) ? "rejected" : "maybe";
}

const TOTAL_TIMEOUT_MS = 8_000;
const NODE_TIMEOUT_MS = 3_000;

/**
 * Offers the SAME signed bytes to each node until one takes them. That's safe to repeat: same bytes, same hash,
 * one execution at most. "rejected" and "nonce_used" are returned only if no node answered ambiguously.
 *
 * A node can be missing our earlier nonces (QIE nodes may refuse gaps), so on a gap it first gets those txs.
 */
export async function broadcast(
  rpc: RelayRpc,
  raw: Hex,
  hash: Hex,
  predecessors: () => Hex[] = () => [],
): Promise<BroadcastResult> {
  const until = Date.now() + TOTAL_TIMEOUT_MS;
  let maybe = false;
  let nonceUsed = false;

  for (const url of rpc.nodes()) {
    const left = () => Math.min(NODE_TIMEOUT_MS, until - Date.now());
    if (left() <= 0) {
      maybe = true;
      break;
    }
    const send = async (bytes: Hex) => rpc.ask(url, "eth_sendRawTransaction", [bytes], Math.max(1, left()));

    let verdict = classifySend(await send(raw), hash);
    if (verdict === "gap") {
      for (const earlier of predecessors()) {
        if (left() <= 0 || (await send(earlier)).kind === "no_answer") break;
      }
      verdict = classifySend(await send(raw), hash);
    }
    if (verdict === "accepted") return "accepted";
    if (verdict === "maybe" || verdict === "gap") maybe = true;
    if (verdict === "nonce_used") {
      nonceUsed = true;
      break;
    }
  }
  if (maybe) return "maybe";
  return nonceUsed ? "nonce_used" : "rejected";
}
