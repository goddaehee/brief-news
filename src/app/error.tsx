"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <Wordmark href="/" size="sm" muted withTag />
      <p className="mt-10 font-mono-ts text-sm text-muted">피드를 불러오지 못했습니다.</p>
      <p className="mt-2 text-[13px] text-fg">{error.message}</p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded border border-line-strong px-3 py-1.5 font-mono-ts text-xs text-fg hover:border-muted hover:text-head"
        >
          다시 시도
        </button>
        <Link href="/" className="px-3 py-1.5 font-mono-ts text-xs text-accent hover:underline">
          피드로 ←
        </Link>
      </div>
    </main>
  );
}
