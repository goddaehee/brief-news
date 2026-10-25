// 회귀 테스트 (재구성본) — 원래 scratch/test32.ts·test34.ts는 커밋되지 않은 채
// 소실돼, 코드 주석·커밋 메시지에 기록된 32차/34차 판정 사례를 기준으로
// 재구성했다. 원본 케이스 수(24/27)와 1:1 대응은 아니며, Phase 1에서
// 등급 결정 경로가 바뀌어 의미가 달라진 케이스는 새 기준으로 적었다.
import { fixTypos, hasStrongSignal, needsRewrite, polishTakeaway } from "../src/lib/news/desk";
import { SEC_TITLE_HINT, tooSimilar } from "../src/lib/news/collect";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} => ${JSON.stringify(actual)}${ok ? "" : ` (기대 ${JSON.stringify(expected)})`}`);
}

// ---------- 32차: dedupe 정규화 (ForTy 쌍) ----------
check(
  "tooSimilar 포티/ForTy 쌍",
  tooSimilar("구글 딥마인드, '포티' 삼림 지도 공개", "구글 딥마인드, 'ForTy' 삼림 지도 공개"),
  true,
);
check(
  "tooSimilar 다른 사건(HBM) 비유사",
  tooSimilar("삼성전자, HBM4 양산 돌입", "SK하이닉스, HBM4 출하 확대"),
  false,
);

// ---------- 32차: 등급 신호 ----------
check(
  "hasStrongSignal 데이터셋 단독 공개는 약함",
  hasStrongSignal("딥마인드, 포티 삼림 지도 무료 공개", "삼림 지도 데이터를 무료로 공개했다."),
  false,
);
check(
  "hasStrongSignal 법안 통과는 강함",
  hasStrongSignal("정부, 삼림 지도 데이터셋 공개 의무화 법안 통과", "법안 통과로 공개 의무가 생겼다."),
  true,
);
check(
  "hasStrongSignal 쿼터 변경 (36차)",
  hasStrongSignal("클로드 오퍼스 5.5 이용량 쿼터 몰래 축소 의혹", "이용량 쿼터가 축소됐다는 의혹 제기. 구독자는 사용량 확인 필요."),
  true,
);

// ---------- 34차: 보안 제목 힌트 (토큰 경계) ----------
check("SEC 힌트 Laravel 제외", SEC_TITLE_HINT.test("Critical Laravel flaw enables remote code execution"), false);
check("SEC 힌트 LiteLLM 통과", SEC_TITLE_HINT.test("LiteLLM supply-chain attack hits PyPI packages"), true);
check("SEC 힌트 Daily/API 오탐 방지", SEC_TITLE_HINT.test("Daily API security news roundup"), false);

// ---------- 34차: 오타 교정 가드 ----------
check("fixTypos 제약가격 보호", fixTypos("제약가격 인상 동향"), "제약가격 인상 동향");
check("fixTypos 칸바스 보호", fixTypos("칸바스 드로잉 앱"), "칸바스 드로잉 앱");
check("fixTypos 칸바→캔바", fixTypos("칸바, 새 템플릿 기능 출시"), "캔바, 새 템플릿 기능 출시");
check("fixTypos 구글 지미니→제미나이", fixTypos("구글 지미니 업데이트"), "구글 제미나이 업데이트");
check("fixTypos 앤스로픽→앤트로픽", fixTypos("앤스로픽 발표"), "앤트로픽 발표");

// ---------- needsRewrite: 정상/승격/Phase 1 하드 게이트 정합 ----------
const goodItem = {
  title: "과기정통부, AI 기본법 시행령 입법예고 의견 수렴 시작",
  takeaway: "고영향 AI 의무 조항 세부 기준 공개. 해당 사업자는 의견 수렴 기간 내 적용 범위 주시.",
  summary: "",
  grade: "note" as const,
  originalTitle: "과기정통부, AI 기본법 시행령 입법예고",
};
check("needsRewrite 정상 기사 통과", needsRewrite(goodItem), false);
check(
  "needsRewrite 신호 없는 중요는 재작성",
  needsRewrite({ ...goodItem, grade: "important" as const }),
  true,
);
check(
  "needsRewrite 하드 게이트 중요는 유지 (Phase 1)",
  needsRewrite({
    title: "인기 라이브러리에 악성 패키지 심어져 개발자 주의보",
    takeaway: "악성 패키지가 유포됐다. 해당 라이브러리 사용자는 버전 확인 필요.",
    summary: "",
    grade: "important" as const,
    originalTitle: "Malicious package planted in popular library",
  }),
  false,
);

// ---------- 32차: 시사점 bare 어미 교정 ----------
check(
  "polishTakeaway bare 확인 교정",
  polishTakeaway("무료 모델 공개로 비용 부담이 완화됐다. 사용 중이면 설정 확인.").endsWith("확인 필요."),
  true,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
