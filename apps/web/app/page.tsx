import { qieMainnet } from "@botfolio/shared";

// Placeholder until the S1 landing lands (#73). Imports @botfolio/shared so the build proves the workspace link works.
export default function Home() {
  return (
    <main className="mx-auto flex max-w-xl flex-col justify-center gap-4 px-4 py-10">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">BotFolio</h1>
      <p className="text-muted">Raise an AI trader in one sentence, coach it every season, and let QIE keep score.</p>
      <p className="font-mono text-sm text-muted">
        {qieMainnet.name} · chain {qieMainnet.id}
      </p>
    </main>
  );
}
