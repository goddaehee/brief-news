import Link from "next/link";
import type { NewsItem } from "@/lib/news/types";

export function Ticker({ items, duration = 108 }: { items: NewsItem[]; duration?: number }) {
  const half = items.map((item) => (
    <Link key={item.id} href={`/item/${item.id}`} className="ticker-entry font-mono-ts">
      <span className="text-accent">●</span>
      <span className="ticker-headline">{item.title}</span>
    </Link>
  ));

  return (
    <div className="ticker border-b border-line" role="marquee" aria-label="주요 뉴스 헤드라인">
      <div className="ticker-track" style={{ animationDuration: `${duration}s` }}>
        <div className="ticker-half">{half}</div>
        <div className="ticker-half" aria-hidden="true">
          {items.map((item) => (
            <Link
              key={`dup-${item.id}`}
              href={`/item/${item.id}`}
              tabIndex={-1}
              className="ticker-entry font-mono-ts"
            >
              <span className="text-accent">●</span>
              <span className="ticker-headline">{item.title}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
