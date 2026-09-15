"use client";

import { useMemo } from "react";
import { NewsRow } from "./news-row";
import { todayLabel } from "@/lib/news/time";
import type { NewsItem } from "@/lib/news/types";

type Row =
  | { kind: "sep"; key: string; label: string }
  | { kind: "item"; key: string; item: NewsItem; index: number };

export function NewsFeed({
  items,
  focused,
  now,
}: {
  items: NewsItem[];
  focused: number;
  now: number;
}) {
  const rows = useMemo(() => {
    const out: Row[] = [];
    let last = "";
    let index = 0;
    for (const item of items) {
      const label = todayLabel(item.publishedAt, now);
      if (label !== last) {
        last = label;
        out.push({ kind: "sep", key: `sep-${label}`, label });
      }
      out.push({ kind: "item", key: item.id, item, index });
      index += 1;
    }
    return out;
  }, [items, now]);

  return (
    <ol>
      {rows.map((row) =>
        row.kind === "sep" ? (
          <li
            key={row.key}
            aria-hidden="true"
            className="border-b border-line px-3 py-1.5 font-mono-ts text-[11px] text-muted/60"
          >
            ── {row.label}
          </li>
        ) : (
          <NewsRow
            key={row.key}
            item={row.item}
            focused={row.index === focused}
            now={now}
          />
        ),
      )}
    </ol>
  );
}
