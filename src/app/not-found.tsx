import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <Wordmark href="/" size="sm" muted withTag />
      <p className="mt-10 font-mono-ts text-sm text-muted">없는 소식입니다.</p>
      <Link href="/" className="mt-4 inline-block font-mono-ts text-sm text-accent hover:underline">
        실시간 피드로 ←
      </Link>
    </main>
  );
}
