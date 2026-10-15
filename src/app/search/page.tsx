import type { Metadata } from "next";
import { headers } from "next/headers";
import { NewsFeed } from "@/components/news-feed";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { TopicBar } from "@/components/topic-bar";
import type { NewsItem } from "@/lib/news/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  return {
    title: query ? `“${query}” 검색 결과` : "뉴스 검색",
    description: query
      ? `brief_에서 “${query}” 검색 결과`
      : "brief_ AI 뉴스 전문 검색",
  };
}

async function searchItems(q: string): Promise<{ items: NewsItem[]; now: number }> {
  const h = await headers();
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    "brief-ai-news.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? "https";
  try {
    const res = await fetch(
      `${proto}://${host}/api/search?q=${encodeURIComponent(q)}`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return { items: [], now: Date.now() };
    const data = await res.json();
    const items: NewsItem[] = Array.isArray(data.items) ? data.items : [];
    return { items, now: Date.now() };
  } catch {
    return { items: [], now: Date.now() };
  }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const { items, now } = query ? await searchItems(query) : { items: [], now: Date.now() };

  return (
    <main>
      <div className="mx-auto max-w-4xl px-3 sm:px-6">
        <SiteHeader lastUpdated={now} />
        <TopicBar active="" />
        <div className="border-b border-line px-3 py-4">
          {query ? (
            <>
              <h1 className="text-xl font-bold text-head">
                “{query}” 검색 결과
              </h1>
              <p className="mt-1 font-mono-ts text-xs text-muted">
                {items.length}건 · 제목·시사점·요약에서 검색
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-head">뉴스 검색</h1>
              <p className="mt-1 font-mono-ts text-xs text-muted">
                검색어를 입력하세요 · 단축키 <kbd className="rounded border border-line px-1">/</kbd> 또는{" "}
                <kbd className="rounded border border-line px-1">⌘K</kbd>
              </p>
            </>
          )}
        </div>
        {!query ? (
          <p className="px-3 py-16 text-center font-mono-ts text-sm text-muted">
            예: “클로드”, “반도체”, “오픈AI”
          </p>
        ) : items.length === 0 ? (
          <p className="px-3 py-16 text-center font-mono-ts text-sm text-muted">
            “{query}”에 대한 검색 결과가 없습니다.
          </p>
        ) : (
          <NewsFeed items={items} focused={-1} now={now} />
        )}
        <SiteFooter />
      </div>
    </main>
  );
}
