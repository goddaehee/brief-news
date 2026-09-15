import Link from "next/link";
import { cn } from "@/lib/utils";

export function Wordmark({
  href = "/",
  size = "md",
  withTag = false,
  muted = false,
}: {
  href?: string;
  size?: "sm" | "md";
  withTag?: boolean;
  muted?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "font-mono-ts font-bold tracking-tight",
        size === "md" ? "text-lg" : "text-sm",
        muted ? "text-muted hover:text-white" : "text-white",
      )}
    >
      {muted ? <span className="mr-1 font-normal">← </span> : null}
      brief
      <span className="text-accent">_</span>
      {withTag ? (
        <span className="ml-2 whitespace-nowrap text-xs font-normal text-muted">
          실시간 AI 뉴스
        </span>
      ) : null}
    </Link>
  );
}
