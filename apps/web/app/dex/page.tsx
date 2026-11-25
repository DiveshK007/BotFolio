import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/SiteHeader";
import { DexGrid } from "@/components/site/extras";
import { dexBots } from "@/lib/site/live";

export const metadata: Metadata = { title: "Bot Dex", description: "Every BotFolio bot, drawn from its own DNA. Filter by trait and find the weird ones." };
export const revalidate = 300;

export default async function Dex() {
  const bots = await dexBots();
  return (
    <>
      <SiteHeader current="/dex" />
      <main className="bf"><section className="band tight enter"><div className="wrap">
        <div className="section-head"><div><h1>Bot Dex</h1><p className="lede">Every bot, drawn from its own DNA. Filter by trait and find the weird ones.</p></div></div>
        <DexGrid bots={bots.data} example={bots.example} />
      </div></section></main>
    </>
  );
}
