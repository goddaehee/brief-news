export default function Loading() {
  return (
    <main>
      <div className="mx-auto max-w-4xl px-3 sm:px-6">
        <div className="h-12 border-b border-line" />
        <div className="flex gap-2 border-b border-line py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className="h-6 w-14 rounded-full bg-white/5" />
          ))}
        </div>
        <div className="h-8 border-b border-line" />
        <ul>
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="border-b border-line px-3 py-3">
              <div className="h-3 w-28 rounded bg-white/5" />
              <div className="mt-2 h-4 w-4/5 rounded bg-white/[0.07]" />
              <div className="mt-2 h-3 w-full rounded bg-white/[0.04]" />
            </li>
          ))}
        </ul>
        <p className="sr-only">피드를 불러오는 중</p>
      </div>
    </main>
  );
}
