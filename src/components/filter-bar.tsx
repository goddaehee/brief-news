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
  sourceValue,
  sources,
  totalCount,
  onSourceChange,
}: {
  value: FilterKey;
  counts: Record<FilterKey, number>;
  onChange: (k: FilterKey) => void;
  sourceValue: string;
  sources: { source: string; count: number }[];
  totalCount: number;
  onSourceChange: (s: string) => void;
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
      <span className="mx-1 self-center text-muted/40" aria-hidden="true">
        |
      </span>
      <label className="sr-only" htmlFor="source-filter">
        소스 필터
      </label>
      <select
        id="source-filter"
        aria-label="소스 필터"
        value={sourceValue}
        onChange={(e) => onSourceChange(e.target.value)}
        className={cn(
          "shrink-0 self-center rounded-full border border-line bg-transparent px-3 py-1 font-mono-ts text-xs transition-colors",
          sourceValue === "all"
            ? "text-muted hover:text-fg"
            : "border-accent/60 text-accent",
        )}
      >
        <option value="all">전체 소스 ({totalCount})</option>
        {sources.map(({ source, count }) => (
          <option key={source} value={source}>
            {source} ({count})
          </option>
        ))}
      </select>
    </nav>
  );
}
