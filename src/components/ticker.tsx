import Link from "next/link";
import type { NewsItem } from "@/lib/news/types";

function TickerEntry({ item, hidden }: { item: NewsItem; hidden?: boolean }) {
  const breaking = item.grade === "breaking";
  return (
    <Link
      href={`/item/${item.id}`}
      tabIndex={hidden ? -1 : undefined}
      className="ticker-entry font-mono-ts"
    >
      <span className={breaking ? "text-breaking" : "text-accent"}>{breaking ? "● 속보" : "●"}</span>
      <span className="ticker-headline">{item.title}</span>
    </Link>
  );
}

export function Ticker({ items, duration = 108 }: { items: NewsItem[]; duration?: number }) {
  return (
    <div className="ticker border-b border-line" role="marquee" aria-label="주요 뉴스 헤드라인">
      <div className="ticker-track" style={{ animationDuration: `${duration}s` }}>
        <div className="ticker-half">
          {items.map((item) => (
            <TickerEntry key={item.id} item={item} />
          ))}
        </div>
        <div className="ticker-half" aria-hidden="true">
          {items.map((item) => (
            <TickerEntry key={`dup-${item.id}`} item={item} hidden />
          ))}
        </div>
      </div>
    </div>
  );
}
