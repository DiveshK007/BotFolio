import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HasBot } from "./CreateFlow";
import { SignInStep, SLOW_PASSKEY_TEXT } from "./SignInStep";

describe("has_bot (#93)", () => {
  it("sends a wallet that already has a bot to /me, or back to the challenge it came from", () => {
    const mine = renderToStaticMarkup(createElement(HasBot, { botId: 7n, challenge: null }));
    expect(mine).toContain("You already have bot #7");
    expect(mine).toContain('href="/me"');
    expect(mine).toContain("Open my bot");
    const back = renderToStaticMarkup(createElement(HasBot, { botId: 7n, challenge: "c0".repeat(8) }));
    expect(back).toContain(`href="/challenge/${"c0".repeat(8)}"`);
  });
});

describe("SignInStep", () => {
  const step = (busy: "passkey" | null) =>
    renderToStaticMarkup(createElement(SignInStep, { blocked: null, busy, options: { passkey: true, qie: false }, onSignIn: () => {} }));

  it("keeps a status slot for the slow-passkey note only while the passkey sheet is open, empty at first", () => {
    expect(step("passkey")).toContain("Waiting for your passkey");
    expect(step("passkey")).toContain('role="status"');
    expect(step("passkey")).not.toContain(SLOW_PASSKEY_TEXT); // appears after 12 s
    expect(step(null)).not.toContain('role="status"');
  });
});
