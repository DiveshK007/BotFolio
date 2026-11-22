import { describe, expect, it } from "vitest";
import { validateJson, type JsonSchema } from "../src/schema";

const schema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["n"],
  properties: { n: { type: "integer" } },
};

describe("validateJson only trusts own properties", () => {
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])("rejects the extra key %s", (key) => {
    // JSON.parse, as with model output: an object literal would treat __proto__ specially.
    const value: unknown = JSON.parse(`{"n":1,${JSON.stringify(key)}:"smuggled"}`);
    expect(validateJson(schema, value)).toEqual([{ path: `$.${key}`, message: "is not allowed" }]);
  });

  it("an inherited name doesn't satisfy `required`", () => {
    const s: JsonSchema = { ...schema, required: ["toString"], properties: { toString: { type: "string" } } };
    expect(validateJson(s, {})).toEqual([{ path: "$.toString", message: "is required" }]);
  });
});
