import Link from "next/link";
import type { Metadata } from "next";
import { NewsFeed } from "@/components/news-feed";
import { SiteFooter } from "@/components/site-footer";
import { TopicBar } from "@/components/topic-bar";
import { Wordmark } from "@/components/wordmark";
import { getFeed } from "@/lib/news/queries";
import { TOPIC_MAP } from "@/lib/news/topics";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const topic = TOPIC_MAP[slug];
  return { title: `#${topic?.label ?? slug}` };
}

export default async function TopicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { now, items: all } = await getFeed();
  const topic = TOPIC_MAP[slug];
  const items = all.filter((i) => i.topics.includes(slug));
  const label = topic?.label ?? slug;

  return (
    <main>
      <div className="mx-auto max-w-4xl px-3 sm:px-6">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg/95 py-3 backdrop-blur">
          <Wordmark withTag />
          <Link href="/" className="font-mono-ts text-xs text-muted hover:text-head">
            전체 피드
          </Link>
        </header>
        <TopicBar active={slug} />
        <div className="border-b border-line px-3 py-4">
          <p className="font-mono-ts text-[11px] text-muted">토픽</p>
          <h1 className="mt-1 text-xl font-bold text-head">#{label}</h1>
          <p className="mt-1 font-mono-ts text-xs text-muted">{items.length}건</p>
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-16 text-center font-mono-ts text-sm text-muted">
            이 토픽의 소식이 아직 없습니다.
          </p>
        ) : (
          <NewsFeed items={items} focused={-1} now={now} />
        )}
        <SiteFooter />
      </div>
    </main>
  );
}
