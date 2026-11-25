import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { ASSETS, CARD_FOOTER, CARD_SIZES, type CardCallRef, type CardFormat, type CardOraclePrice, type CardPayload } from "@botfolio/shared";
import { PLAY_MONEY_LINE } from "@/components/ui/PlayMoneyFooter";
import { assetName, displayInr, formatE8, formatInr, priceAge, shortHex } from "@/lib/format";

/** The kinds this renderer draws (#102). The other five come in later issues. */
export const RENDERED_KINDS = ["trade", "roast", "recap"] as const;
export type RenderedKind = (typeof RENDERED_KINDS)[number];
export type RenderedCard = Extract<CardPayload, { kind: RenderedKind }>;
export const isRenderedKind = (k: string): k is RenderedKind => (RENDERED_KINDS as readonly string[]).includes(k);
export const isRenderedCard = (c: CardPayload): c is RenderedCard => isRenderedKind(c.kind);

// Untrusted text (#159): names, emoji, lines and reasons come from users or the LLM. They only ever reach Satori as
// JSX text children (it lays them out as text, never parses markup) and are clamped so long text can't break layout.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g; // incl. bidi overrides
export function clampText(text: string, max: number): string {
  const flat = text.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(flat); // code points, so a cut never splits a surrogate pair
  return chars.length <= max ? flat : chars.slice(0, max - 1).join("").trimEnd() + "…";
}
/** The bot's emoji is one grapheme; anything longer is cut to its first. */
const firstGrapheme = (s: string) => new Intl.Segmenter().segment(clampText(s, 16))[Symbol.iterator]().next().value?.segment ?? "";

// Noto Sans (OFL), subset from Google Fonts to Latin-1 + ₹ − “ ” … (next/og's built-in font has no ₹).
// Glyphs outside the subset (Devanagari etc.) are fetched by next/og from Google Fonts at render time.
type Fonts = NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"];
let fonts: Promise<Fonts> | undefined;
const loadFonts = () =>
  (fonts ??= Promise.all([
    readFile(path.join(process.cwd(), "app/api/card/fonts/noto-sans-400.ttf")),
    readFile(path.join(process.cwd(), "app/api/card/fonts/noto-sans-700.ttf")),
  ]).then(
    ([regular, bold]): Fonts => [
      { name: "Noto Sans", data: regular, weight: 400, style: "normal" },
      { name: "Noto Sans", data: bold, weight: 700, style: "normal" },
    ],
    () => undefined, // missing file: next/og's default font, ₹ shows as a box
  ));

const C = { paper: "#FAFAF7", surface: "#FFFFFF", ink: "#14161C", muted: "#5A5F6B", line: "#E2E1DA", accent: "#2B50FF", sun: "#FFC93C", up: "#0B7A53", down: "#C23B25", amber: "#8A5A00", grey: "#6B6F78" };

const pct = (bps: number) => `${bps < 0 ? "−" : "+"}${(Math.abs(bps) / 100).toFixed(2)}%`;
const SINCE = { start: "since start", slot: "this slot", day: "today", season: "this season" } as const;
const priceText = (p: CardOraclePrice) => `${formatE8(BigInt(p.priceE8))} ${ASSETS.find((a) => a.id === p.asset)?.quote ?? ""}`;
/** SPEC §5.7 age label, relative to when the price was read (the card is cached for a year). */
function ageText(p: CardOraclePrice): { text: string; color: string } {
  const a = priceAge(p.asset, Math.floor(Date.parse(p.updatedAt) / 1000), Date.parse(p.readAt));
  return { text: a.tone === "muted" ? `${assetName(p.asset)} price ${a.text}` : a.text, color: a.tone === "amber" ? C.amber : a.tone === "grey" ? C.grey : C.muted };
}
const istDate = (day: number) => new Date(day * 86_400_000).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const siteHost = () => new URL(process.env.APP_URL ?? "http://localhost:3000").host;

type Row = { text: string; color?: string };
const callRow = (label: string, c: CardCallRef): Row => ({
  text: `${label}: ${c.side} ${assetName(c.price.asset)} at ${priceText(c.price)}, ${pct(c.pnlBps)}`,
  color: c.pnlBps < 0 ? C.down : C.up,
});

