"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { hydratePrefs, useFeed } from "@/lib/news/store";

export function NotifyButton({
  variant = "icon",
}: {
  variant?: "icon" | "pill" | "cta";
}) {
  const notify = useFeed((s) => s.notify);
  const toggle = useFeed((s) => s.toggleNotify);

  useEffect(() => {
    hydratePrefs();
  }, []);

  async function onClick() {
    const next = toggle();
    if (next) {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        try {
          await Notification.requestPermission();
        } catch {
          /* ignore */
        }
      }
      toast("속보 알림을 켰습니다", {
        description: "이 브라우저에서 속보가 뜨면 알려 드립니다.",
      });
    } else {
      toast("속보 알림을 껐습니다");
    }
  }

  const on = notify
    ? "border-accent/50 text-accent"
    : "border-line-strong text-muted hover:border-muted hover:text-fg";

  if (variant === "icon") {
    return (
      <button
        type="button"
        aria-pressed={notify}
        aria-label="속보 알림 받기"
        title="속보가 뜨면 알림을 받아보세요"
        onClick={onClick}
        className={cn("rounded-full border px-2 py-1 font-mono-ts text-xs transition-colors", on)}
      >
        {notify ? "🔔" : "🔕"}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={notify}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 font-mono-ts text-[11px] transition-colors",
        on,
      )}
    >
      {notify ? "🔔 알림 켜짐" : "🔔 속보 알림 받기"}
    </button>
  );
}
