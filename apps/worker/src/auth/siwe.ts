import { QIE_CHAIN_ID, SIWE_NONCE_TTL_SECONDS, SIWE_STATEMENT, type AuthErrorCode } from "@botfolio/shared";
import { recoverMessageAddress, type Address, type Hex } from "viem";
import { createSiweMessage, parseSiweMessage, type SiweMessage } from "viem/siwe";
import { InternalFailure } from "./log";
import type { NonceService } from "./nonce";

const MAX_MESSAGE_CHARS = 2048;
/** Phones' clocks drift. The app should copy issuedAt from GET /auth/nonce anyway. */
const CLOCK_SKEW_MS = 60_000;

export class AuthRefusal extends Error {
  override name = "AuthRefusal";
  constructor(readonly code: AuthErrorCode) {
    super(code);
  }
}

/**
 * EIP-4361 sign-in (SPEC §11). EOA signatures only: QIE has no ERC-4337 wallets.
 * The nonce is burned only by a correctly signed message, so nobody can burn someone else's.
 */
export async function verifySiwe(
  body: unknown,
  opts: { domain: string; nonces: NonceService; now: () => number },
): Promise<Address> {
  const { message, signature } = (body ?? {}) as { message?: unknown; signature?: unknown };
  if (typeof message !== "string" || message.length > MAX_MESSAGE_CHARS) throw new AuthRefusal("BAD_REQUEST");
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new AuthRefusal("BAD_REQUEST");

  const fields = strictParse(message);
  if (fields.domain !== opts.domain) throw new AuthRefusal("DOMAIN_MISMATCH");
  if (fields.chainId !== QIE_CHAIN_ID) throw new AuthRefusal("CHAIN_MISMATCH");
  if (fields.statement !== SIWE_STATEMENT) throw new AuthRefusal("BAD_REQUEST");
  if (!URL.canParse(fields.uri) || new URL(fields.uri).hostname !== new URL(`http://${opts.domain}`).hostname) {
    throw new AuthRefusal("DOMAIN_MISMATCH");
  }

  const nonce = opts.nonces.check(fields.nonce);
  if (nonce === "invalid") throw new AuthRefusal("INVALID_NONCE");
  if (nonce === "expired") throw new AuthRefusal("NONCE_EXPIRED");

  const now = opts.now();
  const issued = fields.issuedAt!.getTime();
  if (issued > now + CLOCK_SKEW_MS) throw new AuthRefusal("BAD_REQUEST");
  if (issued < now - SIWE_NONCE_TTL_SECONDS * 1000 - CLOCK_SKEW_MS) throw new AuthRefusal("NONCE_EXPIRED");
  if (fields.expirationTime && fields.expirationTime.getTime() <= now) throw new AuthRefusal("NONCE_EXPIRED");
  if (fields.notBefore && fields.notBefore.getTime() > now) throw new AuthRefusal("BAD_REQUEST");

  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message, signature: signature as Hex });
  } catch {
    throw new AuthRefusal("INVALID_SIGNATURE");
  }
  const wallet = fields.address.toLowerCase() as Address;
  if (signer.toLowerCase() !== wallet) throw new AuthRefusal("INVALID_SIGNATURE");

  const consumed = opts.nonces.consume(fields.nonce);
  if (consumed === "full") throw new InternalFailure("nonce_store_full");
  if (consumed === "expired") throw new AuthRefusal("NONCE_EXPIRED");
  if (consumed === "invalid") throw new AuthRefusal("INVALID_NONCE");
  return wallet;
}

/**
 * viem's parser is lenient (regexes that skip what they don't recognise). Rebuilding the message and comparing
 * means we only judge exactly the text the wallet showed: no duplicate or hidden lines.
 */
function strictParse(message: string): SiweMessage {
  try {
    const parsed = parseSiweMessage(message) as SiweMessage;
    if (parsed.issuedAt && createSiweMessage(parsed) === message) return parsed;
  } catch {
    // Not valid EIP-4361.
  }
  throw new AuthRefusal("BAD_REQUEST");
}
