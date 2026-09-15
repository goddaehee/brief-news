import { LegalPage } from "@/components/legal-page";

export default function Privacy() {
  return (
    <LegalPage title="개인정보 처리방침" date="시행일: 2026년 9월">
      <p>
        brief_는 계정을 만들지 않습니다. 반응·알림 설정은 이 브라우저의 localStorage에만 남습니다.
      </p>
      <h2>수집하지 않는 것</h2>
      <ul>
        <li>이름, 이메일, 전화번호</li>
        <li>결제 정보</li>
        <li>위치 정보</li>
      </ul>
      <p>서버에 쌓이는 것은 공개 뉴스 피드와 수집 로그뿐입니다. 개인 글을 넣지 마세요.</p>
    </LegalPage>
  );
}
