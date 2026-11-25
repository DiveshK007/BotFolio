"use client";

import { useEffect, useState } from "react";
import { loadStatus, statusMessages } from "@/lib/status";

const REFRESH_MS = 5 * 60_000; // the root layout stays mounted across client navigation

/** Site-wide notice when prices are delayed or bots are resting (#171). Shows nothing until, and unless, there is news. */
export function StatusBanner() {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void loadStatus().then((s) => live && setMessages(statusMessages(s)));
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return <StatusNotice messages={messages} />;
}

export function StatusNotice({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div role="status" className="border-b border-line bg-amber-soft px-4 py-2 text-center text-sm text-ink">
      {messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  );
}
