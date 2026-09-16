"use client";

import { useEffect, useMemo, useState } from "react";
import { Briefing } from "@/components/briefing";
import { FilterBar } from "@/components/filter-bar";
import { NewsFeed } from "@/components/news-feed";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Ticker } from "@/components/ticker";
import { TopicBar } from "@/components/topic-bar";
import { useFeedHotkeys } from "@/components/use-hotkeys";
import { counts, filterItems, tickerItems } from "@/lib/news/data";
import { hydratePrefs, useFeed } from "@/lib/news/store";
import type { FeedPayload } from "@/lib/news/types";

export function HomeClient({ data }: { data: FeedPayload }) {
  const [now, setNow] = useState(data.now);
  useEffect(() => {
    hydratePrefs();
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const all = data.items;
  const filter = useFeed((s) => s.filter);
  const setFilter = useFeed((s) => s.setFilter);
  const visible = useFeed((s) => s.visible);
  const loadMore = useFeed((s) => s.loadMore);
  const focused = useFeed((s) => s.focused);

  const filtered = useMemo(() => filterItems(all, filter), [all, filter]);
  const shown = filtered.slice(0, visible);
  const c = counts(all);
  const lastUpdated = data.lastRunAt ?? all[0]?.publishedAt ?? now;

  useFeedHotkeys(shown);

  return (
    <main>
      <div className="mx-auto max-w-4xl px-3 sm:px-6">
        <SiteHeader lastUpdated={lastUpdated} showCollect={!data.lastRunAt} />
        <FilterBar value={filter} counts={c} onChange={setFilter} />
        <TopicBar />
        <Ticker items={tickerItems(all)} />
        {filter === "all" ? (
          <Briefing date={data.briefingDate} lines={data.briefingLines} />
        ) : null}
        {shown.length === 0 ? (
          <p className="px-3 py-16 text-center font-mono-ts text-sm text-muted">
            이 필터에 해당하는 소식이 없습니다.
          </p>
        ) : (
          <NewsFeed items={shown} focused={focused} now={now} />
        )}
        {visible < filtered.length ? (
          <div className="py-6 text-center">
            <button
              type="button"
              onClick={loadMore}
              className="rounded border border-line-strong px-5 py-2 font-mono-ts text-xs text-fg transition-colors hover:border-muted hover:text-head"
            >
              더 보기 ↓
            </button>
          </div>
        ) : (
          <div className="py-6" />
        )}
        <SiteFooter />
      </div>
    </main>
  );
}
