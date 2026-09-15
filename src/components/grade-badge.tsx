import { cn } from "@/lib/utils";
import type { Grade } from "@/lib/news/types";

const GRADE_LABEL: Record<Grade, string> = {
  breaking: "속보",
  important: "중요",
  note: "참고",
};

export function GradeBadge({ grade }: { grade: Grade }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-px font-mono-ts text-[11px] font-medium",
        grade === "breaking" &&
          "border-breaking/40 bg-breaking/15 text-breaking",
        grade === "important" &&
          "border-accent/40 bg-accent/15 text-accent",
        grade === "note" &&
          "border-muted/30 bg-muted/10 text-muted",
      )}
    >
      {GRADE_LABEL[grade]}
    </span>
  );
}

export function TipBadge() {
  return (
    <span className="rounded border border-live/40 bg-live/10 px-1.5 py-px font-mono-ts text-[11px] font-medium text-live">
      팁
    </span>
  );
}

export function gradeColor(grade: Grade): string {
  if (grade === "breaking") return "var(--color-breaking)";
  if (grade === "important") return "var(--color-accent)";
  return "var(--color-muted)";
}
