import type { Metadata } from "next";
import { ASSETS } from "@botfolio/shared";
import { AppHeader } from "@/components/AppHeader";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { isAddress } from "@/lib/format";

export const metadata: Metadata = {
  title: "Proof",
  description: "BotFolio's 7 contracts on QIE mainnet, the 5 oracle feeds and their max ages, the oracle caveat, trust rules and how to replay a season.",
};

const REPO = "https://github.com/DiveshK007/BotFolio";

// SPEC §4.9. Addresses come only from env, set after the mainnet deploy (#25). Missing or malformed → "Not deployed yet", never a guess.
// Each var is named in full: Next only inlines literal process.env.NEXT_PUBLIC_* reads.
// UNVERIFIED until #25: no contract is deployed or source-verified on the explorer yet.
const CONTRACTS = [
  { name: "BotForwarder", address: process.env.NEXT_PUBLIC_FORWARDER_ADDRESS, does: "Relays your signed requests so you never pay gas. Unchanged OpenZeppelin ERC2771Forwarder." },
  { name: "BotRegistry", address: process.env.NEXT_PUBLIC_BOT_REGISTRY_ADDRESS, does: "Who owns each bot, its persona hash and its limits." },
  { name: "PaperLedger", address: process.env.NEXT_PUBLIC_PAPER_LEDGER_ADDRESS, does: "Every trade and play balance. Reads the oracle price itself at trade time." },
  { name: "SeasonLedger", address: process.env.NEXT_PUBLIC_SEASON_LEDGER_ADDRESS, does: "Approved bot versions, coach corrections and each season's data root." },
  { name: "TrustScoreRegistry", address: process.env.NEXT_PUBLIC_TRUST_REGISTRY_ADDRESS, does: "Published trust rules and each season's trust score Merkle root." },
  { name: "DailyCall", address: process.env.NEXT_PUBLIC_DAILY_CALL_ADDRESS, does: "Your daily BTC up/down call against your bot's, settled on the BTC feed." },
  { name: "Challenges", address: process.env.NEXT_PUBLIC_CHALLENGES_ADDRESS, does: "Bot vs bot challenge links. No stakes." },
];

const maxAge = (s: number) => (s < 3600 ? `${s / 60} min` : `${s / 3600} h`);

const card = "rounded-r3 border border-line bg-surface p-4 shadow-card";
const code = "overflow-x-auto rounded-r2 bg-night p-3 font-mono text-xs leading-relaxed text-on-night";

