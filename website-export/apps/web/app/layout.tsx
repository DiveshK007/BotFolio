/**
 * Root layout. If WS C already has one, merge: keep the font variables, the theme script
 * in <head>, and the two stylesheet imports. Tailwind's globals can sit alongside.
 */
import type { Metadata, Viewport } from "next";
import { Archivo, Inter, JetBrains_Mono } from "next/font/google";
import { themeScript } from "@/components/site/chrome";
import "@/styles/tokens.css";
import "@/styles/site.css";

const archivo = Archivo({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-archivo", display: "swap", fallback: ["system-ui", "Arial"] });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter", display: "swap", fallback: ["system-ui", "Arial"] });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["500"], variable: "--font-mono", display: "swap", fallback: ["ui-monospace", "Menlo"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "BotFolio · Raise an AI trader in one sentence", template: "BotFolio · %s" },
  description: "Raise an AI trader in one sentence, coach it every season, and let QIE keep score. Play money. Not investment advice. No prizes.",
  openGraph: { siteName: "BotFolio", type: "website" },
  twitter: { card: "summary_large_image" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#14161C" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${archivo.variable} ${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
