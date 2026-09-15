import Link from "next/link";
import { TOPICS } from "@/lib/news/topics";
import { cn } from "@/lib/utils";

export function TopicBar({ active }: { active?: string }) {
  return (
    <nav
      aria-label="토픽"
      className="flex gap-1.5 overflow-x-auto border-b border-line py-2 hide-scroll"
    >
      {TOPICS.map((t) => (
        <Link
          key={t.slug}
          href={`/topic/${t.slug}`}
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-0.5 font-mono-ts text-[11px] transition-colors",
            active === t.slug
              ? "border-head/40 bg-white/10 text-head"
              : "border-line-strong text-muted hover:border-muted hover:text-fg",
          )}
        >
          #{t.label}
        </Link>
      ))}
    </nav>
  );
}
