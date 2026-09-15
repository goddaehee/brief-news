import { LegalPage } from "@/components/legal-page";

export default function Terms() {
  return (
    <LegalPage title="이용약관" date="시행일: 2026년 9월">
      <p>
        brief_ 서비스를 이용함으로써 본 약관에 동의하는 것으로 간주합니다. 서비스는 한국 AI
        실무자를 위한 뉴스 요약·분류 정보를 제공합니다.
      </p>
      <h2>서비스의 성격</h2>
      <p>
        요약, 등급, 시사점은 자동 생성되며 투자·법률·의료 자문이 아닙니다. 중요한 의사결정 전에는
        반드시 원문을 확인하세요.
      </p>
      <h2>지식재산</h2>
      <p>
        원문 기사의 저작권은 각 출처에 있습니다. brief_는 출처를 명시하고 원문 링크를 제공합니다.
      </p>
    </LegalPage>
  );
}
