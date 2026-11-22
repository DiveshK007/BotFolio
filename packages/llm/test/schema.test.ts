import { describe, expect, it } from "vitest";
import { validateJson, type JsonSchema } from "../src/schema";

const schema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "n", "tags"],
  properties: {
    name: { type: "string", minLength: 2, maxLength: 5 },
    n: { type: "integer", minimum: 1, maximum: 8 },
    side: { enum: ["BUY", "SELL"] },
    ok: { type: "boolean" },
    tags: { type: "array", maxItems: 2, items: { type: "string" } },
  },
};

describe("validateJson", () => {
  it("accepts a matching value", () => {
    expect(validateJson(schema, { name: "abc", n: 3, side: "BUY", ok: true, tags: ["x"] })).toEqual([]);
  });

  it("reports missing required and extra keys", () => {
    const errors = validateJson(schema, { name: "abc", n: 3, extra: 1 });
    expect(errors.map((e) => e.path)).toEqual(["$.tags", "$.extra"]);
  });

  it("checks bounds, integers, enums and array length", () => {
    const errors = validateJson(schema, { name: "a", n: 2.5, side: "HODL", ok: "yes", tags: ["a", "b", "c"] });
    expect(errors.map((e) => e.path)).toEqual(["$.name", "$.n", "$.side", "$.ok", "$.tags"]);
  });

  it("counts code points, so an emoji is one character", () => {
    expect(validateJson({ type: "string", maxLength: 1 }, "🐺")).toEqual([]);
  });

  it("fails loudly on a keyword it does not implement", () => {
    expect(() => validateJson({ type: "string", pattern: "x" } as unknown as JsonSchema, "x")).toThrow(/unsupported/);
  });
});
