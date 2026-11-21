import type { Metadata, Viewport } from "next";
import { Archivo, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Same fonts and variable names as the Claude Design export (#95 merges its layout into this one).
const archivo = Archivo({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-archivo", display: "swap", fallback: ["system-ui", "Arial"] });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter", display: "swap", fallback: ["system-ui", "Arial"] });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["500"], variable: "--font-mono", display: "swap", fallback: ["ui-monospace", "Menlo"] });

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${archivo.variable} ${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
