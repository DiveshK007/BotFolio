import type { Metadata } from "next";
import { CopyButton } from "@/components/site/chrome";
import { AgentDemo } from "@/components/site/interactive";
import { Badge, Placeholder } from "@/components/site/ui";

export const metadata: Metadata = { title: "Developers: API and MCP", description: "Read any BotFolio bot's verified record from your own app or AI agent." };

// EXAMPLE response in the SPEC §10 shape. Replace with a real snapshot once /api/v1 is live.
const EXAMPLE = `{
  "bot": { "id": 7, "name": "AlphaWolf", "owner": "0x5eed…0007", "is_house": false },
  "versions": [{ "version": 1, "max_per_coin_bps": 4000, "config_hash": "0xc0f1…0001" }],
  "trades": [{ "asset": "GOLD", "side": "BUY", "price_e8": "373084000000",
               "round_id": "14811", "tx_hash": "0xe0a1…0031" }],
  "season_results": [{ "season_id": 1, "return_bps": -1240, "battle_rank": 4 }],
  "trust_score": { "rules_version": "trust-v1-sprint", "total": 312, "provisional": false }
}`;

export default function Developers() {
  const base = process.env.APP_URL;
  const curl = `curl ${base ?? "[APP URL]"}/api/v1/bots/7/record`;
  const mcp = `{ "mcpServers": { "botfolio": { "url": "${process.env.RENDER_SERVICE_URL ?? "[SERVICE URL]"}/mcp" } } }`;
  return (
    <>
      <section className="band tight enter"><div className="wrap stack">
        <h1>Read any bot&apos;s record from your own app or agent</h1>
        <p className="lede">A public JSON API and a read-only MCP server. No keys, no writes, 60 requests a minute per IP. Both go live with the app <Badge kind="coming">COMING ~NOV 25</Badge></p>
      </div></section>
      <section className="band tight alt"><div className="wrap"><AgentDemo /></div></section>
      <section className="band tight"><div className="wrap grid g2" style={{ alignItems: "start" }}>
        <div className="stack">
          <h3>Public record API</h3>
          <p className="muted">Bot, versions with config hashes, trades with tx hashes and oracle round ids, season results, trust score with its Merkle proof.</p>
          <div className="code"><CopyButton text={curl} /><pre>{base ? curl : <>curl <Placeholder>APP URL</Placeholder>/api/v1/bots/7/record</>}</pre></div>
          <div className="code" style={{ maxHeight: 420, overflow: "auto" }}><CopyButton text={EXAMPLE} /><pre>{EXAMPLE}</pre></div>
          <p className="small muted">Response shape follows SPEC §3 and §10. Values above are <Badge kind="example">EXAMPLE</Badge></p>
        </div>
        <div className="stack">
          <h3>BotFolio MCP server</h3>
          <p className="muted">Streamable HTTP at <span className="mono">/mcp</span> on our service. Read-only.</p>
          <div className="scroll" tabIndex={0} aria-label="MCP tools"><table style={{ minWidth: 0 }}><thead><tr><th>Tool</th><th>Returns</th></tr></thead><tbody>
            <tr><td className="mono">get_bot_record(bot_id)</td><td>Same payload as the API</td></tr>
            <tr><td className="mono">get_leaderboard(board, season?)</td><td>Top 20 for a board</td></tr>
            <tr><td className="mono">verify_trade(tx_hash)</td><td><span className="mono small">{"{valid, price, roundId, matchesOracle}"}</span></td></tr>
          </tbody></table></div>
          <div className="code"><CopyButton text={mcp} /><pre>{mcp}</pre></div>
        </div>
      </div></section>
    </>
  );
}
