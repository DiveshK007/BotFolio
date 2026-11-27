import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { PLAY_MONEY_LINE, feedbackUrl } from "@/components/ui/PlayMoneyFooter";

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
 * - AI model: render.yaml sets LLM_PROVIDER=anthropic and LLM_MODEL_DECISION=claude-haiku-5-5 (decision Nov 26); /healthz says anthropic (Nov 28).
 * - Feedback link: shown only when NEXT_PUBLIC_FEEDBACK_URL is set (components/ui/PlayMoneyFooter.tsx).
 * UNVERIFIED: what Privy, Vercel, Render, Supabase, Anthropic and a feedback form's host log on their side (their own policies apply).
 * UNVERIFIED: Sentry (#161) and analytics (#164) aren't in the code yet; update section 6 before either ships.
 * TODO(#172): add a contact for deletion requests once the team picks one.
 */
const FEEDBACK = feedbackUrl(process.env.NEXT_PUBLIC_FEEDBACK_URL);

export default function PrivacyPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-6">
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight">Privacy policy</h1>
        <p className="mt-2 text-sm font-semibold">{PLAY_MONEY_LINE}</p>
        <p className="mt-1 text-xs text-muted">Last updated 28 November 2026.</p>

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
          note stays off-chain; only its hash goes on-chain, and the note isn&apos;t shown publicly.
        </p>

        <h2 className={h2}>5. What you write (Anthropic)</h2>
        <p className={p}>
          Your one-sentence description is sent to our server and to an AI model (Claude, by Anthropic) to write your bot&apos;s
          personality. We save the personality it writes, not your sentence. Until you launch, the sentence is also kept
          in your browser tab&apos;s session storage. At season close, your correction notes go to the same AI model to
          suggest your bot&apos;s next version.
        </p>

        <h2 className={h2}>6. Error tracking and analytics</h2>
        <p className={p}>
          None are switched on yet. Before we add error tracking (Sentry) or analytics, we&apos;ll list here what they
          collect.
        </p>
        {FEEDBACK && (
          <p className={p}>
            The Feedback link in the footer opens a form run by another service. What you write there goes to that service
            and to our team, under that service&apos;s own policy. Don&apos;t put keys or passwords in it.
          </p>
        )}

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
          We can delete what we hold off-chain (your user row, drafts and notes). We can&apos;t delete anything on QIE
          mainnet. A contact for deletion requests will be added here before public launch.
        </p>

        <h2 className={h2}>10. Changes</h2>
        <p className={p}>We&apos;ll update the date at the top when this policy changes.</p>
      </main>
    </>
  );
}
