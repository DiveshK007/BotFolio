import {
  forwardRequestToJson,
  forwardRequestTypedData,
  toForwardRequest,
  type ForwardRequestJson,
  type ForwardRequestMessage,
  type RelayTargetAddresses,
} from "@botfolio/shared";
import { vi } from "vitest";
import type { Address, Hex } from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import type { Identity } from "../../../src/auth/types";
import { createRelay, type RelayDeps } from "../../../src/relay/pipeline";
import type { Reservation } from "../../../src/relay/ports";

/** Anvil's public test mnemonic. Never holds value. */
export const testAccount = (index: number): HDAccount =>
  mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: index });

export const RELAYER = testAccount(0);
export const USER = testAccount(1);
export const OTHER = testAccount(2);
export const lower = (address: string) => address.toLowerCase() as Address;

export const FORWARDER = "0x00000000000000000000000000000000000000f0" as Address;
export const REGISTRY = "0x00000000000000000000000000000000000000b1" as Address;
export const CREATE_BOT = `0xf429b088${"11".repeat(32)}${"0".repeat(60)}0fa0${"0".repeat(62)}03` as Hex;
export const TARGETS: RelayTargetAddresses = {
  BotRegistry: REGISTRY,
  SeasonLedger: "0x00000000000000000000000000000000000000b2",
  PaperLedger: "0x00000000000000000000000000000000000000b3",
  DailyCall: "0x00000000000000000000000000000000000000b4",
  Challenges: "0x00000000000000000000000000000000000000b5",
};
export const TX_HASH = `0x${"ab".repeat(32)}` as Hex;
export const NOW_S = 1_795_340_000;

export async function signedRequest(
  over: Partial<ForwardRequestMessage> = {},
  forwarder: Address = FORWARDER,
  signer: HDAccount = USER,
): Promise<ForwardRequestJson> {
  const message: ForwardRequestMessage = {
    from: signer.address,
    to: REGISTRY,
    value: 0n,
    gas: 300_000n,
    nonce: 0n,
    deadline: NOW_S + 300,
    data: CREATE_BOT,
    ...over,
  };
  return forwardRequestToJson(toForwardRequest(message, await signer.signTypedData(forwardRequestTypedData(forwarder, message))));
}

export function fakeReservation(id = "7") {
  return {
    id,
    recordSigned: vi.fn<Reservation["recordSigned"]>(async () => {}),
    recordOutcome: vi.fn<Reservation["recordOutcome"]>(async () => {}),
    release: vi.fn<Reservation["release"]>(async () => {}),
  };
}

/** A relay whose every dependency says yes, so each test only has to break one. */
export function fakeRelay(over: Partial<RelayDeps> = {}) {
  const reservation = fakeReservation();
  const identity: Identity = { kind: "siwe", wallets: [lower(USER.address)] };
  const auth = { authenticate: vi.fn<RelayDeps["auth"]["authenticate"]>(async () => identity) };
  const guard = {
    reserve: vi.fn<RelayDeps["guard"]["reserve"]>(async () => reservation),
    recordRefusal: vi.fn<RelayDeps["guard"]["recordRefusal"]>(async () => {}),
    hasAcceptedTerms: vi.fn<RelayDeps["guard"]["hasAcceptedTerms"]>(async () => true),
    dailyCallPick: vi.fn<RelayDeps["guard"]["dailyCallPick"]>(async () => null),
  };
  const chain = { prepare: vi.fn<RelayDeps["chain"]["prepare"]>(async () => ({ to: FORWARDER, data: "0x12" as Hex, gas: 200_000n })) };
  const sender = { send: vi.fn<RelayDeps["sender"]["send"]>(async () => ({ txHash: TX_HASH })) };
  const log = vi.fn<RelayDeps["log"]>();
  const deps: RelayDeps = { auth, guard, chain, sender, relayer: RELAYER.address, targets: TARGETS, now: () => NOW_S, log, ...over };
  return { relay: createRelay(deps), reservation, auth, guard, chain, sender, log };
}

export const relayInput = (request: unknown) => ({ body: { request }, headers: {}, ip: "203.0.113.9" });
