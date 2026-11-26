import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";

const LINKS = [["/leaderboards", "Leaderboards"], ["/dex", "Bot Dex"], ["/proof", "Proof"], ["/judges", "For judges"], ["/developers", "Developers"]] as const;
/** Website pages: the app header plus one row of site links. */
export function SiteHeader({ current }: { current?: string }) {
  return (
    <>
      <AppHeader />
      <nav aria-label="Site" className="mx-auto flex w-full max-w-5xl flex-wrap gap-1 px-4 pb-2 text-sm">
        {LINKS.map(([href, label]) => <Link key={href} href={href} aria-current={current === href ? "page" : undefined} className="inline-flex min-h-11 items-center rounded-full px-3 font-medium hover:bg-surface-2 aria-[current=page]:bg-ink aria-[current=page]:text-paper">{label}</Link>)}
      </nav>
    </>
  );
}
