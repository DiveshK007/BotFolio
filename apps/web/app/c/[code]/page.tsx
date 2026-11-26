import { redirect } from "next/navigation";

// Short alias for share links; SPEC §2.4 names the screen /challenge/[code].
export default async function ShortChallenge({ params }: { params: Promise<{ code: string }> }) {
  redirect(`/challenge/${encodeURIComponent((await params).code)}`);
}
