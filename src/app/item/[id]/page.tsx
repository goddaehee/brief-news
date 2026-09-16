import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GradeBadge, TipBadge, gradeColor } from "@/components/grade-badge";
import { NotifyButton } from "@/components/notify-button";
import { Ticker } from "@/components/ticker";
import { Wordmark } from "@/components/wordmark";
import { ItemActions } from "@/components/item-actions";
import { latestItems, nextItem, relatedItems, tickerItems } from "@/lib/news/data";
import { getItem } from "@/lib/news/queries";
import { TOPIC_MAP } from "@/lib/news/topics";
import { formatKstLong } from "@/lib/news/time";
import type { Grade, NewsItem } from "@/lib/news/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { item } = await getItem(id);
  if (!item) return { title: "없는 소식" };
  const grade = item.grade === "breaking" ? "속보" : item.grade === "important" ? "중요" : "참고";
  const published = new Date(item.publishedAt).toISOString();
  return {
    title: `[${grade}] ${item.title}`,
    description: item.takeaway,
    openGraph: {
      type: "article",
      title: item.title,
      description: item.takeaway,
      publishedTime: published,
      images: ["/og.jpg"],
    },
  };
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { item, items: all } = await getItem(id);
  if (!item) notFound();

  const related = relatedItems(item, all);
  const latest = latestItems(item, all);
  const next = nextItem(item, all);
  const left = gradeColor(item.grade);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: item.title,
    description: item.takeaway,
    datePublished: new Date(item.publishedAt).toISOString(),
    inLanguage: "ko",
    url: `/item/${item.id}`,
    author: { "@type": "Organization", name: "brief_" },
    publisher: { "@type": "Organization", name: "brief_" },
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="flex items-center justify-between gap-3">
        <Wordmark href="/" size="sm" muted withTag />
        <NotifyButton />
      </div>
      <div className="mt-4">
        <Ticker items={tickerItems(all)} duration={54} />
      </div>

      <article
        className="mt-8 rounded-lg border border-line bg-white/[0.02] p-6 sm:p-8"
        style={{ borderLeft: `3px solid ${left}` }}
      >
        <div className="flex flex-wrap items-center gap-3 font-mono-ts text-xs text-muted">
          <GradeBadge grade={item.grade} />
          {item.tip ? <TipBadge /> : null}
          <span>{item.source}</span>
          <time dateTime={new Date(item.publishedAt).toISOString()}>
            {formatKstLong(item.publishedAt)}
          </time>
        </div>
        <h1 className="mt-4 text-2xl font-bold leading-snug text-head text-balance sm:text-3xl">
          {item.title}
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-fg text-pretty">{item.takeaway}</p>
        <div className="mt-6 border-t border-line pt-5">
          <h2 className="font-mono-ts text-xs font-semibold text-muted">요약</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-fg text-pretty">{item.summary}</p>
          <p className="mt-2 font-mono-ts text-[10px] text-muted/50">
            AI가 원문을 요약한 내용으로, 부정확할 수 있습니다.
          </p>
        </div>
        <div className="mt-6 border-t border-line pt-4 text-[13px] text-muted">
          <p>
            <span className="font-mono-ts text-[11px] text-muted/60">원문 제목 </span>
            {item.originalTitle}
          </p>
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block break-all font-mono-ts text-[12px] text-link hover:underline"
          >
            원문 보기 ↗
          </a>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {item.topics.map((slug) => (
            <Link
              key={slug}
              href={`/topic/${slug}`}
              className="rounded-full border border-line-strong px-2.5 py-0.5 font-mono-ts text-[11px] text-muted transition-colors hover:border-muted hover:text-fg"
            >
              #{TOPIC_MAP[slug]?.label ?? slug}
            </Link>
          ))}
        </div>
        <ItemActions item={item} />
      </article>

      {next ? <NextCard item={next} /> : null}

      <section className="mt-8 rounded-lg border border-accent/25 bg-accent/[0.04] p-5 text-center">
        <p className="text-[15px] text-head">
          <span className="font-semibold">brief</span>
          <span className="text-accent">_</span>는 한국 AI 실무자를 위한 실시간 AI 뉴스 터미널입니다.
        </p>
        <p className="mt-1 font-mono-ts text-[11px] text-muted">
          15분마다 속보·중요·팁 자동 수집 · 한국어 요약 제공
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="rounded-full bg-accent px-4 py-1.5 font-mono-ts text-[13px] font-medium text-bg transition-colors hover:bg-accent-2"
          >
            실시간 피드 보기 →
          </Link>
          <NotifyButton variant="cta" />
          <Link href="/rss.xml" className="font-mono-ts text-[12px] text-muted transition-colors hover:text-fg">
            RSS 구독
          </Link>
        </div>
      </section>

      <ListSection title="관련 뉴스" items={related} />
      <ListSection title="최신 뉴스" items={latest} />
    </main>
  );
}

function NextCard({ item }: { item: NewsItem }) {
  return (
    <Link
      href={`/item/${item.id}`}
      className="group mt-6 block rounded-lg border border-line-strong bg-white/[0.02] p-5 transition-colors hover:border-muted hover:bg-white/[0.04]"
    >
      <span className="font-mono-ts text-[11px] text-muted">다음 뉴스 →</span>
      <p className="mt-1.5 flex items-start gap-2 text-[16px] font-medium leading-snug text-head">
        <GradeBadge grade={item.grade} />
        <span className="group-hover:underline">{item.title}</span>
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{item.takeaway}</p>
    </Link>
  );
}

function ListSection({ title, items }: { title: string; items: NewsItem[] }) {
  if (!items.length) return null;
  const label = (g: Grade) => (g === "breaking" ? "속보" : g === "important" ? "중요" : "참고");
  const color = (g: Grade) => gradeColor(g);
  return (
    <section className="mt-8">
      <h2 className="font-mono-ts text-xs font-semibold text-muted">{title}</h2>
      <ul className="mt-2 space-y-1.5">
        {items.map((i) => (
          <li key={i.id} className="text-[13px]">
            <Link href={`/item/${i.id}`} className="text-fg hover:text-white hover:underline">
              <span className="mr-1.5 font-mono-ts text-[11px]" style={{ color: color(i.grade) }}>
                [{label(i.grade)}]
              </span>
              {i.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
