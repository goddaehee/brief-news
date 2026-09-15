import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import Link from "next/link";

export const metadata: Metadata = { title: "광고 문의" };

export default function Advertise() {
  return (
    <LegalPage title="광고 문의">
      <p>
        brief_는 한국 AI 실무자를 위한 실시간 AI 뉴스 터미널입니다. Cursor·Claude·GPT를 매일 쓰는
        개발자와 기획자가 새로운 소식을 확인하러 찾아옵니다.
      </p>
      <h2>독자</h2>
      <ul>
        <li>AI 도구를 실무에 쓰는 개발자·기획자·창업자</li>
        <li>모델 출시, 가격 변경, 에이전트 도구 소식을 매일 확인하는 사용자</li>
      </ul>
      <h2>광고 상품</h2>
      <h3>피드 스폰서 슬롯</h3>
      <p>
        메인 피드 상단 영역에 고정 노출되는 네이티브 슬롯입니다. 기사와 같은 형식이지만{" "}
        <strong>AD</strong> 라벨이 항상 표시됩니다. 제목 1줄 + 설명 1줄 + 링크. 동시에 1개 광고주만
        노출 · 최소 1개월. 단가는 문의.
      </p>
      <h3>데일리 브리핑 스폰서</h3>
      <p>
        매일 발행되는 “오늘의 브리핑” 하단 스폰서 표기. 준비 중이며 사전 문의를 받습니다.
      </p>
      <h2>광고 정책</h2>
      <p>
        독자 신뢰가 이 매체의 전부입니다. 코인·도박·과장된 수익 보장, 그리고 AI 실무자와 무관한
        광고는 받지 않습니다. 기사와 광고는 언제나 명확히 구분됩니다.
      </p>
      <h2>문의</h2>
      <p>
        집행 희망 시기와 소재를 함께 보내주시면 회신드립니다.{" "}
        <a href="mailto:hello@brief.news?subject=brief_%20광고%20문의">hello@brief.news</a>
      </p>
      <p>
        <Link href="/">← 실시간 피드로 돌아가기</Link>
      </p>
    </LegalPage>
  );
}
