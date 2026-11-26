/**
 * One real LLM call with the production persona prompt, to check a provider and key before deploying.
 * Costs a fraction of a cent. The key is read from the environment and never printed.
 *
 *   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=… pnpm --filter ./apps/worker llm:smoke "Careful like my dad, loves gold"
 */
import { createLlmClient, estimateCostUsd, loadLlmConfig } from "@botfolio/llm";
import { createPersona } from "./persona";

async function main(sentence: string): Promise<void> {
  const config = loadLlmConfig(process.env);
  const llm = createLlmClient({ env: process.env });
  console.log(`provider=${config.provider} model=${config.models.persona} temperature=${config.temperature ?? "unset"}`);
  const res = await createPersona({ llm, config, sentence });
  const usage = res.log.usage;
  if (usage) console.log(`tokens in=${usage.inTok} out=${usage.outTok} ≈ $${estimateCostUsd(res.log.model, usage).toFixed(5)}`);
  if (res.status !== "ok") {
    console.error(`persona failed: ${res.error}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ persona: res.persona, limits: res.limits, flags: res.flags }, null, 2));
}

main(process.argv[2] || "Careful like my dad, loves gold").catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
