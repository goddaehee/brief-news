"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { NewsItem } from "@/lib/news/types";
import { useFeed } from "@/lib/news/store";

export function useFeedHotkeys(items: NewsItem[]) {
  const router = useRouter();
  const focused = useFeed((s) => s.focused);
  const setFocused = useFeed((s) => s.setFocused);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = focused < 0 ? 0 : Math.min(items.length - 1, focused + 1);
        setFocused(next);
        document.getElementById(`item-${items[next]?.id}`)?.scrollIntoView({
          block: "nearest",
        });
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = focused < 0 ? 0 : Math.max(0, focused - 1);
        setFocused(next);
        document.getElementById(`item-${items[next]?.id}`)?.scrollIntoView({
          block: "nearest",
        });
      } else if (e.key === "Enter") {
        const item = focused >= 0 ? items[focused] : undefined;
        if (item) router.push(`/item/${item.id}`);
      } else if (e.key === "o") {
        const item = focused >= 0 ? items[focused] : undefined;
        if (item) window.open(item.sourceUrl, "_blank", "noopener,noreferrer");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused, items, router, setFocused]);
}
