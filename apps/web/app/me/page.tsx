import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { MeScreen } from "@/components/me/MeScreen";

export const metadata: Metadata = { title: "Your bot", robots: { index: false } };

// S3 /me (SPEC §2.4). Signed-in only, so it renders in the browser; the play-money line is in the root layout.
export default function MePage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-2">
        <MeScreen />
      </main>
    </>
  );
}
