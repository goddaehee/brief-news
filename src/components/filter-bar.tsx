"use client";

import { cn } from "@/lib/utils";
import type { FilterKey } from "@/lib/news/types";

const TABS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "breaking", label: "속보" },
  { key: "important", label: "중요" },
  { key: "note", label: "참고" },
  { key: "tip", label: "팁" },
];

export function FilterBar({
  value,
  counts,
  onChange,
}: {
  value: FilterKey;
  counts: Record<FilterKey, number>;
  onChange: (k: FilterKey) => void;
}) {
  return (
    <nav
      aria-label="중요도 필터"
      className="sticky top-[49px] z-10 flex gap-1 overflow-x-auto border-b border-line bg-bg/95 py-2 backdrop-blur hide-scroll"
    >
      {TABS.map((tab) => {
        const active = value === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              "rounded-full px-3 py-1 font-mono-ts text-xs transition-colors",
              active
                ? "bg-white/10 text-white shadow-[inset_0_-2px_0_#e6edf3]"
                : "text-muted hover:bg-white/[0.04] hover:text-fg",
            )}
          >
            {tab.label}
            <span className="ml-1.5 text-muted/70">{counts[tab.key]}</span>
          </button>
        );
      })}
    </nav>
  );
}
