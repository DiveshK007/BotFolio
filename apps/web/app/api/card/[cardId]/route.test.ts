import { describe, expect, it } from "vitest";
import { CARD_SIZES } from "@botfolio/shared";
import { clampText } from "../render";
import { GET } from "./route";

let ip = 0;
const call = (cardId: string, query = "", from = `203.0.113.${++ip % 250}`) =>
  GET(new Request(`https://botfolio.example/api/card/${cardId}${query}`, { headers: { "x-real-ip": from } }), { params: Promise.resolve({ cardId }) });

/** PNG width and height from the IHDR chunk. */
const pngSize = (b: Uint8Array) => {
  const v = new DataView(b.buffer, b.byteOffset);
  return { width: v.getUint32(16), height: v.getUint32(20) };
};

describe("GET /api/card/:cardId", () => {
  for (const kind of ["trade", "roast", "recap"]) {
    for (const [format, size] of Object.entries(CARD_SIZES)) {
      it(`draws the ${kind} card at ${size.width}×${size.height}`, async () => {
        const res = await call(`${kind}-mock`, format === "story" ? "?format=story" : "");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/png");
        expect(res.headers.get("cache-control")).toContain("immutable");
        const png = new Uint8Array(await res.arrayBuffer());
        expect(Array.from(png.slice(1, 4), (c) => String.fromCharCode(c)).join("")).toBe("PNG");
        expect(pngSize(png)).toEqual(size);
      }, 20_000);
    }
  }

  it("turns away an unknown format or kind with 400, and a missing card with 404", async () => {
    for (const [id, q] of [["trade-mock", "?format=square"], ["trade-mock", "?format=toString"], ["battle-7-s3", ""], ["nope", ""]] as const) {
      const res = await call(id, q);
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect((await call("trade-999")).status).toBe(404);
  });

  it("answers 429 once an IP has used its minute", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await call("nope", "", "198.51.100.9")).status);
    expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe("clampText", () => {
  it("keeps short text, flattens whitespace and control/bidi characters", () => {
    expect(clampText("  buy\n\tthe‮dip  ", 50)).toBe("buy the dip");
  });
  it("cuts long text to the limit with an ellipsis, without splitting an emoji", () => {
    const out = clampText("🐺".repeat(300), 120);
    expect(Array.from(out)).toHaveLength(120);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // no lone high surrogate
  });
});
