"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { GradeBadge, TipBadge } from "./grade-badge";
import { formatClock, formatKstLong, formatRelative } from "@/lib/news/time";
import type { NewsItem } from "@/lib/news/types";
import { cn } from "@/lib/utils";

export function NewsRow({
  item,
  focused,
  now,
}: {
  item: NewsItem;
  focused?: boolean;
  now: number;
}) {
  const router = useRouter();
  const accent =
    item.grade === "breaking"
      ? "border-l-breaking"
      : item.grade === "important"
        ? "border-l-accent"
        : "border-l-line-strong";

  return (
    <li
      id={`item-${item.id}`}
      className={cn(
        "cursor-pointer border-b border-line border-l-2 px-3 py-2.5 transition-colors hover:bg-white/[0.03]",
        accent,
        focused && "item-focused",
        now - item.publishedAt < 12 * 60_000 && "item-new",
      )}
      onClick={() => router.push(`/item/${item.id}`)}
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
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 basis-full text-[15px] font-medium leading-snug text-head hover:underline sm:basis-auto"
        >
          {item.title}
        </Link>
        <span className="ml-auto min-w-0 shrink truncate font-mono-ts text-[11px] text-muted/70">
          {item.source} · {formatRelative(item.publishedAt, now)}
        </span>
      </div>
      <p className="mt-1 pl-0 text-[13px] leading-relaxed text-muted sm:pl-[76px]">
        {item.takeaway}
      </p>
    </li>
  );
}
