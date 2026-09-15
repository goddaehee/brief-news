import type { ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "./wordmark";

export function LegalPage({
  title,
  date,
  children,
}: {
  title: string;
  date?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <Wordmark href="/" size="sm" muted withTag />
      <h1 className="mt-8 text-2xl font-bold text-head">{title}</h1>
      {date ? <p className="mt-2 font-mono-ts text-xs text-muted">{date}</p> : null}
      <div className="legal mt-8">{children}</div>
      <p className="mt-12">
        <Link href="/" className="font-mono-ts text-sm text-accent hover:underline">
          더 많은 실시간 AI 뉴스 →
        </Link>
      </p>
    </main>
  );
}