// S8 (SPEC §2.4): how verification works, contracts, feeds, oracle caveat, trust rules, replay. Static: no data fetching.
export default function ProofPage() {
  const seasonLedger = CONTRACTS[3].address;
  const ledgerArg = seasonLedger && isAddress(seasonLedger) ? seasonLedger : "<SeasonLedger address>";

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 pb-12 pt-4">
        <section className="flex flex-col gap-3">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Don&apos;t trust us. Check.</h1>
          <p className="text-muted">
            Every trade is settled against QIE&apos;s official mainnet oracle (chain 1990). The contract reads the price
            itself, so we can&apos;t pick it. Here are the contracts, the price feeds, what the oracle can and can&apos;t
            promise, and how to recompute a whole season yourself.
          </p>
        </section>

        <section aria-labelledby="contracts" className="flex flex-col gap-3">
          <h2 id="contracts" className="font-display text-xl font-extrabold">7 contracts on QIE mainnet</h2>
          <p className="text-sm text-muted">
            Solidity 0.8.24, OpenZeppelin 5.0.2. The source is open in our repo and is verified on the QIE explorer at
            deploy. Feed addresses are fixed at deploy with no setter, so prices can&apos;t be swapped.
          </p>
          <ul className="flex flex-col gap-2">
            {CONTRACTS.map(({ name, address, does }) => (
              <li key={name} className={`${card} flex flex-col gap-2`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b className="font-mono text-sm">{name}</b>
                  {address && isAddress(address) ? (
                    <ExplorerLink address={address} />
                  ) : (
                    <ExplorerLink address="" label="Not deployed yet" />
                  )}
                </div>
                <p className="text-sm text-muted">{does}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="feeds" className="flex flex-col gap-3">
          <h2 id="feeds" className="font-display text-xl font-extrabold">5 price feeds, read inside the contract</h2>
          <p className="text-sm text-muted">
            QIE oracle feeds, read with <code className="font-mono">latestRoundData()</code> at trade time. Crypto is
            quoted in USDT, gold in USD, all with 8 decimals. A price older than its max age is never traded on.
          </p>
          <ul className="flex flex-col gap-2">
            {ASSETS.map((a) => (
              <li key={a.id} className={`${card} flex flex-wrap items-center justify-between gap-2`}>
                <span>
                  <b>{a.label}</b> <span className="text-sm text-muted">{a.id} / {a.quote}</span>
                  <span className="block text-xs text-muted">Max age {maxAge(a.maxAgeSeconds)}</span>
                </span>
                <ExplorerLink address={a.feed} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">QIE and BNB feeds exist on QIE but are not used by BotFolio.</p>
        </section>

        <section aria-labelledby="caveat" className="flex flex-col gap-2 rounded-r3 border border-amber bg-amber-soft p-4">
          <h2 id="caveat" className="font-display text-xl font-extrabold">What the oracle can and can&apos;t promise</h2>
          <p className="text-sm">
            All five feeds are updated by one QIE-operated wallet. So our wording is exact: trades are{" "}
            <b>settled against QIE&apos;s official mainnet oracle</b>. Nothing grander.
          </p>
          <p className="text-sm">
            Feeds sometimes go quiet. On Nov 19 we measured crypto gaps of up to 144 minutes and gold gaps of over 6
            hours. When a price is too old, the bot holds that asset and says so (&quot;Gold market quiet —
            holding&quot;). Its other assets still trade. Every price in the app shows its age.
          </p>
        </section>

        <section aria-labelledby="how" className="flex flex-col gap-3">
          <h2 id="how" className="font-display text-xl font-extrabold">What you can check</h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            <li>
              <b>Every trade</b> is a <code className="font-mono">Trade</code> event from PaperLedger with the oracle
              price, round id and time. Re-read the round with <code className="font-mono">getRoundData(roundId)</code>{" "}
              on the feed.
            </li>
            <li>
              <b>Every bot version and correction</b> is a signed record in SeasonLedger.
            </li>
            <li>
              <b>Every season</b> ends with a data root in <code className="font-mono">SeasonLedger.closeSeason</code>,
              a Merkle root over the season&apos;s replay file.
            </li>
            <li>
              <b>Every trust score</b> is a leaf under the root in TrustScoreRegistry. Check one with{" "}
              <code className="font-mono">verifyScore</code>.
            </li>
          </ul>
        </section>

        <section aria-labelledby="trust" className="flex flex-col gap-3">
          <h2 id="trust" className="font-display text-xl font-extrabold">Trust score rules</h2>
          <p className="text-sm text-muted">
            0 to 1000: four factors worth 250 each (follows its rules, drawdown control, consistency, explains its
            trades). Two versions are published on-chain with <code className="font-mono">publishRules</code>. A
            version is never edited, and old seasons keep theirs.
          </p>
          <div className={`${card} overflow-x-auto p-0`}>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="p-3 font-semibold">Version</th>
                  <th scope="col" className="p-3 font-semibold">Seasons</th>
                  <th scope="col" className="p-3 font-semibold">&quot;New&quot; badge until</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line">
                  <td className="p-3 font-mono text-xs">trust-v1-sprint</td>
                  <td className="p-3">S0 to S5</td>
                  <td className="p-3">8 trades + 1 season</td>
                </tr>
                <tr className="border-t border-line">
                  <td className="p-3 font-mono text-xs">trust-v1</td>
                  <td className="p-3">S6 onwards</td>
                  <td className="p-3">20 trades + 1 season</td>
                </tr>
              </tbody>
            </table>
          </div>
          <a className="text-sm font-semibold text-accent-ink underline" href={`${REPO}/blob/main/docs/trust-rules.md`}>
            Read the full rules and formulas
          </a>
        </section>

        <section aria-labelledby="replay" className="flex flex-col gap-3">
          <h2 id="replay" className="font-display text-xl font-extrabold">Replay a season yourself</h2>
          <p className="text-sm text-muted">
            Each season has a replay file with every decision, the logged AI output, the risk-gate result, oracle round
            ids and tx hashes. AI output isn&apos;t guaranteed to repeat, so we log it.{" "}
            <b className="text-ink">Given the logged output, everything after it is deterministic and recomputable.</b>
          </p>
          <pre className={code}>
            {`git clone ${REPO}.git && cd BotFolio
pnpm install && pnpm --filter @botfolio/replay build
pnpm replay 0 --ledger ${ledgerArg}`}
          </pre>
          <p className="text-sm text-muted">
            It re-runs the risk gate on every logged output, re-reads each oracle round from QIE, recomputes every
            bot&apos;s cash and holdings from its <code className="font-mono">Trade</code> events, and checks the data
            root against SeasonLedger. Change <code className="font-mono">0</code> to the season number, or pass a
            replay file path or URL instead. Exit code 0 means everything matches.{" "}
            <a className="font-semibold text-accent-ink underline" href={`${REPO}/tree/main/scripts/replay`}>
              Replay guide
            </a>
          </p>
        </section>
      </main>
    </>
  );
}
