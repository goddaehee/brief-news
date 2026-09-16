"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { hydratePrefs, useFeed } from "@/lib/news/store";
import type { NewsItem, Reaction } from "@/lib/news/types";
import { cn } from "@/lib/utils";

const REACTIONS: { key: Reaction; label: string; icon: string }[] = [
  { key: "useful", label: "유용해요", icon: "👍" },
  { key: "hot", label: "중요하네요", icon: "🔥" },
  { key: "meh", label: "글쎄요", icon: "🤔" },
];

export function ItemActions({ item }: { item: NewsItem }) {
  const reaction = useFeed((s) => s.reactions[item.id]);
  const setReaction = useFeed((s) => s.setReaction);

  useEffect(() => {
    hydratePrefs();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "o" || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      window.open(item.sourceUrl, "_blank", "noopener,noreferrer");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item.sourceUrl]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("링크를 복사했습니다");
    } catch {
      toast("복사에 실패했습니다");
    }
  }

  function shareThreads() {
    const gradeLabel =
      item.grade === "breaking" ? "속보" : item.grade === "important" ? "중요" : "참고";
    const text = `[${gradeLabel}] ${item.title}\n${item.takeaway}\n${window.location.href}`;
    const intent = `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
    navigator.clipboard.writeText(text).then(
      () => toast("Threads 공유창을 열었습니다"),
      () => toast("공유 문구 복사에 실패했습니다"),
    );
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex items-center gap-1.5">
        {REACTIONS.map((r) => (
          <button
            key={r.key}
            type="button"
            aria-pressed={reaction === r.key}
            title={r.label}
            onClick={() => setReaction(item.id, r.key)}
            className={cn(
              "rounded-full border px-2 py-0.5 font-mono-ts text-[12px] transition-colors",
              reaction === r.key
                ? "border-accent/50 text-accent"
                : "border-line-strong text-muted hover:border-muted hover:text-fg",
            )}
          >
            {r.icon} {r.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={copyLink}
        className="rounded border border-line-strong px-3 py-1.5 font-mono-ts text-[12px] text-fg transition-colors hover:border-muted hover:text-head"
      >
        🔗 링크 복사
      </button>
      <button
        type="button"
        onClick={shareThreads}
        className="font-mono-ts text-[12px] text-muted transition-colors hover:text-head"
        title="Threads에 공유"
      >
        @ Threads 공유
      </button>
    </div>
  );
}
