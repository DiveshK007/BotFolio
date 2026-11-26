# Launch copy (drafts)

Play money. Not investment advice. No prizes.

Drafts for the soft launch (Sat Nov 28, before S1 opens Sun Nov 29 00:00 IST) and the public posts after it (#113, #112, master plan D1 and H15). **The team approves each draft before it's posted.** Swap every `[BRACKET]` for a real link or number. Never post a made-up result. If a card or number doesn't exist yet, cut that line.

Rules for every post:
- Say "play money" and "no prizes" in the post itself, not only on the site. No cash, tokens, NFTs, rewards, giveaways or "win" language about money.
- Say "settled against QIE's official mainnet oracle" or "recorded on QIE mainnet". Never "trustless", "decentralised" or "can't be faked".
- No investment talk: no "make money", "profit", "returns you can earn" or "beat the market".
- Only claims we've checked. The 30 s path goes in only once the stopwatch sheet below backs it up. Until then, say "under a minute" or give the measured number.
- Count only real users. Team wallets are listed apart (master plan H15), and they never go in a "people joined" number.
- Live link: https://bot-folio.vercel.app

---

## 1. X thread (public launch, after a real card exists)

**1/**
I raised an AI trader in one sentence: "[MY SENTENCE]".

It trades BTC, ETH, SOL, XRP and Gold four times a day with play money, and every trade is settled against QIE's official mainnet oracle.

Play money. No prizes. 🧵

**2/**
How it works:
→ type one sentence
→ sign in with your fingerprint or Face ID (passkey, no seed phrase)
→ your bot gets a name, rules and two sliders
→ first trade right away, with a "Verify on QIE" link

You never pay gas.

**3/**
Today it did this: [ROAST OR TRADE CARD IMAGE + LINK]

Tap Verify and you see the tx on QIE mainnet and the oracle round it was priced at. Not a screenshot.

**4/**
You coach it. Tap "Bad call: too risky" on a decision.

At the season close it proposes v2 from your feedback, e.g. "max per coin 40 % → 25 %". You approve it, and the new config hash goes on QIE.

**5/**
Big moves wait for you: a buy of 30 %+ into one coin, or selling half a holding. Allow, Shrink or Block.

Seasons are 2 days now (S1: Sun Nov 29 → Mon Nov 30 21:30 IST), weekly from Dec 7.

**6/**
Built for @[QIE HANDLE] Hackathon 3.0, AI + Autonomous Agents track. Open source: https://github.com/DiveshK007/BotFolio

Raise yours: https://bot-folio.vercel.app

Play money. Not investment advice. No prizes.

*(Check QIE's real handle before tagging. Post 3 only goes in with a real card. If the card page isn't fixed yet (#105), post the image without the link.)*

---

## 2. WhatsApp message (friends, class and hostel groups)

> Made a small thing for the QIE hackathon: you type one sentence like "careful like my dad, loves gold" and an AI bot is born that trades crypto + gold with **play money** 4 times a day. You coach it, it learns. Every trade is recorded on QIE mainnet, so anyone can check a bot's record.
>
> No money, no prizes, no gas, no seed phrase. Just a passkey (fingerprint/Face ID).
>
> Season 1 starts tonight 12 AM (Sun Nov 29), so make it before then: https://bot-folio.vercel.app
>
> Tell me how long it took you and anything confusing 🙏

Soft-launch version (Sat Nov 28, 5–15 people): same text, plus "you're one of the first few, so it might be rough. Reply with what broke." Send it to people one by one, not to a big group, so the stopwatch sheet stays honest.

---

## 3. Challenge-link message (one friend, one season)

The app makes the link: `/me` → "Challenge a friend" → copy (`https://bot-folio.vercel.app/challenge/<code>`). **Known:** making a challenge fails between 21:30 and 00:00 IST (the season gap). Make it after midnight.

> My bot vs yours, this season 🤖⚔️
>
> Raise a bot in one sentence and accept: [CHALLENGE LINK]
>
> Whoever's bot is ahead at the season close (Mon Nov 30 21:30 IST) gets bragging rights. That's all: play money, no stakes, no prizes. Settled against QIE's official mainnet oracle.

---

## 4. Coding-club run sheet (5 minutes)

Before the session: phone screen-mirroring works, the projector shows https://bot-folio.vercel.app, `/healthz` is `ok` or every reason is understood, and you know which feeds are fresh (`runbook.md` §9 setup). Prepare a bot of your own with a few trades in advance, in case the live one only holds.

| Time | Say / do | Show |
|---|---|---|
| 0:00–0:30 | "Who's curious about AI trading but doesn't want to risk money or write code?" One line: "Raise an AI trader in one sentence, coach it, and QIE keeps score." | Landing page |
| 0:30–1:30 | Live: ask the room for a sentence and type it. Passkey, bot card, two sliders, Launch. Time it out loud. | `/create` on the phone |
| 1:30–2:15 | The first trade, or "holding because QIE's BTC price is N min old". Tap Verify on QIE. "This price was read inside the contract, at the oracle round shown." | Bot page → explorer tx |
| 2:15–3:00 | Coaching: "Bad call: too risky". At the close it proposes v2, and you sign the change. | Prepared bot's decisions |
| 3:00–3:45 | Why blockchain: anyone can check, other apps and AI agents can read it, and it outlives us. "Users never pay gas. The relayer sends, you sign." | `/proof` |
| 3:45–4:30 | "Make yours now, Season 1 starts at midnight. Challenge the person next to you." QR code to the site. | QR slide |
| 4:30–5:00 | Questions. Say it: "Play money. Not investment advice. No prizes." | Footer |

Backup if the live create fails: show the prepared bot, say honestly what failed, and write the step down in the friction list (#93).

---

## 5. Stopwatch sheet (soft launch and phone tests)

One row per person. Start when they open the link and stop when the first trade, or the hold line with a reason, shows on their bot page (SPEC §2.1). Use a fresh wallet: no earlier bot on that phone. Time it 3 times per phone model if you can (H9).

| # | Date, time (IST) | Phone + browser | Passkey (s) | Sentence → bot card (s) | Launch → first trade or hold (s) | **Total (s)** | Got stuck at | Team wallet? |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |
| 4 | | | | | | | | |
| 5 | | | | | | | | |
| 6 | | | | | | | | |
| 7 | | | | | | | | |
| 8 | | | | | | | | |
| 9 | | | | | | | | |
| 10 | | | | | | | | |

Afterwards:
- Paste the filled table into #112 (soft launch) or #76 / #146 (phone tests), with the feed freshness at that time.
- The headline number is the **median total, and how many of N finished under 30 s**. Team wallets are not in it.
- Friction list: one line per "got stuck at", and the top 5 go to #93.
- Change the 30 s claim on the site and in the deck to match (master plan D9).

*Play money. Not investment advice. No prizes.*
