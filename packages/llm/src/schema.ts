/**
 * A small JSON Schema subset and a validator for it.
 *
 * Why not ajv: we only need the handful of keywords that xAI strict structured
 * outputs support and that our schemas use (SPEC §6.3). Keeping the validator
 * tiny and dependency-free means the replay script can re-run exactly the same
 * check on logged outputs, and any keyword we don't support fails loudly
 * instead of being silently ignored.
 */

export type JsonSchema =
  | {
      type: "object";
      properties: Record<string, JsonSchema>;
      required?: readonly string[];
      additionalProperties: false;
      description?: string;
    }
  | { type: "array"; items: JsonSchema; minItems?: number; maxItems?: number; description?: string }
  | { type: "string"; minLength?: number; maxLength?: number; enum?: readonly string[]; description?: string }
  | { type: "integer"; minimum?: number; maximum?: number; enum?: readonly number[]; description?: string }
  | { type: "boolean"; description?: string }
  | { enum: readonly (string | number)[]; description?: string };

const KNOWN_KEYS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "enum",
  "description",
]);

export interface SchemaError {
  path: string;
  message: string;
}

/** Returns a list of problems; an empty list means `value` matches `schema`. */
export function validateJson(schema: JsonSchema, value: unknown, path = "$"): SchemaError[] {
  for (const k of Object.keys(schema)) {
    if (!KNOWN_KEYS.has(k)) throw new Error(`validateJson: unsupported schema keyword "${k}" at ${path}`);
  }
  const errors: SchemaError[] = [];
  const err = (message: string) => errors.push({ path, message });

  if ("enum" in schema && schema.enum && !schema.enum.includes(value as never)) {
    err(`must be one of ${JSON.stringify(schema.enum)}`);
    return errors;
  }
  if (!("type" in schema)) return errors;

  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        err("must be an object");
        break;
      }
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(obj, key)) errors.push({ path: `${path}.${key}`, message: "is required" });
      }
      for (const [key, v] of Object.entries(obj)) {
        // Own properties only: a plain lookup finds Object.prototype's "constructor", "__proto__", "toString"…
        const sub = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
        if (!sub) errors.push({ path: `${path}.${key}`, message: "is not allowed" });
        else errors.push(...validateJson(sub, v, `${path}.${key}`));
      }
      break;
    }
    case "array": {
      if (!Array.isArray(value)) {
        err("must be an array");
        break;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) err(`must have ≥ ${schema.minItems} items`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) err(`must have ≤ ${schema.maxItems} items`);
      value.forEach((v, i) => errors.push(...validateJson(schema.items, v, `${path}[${i}]`)));
      break;
    }
    case "string": {
      if (typeof value !== "string") {
        err("must be a string");
        break;
      }
      // JSON Schema counts Unicode code points, not UTF-16 units.
      const len = [...value].length;
      if (schema.minLength !== undefined && len < schema.minLength) err(`must be ≥ ${schema.minLength} chars`);
      if (schema.maxLength !== undefined && len > schema.maxLength) err(`must be ≤ ${schema.maxLength} chars`);
      break;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        err("must be an integer");
        break;
      }
      if (schema.minimum !== undefined && value < schema.minimum) err(`must be ≥ ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) err(`must be ≤ ${schema.maximum}`);
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") err("must be a boolean");
      break;
    }
  }
  return errors;
}

export function formatSchemaErrors(errors: SchemaError[]): string {
  return errors.map((e) => `${e.path} ${e.message}`).join("; ");
}
