import { ogCard, ogSize } from "@/lib/site/og";

// Site-wide link preview: / and every page that sets no image of its own (e.g. /bot/[botId]) inherit it.
export const alt = "BotFolio: raise an AI trader in one sentence";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogCard("Raise an AI trader in one sentence.", "Coach it every season. Every trade settled against QIE's official mainnet oracle.");
}
