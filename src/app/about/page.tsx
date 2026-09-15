import { LegalPage } from "@/components/legal-page";

export default function About() {
  return (
    <LegalPage title="brief_ 소개" date="시행일: 2026년 9월">
      <p>
        <strong>brief_</strong>는 한국 AI 실무자를 위한 실시간 AI 뉴스 터미널입니다. 전 세계 AI
        소식을 한국어 한 줄 요약과 함께, 중요한 것부터 빠르게 전합니다.
      </p>
      <h2>파이프라인</h2>
      <ul>
        <li>
          <strong>RSS 수집</strong> — 공식 블로그·테크 미디어·GeekNews·Reddit을 당깁니다.
        </li>
        <li>
          <strong>분류·요약</strong> — 속보·중요·참고와 “실무자가 뭘 하면 되는지” 한 줄.
        </li>
        <li>
          <strong>저장</strong> — Postgres가 런타임 소스. 같은 원문 URL은 한 번만.
        </li>
        <li>
          <strong>시계</strong> — GitHub Actions가 아니라 리눅스 cron이{" "}
          <code>POST /api/collect</code>를 칩니다.
        </li>
      </ul>
      <h2>등급</h2>
      <ul>
        <li>
          <strong>속보</strong> — 지금 바로. 모델 출시, 장애, 즉시 규제.
        </li>
        <li>
          <strong>중요</strong> — 오늘 읽을 가치. 도구 업데이트, 벤치, 업계 동향.
        </li>
        <li>
          <strong>참고</strong> — 알아두면 좋은 소식.
        </li>
      </ul>
      <p>
        요약과 등급은 자동 생성되며 부정확할 수 있습니다. 중요한 판단 전에는 원문을 확인하세요.
      </p>
    </LegalPage>
  );
}
