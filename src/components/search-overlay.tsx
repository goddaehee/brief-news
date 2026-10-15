"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GradeBadge, TipBadge } from "./grade-badge";
import { useSearchHotkey } from "./use-hotkeys";
import { formatRelative } from "@/lib/news/time";
import { useFeed } from "@/lib/news/store";
import type { NewsItem } from "@/lib/news/types";
import { cn } from "@/lib/utils";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; items: NewsItem[] }
  | { status: "error" };

export function SearchOverlay() {
  const open = useFeed((s) => s.searchOpen);
  const setSearchOpen = useFeed((s) => s.setSearchOpen);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const now = useRef(Date.now());

  // 전역 단축키 (Cmd/Ctrl+K, /) — 오버레이가 마운트된 모든 페이지에서 동작
  useSearchHotkey();

  const close = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setState({ status: "idle" });
    setActive(0);
  }, [setSearchOpen]);

  // 열릴 때 입력창 포커스
  useEffect(() => {
    if (open) {
      now.current = Date.now();
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
  }, [open ]);

  // 300ms 디바운스 검색
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setState({ status: "idle" });
      setActive(0);
      return;
    }
    setState({ status: "loading" });
    const id = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(`search ${res.status}`);
        const data = await res.json();
        const items: NewsItem[] = Array.isArray(data.items) ? data.items : [];
        setState({ status: "done", items: items.slice(0, 15) });
        setActive(0);
      } catch {
        setState({ status: "error" });
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [query, open]);

  const items = state.status === "done" ? state.items : [];

  const go = useCallback(
    (item: NewsItem) => {
      close();
      router.push(`/item/${item.id}`);
    },
    [close, router],
  );

  // 오버레이 내부 키보드 내비게이션
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(items.length - 1, a + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === "Enter") {
        const item = items[active];
        if (item) {
          e.preventDefault();
          go(item);
        } else if (query.trim().length >= 2) {
          // 결과가 없어도 전체 검색 페이지로 이동
          e.preventDefault();
          close();
          router.push(`/search?q=${encodeURIComponent(query.trim())}`);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, active, go, close, query, router]);

  // 활성 행 스크롤
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-3 pt-[12vh] backdrop-blur-sm"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="뉴스 검색"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-line-strong bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="shrink-0 text-muted"
            aria-hidden
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="AI 뉴스 검색… (2자 이상)"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-head outline-none placeholder:text-muted/60"
            aria-label="검색어"
          />
          <kbd className="rounded border border-line px-1.5 py-px font-mono-ts text-[10px] text-muted">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {state.status === "idle" && (
            <p className="px-4 py-8 text-center font-mono-ts text-xs text-muted">
              제목·시사점·요약에서 검색합니다
              <br />
              <span className="text-muted/60">↑↓ 이동 · Enter 열기 · 전체 결과는 Enter (빈 결과 시)</span>
            </p>
          )}
          {state.status === "loading" && (
            <p className="px-4 py-8 text-center font-mono-ts text-xs text-muted">
              검색 중…
            </p>
          )}
          {state.status === "error" && (
            <p className="px-4 py-8 text-center font-mono-ts text-xs text-breaking">
              검색에 실패했습니다. 잠시 후 다시 시도해주세요.
            </p>
          )}
          {state.status === "done" && items.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="font-mono-ts text-xs text-muted">
                “{query.trim()}”에 대한 결과가 없습니다
              </p>
              <button
                className="mt-3 rounded border border-line-strong px-3 py-1.5 font-mono-ts text-xs text-head hover:bg-white/[0.05]"
                onClick={() => {
                  close();
                  router.push(`/search?q=${encodeURIComponent(query.trim())}`);
                }}
              >
                전체 검색 페이지로 이동 →
              </button>
            </div>
          )}
          {items.length > 0 && (
            <ul>
              {items.map((item, i) => (
                <li key={item.id}>
                  <button
                    data-idx={i}
                    onClick={() => go(item)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex w-full items-baseline gap-2 px-4 py-2.5 text-left",
                      i === active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
                    )}
                  >
                    <GradeBadge grade={item.grade} />
                    {item.tip ? <TipBadge /> : null}
                    <span className="min-w-0 flex-1 truncate text-[14px] text-head">
                      {item.title}
                    </span>
                    <span className="shrink-0 font-mono-ts text-[10px] text-muted/70">
                      {item.source} · {formatRelative(item.publishedAt, now.current)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-line px-4 py-2">
            <button
              className="font-mono-ts text-[11px] text-muted hover:text-head"
              onClick={() => {
                close();
                router.push(`/search?q=${encodeURIComponent(query.trim())}`);
              }}
            >
              “{query.trim()}” 전체 결과 보기 →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
