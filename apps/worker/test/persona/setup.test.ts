import { describe, expect, it, vi } from "vitest";
import { loadWorkerConfig } from "../../src/config";
import { HealthState } from "../../src/health";
import { setUpPersona } from "../../src/persona/setup";

describe("setUpPersona", () => {
  it("PERSONA_DISABLED=true switches it off even when fully configured", () => {
    const env = { PERSONA_DISABLED: "true", DATABASE_URL: "postgres://u:p@localhost:5432/db", LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test" };
    const persona = setUpPersona({ env, cfg: loadWorkerConfig(env), health: new HealthState({ provider: "anthropic", capUsd: 4 }), log: vi.fn() });
    expect(persona.service).toBeNull();
    expect(persona.problems).toEqual(["PERSONA_DISABLED"]);
  });
});