/** What only this kind shows: a tag, a headline and a few detail rows. */
function kindParts(card: RenderedCard, inr: (e8: string) => string): { tag: string; headline: string; rows: Row[] } {
  switch (card.kind) {
    case "trade": {
      const t = card.trade;
      return {
        tag: "First trade",
        headline: `${t.side} ${assetName(t.price.asset)} · ${inr(t.cashE8)}`,
        rows: [{ text: `at ${priceText(t.price)}` }, ...(t.approvedByOwner ? [{ text: "Approved by its owner" }] : [])],
      };
    }
    case "roast": {
      const r = card.roast;
      return {
        tag: "Roast",
        headline: r.trigger === "slot_loss" ? `Lost ${inr(r.lossE8)} in one slot` : `Worst call of the season: ${pct(-r.lossBps)}`,
        rows: r.trigger === "worst_call" ? [callRow("Call", r.call)] : [],
      };
    }
    case "recap": {
      const r = card.recap;
      return {
        tag: "Daily recap",
        headline: istDate(r.day) + (r.rank ? ` · #${r.rank.position} of ${r.rank.of}` : ""),
        rows: [
          ...(r.best ? [callRow("Best", r.best)] : []),
          ...(r.worst ? [callRow("Worst", r.worst)] : []),
          ...(!r.best && !r.worst ? [{ text: "Quiet day: no trades" }] : []),
        ],
      };
    }
  }
}

/** One card as a PNG. Takes a stored payload; where it comes from is the caller's business. */
export async function renderCard(card: RenderedCard, format: CardFormat, headers: Record<string, string> = {}): Promise<ImageResponse> {
  const { width, height } = CARD_SIZES[format];
  const s = <T,>(og: T, story: T) => (format === "story" ? story : og);

  const start = BigInt(card.value.startCashE8);
  const inr = (e8: string) => formatInr(displayInr(BigInt(e8), start));
  const parts = kindParts(card, inr);
  const owner = clampText(card.bot.ownerQieName ?? shortHex(card.bot.ownerAddress), 32);
  const valueAge = card.value.oldestPrice ? ageText(card.value.oldestPrice) : null;
  const chips = [
    parts.tag,
    ...(card.seasonId !== null ? [`Season ${card.seasonId}`] : []),
    ...(card.trust ? [`Trust ${card.trust.total}${card.trust.provisional ? " · new" : ""}`] : []),
    ...(card.bot.isHouse ? ["House bot"] : []),
  ];
  const tx = card.cites[0]?.txHash;

  return new ImageResponse(
    (
      <div style={{ width, height, display: "flex", flexDirection: "column", justifyContent: "space-between", background: C.paper, color: C.ink, padding: s(52, 96), fontSize: s(26, 40), fontFamily: "Noto Sans" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: s(18, 40) }}>
          <div style={{ display: "flex", alignItems: "center", gap: s(20, 32) }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, width: s(88, 160), height: s(88, 160), borderRadius: s(22, 40), background: C.sun, fontSize: s(56, 100) }}>
              {firstGrapheme(card.bot.emoji)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden" }}>
              <div style={{ fontSize: s(48, 72), fontWeight: 700, lineHeight: 1.1, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{clampText(card.bot.name, 24)}</div>
              <div style={{ color: C.muted }}>{owner}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: s(10, 16) }}>
            {chips.map((c) => (
              <div key={c} style={{ display: "flex", padding: s("4px 14px", "10px 24px"), borderRadius: 999, border: `2px solid ${C.line}`, background: C.surface, fontSize: s(20, 34) }}>
                {c}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: s(6, 24) }}>
          <div style={{ fontSize: s(40, 72), fontWeight: 700, lineHeight: 1.15 }}>{parts.headline}</div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: s(16, 32) }}>
            <div style={{ fontSize: s(34, 64), fontWeight: 700 }}>{inr(card.value.valueE8)}</div>
            <div style={{ color: card.change.bps < 0 ? C.down : C.up, fontSize: s(28, 52) }}>{`${pct(card.change.bps)} ${SINCE[card.change.since]}`}</div>
            {valueAge ? <div style={{ color: valueAge.color, fontSize: s(20, 32) }}>{valueAge.text}</div> : null}
          </div>
          {parts.rows.map((r) => (
            <div key={r.text} style={{ color: r.color ?? C.ink, fontSize: s(24, 38) }}>
              {r.text}
            </div>
          ))}
          {card.line ? (
            <div style={{ display: "flex", marginTop: s(6, 32), padding: s("10px 18px", "28px 36px"), borderLeft: `6px solid ${C.accent}`, background: C.surface, maxHeight: s(120, 460), overflow: "hidden", fontSize: s(24, 40) }}>
              {`“${clampText(card.line.text, s(110, 160))}”`}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: s(2, 12), color: C.muted, fontSize: s(18, 26) }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>{`${siteHost()}/bot/${card.bot.botId}`}</div>
            {tx ? <div>{`tx ${shortHex(tx)}`}</div> : null}
          </div>
          <div>{CARD_FOOTER}</div>
          <div style={{ color: C.ink }}>{PLAY_MONEY_LINE}</div>
        </div>
      </div>
    ),
    { width, height, emoji: "twemoji", headers, fonts: await loadFonts() },
  );
}
