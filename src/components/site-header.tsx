"use client";

import { useEffect, useState } from "react";
import { formatRelative } from "@/lib/news/time";
import { CollectButton } from "./collect-button";
import { NotifyButton } from "./notify-button";
import { Wordmark } from "./wordmark";

export function SiteHeader({ lastUpdated }: { lastUpdated: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg/95 py-3 backdrop-blur">
      <h1 className="shrink">
        <Wordmark withTag />
      </h1>
      <div className="flex shrink-0 items-center gap-2 font-mono-ts text-xs">
        <span className="live-dot inline-block h-2 w-2 rounded-full bg-live" />
        <span className="text-live">LIVE</span>
        <span className="text-muted">
          {formatRelative(lastUpdated)}
          <span className="hidden sm:inline"> 업데이트</span>
        </span>
        <CollectButton compact />
        <NotifyButton />
      </div>
    </header>
  );
}
