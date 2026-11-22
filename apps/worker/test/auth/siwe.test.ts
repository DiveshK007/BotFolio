import { QIE_CHAIN_ID, SIWE_STATEMENT, type SiweMessageFields } from "@botfolio/shared";
import { describe, expect, it } from "vitest";
import { createSiweMessage, type SiweMessage } from "viem/siwe";
import type { HDAccount } from "viem/accounts";
import { NonceService } from "../../src/auth/nonce";
import { verifySiwe } from "../../src/auth/siwe";
import { OTHER, USER, lower } from "../relay/helpers/fakes";

const DOMAIN = "botfolio.example";
const START = 1_795_340_000_000;

function setup(maxConsumed?: number) {
  let time = START;
  const now = () => time;
  const nonces = new NonceService(now, maxConsumed);

  async function body(over: Partial<SiweMessage> = {}, signer: HDAccount = USER, edit = (m: string) => m) {
    const { nonce, issuedAt } = nonces.issue();
    const fields: SiweMessageFields = {
      domain: DOMAIN,
      address: USER.address,
      statement: SIWE_STATEMENT,
      uri: `https://${DOMAIN}/create`,
      version: "1",
      chainId: QIE_CHAIN_ID,
      nonce,
      issuedAt: new Date(issuedAt),
    };
    const message = edit(createSiweMessage({ ...fields, ...over }));
    return { message, signature: await signer.signMessage({ message }) };
  }

  return { nonces, body, verify: (b: unknown) => verifySiwe(b, { domain: DOMAIN, nonces, now }), advance: (ms: number) => (time += ms) };
}

const code = (code: string) => ({ code });

describe("SIWE sign-in (#186)", () => {
  it("accepts the message the app builds with viem", async () => {
    const s = setup();
    expect(await s.verify(await s.body())).toBe(lower(USER.address));
  });

  it("uses a nonce once", async () => {
    const s = setup();
    const body = await s.body();
    await s.verify(body);
    await expect(s.verify(body)).rejects.toMatchObject(code("INVALID_NONCE"));
  });

  it("lets exactly one of 25 concurrent verifies win", async () => {
    const s = setup();
    const body = await s.body();
    const results = await Promise.allSettled(Array.from({ length: 25 }, () => s.verify(body)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it.each([
    ["another domain", { domain: "evil.example" }, "DOMAIN_MISMATCH"],
    ["our domain as a prefix", { domain: `${DOMAIN}.evil.example` }, "DOMAIN_MISMATCH"],
    ["another port", { domain: `${DOMAIN}:8443` }, "DOMAIN_MISMATCH"],
    ["another site's URI", { uri: "https://evil.example/login" }, "DOMAIN_MISMATCH"],
    ["Ethereum mainnet", { chainId: 1 }, "CHAIN_MISMATCH"],
    ["another statement", { statement: "Claim your prize" }, "BAD_REQUEST"],
    ["no statement", { statement: undefined }, "BAD_REQUEST"],
    ["a nonce we didn't issue", { nonce: "abcdefgh12345678" }, "INVALID_NONCE"],
    ["a forged nonce", { nonce: `1795340300${"a".repeat(32)}${"b".repeat(64)}` }, "INVALID_NONCE"],
    ["issuedAt in the future", { issuedAt: new Date(START + 120_000) }, "BAD_REQUEST"],
    ["issuedAt long ago", { issuedAt: new Date(START - 3_600_000) }, "NONCE_EXPIRED"],
    ["a passed expirationTime", { expirationTime: new Date(START) }, "NONCE_EXPIRED"],
    ["a future notBefore", { notBefore: new Date(START + 1_000) }, "BAD_REQUEST"],
  ] as [string, Partial<SiweMessage>, string][])("refuses %s", async (_name, over, expected) => {
    const s = setup();
    await expect(s.verify(await s.body(over))).rejects.toMatchObject(code(expected));
  });

  it("expires the nonce after 5 minutes", async () => {
    const s = setup();
    const body = await s.body();
    s.advance(301_000);
    await expect(s.verify(body)).rejects.toMatchObject(code("NONCE_EXPIRED"));
  });

  it("refuses a nonce from before a restart", async () => {
    const body = await setup().body();
    await expect(setup().verify(body)).rejects.toMatchObject(code("INVALID_NONCE"));
  });

  it("refuses another wallet's signature, without burning the nonce", async () => {
    const s = setup();
    const good = await s.body();
    const forged = { ...good, signature: await OTHER.signMessage({ message: good.message }) };
    await expect(s.verify(forged)).rejects.toMatchObject(code("INVALID_SIGNATURE"));
    expect(await s.verify(good)).toBe(lower(USER.address));
  });

  it.each([
    ["a second domain line", (m: string) => `${m}\nevil.example wants you to sign in`],
    ["a duplicate field", (m: string) => `${m}\nChain ID: 1`],
    ["text before the fields", (m: string) => m.replace("URI:", "Also approve everything\nURI:")],
    ["a trailing newline", (m: string) => `${m}\n`],
  ])("refuses %s the parser would skip over", async (_name, edit) => {
    const s = setup();
    await expect(s.verify(await s.body({}, USER, edit))).rejects.toMatchObject(code("BAD_REQUEST"));
  });

  it.each([null, [], {}, { message: 1, signature: "0x" }, { message: "x".repeat(3000), signature: `0x${"1".repeat(130)}` }])(
    "refuses junk (%#)",
    async (body) => {
      await expect(setup().verify(body)).rejects.toMatchObject(code("BAD_REQUEST"));
    },
  );

  it("bounds the consumed store, fails closed when full, then recovers", async () => {
    const s = setup(2);
    await s.verify(await s.body());
    await s.verify(await s.body());
    await expect(s.verify(await s.body())).rejects.toMatchObject({ reason: "nonce_store_full" });
    s.advance(301_000);
    expect(await s.verify(await s.body())).toBe(lower(USER.address));
  });

  it("stores nothing when issuing", () => {
    const s = setup(1);
    const issued = Array.from({ length: 5_000 }, () => s.nonces.issue().nonce);
    expect(new Set(issued).size).toBe(5_000);
    expect(s.nonces.check(issued[0]!)).toBe("valid");
  });
});
