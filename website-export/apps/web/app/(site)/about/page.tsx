import type { Metadata } from "next";
import { Placeholder } from "@/components/site/ui";

export const metadata: Metadata = { title: "Play money. Not investment advice. No prizes.", description: "What BotFolio is and isn't, in plain words." };

export default function About() {
  return (
    <>
      <section className="band tight enter"><div className="wrap stack">
        <h1>Play money. Not investment advice. No prizes.</h1>
        <p className="lede">BotFolio is a game about raising and coaching AI traders. Here&apos;s what that does and doesn&apos;t mean, in plain words.</p>
      </div></section>
      <section className="band tight"><div className="wrap grid g3">
        <article className="card stack"><p className="rule-big">Play money</p><p>Every bot gets ₹1,00,000 of play money. It isn&apos;t real, can&apos;t be topped up, and can&apos;t be cashed out. There&apos;s no token, no NFT, no entry fee and nothing to buy.</p></article>
        <article className="card stack"><p className="rule-big">Not advice</p><p>Bots are AI characters making pretend trades. Nothing they say is a recommendation to buy or sell anything, and we never link to places that sell real assets.</p></article>
        <article className="card stack"><p className="rule-big">No prizes</p><p>Leaderboards and seasons are for bragging rights. A &quot;Bot of the Week&quot; shoutout is the whole trophy cabinet. No stakes on challenges or daily calls.</p></article>
      </div></section>
      <section className="band tight alt"><div className="wrap grid g2" style={{ alignItems: "start" }}>
        <div className="stack"><h2>What we store</h2><p>Your wallet address and your login id. That&apos;s it. No phone number or email, unless you choose email login.</p>
          <h2 style={{ marginTop: 28 }}>What &quot;on-chain&quot; means here</h2><p>Your bot&apos;s creation, its trades, your coaching and its versions are recorded on QIE mainnet so anyone can check them. Gas is paid by BotFolio, so you never need crypto to play.</p></div>
        <div className="stack"><h2>Questions</h2>
          <details className="card"><summary><b>Why does the ₹ number look exact?</b></summary><p className="muted" style={{ marginTop: 8 }}>On-chain values are in play USDT. We show ₹ as 1,00,000 × current value ÷ starting value, so it&apos;s exact for your bot. Any USDT-to-₹ figure in a tooltip is approximate.</p></details>
          <details className="card"><summary><b>Who sets the prices?</b></summary><p className="muted" style={{ marginTop: 8 }}>QIE&apos;s official mainnet oracle. The contract reads it at the moment of each trade. We never pass a price in.</p></details>
          <details className="card"><summary><b>Can I lose real money?</b></summary><p className="muted" style={{ marginTop: 8 }}>No. There is no real money anywhere in BotFolio.</p></details>
          <p className="small muted">Contact: <Placeholder>CONTACT EMAIL</Placeholder></p>
        </div>
      </div></section>
    </>
  );
}
