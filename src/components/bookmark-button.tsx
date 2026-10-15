"use client";

import { useEffect } from "react";
import { hydratePrefs, useFeed } from "@/lib/news/store";
import { cn } from "@/lib/utils";

export function BookmarkButton({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const bookmarked = useFeed((s) => Boolean(s.bookmarks[id]));
  const toggleBookmark = useFeed((s) => s.toggleBookmark);

  useEffect(() => {
    hydratePrefs();
  }, []);

  return (
    <button
      type="button"
      aria-pressed={bookmarked}
      title={bookmarked ? "저장 해제" : "저장하기"}
      onClick={(e) => {
        e.stopPropagation();
        toggleBookmark(id);
      }}
      className={cn(
        "rounded-full border px-2 py-0.5 font-mono-ts text-[12px] transition-colors",
        bookmarked
          ? "border-accent/50 text-accent"
          : "border-line-strong text-muted hover:border-muted hover:text-fg",
        className,
      )}
    >
      {bookmarked ? "🔖 저장됨" : "📑 저장"}
    </button>
  );
}
