"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookmarkButton } from "@/components/bookmark-button";
import { GradeBadge, TipBadge } from "@/components/grade-badge";
import { SiteHeader } from "@/components/site-header";
import { Wordmark } from "@/components/wordmark";
import { hydratePrefs, useFeed } from "@/lib/news/store";
import { formatClock, formatKstLong, formatRelative } from "@/lib/news/time";
import type { NewsItem } from "@/lib/news/types";

export default function SavedPage() {
  const bookmarks = useFeed((s) => s.bookmarks);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  // 북마크 ID 목록을 안정적인 문자열 키로 변환 (객체 참조 변경에 의한 무한 재실행 방지)
  const bookmarkIds = Object.entries(bookmarks)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)
    .join(",");

  useEffect(() => {
    hydratePrefs();
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    // 최신 저장 순으로 정렬 (timestamp 내림차순)
    const ids = bookmarkIds ? bookmarkIds.split(",") : [];
    if (ids.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    fetch(`/api/items?ids=${encodeURIComponent(ids.join(","))}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => setItems([]))
      .finally(() => {
        clearTimeout(timeoutId);
        setLoading(false);
      });
    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [bookmarkIds]);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24">
      <SiteHeader lastUpdated={now} />
      <main className="mt-8">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-head">🔖 저장한 소식</h1>
          <Link
            href="/"
            className="font-mono-ts text-[12px] text-muted transition-colors hover:text-head"
          >
            ← 홈으로
          </Link>
        </div>
        <p className="mt-1 font-mono-ts text-[12px] text-muted">
          {items.length}건 저장됨 · 이 기기에서만 보관됩니다
        </p>

        {loading ? (
          <p className="mt-12 text-center font-mono-ts text-[13px] text-muted">
            불러오는 중…
          </p>
        ) : items.length === 0 ? (
          <div className="mt-12 text-center">
            <p className="text-[15px] text-muted">저장한 소식이 없습니다</p>
            <p className="mt-2 font-mono-ts text-[12px] text-muted/70">
              기사 옆의 📑 저장 버튼을 눌러 나중에 읽을 소식을 모아보세요
            </p>
            <Link
              href="/"
              className="mt-6 inline-block rounded border border-line-strong px-4 py-2 font-mono-ts text-[13px] text-fg transition-colors hover:border-muted hover:text-head"
            >
              홈에서 소식 보기 →
            </Link>
          </div>
        ) : (
          <ul className="mt-6">
            {items.map((item) => (
              <li
                key={item.id}
                className="border-b border-line border-l-2 border-l-line-strong px-3 py-2.5"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <time
                    className="font-mono-ts text-xs text-muted"
                    title={formatKstLong(item.publishedAt, true)}
                    dateTime={new Date(item.publishedAt).toISOString()}
                  >
                    {formatClock(item.publishedAt)}
                  </time>
                  <GradeBadge grade={item.grade} />
                  {item.tip ? <TipBadge /> : null}
                  <Link
                    href={`/item/${item.id}`}
                    className="min-w-0 flex-1 basis-full text-[15px] font-medium leading-snug text-head hover:underline sm:basis-auto"
                  >
                    {item.title}
                  </Link>
                  <span className="ml-auto flex min-w-0 shrink items-center gap-2">
                    <span className="truncate font-mono-ts text-[11px] text-muted/70">
                      {item.source} · {formatRelative(item.publishedAt, now)}
                    </span>
                    <BookmarkButton id={item.id} />
                  </span>
                </div>
                <p className="mt-1 pl-0 text-[13px] leading-relaxed text-muted sm:pl-[76px]">
                  {item.takeaway}
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
      <footer className="mt-16 border-t border-line pt-6 text-center">
        <Wordmark href="/" size="sm" muted withTag />
      </footer>
    </div>
  );
}
