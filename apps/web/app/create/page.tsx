import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { CreateFlow } from "@/components/create/CreateFlow";

// The title is static on purpose: the user's sentence never goes into metadata or OG tags (#159).
export const metadata: Metadata = { title: "Make your bot" };

// S2 (SPEC §2.1, §2.4).
export default function CreatePage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-4">
        <CreateFlow />
      </main>
    </>
  );
}
