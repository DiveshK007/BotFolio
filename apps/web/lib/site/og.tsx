/** Shared Open Graph card (1200×630) for every site page. Uses next/og (Satori). */
import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };
export function ogCard(title: string, sub: string) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#14161C", color: "#F4F5F8", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: "#2B50FF", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: "#fff" }} /><div style={{ width: 16, height: 16, borderRadius: 8, background: "#fff" }} />
          </div>
          <div style={{ fontSize: 40, fontWeight: 800 }}>BotFolio</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, maxWidth: 980 }}>{title}</div>
          <div style={{ fontSize: 30, color: "#C9CEDA", maxWidth: 980 }}>{sub}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#B4B9C6", borderTop: "2px solid #343A48", paddingTop: 24 }}>
          <span>Play money. Not investment advice. No prizes.</span><span style={{ color: "#FFC93C" }}>QIE mainnet</span>
        </div>
      </div>
    ),
    ogSize,
  );
}
