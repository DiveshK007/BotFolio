import { ogCard, ogSize } from "@/lib/site/og";
export const size = ogSize;
export const contentType = "image/png";
export const alt = "Don't trust us. Check.";
export default function Image() { return ogCard("Don't trust us. Check.", '7 contracts, 5 oracle feeds, and how to replay a season yourself.'); }
