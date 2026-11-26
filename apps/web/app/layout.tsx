import type { Metadata, Viewport } from "next";
import { Archivo, Inter, JetBrains_Mono, Silkscreen } from "next/font/google";
import { HoloEffects, Ticker } from "@/components/site/arcade";
import { motionScript } from "@/lib/site/scripts";
import { WatchParty } from "@/components/site/home-v3";
import { tickerItems } from "@/lib/site/ticker";
import { PlayMoneyFooter } from "@/components/ui/PlayMoneyFooter";
import { StatusBanner } from "@/components/ui/StatusBanner";
import { WalletRoot } from "@/components/WalletRoot";
import "./globals.css";
import "../styles/site-v3.css";

// Same fonts and variable names as the Claude Design export (#95 merges its layout into this one).
const archivo = Archivo({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-archivo", display: "swap", fallback: ["system-ui", "Arial"] });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter", display: "swap", fallback: ["system-ui", "Arial"] });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-mono", display: "swap", fallback: ["ui-monospace", "Menlo"] });

// v3 arcade labels (LED ticker, scoreboard). Same variable name as the prototype CSS.
const pixel = Silkscreen({ subsets: ["latin"], weight: ["400"], variable: "--font-pixel", display: "swap", fallback: ["ui-monospace", "Menlo"] });

/** Runs in <head> before paint: stored theme choice, else the system setting. Same key as the export ("bf-theme"). */
const themeScript = `try{var t=localStorage.getItem('bf-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}`;

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "BotFolio · Raise an AI trader in one sentence", template: "BotFolio · %s" },
  description:
    "Raise an AI trader in one sentence, coach it every season, and let QIE keep score. Play money. Not investment advice. No prizes.",
  applicationName: "BotFolio",
  appleWebApp: { capable: true, title: "BotFolio", statusBarStyle: "default" },
  openGraph: { siteName: "BotFolio", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAFAF7" },
    { media: "(prefers-color-scheme: dark)", color: "#0D0F14" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ticker = await tickerItems();
  return (
    <html lang="en" className={`${archivo.variable} ${inter.variable} ${mono.variable} ${pixel.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript + motionScript }} />
      </head>
      <body className="flex min-h-dvh flex-col antialiased">
        <StatusBanner />
        <div className="bf"><Ticker items={ticker.items} status={ticker.status} /></div>
        <WatchParty />
        <HoloEffects />
        <div className="flex-1">{children}</div>
        <PlayMoneyFooter />
        <WalletRoot />
      </body>
    </html>
  );
}
