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

async function searchItems(
  q: string,
  grade: string,
  sort: string,
): Promise<{ items: NewsItem[]; total: number; now: number }> {
  const h = await headers();
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    "brief-ai-news.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? "https";
  try {
    const res = await fetch(
      `${proto}://${host}/api/search?q=${encodeURIComponent(q)}&grade=${grade}&sort=${sort}&limit=20`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return { items: [], total: 0, now: Date.now() };
    const data = await res.json();
    const items: NewsItem[] = Array.isArray(data.items) ? data.items : [];
    const total: number = typeof data.total === "number" ? data.total : items.length;
    return { items, total, now: Date.now() };
  } catch {
    return { items: [], total: 0, now: Date.now() };
  }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; grade?: string; sort?: string }>;
}) {
  const { q, grade: gradeParam, sort: sortParam } = await searchParams;
  const query = (q ?? "").trim();
  const grade = ["all", "breaking", "important", "note", "tip"].includes(gradeParam ?? "")
    ? gradeParam!
    : "all";
  const sort = sortParam === "relevant" ? "relevant" : "new";
  const { items, total, now } = query
    ? await searchItems(query, grade, sort)
    : { items: [], total: 0, now: Date.now() };

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
                전체 {total}건 중 {items.length}건 표시 · 제목·시사점·요약에서 검색
              </p>
              {/* 등급 필터 + 정렬 */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {[
                  { key: "all", label: "전체" },
                  { key: "breaking", label: "속보" },
                  { key: "important", label: "중요" },
                  { key: "note", label: "참고" },
                  { key: "tip", label: "팁" },
                ].map((g) => (
                  <a
                    key={g.key}
                    href={`/search?q=${encodeURIComponent(query)}&grade=${g.key}&sort=${sort}`}
                    className={`rounded-full px-3 py-1 font-mono-ts text-[11px] transition-colors ${
                      grade === g.key
                        ? "bg-accent text-black"
                        : "border border-line text-muted hover:text-head"
                    }`}
                  >
                    {g.label}
                  </a>
                ))}
                <span className="mx-1 text-muted">|</span>
                <a
                  href={`/search?q=${encodeURIComponent(query)}&grade=${grade}&sort=new`}
                  className={`font-mono-ts text-[11px] ${sort === "new" ? "text-accent" : "text-muted hover:text-head"}`}
                >
                  최신순
                </a>
                <a
                  href={`/search?q=${encodeURIComponent(query)}&grade=${grade}&sort=relevant`}
                  className={`font-mono-ts text-[11px] ${sort === "relevant" ? "text-accent" : "text-muted hover:text-head"}`}
                >
                  관련도순
                </a>
              </div>
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
