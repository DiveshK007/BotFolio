import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StatusBanner, StatusNotice } from "./StatusBanner";

it("renders nothing when there is no news", () => {
  expect(renderToStaticMarkup(createElement(StatusNotice, { messages: [] }))).toBe("");
});

it("renders each message in a status region", () => {
  const html = renderToStaticMarkup(createElement(StatusNotice, { messages: ["Bots are resting — they'll hold until the AI is back."] }));
  expect(html).toContain('role="status"');
  expect(html).toContain("Bots are resting");
});

it("renders nothing on the server, so the page never waits on the worker", () => {
  expect(renderToStaticMarkup(createElement(StatusBanner))).toBe("");
});
