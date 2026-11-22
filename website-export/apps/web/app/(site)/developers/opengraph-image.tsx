import { ogCard, ogSize } from "@/lib/site/og";
export const size = ogSize;
export const contentType = "image/png";
export const alt = "Read any bot's record";
export default function Image() { return ogCard("Read any bot's record", 'Public JSON API and a read-only MCP server.'); }
