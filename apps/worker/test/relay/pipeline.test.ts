import { RELAY_ERROR_HTTP_STATUS, type RelayErrorCode } from "@botfolio/shared";
import { describe, expect, it } from "vitest";
import { InternalFailure } from "../../src/auth/log";
import { RelayRefusal } from "../../src/relay/errors";
import { MAX_CALLDATA_BYTES } from "../../src/relay/request";
import { CREATE_BOT, OTHER, RELAYER, TX_HASH, USER, fakeRelay, lower, relayInput, signedRequest } from "./helpers/fakes";

const code = (r: { body: unknown }) => (r.body as { error?: { code: RelayErrorCode } }).error?.code;

describe("POST /relay pipeline (#37)", () => {
  it("submits and returns the hash and relay_log id", async () => {
    const f = fakeRelay();
    const result = await f.relay(relayInput(await signedRequest()));
    expect(result).toEqual({ status: 200, body: { ok: true, status: "submitted", txHash: TX_HASH, relayId: "7" } });
    expect(f.guard.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ wallet: lower(USER.address), selector: CREATE_BOT.slice(0, 10) }),
    );
    expect(f.reservation.release).not.toHaveBeenCalled();
  });

  it.each([
    ["no body", () => undefined],
    ["array body", () => []],
    ["no request", () => ({})],
    ["numeric value", (r: object) => ({ request: { ...r, value: 0 } })],
    ["negative gas", (r: object) => ({ request: { ...r, gas: "-1" } })],
    ["hex gas", (r: object) => ({ request: { ...r, gas: "0x10" } })],
    ["uint256 overflow", (r: object) => ({ request: { ...r, gas: (2n ** 256n).toString() } })],
    ["fractional deadline", (r: object) => ({ request: { ...r, deadline: 1.5 } })],
    ["string deadline", (r: object) => ({ request: { ...r, deadline: "123" } })],
    ["uint48 overflow", (r: object) => ({ request: { ...r, deadline: 2 ** 48 } })],
    ["short from", (r: object) => ({ request: { ...r, from: "0x12" } })],
    ["odd-length data", (r: object) => ({ request: { ...r, data: "0x123" } })],
    ["huge calldata", (r: object) => ({ request: { ...r, data: `0x${"00".repeat(MAX_CALLDATA_BYTES + 1)}` } })],
    ["64-byte signature", (r: object) => ({ request: { ...r, signature: `0x${"11".repeat(64)}` } })],
  ])("BAD_REQUEST for %s, before auth", async (_name, mutate) => {
    const f = fakeRelay();
    const body = mutate(await signedRequest());
    const result = await f.relay({ body, headers: {}, ip: "x" });
    expect(code(result)).toBe("BAD_REQUEST");
    expect(f.auth.authenticate).not.toHaveBeenCalled();
    expect(f.sender.send).not.toHaveBeenCalled();
  });

  it("refuses without credentials and logs nothing under the claimed wallet", async () => {
    const f = fakeRelay({ auth: { authenticate: async () => null } });
    const result = await f.relay(relayInput(await signedRequest()));
    expect(code(result)).toBe("UNAUTHORIZED");
    expect(result.status).toBe(401);
    expect(f.guard.reserve).not.toHaveBeenCalled();
    expect(f.guard.recordRefusal).not.toHaveBeenCalled();
    expect(f.sender.send).not.toHaveBeenCalled();
  });

  it("refuses when the proven wallet isn't request.from, so nobody can spend another wallet's limit", async () => {
    const f = fakeRelay();
    const result = await f.relay(relayInput(await signedRequest({}, undefined, OTHER)));
    expect(code(result)).toBe("SIGNER_MISMATCH");
    expect(f.guard.reserve).not.toHaveBeenCalled();
    expect(f.guard.recordRefusal).not.toHaveBeenCalled();
  });

  it("never relays for its own hot wallet, which would count as user activity", async () => {
    const f = fakeRelay({ auth: { authenticate: async () => ({ kind: "siwe", wallets: [lower(RELAYER.address)] }) } });
    expect(code(await f.relay(relayInput(await signedRequest({}, undefined, RELAYER))))).toBe("SIGNER_MISMATCH");
    expect(f.sender.send).not.toHaveBeenCalled();
  });

  it.each(["RATE_LIMITED_USER", "RATE_LIMITED_GLOBAL"] as const)("%s stops before any RPC", async (limit) => {
    const f = fakeRelay();
    f.guard.reserve.mockRejectedValue(new RelayRefusal(limit, { retryAfterSeconds: 9 }));
    const result = await f.relay(relayInput(await signedRequest()));
    expect(result.body).toMatchObject({ error: { code: limit, retryAfterSeconds: 9 } });
    expect(f.chain.prepare).not.toHaveBeenCalled();
    expect(f.guard.recordRefusal).toHaveBeenCalledOnce();
  });

  it.each(["INVALID_SIGNATURE", "WOULD_REVERT", "RPC_UNAVAILABLE"] as const)(
    "%s releases the reservation and broadcasts nothing",
    async (refusal) => {
      const f = fakeRelay();
      f.chain.prepare.mockRejectedValue(new RelayRefusal(refusal));
      const result = await f.relay(relayInput(await signedRequest()));
      expect(code(result)).toBe(refusal);
      expect(result.status).toBe(RELAY_ERROR_HTTP_STATUS[refusal]);
      expect(f.sender.send).not.toHaveBeenCalled();
      expect(f.reservation.release).toHaveBeenCalledOnce();
    },
  );

  it.each(["auth", "reserve", "chain"] as const)("fails closed when %s throws", async (stage) => {
    const f = fakeRelay();
    const boom = new Error("postgres://user:hunter2@db https://rpc.example/key");
    if (stage === "auth") f.auth.authenticate.mockRejectedValue(boom);
    if (stage === "reserve") f.guard.reserve.mockRejectedValue(boom);
    if (stage === "chain") f.chain.prepare.mockRejectedValue(boom);
    const result = await f.relay(relayInput(await signedRequest()));
    expect(code(result)).toBe("INTERNAL");
    expect(f.sender.send).not.toHaveBeenCalled();
    const visible = JSON.stringify([result.body, f.log.mock.calls]);
    expect(visible).not.toMatch(/hunter2|postgres:|rpc\.example/);
  });

  it("releases when the sender says nothing was sent", async () => {
    const f = fakeRelay();
    f.sender.send.mockRejectedValue(new InternalFailure("broadcast_rejected"));
    expect(code(await f.relay(relayInput(await signedRequest())))).toBe("INTERNAL");
    expect(f.reservation.release).toHaveBeenCalledOnce();
  });

  it("keeps the refusal when relay_log can't be written", async () => {
    const f = fakeRelay();
    f.chain.prepare.mockRejectedValue(new RelayRefusal("WOULD_REVERT"));
    f.reservation.release.mockRejectedValue(new Error("db down"));
    expect(code(await f.relay(relayInput(await signedRequest())))).toBe("WOULD_REVERT");
  });

  it("puts no signature or token in the log", async () => {
    const f = fakeRelay();
    const request = await signedRequest();
    await f.relay({ body: { request }, headers: { authorization: "Bearer secret-token" }, ip: "203.0.113.9" });
    const logged = JSON.stringify(f.log.mock.calls);
    expect(logged).not.toContain(request.signature.slice(2, 40));
    expect(logged).not.toMatch(/secret-token|203\.0\.113\.9/);
  });
});
