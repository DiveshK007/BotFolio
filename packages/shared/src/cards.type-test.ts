// Compile-time checks for cards.ts. `pnpm --filter @botfolio/shared typecheck` is the test; nothing here runs.
import type { CardKind, CardPayload, CardPayloadOf } from "./cards";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

/** true unless something in T can't go through JSON unchanged (bigint, Date, function, undefined). */
type IsJson<T> = T extends string | number | boolean | null
  ? true
  : T extends bigint | Date | undefined | ((...args: never[]) => unknown)
    ? false
    : T extends readonly (infer U)[]
      ? IsJson<U>
      : T extends object
        ? false extends { [K in keyof T]-?: IsJson<T[K]> }[keyof T]
          ? false
          : true
        : false;

export type Checks = [
  // The union and CARD_KINDS hold the same kinds.
  Expect<Equal<CardPayload["kind"], CardKind>>,
  // Exactly the 8 kinds of SPEC §3 / §9.
  Expect<Equal<CardKind, "trade" | "roast" | "battle" | "season" | "recap" | "evolution" | "challenge" | "call">>,
  // Each kind narrows to its own payload.
  Expect<Equal<{ [K in CardKind]: CardPayloadOf<K>["kind"] }, { [K in CardKind]: K }>>,
  // Safe to store in jsonb.
  Expect<Equal<IsJson<CardPayload>, true>>,
  // The JSON check itself does catch a bigint.
  Expect<Equal<IsJson<{ nested: { value: bigint }[] }>, false>>,
];

/** Stops compiling if a kind is added without a case, or if a kind loses its own field. */
export function detailOf(card: CardPayload): object {
  switch (card.kind) {
    case "trade":
      return card.trade;
    case "roast":
      return card.roast;
    case "battle":
      return card.battle;
    case "season":
      return card.season;
    case "recap":
      return card.recap;
    case "evolution":
      return card.evolution;
    case "challenge":
      return card.challenge;
    case "call":
      return card.call;
    default: {
      const missing: never = card;
      return missing;
    }
  }
}
