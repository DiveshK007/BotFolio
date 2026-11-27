import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChallengeView } from "@/components/challenge/ChallengeView";
import { samplePage } from "@/lib/bot-record.fixture";
import type { OwnerConfig } from "@/lib/config";
import type { OwnerBot, PublicChallenge } from "@/lib/owner";
import type { WalletSession } from "@/lib/wallet";
import { SeasonView } from "./SeasonScreen";

const addr = (b: string) => `0x${b.repeat(20)}` as `0x${string}`;
const config: OwnerConfig = { workerUrl: "https://w", forwarder: addr("11"), targets: { SeasonLedger: addr("22") } };
const session = { address: addr("aa"), authKind: "privy", getAuthToken: async () => "t", signTypedData: async () => "0x" } as WalletSession;
const h = (b: string) => `0x${b.repeat(32)}` as `0x${string}`;

const proposal: NonNullable<OwnerBot["proposal"]> = {
  version: 2,
  configHash: h("ab"),
  approveBy: "2026-11-27T03:00:00.000Z",
  config: {
    version: 2,
    season: 1,
    rules: "Careful, max 25% per coin.",
    max_per_coin_bps: 2500,
    max_trades_per_day: 4,
    from: { version: 1, rules: "Careful.", max_per_coin_bps: 4000, max_trades_per_day: 4 },
    changes: [{ what: "You said 'too risky' 3×", because_correction_id: 12 }],
    approve_by: "2026-11-27T03:00:00.000Z",
  },
};
const owner = (p: OwnerBot["proposal"]): OwnerBot => ({ botId: "7", name: "AlphaWolf", status: "active", proposal: p, calls: { season: 1, you: 0, bot: 0, streak: 0, today: null } });
const season = (n: number, p: OwnerBot["proposal"]) =>
  renderToStaticMarkup(createElement(SeasonView, { n, data: { kind: "ok", page: samplePage(), owner: owner(p), daily: null, moves: [], cards: [] }, ctx: { config, session } }));

describe("SeasonView", () => {
  it("shows the battle result, the v2 diff tied to coaching, the window and Approve", () => {
    const html = season(1, proposal);
    expect(html).toContain("#1 of 4");
    expect(html).toContain("+10.00%");
    expect(html).toMatch(/Max per coin.*40\.00%.*25\.00%/);
    expect(html).not.toContain("Max trades a day"); // unchanged
    expect(html).toContain("from your coaching");
    expect(html).toContain("Approve by <b>27 Nov, 08:30 IST</b>, or your bot keeps v1");
    expect(html).toContain("Approve v2");
    expect(html).toContain("0xabab…abab");
  });

  it("lets the owner approve the S0 v2 while S0 stays off the boards (#385)", () => {
    const s0 = { ...proposal, config: { ...proposal.config, season: 0 } };
    const html = season(0, s0);
    expect(html).toContain("Approve v2");
    expect(html).toContain("test season, so its results stay off the boards");
    expect(html).not.toContain("leaderboards?season=0");
    expect(html).not.toContain("No result for season 0 yet");
  });

  it("says there's nothing to approve for another season or after the window", () => {
    expect(season(2, proposal)).toContain("Nothing waiting for you");
    expect(season(2, proposal)).toContain("No result for season 2 yet");
    expect(season(1, null)).not.toContain("Approve v2");
  });
});

describe("ChallengeView", () => {
  const c: PublicChallenge = {
    code: h("c0"),
    season: 3,
    status: "accepted",
    challenger: { botId: "7", name: "<b>GoldGuru</b>", emoji: "g", ownerWallet: `0x${"a1".repeat(20)}` },
    opponent: { botId: "8", name: "AlphaWolf", emoji: "w", ownerWallet: `0x${"b2".repeat(20)}` },
    createTx: h("01"),
    acceptTx: h("02"),
    winnerBotId: null,
  };

  it("shows both bots with explorer links and escapes the names", () => {
    const html = renderToStaticMarkup(createElement(ChallengeView, { challenge: c }));
    expect(html).toContain("&lt;b&gt;GoldGuru&lt;/b&gt;");
    expect(html).toContain(`https://mainnet.qie.digital/tx/${h("02")}`);
    expect(html).toContain("The result comes at the season 3 close");
  });

  it("marks the winner once settled, and offers a newcomer the 30-second path while open", () => {
    expect(renderToStaticMarkup(createElement(ChallengeView, { challenge: { ...c, status: "settled", winnerBotId: "8" } }))).toContain("Won");
    // No contract addresses in the test env: the accept step says it isn't live rather than guessing.
    expect(renderToStaticMarkup(createElement(ChallengeView, { challenge: { ...c, status: "open", opponent: null, acceptTx: null } }))).toContain("Your bot here?");
  });
});
