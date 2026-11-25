import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { PLAY_MONEY_LINE } from "@/components/ui/PlayMoneyFooter";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `What BotFolio stores: your wallet address and login ID, not your email. ${PLAY_MONEY_LINE}`,
};

const h2 = "mt-6 font-semibold";
const p = "mt-1 text-sm text-muted";
const ul = "mt-1 list-disc space-y-1 pl-5 text-sm text-muted";

/*
 * SPEC §11 privacy. Draft for the team to review; not lawyer-reviewed.
 * Every claim below was checked against the code on Nov 25 2026:
 * - users table: packages/db/schema.sql (no email/phone column); written by apps/worker/src/persona/drafts.ts.
 * - Privy: apps/worker/src/auth/privy.ts reads only wallet entries from linked_accounts.
 * - Raw sentence: apps/worker/src/persona/route.ts sends it to the LLM and logs only the persona hash.
 * - Correction notes: apps/worker/src/v2/propose.ts sends them to the LLM; site_corrections leaves the note out.
 * - IP: apps/worker/src/auth/client-ip.ts + relay/ip-limit.ts keep it in memory; relay_log has no IP column.
 * - Browser storage: app/layout.tsx (bf-theme, localStorage), lib/draft.ts (sessionStorage).
 * UNVERIFIED: what Privy, Vercel, Render, Supabase and xAI log on their side (their own policies apply).
 * UNVERIFIED: the web app's Privy sign-in isn't wired yet (#71); re-check this page when it is.
 * UNVERIFIED: Sentry (#161) and analytics (#164) aren't in the code yet; update section 6 before either ships.
 * - Notes in replay: slot/decide.ts passes recent notes into decisions.input_json, which season/replay-file.ts publishes.
 * - Deletion: apps/worker/src/me/delete.ts (POST /me/delete, #174) does exactly the list in section 9.
 * UNVERIFIED: Privy's delete-user endpoint and that it removes the embedded wallet (#71).
 * TODO(#172): add a contact for deletion requests once the team picks one.
 * TODO(#174): add the "Delete my data" button once the app has sign-in (#71); it calls POST /me/delete { confirm: true }.
 */
export default function PrivacyPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-6">
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight">Privacy policy</h1>
        <p className="mt-2 text-sm font-semibold">{PLAY_MONEY_LINE}</p>
        <p className="mt-1 text-xs text-muted">Last updated 25 November 2026.</p>

        <h2 className={h2}>1. The short version</h2>
        <p className={p}>
          We store your wallet address and your login ID. We don&apos;t store your email or phone number, we don&apos;t
          sell data and we don&apos;t show ads. Anything recorded on QIE mainnet is public and permanent.
        </p>

        <h2 className={h2}>2. Signing in (Privy)</h2>
        <p className={p}>
          Passkey sign-in and your embedded wallet are run by Privy. If you choose email login, Privy handles your email;
          we don&apos;t receive or store it. From Privy we keep only your Privy ID (a DID) and your wallet address. If you
          sign in with QIE Wallet instead, we keep only your wallet address.
        </p>

        <h2 className={h2}>3. What we store (Supabase)</h2>
        <p className={p}>Our database runs on Supabase (Postgres). For each user it holds:</p>
        <ul className={ul}>
          <li>wallet address, Privy ID (passkey logins only) and login method;</li>
          <li>when you signed up and confirmed you are 18+ and accept the Terms, and when you were last seen;</li>
          <li>your last few AI-written bot personalities, before you launch one;</li>
          <li>
            your bot and its activity: name, emoji, personality, rules, limits, versions, decisions, trades, corrections
            (with your optional note of up to 80 characters), Daily Calls and challenges;
          </li>
          <li>a log of each action we relay for you: wallet, contract, function, result and transaction.</li>
        </ul>

        <h2 className={h2}>4. What is public</h2>
        <p className={p}>
          Your bot and its activity are shown on BotFolio and recorded on QIE mainnet with your wallet address (and your
          .qie name, if your wallet has one). On-chain records can&apos;t be deleted by anyone, including us. A correction
          note stays off-chain; only its hash goes on-chain, and the note isn&apos;t shown on the site. Your bot reads
          your latest notes when it decides, so they are part of its decision records in the season&apos;s public replay
          file.
        </p>

        <h2 className={h2}>5. What you write (xAI)</h2>
        <p className={p}>
          Your one-sentence description is sent to our server and to an AI model (Grok, by xAI) to write your bot&apos;s
          personality. We save the personality it writes, not your sentence. Until you launch, the sentence is also kept
          in your browser tab&apos;s session storage. At season close, your correction notes go to the same AI model to
          suggest your bot&apos;s next version.
        </p>

        <h2 className={h2}>6. Error tracking and analytics</h2>
        <p className={p}>
          None are switched on yet. Before we add error tracking (Sentry) or analytics, we&apos;ll list here what they
          collect.
        </p>

        <h2 className={h2}>7. IP address and logs</h2>
        <p className={p}>
          Our server uses your IP address only in memory, to limit how many bots and requests come from one connection. We
          don&apos;t write it to our database. Our hosts (Vercel for the website, Render for our server) may keep their
          own request logs.
        </p>

        <h2 className={h2}>8. Your browser</h2>
        <p className={p}>
          We save your light or dark theme choice in local storage and your draft sentence in session storage. We
          don&apos;t set cookies ourselves. Privy may store its own sign-in data in your browser.
        </p>

        <h2 className={h2}>9. Deleting your data</h2>
        <p className={p}>
          When you ask us to delete your data while signed in, it happens straight away. We:
        </p>
        <ul className={ul}>
          <li>
            delete your user record: wallet address, Privy ID, login method, sign-up, 18+ and last-seen times, and the
            AI-written personalities you didn&apos;t launch;
          </li>
          <li>delete our copy of your .qie name (it is public on QIE, so it can show up again next to your bot);</li>
          <li>erase your correction notes (their hashes on QIE mainnet stay);</li>
          <li>blank your bot&apos;s personality text on BotFolio (its hash on QIE mainnet stays);</li>
          <li>
            if you signed in with a passkey, delete your Privy account. That also deletes the wallet Privy keeps for you,
            so nobody can sign for that wallet or your bot again.
          </li>
        </ul>
        <p className={p}>
          We keep what is tied to QIE mainnet: your bot and its name, versions, decisions, trades, Daily Calls,
          challenges, season results, trust scores and share cards. We also keep the log of actions we relayed for you,
          because rate limits and our public activity counts are built from it. These are public on-chain records or are
          sealed into a season&apos;s replay file, and the leaderboards and proofs are rebuilt from them. Your bot stays
          on QIE mainnet and keeps playing. Text already in a past decision&apos;s record, such as an earlier personality
          or note, stays in that season&apos;s replay file.
        </p>
        <p className={p}>
          A &quot;Delete my data&quot; button in the app and a contact for deletion requests will be added before public
          launch.
        </p>

        <h2 className={h2}>10. Changes</h2>
        <p className={p}>We&apos;ll update the date at the top when this policy changes.</p>
      </main>
    </>
  );
}
