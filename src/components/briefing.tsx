export function Briefing({ date, lines }: { date: string; lines: string[] }) {
  return (
    <section className="mt-3 rounded border border-accent/25 bg-accent/[0.04] px-4 py-3">
      <h2 className="font-mono-ts text-xs font-semibold text-accent">
        ☀ 오늘의 브리핑 <span className="font-normal text-muted">{date}</span>
      </h2>
      <div className="mt-2 space-y-1 text-[13px] leading-relaxed text-fg">
        {lines.map((line) => (
          <p key={line}>• {line}</p>
        ))}
      </div>
    </section>
  );
}
