import { ogCard, ogSize } from "@/lib/site/og";
export const size = ogSize;
export const contentType = "image/png";
export const alt = 'Is this card real? Flip it.';
export default function Image() { return ogCard('Is this card real? Flip it.', 'Verify on QIE: the tx, the oracle round, and what it proves.'); }
