import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { getFeed } from "@/lib/news/queries";
import { formatKstLong } from "@/lib/news/time";

export const dynamic = "force-dynamic";

export default async function RssPage() {
  const { items } = await getFeed();
  const shown = items.slice(0, 30);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <Wordmark href="/" size="sm" muted withTag />
      <h1 className="mt-8 text-2xl font-bold text-head">RSS 피드</h1>
      <p className="mt-2 font-mono-ts text-xs text-muted">
        머신리더용 XML은{" "}
        <a href="/rss.xml" className="text-link hover:underline">
          /rss.xml
        </a>
        을 구독하세요. 아래는 같은 목록의 읽기용 페이지입니다.
      </p>
      <ol className="mt-8 space-y-4">
        {shown.map((item) => (
          <li key={item.id} className="border-b border-line pb-4">
            <Link
              href={`/item/${item.id}`}
              className="text-[15px] font-medium text-head hover:underline"
            >
              {item.title}
            </Link>
            <p className="mt-1 font-mono-ts text-[11px] text-muted">
              {item.source} · {formatKstLong(item.publishedAt)}
            </p>
            <p className="mt-1 text-[13px] text-muted">{item.takeaway}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
