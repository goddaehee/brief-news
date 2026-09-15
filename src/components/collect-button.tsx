"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function CollectButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/collect", { method: "POST" });
      const result = (await res.json()) as {
        status: string;
        inserted: number;
        note: string;
      };
      if (result.status === "rate_limited") {
        toast("잠시 후 다시 수집하세요", { description: result.note });
      } else if (result.status === "error") {
        toast("수집 실패", { description: result.note });
      } else {
        toast(`수집 완료 · ${result.inserted}건 편성`, { description: result.note });
        router.refresh();
      }
    } catch (err) {
      toast("수집 실패", {
        description: err instanceof Error ? err.message : "unknown",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "rounded-full border px-2.5 py-1 font-mono-ts text-[11px] transition-colors",
        busy
          ? "border-accent/40 text-accent"
          : "border-line-strong text-muted hover:border-muted hover:text-fg",
      )}
    >
      {busy ? "수집 중…" : compact ? "수집" : "지금 수집"}
    </button>
  );
}
