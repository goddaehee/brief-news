"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatRelative } from "@/lib/news/time";
import { CollectButton } from "./collect-button";
import { NotifyButton } from "./notify-button";
import { Wordmark } from "./wordmark";
import { useFeed } from "@/lib/news/store";

export function SiteHeader({
  lastUpdated,
  showCollect = false,
}: {
  lastUpdated: number;
  showCollect?: boolean;
}) {
  const [, tick] = useState(0);
  const bookmarkCount = useFeed((s) => Object.keys(s.bookmarks).length);
  const setSearchOpen = useFeed((s) => s.setSearchOpen);
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
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-1.5 rounded border border-line-strong px-2 py-1 text-muted transition-colors hover:border-muted hover:text-head"
          aria-label="뉴스 검색"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="hidden sm:inline">검색</span>
          <kbd className="hidden rounded border border-line px-1 text-[10px] text-muted/70 md:inline">
            /
          </kbd>
        </button>
        <span className="live-dot inline-block h-2 w-2 rounded-full bg-live" />
        <span className="text-live">LIVE</span>
        <span className="text-muted">
          {formatRelative(lastUpdated)}
          <span className="hidden sm:inline"> 업데이트</span>
        </span>
        <Link
          href="/saved"
          title="저장한 소식"
          className="rounded border border-line-strong px-2 py-1 text-muted transition-colors hover:border-muted hover:text-head"
        >
          🔖{bookmarkCount > 0 ? ` ${bookmarkCount}` : ""}
        </Link>
        {showCollect ? <CollectButton compact /> : null}
        <NotifyButton />
      </div>
    </header>
  );
}
