import { RELAY_ERROR_HTTP_STATUS, type RelayError, type RelayErrorCode } from "@botfolio/shared";

/** Plain words the app can show as they are. Every refusal happens before broadcast, so "nothing was sent" holds. */
export const REFUSAL_MESSAGES: Record<RelayErrorCode, string> = {
  RELAY_DISABLED: "Actions are paused right now. Nothing was sent. Please try again later.",
  BAD_REQUEST: "That request didn't look right, so nothing was sent.",
  UNAUTHORIZED: "Your sign-in is missing or expired. Please sign in again.",
  SIGNER_MISMATCH: "That action was signed by a different wallet than the one you're signed in with.",
  NOT_ALLOWLISTED: "BotFolio doesn't relay that action.",
  VALUE_NOT_ZERO: "BotFolio actions can't move any QIE, so nothing was sent.",
  GAS_TOO_HIGH: "That action asks for more gas than BotFolio relays.",
  DEADLINE_EXPIRED: "That signature expired. Please sign again.",
  DEADLINE_TOO_FAR: "That signature is valid for too long. Check your device's clock and sign again.",
  TERMS_NOT_ACCEPTED: "Please confirm you're 18 or older and accept the Terms first. Nothing was sent.",
  PICK_MISMATCH: "That isn't the pick you made before seeing your bot's call, so nothing was sent.",
  RATE_LIMITED_USER: "You've reached today's action limit. Please try again later.",
  RATE_LIMITED_IP: "Too many new bots from this connection today. Please try again later.",
  RATE_LIMITED_GLOBAL: "BotFolio is very busy right now. Please try again later.",
  INVALID_SIGNATURE: "That signature is no longer valid. Please sign again.",
  WOULD_REVERT: "QIE would reject this action, so nothing was sent.",
  RPC_UNAVAILABLE: "Can't reach QIE right now. Nothing was sent. Please try again.",
  INTERNAL: "Something went wrong on our side. Nothing was sent. Please try again.",
};

interface RefusalDetails {
  message?: string;
  retryAfterSeconds?: number;
  revertReason?: string;
}

/** Throwing this means "refused, nothing broadcast". */
export class RelayRefusal extends Error {
  override name = "RelayRefusal";
  constructor(
    readonly code: RelayErrorCode,
    readonly details: RefusalDetails = {},
  ) {
    super(code);
  }

  get httpStatus(): number {
    return RELAY_ERROR_HTTP_STATUS[this.code];
  }

  toBody(): RelayError {
    const { message = REFUSAL_MESSAGES[this.code], retryAfterSeconds, revertReason } = this.details;
    return {
      ok: false,
      error: {
        code: this.code,
        message,
        ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
        ...(revertReason !== undefined && { revertReason }),
      },
    };
  }
}
