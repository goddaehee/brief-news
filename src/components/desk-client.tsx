"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CollectButton } from "@/components/collect-button";
import { Wordmark } from "@/components/wordmark";
import { parseNewsMarkdown } from "@/lib/news/parse";
import { formatKstLong } from "@/lib/news/time";
import type { DeskPayload, IngestPayload } from "@/lib/news/types";

const TEMPLATE = `---
title: 한국어 헤드라인
grade: important
tip: false
source: GeekNews
source_url: https://example.com/your-story
original_title: Original headline
topics: agent, korea-ai
published: 2026-09-15T16:00:00+09:00
---

한 줄 시사점. 실무자가 지금 뭘 하면 되는지.

## 요약

세 문장 안팎의 본문 요약. 같은 source_url은 두 번 들어가지 않습니다.
`;

export function DeskClient({ data }: { data: DeskPayload }) {
  const router = useRouter();
  const [markdown, setMarkdown] = useState(TEMPLATE);
  const [preview, setPreview] = useState<IngestPayload | null>(null);
  const [busy, setBusy] = useState(false);

  function onPreview() {
    try {
      setPreview(parseNewsMarkdown(markdown));
      toast("파싱 완료");
    } catch (err) {
      setPreview(null);
      toast("파싱 실패", { description: err instanceof Error ? err.message : "invalid" });
    }
  }

  async function onIngest() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown }),
      });
      const result = (await res.json()) as { inserted?: number; skipped?: number; error?: string };
      if (!res.ok) throw new Error(result.error || "ingest failed");
      toast(`입고 ${result.inserted ?? 0}건 · 건너뜀 ${result.skipped ?? 0}건`);
      router.refresh();
    } catch (err) {
      toast("입고 실패", { description: err instanceof Error ? err.message : "unknown" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-3 py-8 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <Wordmark href="/" size="sm" muted withTag />
        <CollectButton />
      </div>
      <h1 className="mt-8 text-2xl font-bold text-head">편성 데스크</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        RSS는 크론이 <code className="font-mono-ts text-head">POST /api/collect</code>를 치면 들어옵니다.
        사람이 쓰는 글은 아래 마크다운 계약입니다. 런타임 소스는 DB입니다.
      </p>

      <ol className="mt-6 grid gap-2 sm:grid-cols-3">
        {[
          ["1. 수집", "RSS를 당기고 중복 URL을 걷어냅니다."],
          ["2. 분류", "속보·중요·참고와 한국어 한 줄을 붙입니다."],
          ["3. 편성", "Postgres에 넣고 피드·RSS가 그걸 읽습니다."],
        ].map(([title, body]) => (
          <li key={title} className="rounded-lg border border-line bg-white/[0.02] p-3">
            <p className="font-mono-ts text-[11px] text-accent">{title}</p>
            <p className="mt-1 text-[13px] text-fg">{body}</p>
          </li>
        ))}
      </ol>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-mono-ts text-xs font-semibold text-muted">마크다운 입고</h2>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            spellCheck={false}
            className="mt-2 h-80 w-full resize-y rounded-lg border border-line-strong bg-elevated p-3 font-mono-ts text-[12px] leading-relaxed text-fg outline-none focus:border-accent/50"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onPreview}
              className="rounded border border-line-strong px-3 py-1.5 font-mono-ts text-[12px] text-fg hover:border-muted hover:text-head"
            >
              미리보기
            </button>
            <button
              type="button"
              onClick={onIngest}
              disabled={busy}
              className="rounded bg-accent px-3 py-1.5 font-mono-ts text-[12px] font-medium text-bg hover:bg-accent-2 disabled:opacity-60"
            >
              {busy ? "입고 중…" : "DB에 편성"}
            </button>
            <Link href="/" className="px-2 py-1.5 font-mono-ts text-[12px] text-muted hover:text-head">
              피드로
            </Link>
          </div>
          {preview ? (
            <div className="mt-4 rounded-lg border border-line p-3 text-[13px]">
              <p className="font-medium text-head">{preview.title}</p>
              <p className="mt-1 text-muted">{preview.takeaway}</p>
              <p className="mt-2 font-mono-ts text-[11px] text-muted">
                {preview.grade} · {preview.source} · {(preview.topics ?? []).join(", ") || "토픽 없음"}
              </p>
            </div>
          ) : null}
        </div>

        <div>
          <h2 className="font-mono-ts text-xs font-semibold text-muted">수집 로그</h2>
          <ul className="mt-2 space-y-2">
            {data.runs.length === 0 ? (
              <li className="text-[13px] text-muted">아직 수집 기록이 없습니다.</li>
            ) : (
              data.runs.map((run) => (
                <li key={run.id} className="rounded border border-line px-3 py-2">
                  <p className="font-mono-ts text-[11px] text-muted">
                    {formatKstLong(run.startedAt)} · {run.status}
                  </p>
                  <p className="mt-0.5 text-[13px] text-fg">{run.note || "—"}</p>
                  <p className="mt-0.5 font-mono-ts text-[11px] text-muted">
                    fetch {run.fetched} · in {run.inserted} · skip {run.skipped}
                  </p>
                </li>
              ))
            )}
          </ul>

          <h2 className="mt-6 font-mono-ts text-xs font-semibold text-muted">RSS 출처</h2>
          <ul className="mt-2 space-y-1">
            {data.sources.map((s) => (
              <li key={s.id} className="font-mono-ts text-[11px] text-muted">
                {s.name}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
