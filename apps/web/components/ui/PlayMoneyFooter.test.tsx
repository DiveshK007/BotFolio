import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLAY_MONEY_LINE, PlayMoneyFooter, feedbackUrl } from "./PlayMoneyFooter";

describe("feedbackUrl (#182, master plan B7)", () => {
  it("takes only an https URL", () => {
    expect(feedbackUrl("https://forms.example/botfolio")).toBe("https://forms.example/botfolio");
    expect(feedbackUrl("  https://forms.example/x  ")).toBe("https://forms.example/x");
    for (const bad of [undefined, "", "http://forms.example", "javascript:alert(1)", "https://a b"]) expect(feedbackUrl(bad)).toBeNull();
  });
});

describe("PlayMoneyFooter", () => {
  it("always carries the play-money line, and no Feedback link until one is set", () => {
    const html = renderToStaticMarkup(createElement(PlayMoneyFooter, { feedback: null }));
    expect(html).toContain(PLAY_MONEY_LINE);
    expect(html).not.toContain("Feedback");
  });

  it("links to the feedback form in a new tab", () => {
    const html = renderToStaticMarkup(createElement(PlayMoneyFooter, { feedback: "https://forms.example/botfolio" }));
    expect(html).toContain('href="https://forms.example/botfolio"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">Feedback</a>");
  });
});
