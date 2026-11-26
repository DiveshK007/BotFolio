/**
 * House-bot seeding (#28, #134). Two steps, run by a person (docs/deploy.md step 6):
 *
 *   pnpm --filter ./apps/worker house:seed forge
 *     prints the env for `forge script script/Admin.s.sol:SeedHouseBots` (hashes and limits, no secrets)
 *
 *   DATABASE_URL=… ADMIN_ADDRESS=0x… pnpm --filter ./apps/worker house:seed db
 *     saves the three personas as the admin wallet's drafts, so the indexer names the bots when it sees them,
 *     and renames rows it already wrote as "Bot #n". Safe to run again, before or after the on-chain step.
 */
import { isAddress } from "viem";
import { savePersonaDraft } from "../persona/drafts";
import { HOUSE_PERSONAS, housePersonaHash } from "./personas";

async function main(mode: string | undefined): Promise<void> {
  if (mode === "forge") {
    console.log(`HOUSE_HASHES=${HOUSE_PERSONAS.map(housePersonaHash).join(",")}`);
    console.log(`HOUSE_BPS=${HOUSE_PERSONAS.map((h) => h.maxPerCoinBps).join(",")}`);
    console.log(`HOUSE_TRADES=${HOUSE_PERSONAS.map((h) => h.maxTradesPerDay).join(",")}`);
    return;
  }
  if (mode !== "db") throw new Error("usage: house:seed forge | db");

  const admin = process.env.ADMIN_ADDRESS ?? "";
  const url = process.env.DATABASE_URL ?? "";
  if (!isAddress(admin)) throw new Error("ADMIN_ADDRESS must be the wallet that owns the house bots");
  if (!url) throw new Error("DATABASE_URL is not set");

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    const now = new Date();
    for (const house of HOUSE_PERSONAS) {
      const hash = housePersonaHash(house);
      await savePersonaDraft(client, { wallet: admin, privyDid: null, loginMethod: "qie_wallet" }, hash, house.persona, now);
      const { rowCount } = await client.query(
        `update bots set name = $1, emoji = $2, persona_text = $3
         where is_house and persona_hash = decode($4, 'hex') and owner_wallet = $5`,
        [house.persona.name, house.persona.emoji, house.persona.persona, hash.slice(2), admin.toLowerCase()],
      );
      console.log(`${house.persona.name}: draft saved${rowCount ? `, ${rowCount} bot row renamed` : ""} (${hash})`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
