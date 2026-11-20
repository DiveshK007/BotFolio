"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BotHead } from "./BotHead";
import { Icon } from "./ui";

const LINKS = [
  { href: "/leaderboards", label: "Leaderboards" },
  { href: "/proof", label: "Proof" },
  { href: "/judges", label: "For judges" },
  { href: "/developers", label: "Developers" },
  { href: "/about", label: "Play money" },
];

/** Put in <head>: sets data-theme before paint (stored choice, else system). */
export const themeScript = `try{var t=localStorage.getItem('bf-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}`;

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => { setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"); }, []);
  useEffect(() => setOpen(false), [path]);
  const flip = () => {
    const t = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t; setTheme(t);
    try { localStorage.setItem("bf-theme", t); } catch { /* storage blocked */ }
  };
  return (
    <header className="nav" data-open={open}>
      <div className="wrap">
        <Link className="brand" href="/" aria-label="BotFolio home"><BotHead size={30} />BotFolio</Link>
        <ul className="nav-links" id="navlinks">
          {LINKS.map(l => <li key={l.href}><Link href={l.href} aria-current={path?.startsWith(l.href) ? "page" : undefined}>{l.label}</Link></li>)}
        </ul>
        <div className="nav-cta">
          <button className="icon-btn" type="button" onClick={flip} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
          <Link className="btn accent sm" href="/#try">Make a bot</Link>
          <button className="icon-btn menu-btn" type="button" aria-expanded={open} aria-controls="navlinks" aria-label="Menu" onClick={() => setOpen(o => !o)}><Icon name="menu" /></button>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div className="stack-s">
            <Link className="brand" href="/"><BotHead size={28} color="#FFC93C" />BotFolio</Link>
            <p className="muted" style={{ maxWidth: "40ch" }}>Raise an AI trader in one sentence, coach it every season, and let QIE keep score.</p>
            <p className="muted small">Built for QIE Hackathon 3.0 · AI + Autonomous Agents track.</p>
          </div>
          <div><b>Product</b><ul><li><Link href="/">Home</Link></li><li><Link href="/leaderboards">Leaderboards</Link></li><li><Link href="/about">Play money</Link></li></ul></div>
          <div><b>Proof and code</b><ul><li><Link href="/proof">Proof and activity</Link></li><li><Link href="/judges">For judges</Link></li><li><Link href="/developers">Developers</Link></li><li><a href="https://github.com/DiveshK007/BotFolio" rel="noopener">GitHub</a></li></ul></div>
        </div>
        {/* Required on every page (CLAUDE.md). Do not remove or reword. */}
        <div className="legal"><strong>Play money. Not investment advice. No prizes.</strong><span className="muted">Settled against QIE&apos;s official mainnet oracle.</span></div>
      </div>
    </footer>
  );
}

export function CopyButton({ text, label = "Copy", className = "copy" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={className} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); } catch { /* clipboard blocked */ }
    }}>{done ? "Copied" : label}</button>
  );
}
