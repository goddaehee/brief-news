import Link from "next/link";
import { NotifyButton } from "./notify-button";

export function SiteFooter() {
  return (
    <footer className="py-6 text-center font-mono-ts text-[11px] text-muted/50">
      <div className="mb-4 flex justify-center">
        <NotifyButton variant="pill" />
      </div>
      <p>15분마다 자동 수집 · 요약은 AI가 생성하며 부정확할 수 있습니다</p>
      <p className="mt-1 hidden text-[10px] text-muted/40 sm:block">
        단축키: j/k 이동 · Enter 펼치기 · o 원문 열기
      </p>
      <p className="mt-2">
        <Link href="/about" className="hover:text-muted hover:underline">
          소개
        </Link>
        <span className="mx-2">·</span>
        <Link href="/terms" className="hover:text-muted hover:underline">
          이용약관
        </Link>
        <span className="mx-2">·</span>
        <Link href="/privacy" className="hover:text-muted hover:underline">
          개인정보 처리방침
        </Link>
        <span className="mx-2">·</span>
        <a href="/rss.xml" className="hover:text-muted hover:underline">
          RSS
        </a>
        <span className="mx-2">·</span>
        <Link href="/advertise" className="hover:text-muted hover:underline">
          광고 문의
        </Link>
      </p>
    </footer>
  );
}
