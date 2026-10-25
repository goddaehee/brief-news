// Phase 1 (2패스 데스크·등급 거버너·엔티티 잠금) 단위 테스트.
// LLM 호출이 필요한 classifyEntry 자체는 대상이 아니고, 결정론 부분
// (parseFactCard·decideGrade·applyGovernor·verifyAgainstCard)을 고정한다.
import {
  buildPayloadFromCard,
  decideGrade,
  factUser,
  findNearMissEntities,
  parseFactCard,
  verifyAgainstCard,
  writeUser,
} from "../src/lib/news/desk";
import { applyGovernor } from "../src/lib/news/collect";
import type { FactCard, Grade, IngestPayload, NewsItem } from "../src/lib/news/types";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} => ${JSON.stringify(actual)}${ok ? "" : ` (기대 ${JSON.stringify(expected)})`}`);
}

const card = (partial: Partial<FactCard>): FactCard => ({
  status: "confirmed",
  entities: [],
  hangulForms: [],
  change: "",
  numbers: [],
  evidence: "",
  importance: 50,
  promotionReason: "",
  hardGate: null,
  immediate: false,
  tip: false,
  topics: [],
  ...partial,
});
const entry = (partial: Partial<{ title: string; source: string; sourceUrl: string; summary: string; date: number }> = {}) => ({
  title: "Example story",
  source: "TechCrunch",
  sourceUrl: "https://example.com/a",
  summary: "",
  date: Date.now(),
  ...partial,
});

// ---------- parseFactCard ----------
const parsed = parseFactCard({
  status: "claim",
  entities: ["OpenAI", "GPT-6"],
  hangulForms: ["오픈AI", "없는표기"],
  change: "신모델 공개",
  numbers: ["2시간", 39],
  evidence: "OpenAI announced GPT-6",
  importance: 85.6,
  promotionReason: "주요 모델 출시",
  hardGate: "cve",
  immediate: true,
  tip: false,
  topics: ["openai", "bogus-topic"],
});
check("카드 파싱 status", parsed?.status, "claim");
check("카드 파싱 importance 반올림", parsed?.importance, 86);
check("카드 파싱 hangulForms 등록분만", parsed?.hangulForms, ["오픈AI"]);
check("카드 파싱 numbers 문자열화", parsed?.numbers, ["2시간", "39"]);
check("카드 파싱 topics 허용값만", parsed?.topics, ["openai"]);
check("카드 파싱 hardGate", parsed?.hardGate, "cve");
check("카드 importance 없음 → null", parseFactCard({ status: "confirmed" }), null);
check("카드 hardGate 무효 → null 처리", parseFactCard({ status: "confirmed", importance: 10, hardGate: "whatever" })?.hardGate, null);
check("카드 status 무효 → 거부", parseFactCard({ importance: 80, status: "alleged" }), null);
check("카드 status 누락 → 거부", parseFactCard({ importance: 80 }), null);
check("카드 importance 상한 클램프", parseFactCard({ status: "confirmed", importance: 150 })?.importance, 100);

// ---------- decideGrade ----------
check(
  "하드 게이트(cve)는 점수 낮아도 중요",
  decideGrade(card({ hardGate: "cve", importance: 10 }), "LiteLLM 종속성에서 악성 코드 발견돼 긴급 패치 배포 시작", "악성 코드가 포함됐다. 사용자는 즉시 패치 적용 필요."),
  "important",
);
check(
  "하드 게이트(outage)+당일이면 속보",
  decideGrade(card({ hardGate: "outage", immediate: true, importance: 95 }), "앤트로픽, 클로드 API 장애로 서비스 전면 중단", "클로드 API 장애로 연동 서비스 요청 실패. 폴백 로직 점검 필요."),
  "breaking",
);
check(
  "하드 게이트(outage) 비당일이면 중요",
  decideGrade(card({ hardGate: "outage", immediate: false, importance: 95 }), "앤트로픽, 클로드 API 장애 복구 완료", "2시간 장애 후 정상화. 연동 서비스는 요청 누락 여부 점검 필요."),
  "important",
);
check(
  "점수 90 + 강한 신호 → 중요",
  decideGrade(card({ importance: 90 }), "오픈AI, GPT-6 신모델 출시", "GPT-6 출시로 추론 성능 경쟁 심화. 기존 워크플로우 적용 검토."),
  "important",
);
check(
  "점수 90 + 신호 없음 → 참고 (하한·신호 게이트)",
  decideGrade(card({ importance: 90 }), "국내 AI 스타트업, 협업 기능 대폭 개선한 업데이트 배포", "협업 기능 개선으로 작업 속도 향상. 사용 중이면 변경 사항 확인 필요."),
  "note",
);
check(
  "점수 50 + 강한 신호 → 참고 (절대 하한)",
  decideGrade(card({ importance: 50 }), "오픈AI, API 장문 입력 요금 인하", "장문 컨텍스트 호출 비용 부담 완화. 대량 문서 처리 워크로드라면 새 요금제 적용 시점 확인."),
  "note",
);
check(
  "NOTE_FORCE(전력 모듈)는 고점수여도 참고",
  decideGrade(card({ importance: 95 }), "슈나이더, 엔비디아 'GB300' 맞춤 전력 모듈 선봬", "데이터센터 전력 장비 선택지 확대. 도입 예정 기업은 전력·냉각 요구 조건 비교 권장."),
  "note",
);
check(
  "NOTE_FORCE 리스크 가드(리콜)는 중요 유지",
  decideGrade(card({ importance: 95 }), "슈나이더, 서버랙 화재 위험으로 전량 리콜", "화재 위험으로 전량 리콜 조치. 해당 장비 사용 기업은 교체 일정 확인 필요."),
  "important",
);

// ---------- applyGovernor ----------
const item = (grade: Grade, publishedAt: number): NewsItem => ({
  id: `i${publishedAt}`,
  publishedAt,
  grade,
  tip: false,
  title: "t",
  takeaway: "t",
  summary: "",
  source: "s",
  sourceUrl: `https://x/${publishedAt}`,
  originalTitle: "t",
  topics: [],
});
const recent = (total: number, top: number): NewsItem[] =>
  Array.from({ length: total }, (_, i) => item(i < top ? "important" : "note", 100000 - i));
let seq = 0;
const payload = (grade: Grade, extra: Partial<IngestPayload> = {}): IngestPayload => ({
  title: "t",
  takeaway: "t",
  summary: "",
  source: "s",
  sourceUrl: `https://y/${seq++}`,
  originalTitle: "t",
  grade,
  tip: false,
  topics: [],
  keep: true,
  publishedAt: 200000,
  ...extra,
});

{
  const ps = [payload("note"), payload("note"), payload("note"), payload("note"), payload("note"), payload("note")];
  const r = applyGovernor(ps, recent(40, 6), 6);
  check("거버너 밴드 내 무강등", [r.demoted, r.signal], [0, undefined]);
  check("거버너 밴드 내 비율", Math.round(r.shareAfter * 1000), 150);
}
{
  const ps = [payload("important", { score: 90 }), payload("important", { score: 80 }), payload("important", { score: 75 }), payload("note"), payload("note"), payload("note")];
  const r = applyGovernor(ps, recent(40, 7), 6);
  check("거버너 상한 강등 3건 (기존 7건이 창 상한 점유)", r.demoted, 3);
  check("거버너 강등 순서", [ps[0].grade, ps[1].grade, ps[2].grade], ["note", "note", "note"]);
  check("거버너 강등 후 비율", Math.round(r.shareAfter * 1000), 175);
}
{
  const ps = [payload("important", { hardGate: "cve", score: 10 }), payload("important", { score: 95 }), payload("note"), payload("note"), payload("note"), payload("note")];
  const r = applyGovernor(ps, recent(40, 7), 6);
  check("거버너 하드 게이트 면제", [ps[0].grade, ps[1].grade, r.demoted, /상한/.test(r.signal ?? "")], ["important", "note", 1, true]);
}
{
  const ps = [payload("important", { secHint: true, score: 60 }), payload("important", { score: 99 }), payload("note"), payload("note"), payload("note"), payload("note")];
  const r = applyGovernor(ps, recent(40, 7), 6);
  check("거버너 보안 힌트 면제", [ps[0].grade, ps[1].grade, r.demoted], ["important", "note", 1]);
}
{
  const ps = [payload("important", { hardGate: "outage" }), payload("note"), payload("note"), payload("note"), payload("note"), payload("note")];
  const r = applyGovernor(ps, recent(40, 10), 6);
  check("거버너 상한 초과는 신호만", [r.demoted, /상한/.test(r.signal ?? "")], [0, true]);
}
{
  const ps = [payload("note"), payload("note"), payload("note"), payload("note"), payload("note"), payload("note")];
  const r = applyGovernor(ps, recent(40, 2), 6);
  check("거버너 하한 미달은 신호만", [/하한/.test(r.signal ?? "")], [true]);
}
{
  const ps = Array.from({ length: 8 }, (_, i) => payload("important", { score: 100 - i }));
  const r = applyGovernor(ps, recent(40, 0), 6);
  check("거버너 newCap 밖은 무접촉", [r.demoted, ps[6].grade, ps[7].grade], [0, "important", "important"]);
}
{
  const ps = [payload("important", { score: 100, keep: false }), payload("note"), payload("note"), payload("note"), payload("note"), payload("note")];
  const r = applyGovernor(ps, recent(40, 7), 6);
  check("거버너 keep=false 제외", [r.demoted, Math.round(r.shareAfter * 1000)], [0, 175]);
}

// ---------- verifyAgainstCard: 엔티티 잠금 ----------
check(
  "근접 오형 검출 (스모그)",
  findNearMissEntities("엔비디아, 스모그-네모트론 추론 모델 공개", "NVIDIA unveils Smaug-Nemotron reasoning model"),
  ["스모그"],
);
check(
  "근접 오형 원문 면제",
  findNearMissEntities("엔비디아, 스모그-네모트론 추론 모델 공개", "엔비디아 스모그-네모트론 공개"),
  [],
);
check(
  "정상 제목 무위반 (보정: 오픈소스·클라우드·스마트)",
  verifyAgainstCard(
    "오픈소스 클라우드 도구, 스마트 에이전트 기능 공개",
    "오픈소스 도구 공개로 선택지 확대. 클라우드 사용 기업은 적용 검토.",
    "",
    card({ entities: ["Open Source Cloud Tool"] }),
    entry({ title: "Open source cloud tool launches smart agent feature", summary: "An open source tool." }),
  ).filter((v) => v.kind === "entity"),
  [],
);
{
  const v = verifyAgainstCard(
    "Notion, 새 협업 기능 대폭 공개",
    "협업 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Notion"] }),
    entry({ title: "Notion launches new collaboration features", summary: "Notion announced features." }),
    ["노션"],
  );
  check("usedNames 미등록 음역 위반", v.filter((x) => x.kind === "entity").length, 1);
}
{
  const v = verifyAgainstCard(
    "Notion, 새 협업 기능 대폭 공개",
    "협업 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Notion"] }),
    entry({ title: "Notion launches new collaboration features", summary: "Notion announced features." }),
    ["Notion"],
  );
  check("usedNames 라틴 표기 통과", v.filter((x) => x.kind === "entity").length, 0);
}
{
  const v = verifyAgainstCard(
    "구글, 지미니 신기능 공개",
    "제미나이 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Google", "Gemini"], hangulForms: ["제미나이"] }),
    entry({ title: "Google adds new Gemini feature", summary: "Google announced." }),
    ["구글", "지미니"],
  );
  check("usedNames 오형(지미니) 위반", v.filter((x) => x.kind === "entity").length >= 1, true);
}

// ---------- verifyAgainstCard: 수치·상태 ----------
{
  const v = verifyAgainstCard(
    "센티넬원, AI 위협 탐지 역량 24배 확대",
    "탐지 역량 확대로 대응 속도 개선. 보안 담당은 수치 검증 필요.",
    "",
    card({ numbers: ["23배"], evidence: "23x improvement" }),
    entry({ title: "SentinelOne boosts detection 23x", summary: "23x improvement in detection." }),
  );
  check("수치 변경 위반", v.filter((x) => x.kind === "number").length, 1);
}
{
  const v = verifyAgainstCard(
    "앤트로픽, 클로드 API 장애 복구",
    "2시간 장애 후 정상화. 클로드 API 연동 서비스는 장애 시간대 요청 누락 여부 점검.",
    "",
    card({ numbers: ["2시간"], hardGate: "outage" }),
    entry({ title: "Anthropic Claude API outage resolved", summary: "The 2 hour outage ended." }),
  );
  check("수치 일치 무위반", v.filter((x) => x.kind === "number").length, 0);
}
{
  const v = verifyAgainstCard(
    "클로드 오퍼스 5.5 이용량 쿼터 축소 확인",
    "쿼터가 축소됐다. 구독자는 사용량 확인 필요.",
    "",
    card({ status: "allegation", entities: ["Claude Opus 5.5"] }),
    entry({ title: "Claude Opus 5.5 quota allegedly cut", summary: "Users allege a quota cut." }),
  );
  check("의혹 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  const v = verifyAgainstCard(
    "클로드 오퍼스 5.5 이용량 쿼터 축소 의혹 확산",
    "쿼터 축소 의혹이 제기됐다. 구독자는 사용량 확인 필요.",
    "",
    card({ status: "allegation", entities: ["Claude Opus 5.5"] }),
    entry({ title: "Claude Opus 5.5 quota allegedly cut", summary: "Users allege a quota cut." }),
  );
  check("의혹 표지 있으면 무위반", v.filter((x) => x.kind === "status").length, 0);
}


// ---------- Codex 리뷰 반영 케이스 ----------
{
  // 단위 변경: 원문 10% → 출력 10배
  const v = verifyAgainstCard(
    "오픈AI, API 비용 10배 절감 프로그램 발표",
    "비용 절감 프로그램 등장. 대량 호출 워크로드라면 적용 검토.",
    "",
    card({ entities: ["OpenAI"] }),
    entry({ title: "OpenAI launches program to cut API costs by 10%", summary: "Costs drop by 10% for heavy users." }),
    ["오픈AI"],
  );
  check("수치 단위 변경 위반", v.filter((x) => x.kind === "number").length >= 1, true);
}
{
  // Pass 1이 만든 숫자는 근거가 아니다: 카드 numbers에만 있고 원문에 없으면 위반
  const v = verifyAgainstCard(
    "신규 도구, 데이터셋 99개 공개",
    "데이터셋 공개로 학습 선택지 확대. 로컬 실험에 활용 검토.",
    "",
    card({ numbers: ["99개"], entities: ["NewTool"] }),
    entry({ title: "NewTool releases dataset collection", summary: "A collection of datasets was released." }),
    ["NewTool"],
  );
  check("카드 생성 수치 위반", v.filter((x) => x.kind === "number").length >= 1, true);
}
{
  // 제목에 의혹 표지가 있어도 사실 문장이 단정형이면 위반
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 판매 의혹 제기",
    "고객 데이터 불법 판매 확인. 이용자는 개인정보 설정 점검 필요.",
    "",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of selling customer data", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("제목 표지 있어도 사실 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 요약의 수치 생성도 검증 대상
  const v = verifyAgainstCard(
    "신규 모델 공개",
    "신규 모델 등장. 벤치마크 결과 확인 필요.",
    "신규 모델이 공개됐다. 파라미터 700억 규모다. 추론 속도가 개선됐다.",
    card({ entities: ["NewModel"] }),
    entry({ title: "NewModel released", summary: "A new model was released." }),
    ["NewModel"],
  );
  check("요약 수치 생성 위반", v.filter((x) => x.kind === "number").length >= 1, true);
}
{
  // usedNames 누락은 form 위반
  const v = verifyAgainstCard(
    "오픈AI, 새 모델 공개",
    "새 모델 등장. 도입 검토.",
    "",
    card({ entities: ["OpenAI"] }),
    entry({ title: "OpenAI releases new model", summary: "OpenAI announced." }),
    undefined,
  );
  check("usedNames 누락 form 위반", v.filter((x) => x.kind === "form").length >= 1, true);
}
{
  // usedNames 완전성: 제목의 등록 표기가 선언에서 빠지면 form 위반
  const v = verifyAgainstCard(
    "구글, 제미나이 신기능 공개",
    "기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Google", "Gemini"], hangulForms: ["제미나이"] }),
    entry({ title: "Google adds Gemini feature", summary: "Google announced." }),
    [],
  );
  check("usedNames 완전성 위반", v.filter((x) => x.kind === "form").length >= 1, true);
}
{
  // 등장하지 않은 등록 회사명을 선언하면 entity 위반 (등장 범위 제한)
  const v = verifyAgainstCard(
    "오픈AI·구글, 새 파트너십 프로그램 공개",
    "파트너십 확대로 연동 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["OpenAI"] }),
    entry({ title: "OpenAI launches partnership program", summary: "OpenAI announced a program." }),
    ["오픈AI", "구글"],
  );
  check("미등장 등록명 위반", v.filter((x) => x.kind === "entity").length, 1);
}


// ---------- Codex 리뷰 2차 반영 케이스 ----------
{
  // 상태: 표지와 단정이 한 문장에 같이 있어도 위반
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 사실로 확인됐다. 이용자는 개인정보 설정 점검 필요.",
    "",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("표지+단정 혼합 문장 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 상태: 요약 문장 단위 단정 검사
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출 의혹이 제기됐다. 유출 사실이 확인됐다. 당국은 조사 중이다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("요약 단정 문장 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 수치: 배율은 같고 통화만 변경 (2만 달러 → 2만 원)
  const v = verifyAgainstCard(
    "스타트업, 투자액 2만 원 유치 발표",
    "투자 유치로 자금 확보. 후속 라운드 일정 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup raises funds", summary: "The round totaled 2만 달러 from angels." }),
    ["스타트업"],
  );
  check("통화 단위 변경 위반", v.filter((x) => x.kind === "number").length >= 1, true);
}
{
  // 수치: 배율·통화 일치하면 통과
  const v = verifyAgainstCard(
    "스타트업, 투자액 2만 달러 유치 발표",
    "투자 유치로 자금 확보. 후속 라운드 일정 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup raises funds", summary: "The round totaled 2만 달러 from angels." }),
    ["스타트업"],
  );
  check("배율·통화 일치 무위반", v.filter((x) => x.kind === "number").length, 0);
}
{
  // usedNames 완전성: "GPT" 선언으로 "FakeGPT"를 선언한 척할 수 없다
  const v = verifyAgainstCard(
    "FakeGPT, GPT-5 연동 기능 공개",
    "연동 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["GPT-5"] }),
    entry({ title: "Acme launches GPT-5 add-on", summary: "Acme announced an add-on." }),
    ["GPT"],
  );
  check("FakeGPT 부분일치 우회 차단", v.filter((x) => x.kind === "form" || x.kind === "entity").length >= 1, true);
}
{
  // present 경계: "metadata"가 Meta 등장으로 오인되지 않는다
  const v = verifyAgainstCard(
    "메타, 새 필터 기능 공개",
    "필터 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Acme"] }),
    entry({ title: "Acme adds metadata filters", summary: "Acme shipped metadata filters." }),
    ["메타"],
  );
  check("metadata≠Meta 경계", v.filter((x) => x.kind === "entity").length, 1);
}


// ---------- Codex 리뷰 3차 반영 케이스 ----------
{
  // 수치 배율 탈락: 원문 "2만 달러" → 출력 bare "2"
  const v = verifyAgainstCard(
    "스타트업, 투자액 2 유치 발표",
    "투자 유치로 자금 확보. 후속 라운드 일정 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup raises funds", summary: "The round totaled 2만 달러 from angels." }),
    ["스타트업"],
  );
  check("배율 탈락 위반", v.filter((x) => x.kind === "number").length >= 1, true);
}
{
  // 상태: 제목 끝 명사형 단정 ("…유출 확정")
  const v = verifyAgainstCard(
    "테크기업, 고객 정보 유출 확정",
    "유출 의혹이 확산되고 있다. 이용자는 개인정보 설정 점검 필요.",
    "",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("제목 명사형 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 상태: "확정되었다" 완형 단정도 검출
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출 의혹이 제기됐다. 유출이 확정되었다. 당국은 조사 중이다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("확정되었다 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // FakeGPT: 선언 누락 + 추적 불가 → entity 위반 (form 수용으로 게시 불가)
  const v = verifyAgainstCard(
    "FakeGPT, GPT-5 연동 기능 공개",
    "연동 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["GPT-5"] }),
    entry({ title: "Acme launches GPT-5 add-on", summary: "Acme announced an add-on." }),
    ["GPT"],
  );
  check("FakeGPT entity 위반 승격", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 추적성 경계: 선언된 "Meta"가 원문의 "metadata"로 추적되지 않는다
  const v = verifyAgainstCard(
    "Meta, 새 필터 기능 공개",
    "필터 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Acme"] }),
    entry({ title: "Acme adds metadata filters", summary: "Acme shipped metadata filters." }),
    ["Meta"],
  );
  check("Meta 추적 경계 위반", v.filter((x) => x.kind === "entity").length >= 1, true);
}


// ---------- Codex 리뷰 4차 반영 케이스 ----------
{
  // usedNames 누락이어도 제목 후보 추적 검사는 수행된다 (FakeGPT)
  const v = verifyAgainstCard(
    "FakeGPT, GPT-5 연동 기능 공개",
    "연동 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["GPT-5"] }),
    entry({ title: "Acme launches GPT-5 add-on", summary: "Acme announced an add-on." }),
    undefined,
  );
  check("선언 누락+FakeGPT entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 추적 경계: "Metadata"가 선언된 "Meta"를 추적 가능하게 만들지 않는다
  const v = verifyAgainstCard(
    "Meta, 새 필터 기능 공개",
    "필터 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Acme"] }),
    entry({ title: "Metadata filters expand in Acme app", summary: "Metadata tooling improved." }),
    ["Meta"],
  );
  check("Metadata≠Meta 추적", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 의혹 단위별 보존: 제목·요약이 표지를 잃으면 위반
  const v = verifyAgainstCard(
    "오픈AI, 기업 고객의 대화 데이터를 외부 광고주에 판매",
    "고객 대화 판매 의혹 확산. 이용자는 데이터 설정 확인 필요.",
    "오픈AI가 고객 대화를 광고주에게 판매했다. 업계가 주목하고 있다.",
    card({ status: "allegation", entities: ["OpenAI"] }),
    entry({ title: "OpenAI accused of selling chat data", summary: "Reports claim OpenAI sold data." }),
    ["오픈AI"],
  );
  check("의혹 단위별 표지 위반", v.filter((x) => x.kind === "status").length >= 2, true);
}
{
  // 영문 배율 정규화: "2 million dollars" → "2억 원"은 값 변경
  const v = verifyAgainstCard(
    "스타트업, 투자액 2억 원 유치 발표",
    "투자 유치로 자금 확보. 후속 라운드 일정 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup raises funds", summary: "The round totaled 2 million dollars." }),
    ["스타트업"],
  );
  check("영문 배율 값 변경 위반", v.filter((x) => x.kind === "number").length >= 1, true);
}
{
  // 영문 배율 정규화 일치: "2 million dollars" → "200만 달러"는 무위반
  const v = verifyAgainstCard(
    "스타트업, 투자액 200만 달러 유치 발표",
    "투자 유치로 자금 확보. 후속 라운드 일정 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup raises funds", summary: "The round totaled 2 million dollars." }),
    ["스타트업"],
  );
  check("영문 배율 정규화 일치", v.filter((x) => x.kind === "number").length, 0);
}


// ---------- Codex 리뷰 5차 반영 케이스 ----------
{
  // "23x"가 "2"+"3배"로 분해되지 않는다 — 23배→3배 변경 검출
  const bad = verifyAgainstCard(
    "센티넬원, AI 위협 탐지 역량 3배 확대",
    "탐지 역량 확대로 대응 속도 개선. 보안 담당은 수치 검증 필요.",
    "",
    card({ entities: ["SentinelOne"] }),
    entry({ title: "SentinelOne boosts detection 23x", summary: "23x improvement in detection." }),
    ["센티넬원"],
  );
  check("23배→3배 변경 검출", bad.filter((x) => x.kind === "number").length >= 1, true);
  const ok = verifyAgainstCard(
    "센티넬원, AI 위협 탐지 역량 23배 확대",
    "탐지 역량 확대로 대응 속도 개선. 보안 담당은 수치 검증 필요.",
    "",
    card({ entities: ["SentinelOne"] }),
    entry({ title: "SentinelOne boosts detection 23x", summary: "23x improvement in detection." }),
    ["센티넬원"],
  );
  check("23배 일치 무위반", ok.filter((x) => x.kind === "number").length, 0);
}
{
  // "$2 million" = 200만 달러 — 정상 번역 무위반, 2억 원은 위반
  const ok = verifyAgainstCard(
    "스타트업, 투자액 200만 달러 유치 발표",
    "투자 유치로 자금 확보. 후속 라운드 일정 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup raises funds", summary: "The round totaled $2 million." }),
    ["스타트업"],
  );
  check("$2 million→200만 달러 무위반", ok.filter((x) => x.kind === "number").length, 0);
  const bad = verifyAgainstCard(
    "스타트업, 투자액 2억 원 유치 발표",
    "투자 유치로 자금 확보. 후속 라운드 일정 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup raises funds", summary: "The round totaled $2 million." }),
    ["스타트업"],
  );
  check("$2 million→2억 원 위반", bad.filter((x) => x.kind === "number").length >= 1, true);
}
{
  // 조사 결합형 "메타가"도 등록형 후보로 잡힌다 — 근거 없는 회사명은 entity
  const v = verifyAgainstCard(
    "메타가 기업용 AI 비서를 공개하고 업무 자동화 확대",
    "비서 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Acme"] }),
    entry({ title: "Acme launches assistant", summary: "Acme shipped an assistant." }),
    undefined,
  );
  check("메타가 후보+entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 소문자 라틴 이름도 후보 — fakegpt
  const v = verifyAgainstCard(
    "fakegpt, 새 연동 기능 공개하고 이용자 확대 추진",
    "연동 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Acme"] }),
    entry({ title: "Acme launches integration", summary: "Acme shipped an integration." }),
    undefined,
  );
  check("fakegpt 소문자 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}


// ---------- Codex 리뷰 6차 반영 케이스 ----------
{
  // 영문 축약 배율: "$2 million" → "$3M" 변경 검출, "$2M"은 무위반
  const bad = verifyAgainstCard(
    "Startup, raises $3M in seed round",
    "시드 라운드 확보로 채용 확대. 후속 일정 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup raises funds", summary: "The round totaled $2 million." }),
    ["Startup"],
  );
  check("$3M 변경 검출", bad.filter((x) => x.kind === "number").length >= 1, true);
  const ok = verifyAgainstCard(
    "Startup, raises $2M in seed round",
    "시드 라운드 확보로 채용 확대. 후속 일정 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup raises funds", summary: "The round totaled $2 million." }),
    ["Startup"],
  );
  check("$2M 일치 무위반", ok.filter((x) => x.kind === "number").length, 0);
}
{
  // 한글 복합 배율: "$20 million" → "2천만 달러" 무위반
  const ok = verifyAgainstCard(
    "스타트업, 투자액 2천만 달러 유치 발표",
    "투자 유치로 자금 확보. 후속 라운드 일정 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup raises funds", summary: "The round totaled $20 million." }),
    ["스타트업"],
  );
  check("2천만 달러 정규화 무위반", ok.filter((x) => x.kind === "number").length, 0);
}
{
  // 2글자 라틴 이름 HP — 근거 없으면 entity
  const v = verifyAgainstCard(
    "HP, 기업용 노트북 보안 결함 발견하고 패치 배포",
    "보안 결함 패치 배포로 대응 시작. 사용자는 업데이트 적용 필요.",
    "",
    card({ entities: ["Dell"] }),
    entry({ title: "Dell patches laptop flaw", summary: "Dell shipped a fix." }),
    ["HP"],
  );
  check("HP 2글자 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 의혹 요약 첫 문장 단정 — 뒤 문장의 표지로 면제되지 않는다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "고객 데이터가 외부로 유출됐다. 회사는 유출 의혹에 답하지 않았다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("요약 첫 문장 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 7차 반영 케이스 ----------
{
  // 의혹 요약 첫 문장: 명사형 종결("발생.")도 문장 경계로 분리된다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "고객 정보 유출 발생. 회사는 의혹을 부인했다. 조사가 진행 중이다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("요약 첫 문장 명사형 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 본문 추적성: 요약에 생성된 FakeGPT도 entity
  const v = verifyAgainstCard(
    "에이씨미, 새 연동 기능 공개하고 이용자 확대 추진",
    "연동 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "Acme가 FakeGPT와 연동해 기능을 넓혔다. 이용자 반응이 주목된다.",
    card({ entities: ["Acme"] }),
    entry({ title: "Acme launches integration", summary: "Acme shipped an integration." }),
    ["에이씨미"],
  );
  check("본문 FakeGPT entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 수치 부호: -3% → 3%는 부호 변경 위반, -3% 유지는 무위반
  const bad = verifyAgainstCard(
    "테크기업, 분기 성장률 3% 기록하며 반등 모색",
    "성장률 둔화가 이어졌다. 투자자는 실적 발표 확인 필요.",
    "",
    card({ entities: ["TechCorp"] }),
    entry({ title: "TechCorp growth slows", summary: "Growth rate fell -3% last quarter." }),
    ["테크기업"],
  );
  check("부호 변경 위반", bad.filter((x) => x.kind === "number").length >= 1, true);
  const ok = verifyAgainstCard(
    "테크기업, 분기 성장률 -3% 기록하며 반등 모색",
    "성장률 둔화가 이어졌다. 투자자는 실적 발표 확인 필요.",
    "",
    card({ entities: ["TechCorp"] }),
    entry({ title: "TechCorp growth slows", summary: "Growth rate fell -3% last quarter." }),
    ["테크기업"],
  );
  check("부호 유지 무위반", ok.filter((x) => x.kind === "number").length, 0);
}


// ---------- Codex 리뷰 8차 반영 케이스 ----------
{
  // 혼합 등록명 오픈AI: Google 기사 본문에 생성하면 entity (오픈 부분일치 우회 차단)
  const v = verifyAgainstCard(
    "구글, 제미나이 새 기능 공개하고 이용자 확대 추진",
    "기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "구글이 제미나이를 앞세워 오픈AI와 경쟁을 본격화했다.",
    card({ entities: ["Google", "Gemini"], hangulForms: ["구글", "제미나이"] }),
    entry({ title: "Google adds Gemini feature", summary: "Google shipped a Gemini update." }),
    ["구글", "제미나이"],
  );
  check("본문 오픈AI 생성 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 혼합 등록명 정상 사용: OpenAI 기사에서 오픈AI는 무위반
  const v = verifyAgainstCard(
    "오픈AI, 새 모델 공개하고 개발자 기능 확대 추진",
    "모델 공개로 선택지 증가. 사용 중이면 적용 검토.",
    "오픈AI가 새 모델을 공개했다. 개발자 반응이 주목된다.",
    card({ entities: ["OpenAI"], hangulForms: ["오픈AI"] }),
    entry({ title: "OpenAI launches new model", summary: "OpenAI shipped a model." }),
    ["오픈AI"],
  );
  check("오픈AI 정상 사용 무위반", v.filter((x) => x.kind === "entity").length, 0);
}
{
  // 문장 끝 "Orion." — 종결 마침표가 이름에 붙지 않는다
  const v = verifyAgainstCard(
    "Orion, 새 모델 공개하고 개발자 기능 확대 추진",
    "모델 공개로 선택지 증가. 사용 중이면 적용 검토.",
    "새 모델 이름은 Orion. 개발자 반응이 주목된다.",
    card({ entities: ["Orion"] }),
    entry({ title: "Orion launches new model", summary: "Orion shipped a model." }),
    ["Orion"],
  );
  check("Orion. 종결점 무위반", v.filter((x) => x.kind === "entity").length, 0);
}


// ---------- Codex 리뷰 9차 반영 케이스 ----------
{
  // 분리 선언 우회: usedNames ["오픈","AI"]로 후보 오픈AI의 추적을 회피할 수 없다
  const v = verifyAgainstCard(
    "오픈AI, 새 기능 공개하고 개발자 도구 확대 추진",
    "기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["SomeTool"] }),
    entry({ title: "New AI open-source tool gains traction", summary: "The AI open-source toolkit spread quickly." }),
    ["오픈", "AI"],
  );
  check("분리 선언 우회 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 수치 단위는 이름 후보가 아니다 — 10ms·16GB 정상 요약 무위반
  const v = verifyAgainstCard(
    "Orion, 새 모델 공개하고 추론 속도 개선 발표",
    "모델 공개로 선택지 증가. 사용 중이면 적용 검토.",
    "Orion이 10ms 지연과 16GB 메모리 지원을 달성했다.",
    card({ entities: ["Orion"] }),
    entry({ title: "Orion achieves 10ms latency", summary: "Orion hit 10ms latency with 16GB memory." }),
    ["Orion"],
  );
  check("수치 단위 후보 제외", v.filter((x) => x.kind === "entity").length, 0);
}


// ---------- Codex 리뷰 10차 반영 케이스 ----------
{
  // 챗GPT 내부의 GPT는 독립 후보가 아니다 — 정상 사용 무위반
  const v = verifyAgainstCard(
    "챗GPT, 새 기능 공개하고 이용자 확대 추진 본격화",
    "기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "챗GPT가 새 기능을 공개했다. 이용자 반응이 주목된다.",
    card({ entities: ["ChatGPT"], hangulForms: ["챗GPT"] }),
    entry({ title: "ChatGPT gets new feature", summary: "ChatGPT shipped a feature." }),
    ["챗GPT"],
  );
  check("챗GPT 내부 GPT 무위반", v.filter((x) => x.kind === "entity").length, 0);
}
{
  // 붙여 쓴 단위 수치 변경: 10ms→20ms, 16GB→32GB 검출
  const v = verifyAgainstCard(
    "Orion, 새 모델 공개하고 추론 속도 개선 발표",
    "모델 공개로 선택지 증가. 사용 중이면 적용 검토.",
    "Orion이 20ms 지연과 32GB 메모리 지원을 달성했다.",
    card({ entities: ["Orion"] }),
    entry({ title: "Orion achieves 10ms latency", summary: "Orion hit 10ms latency with 16GB memory." }),
    ["Orion"],
  );
  check("붙은 단위 수치 변경 검출", v.filter((x) => x.kind === "number").length >= 1, true);
}
{
  // 공백 없는 문장 경계: "유출했다.유출 의혹은…" — 첫 문장 단정 검출
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "기업이 고객 정보를 유출했다.유출 의혹은 조사 중이다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("공백 없는 첫 문장 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 11차 반영 케이스 ----------
{
  // 문장 경계: "유출했다.2건의…" — 숫자 시작 문장도 분리된다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "데이터를 유출했다.2건의 유출 의혹은 조사 중이다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("숫자 시작 문장 분리 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 측정 단위 우선: "10ms" 정상 표기와 "10밀리초" 번역 모두 무위반
  const v = verifyAgainstCard(
    "Orion, 새 모델 공개하고 추론 속도 개선 발표",
    "모델 공개로 선택지 증가. 사용 중이면 적용 검토.",
    "Orion이 10밀리초 지연을 달성했다. 반응 속도가 주목된다.",
    card({ entities: ["Orion"] }),
    entry({ title: "Orion achieves 10ms latency", summary: "Orion hit 10ms latency." }),
    ["Orion"],
  );
  check("10ms→10밀리초 무위반", v.filter((x) => x.kind === "number").length, 0);
}
{
  // 시간 단위 정규화: "2 hours" → "2초"는 단위 변경 위반, "2시간"은 무위반
  const bad = verifyAgainstCard(
    "Orion, 새 모델 공개하고 응답 시간 개선 발표",
    "모델 공개로 선택지 증가. 사용 중이면 적용 검토.",
    "Orion이 응답 시간을 2초로 단축했다.",
    card({ entities: ["Orion"] }),
    entry({ title: "Orion cuts response time", summary: "Response time dropped to 2 hours." }),
    ["Orion"],
  );
  check("2 hours→2초 단위 위반", bad.filter((x) => x.kind === "number").length >= 1, true);
  const ok = verifyAgainstCard(
    "Orion, 새 모델 공개하고 응답 시간 개선 발표",
    "모델 공개로 선택지 증가. 사용 중이면 적용 검토.",
    "Orion이 응답 시간을 2시간으로 단축했다.",
    card({ entities: ["Orion"] }),
    entry({ title: "Orion cuts response time", summary: "Response time dropped to 2 hours." }),
    ["Orion"],
  );
  check("2 hours→2시간 무위반", ok.filter((x) => x.kind === "number").length, 0);
}
{
  // "챗GPT." 종결 — 내부 GPT가 독립 후보로 남지 않는다
  const v = verifyAgainstCard(
    "챗GPT, 새 기능 공개하고 이용자 확대 추진 본격화",
    "기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "지원 대상은 챗GPT. 이용자 반응이 주목된다.",
    card({ entities: ["ChatGPT"], hangulForms: ["챗GPT"] }),
    entry({ title: "ChatGPT gets new feature", summary: "ChatGPT shipped a feature." }),
    ["챗GPT"],
  );
  check("챗GPT. 종결 무위반", v.filter((x) => x.kind === "entity").length, 0);
}


// ---------- Codex 리뷰 12차 반영 케이스 ----------
{
  // 미등록 한글 음역: 퍼플렉시티는 선언을 비워도 선두 주체 검사에 걸린다
  const v = verifyAgainstCard(
    "퍼플렉시티, 기업용 검색 기능 전면 확대하고 도입사 늘려",
    "검색 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Perplexity"] }),
    entry({ title: "Perplexity expands enterprise search", summary: "Perplexity shipped enterprise search." }),
    [],
  );
  check("미등록 음역 선두 주체 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 한국 고유명사 면제: 삼성전자는 무위반
  const v = verifyAgainstCard(
    "삼성전자, 새 반도체 공개하고 파운드리 확대 추진 본격화",
    "반도체 공개로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Samsung Electronics"] }),
    entry({ title: "Samsung Electronics unveils chip", summary: "Samsung Electronics announced a chip." }),
    ["삼성전자"],
  );
  check("삼성전자 고유명사 무위반", v.filter((x) => x.kind === "entity").length, 0);
}
{
  // 단위 없는 음수: -2 → 2는 부호 변경 위반
  const bad = verifyAgainstCard(
    "테크기업, 벤치마크 점수 2 기록하며 순위 변동 생겨",
    "점수 변동으로 순위 변화. 개발자는 세부 지표 확인 필요.",
    "",
    card({ entities: ["TechCorp"] }),
    entry({ title: "TechCorp benchmark slips", summary: "The benchmark score is -2 now." }),
    ["테크기업"],
  );
  check("단위 없는 음수 부호 위반", bad.filter((x) => x.kind === "number").length >= 1, true);
}


// ---------- Codex 리뷰 13차 반영 케이스 ----------
{
  // Pass 1 change의 한국어 서술은 추적 근거가 아니다
  const v = verifyAgainstCard(
    "퍼플렉시티, 기업용 검색 기능 전면 확대하고 도입사 늘려",
    "검색 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Perplexity"], change: "퍼플렉시티가 검색 기능을 확대했다" }),
    entry({ title: "Perplexity expands enterprise search", summary: "Perplexity shipped enterprise search." }),
    [],
  );
  check("change 근거 차단 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 한국 고유명사 날조: Google 기사에 삼성전자를 주체로 세우면 entity
  const v = verifyAgainstCard(
    "삼성전자, 새 검색 기능 공개하고 이용자 확대 추진 본격화",
    "검색 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Google"] }),
    entry({ title: "Google launches search feature", summary: "Google shipped a search feature." }),
    ["삼성전자"],
  );
  check("삼성전자 날조 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 병렬 주체: 구글·퍼플렉시티 중 미등록 음역도 걸린다
  const v = verifyAgainstCard(
    "구글·퍼플렉시티, 검색 기능 확대 경쟁 본격화하며 격돌",
    "검색 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Google", "Perplexity"], hangulForms: ["구글"] }),
    entry({ title: "Google and Perplexity expand search", summary: "Google and Perplexity raced on search." }),
    [],
  );
  check("병렬 주체 미등록 음역 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}


// ---------- Codex 리뷰 14차 반영 케이스 ----------
{
  // hangulForms 단독 근거 차단: Google 기사에 메타 선언만으로 통과 불가
  const v = verifyAgainstCard(
    "메타, 새 기능 공개하고 이용자 확대 추진 본격화 진행",
    "기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Google"], hangulForms: ["메타"] }),
    entry({ title: "Google launches feature", summary: "Google shipped a feature." }),
    ["메타"],
  );
  check("hangulForms 단독 근거 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 인용부호 속 미등록 음역: 제목 중간·요약 어디에 있어도 검출
  const v = verifyAgainstCard(
    "AI 검색 도구 '퍼플렉시티', 기업용 기능 공개 확대",
    "기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "업계는 '퍼플렉시티'의 확장에 주목하고 있다.",
    card({ entities: ["Perplexity"] }),
    entry({ title: "Perplexity expands enterprise search", summary: "Perplexity shipped enterprise search." }),
    [],
  );
  check("인용 미등록 음역 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 라인↔line 일반어: 원문의 command line으로 라인(회사)이 인정되지 않는다
  const v = verifyAgainstCard(
    "라인, 새 업무 도구 공개하고 이용자 확대 추진 본격화",
    "도구 공개로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Google"] }),
    entry({ title: "Google launches command line AI tools", summary: "Google shipped command line tools." }),
    ["라인"],
  );
  check("라인 일반어 오인 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}


// ---------- Codex 리뷰 15차 반영 케이스 ----------
{
  // 본문 속 한국 고유명사도 후보다 — 근거 없는 "라인" 연동은 entity
  const v = verifyAgainstCard(
    "구글, 라인과 기업용 AI 도구 연동 서비스 확대 발표",
    "연동 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Google"], hangulForms: ["구글"] }),
    entry({ title: "Google expands AI tools", summary: "Google shipped AI tools." }),
    ["구글"],
  );
  check("본문 라인 무근거 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // "파이프라인"의 부분 문자열은 라인(회사)의 근거가 아니다
  const v = verifyAgainstCard(
    "라인, 새 업무 도구 공개하고 이용자 확대 추진 본격화",
    "도구 공개로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Google"], hangulForms: ["구글"] }),
    entry({ title: "구글, CI 파이프라인 도구 개선", summary: "구글이 파이프라인 도구를 개선했다." }),
    ["라인"],
  );
  check("파이프라인≠라인 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // "메타데이터"의 부분 문자열은 메타의 근거가 아니다
  const v = verifyAgainstCard(
    "메타, 새 기능 공개하고 이용자 확대 추진 본격화 진행",
    "기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Acme"] }),
    entry({ title: "메타데이터 표준안 공개", summary: "메타데이터 표준이 공개됐다." }),
    ["메타"],
  );
  check("메타데이터≠메타 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 쉼표 없는 제목의 첫 단어는 선두 검사를 받지 않는다 (few-shot 구조)
  const v = verifyAgainstCard(
    "게임 NPC 실시간 대화 구현 도구 'NPCTalk' 공개",
    "대화 구현 도구 공개로 선택지 증가. 개발자는 적용 검토.",
    "",
    card({ entities: ["NPCTalk"] }),
    entry({ title: "NPCTalk tool for game NPC dialogue", summary: "A tool enabling real-time NPC dialogue." }),
    ["NPCTalk"],
  );
  check("쉼표 없는 제목 무위반", v.filter((x) => x.kind === "entity").length, 0);
}
{
  // 부정문은 단정이 아니다 — "사실로 확인되지 않았다"는 의혹 보존
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출 의혹은 사실로 확인되지 않았다. 회사는 공식 입장을 내놓지 않았다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("부정문 단정 오판 없음", v.filter((x) => x.kind === "status").length, 0);
}


// ---------- Codex 리뷰 16차 반영 케이스 ----------
{
  // 절 단위 부정: 다른 절의 "미확인"이 단정절을 면제하지 않는다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹은 사실로 확인됐지만 피해 규모는 미확인이다. 이용자는 개인정보 설정 점검 필요.",
    "",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("절 단위 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 선두 주체 원형 우선: "제미나이"가 "제미나"로 잘리지 않는다
  const v = verifyAgainstCard(
    "제미나이, 새 기능 공개하고 이용자 확대 추진 본격화",
    "기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Gemini"], hangulForms: ["제미나이"] }),
    entry({ title: "Gemini launches feature", summary: "Gemini shipped a feature." }),
    ["제미나이"],
  );
  check("제미나이 선두 무위반", v.filter((x) => x.kind === "entity").length, 0);
}
{
  // 미확인 표현은 표지 검사에서도 상태 보존으로 인정된다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출은 사실로 확인되지 않았다. 조사가 이어지고 있다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("미확인 요약 상태 보존", v.filter((x) => x.kind === "status").length, 0);
}


// ---------- Codex 리뷰 17차 반영 케이스 ----------
{
  // 절 분리 확장: "확인됐으며"도 절 경계다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출은 확인됐으며 피해 범위는 미확인이다. 이용자는 개인정보 설정 점검 필요.",
    "",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("됐으며 절 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 첫 문장 절별 보존: 앞절 단정은 뒤절 미확인으로 덮이지 않는다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "고객 데이터가 유출됐다, 피해 규모는 미확인이다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("첫 문장 앞절 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 혼합형 경계: "슈퍼챗GPT"는 챗GPT의 근거가 아니다
  const v = verifyAgainstCard(
    "챗GPT, 새 기능 공개하고 이용자 확대 추진 본격화",
    "기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: [], hangulForms: ["챗GPT"] }),
    entry({ title: "슈퍼챗GPT 새 기능 공개", summary: "슈퍼챗GPT가 기능을 공개했다." }),
    ["챗GPT"],
  );
  check("슈퍼챗GPT≠챗GPT entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 영문 단위어: "2 million tokens"를 "200만 달러"로 바꾸면 단위 날조
  const bad = verifyAgainstCard(
    "스타트업, 처리액 200만 달러 기록하며 성장 본격화",
    "처리량 증가로 성장세 지속. 투자자는 지표 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup scales API", summary: "The API processed 2 million tokens." }),
    ["스타트업"],
  );
  check("tokens→달러 단위 날조", bad.filter((x) => x.kind === "number").length >= 1, true);
  const ok = verifyAgainstCard(
    "스타트업, 토큰 200만 개 처리하며 고속 성장 본격화",
    "처리량 증가로 성장세 지속. 투자자는 지표 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup scales API", summary: "The API processed 2 million tokens." }),
    ["스타트업"],
  );
  check("tokens→토큰 계수 무위반", ok.filter((x) => x.kind === "number").length, 0);
}


// ---------- Codex 리뷰 18차 반영 케이스 ----------
{
  // cardText 부분 문자열 우회 차단: entities의 슈퍼챗GPT로 챗GPT가 인정되지 않는다
  const v = verifyAgainstCard(
    "챗GPT, 새 기능 공개하고 이용자 확대 추진 본격화",
    "기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["슈퍼챗GPT"], hangulForms: ["챗GPT"] }),
    entry({ title: "슈퍼챗GPT 새 기능 공개", summary: "슈퍼챗GPT가 기능을 공개했다." }),
    ["챗GPT"],
  );
  check("슈퍼챗GPT cardText 우회 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 의혹 제목·사실부의 절 단위 보존: 앞절 단정은 뒤절 미확인으로 덮이지 않는다
  const v = verifyAgainstCard(
    "오픈AI, 고객 데이터 유출됐고 피해 규모는 미확인",
    "고객 데이터 유출됐고 피해 규모는 미확인. 이용자는 개인정보 설정 점검 필요.",
    "오픈AI의 고객 데이터 유출 의혹이 제기됐다. 회사는 조사 중이다.",
    card({ status: "allegation", entities: ["OpenAI"], hangulForms: ["오픈AI"] }),
    entry({ title: "OpenAI accused of data leak", summary: "Allegations surfaced." }),
    ["오픈AI"],
  );
  check("제목·사실부 절 단위 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 단수 단위어: "1 token" → "1달러" 단위 날조 검출
  const v = verifyAgainstCard(
    "스타트업, 호출당 1달러 과금하며 요금제 개편 본격화",
    "요금제 개편으로 비용 구조 변화. 사용자는 단가 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup changes pricing", summary: "The API used 1 token per call." }),
    ["스타트업"],
  );
  check("1 token→1달러 날조", v.filter((x) => x.kind === "number").length >= 1, true);
}


// ---------- Codex 리뷰 19차 반영 케이스 ----------
{
  // 주체 구간 사칭 차단: 사건 동사가 있는 선두는 절 검사에서 제외되지 않는다
  const v = verifyAgainstCard(
    "오픈AI 기밀 유출 발생, 관련 의혹에 대한 당국 조사 착수",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "오픈AI 기밀 유출 의혹에 대해 당국이 조사에 착수했다.",
    card({ status: "allegation", entities: ["OpenAI"], hangulForms: ["오픈AI"] }),
    entry({ title: "OpenAI leak allegations surface", summary: "Allegations surfaced." }),
    ["오픈AI"],
  );
  check("선두 사건 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 대문자 단위어: "1 Token" → "1달러" 날조 검출
  const v = verifyAgainstCard(
    "스타트업, 호출당 1달러 과금하며 요금제 개편 본격화",
    "요금제 개편으로 비용 구조 변화. 사용자는 단가 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup changes pricing", summary: "The API used 1 Token per call." }),
    ["스타트업"],
  );
  check("1 Token→1달러 날조", v.filter((x) => x.kind === "number").length >= 1, true);
}


// ---------- Codex 리뷰 20차 반영 케이스 ----------
{
  // 사건 명사 선두: "오픈AI 해킹, …의혹" — 선두가 주체 구간으로 제외되지 않는다
  const v = verifyAgainstCard(
    "오픈AI 해킹, 보안 체계 취약성 의혹",
    "해킹 의혹이 제기됐다. 이용자는 비밀번호 변경 점검 필요.",
    "오픈AI 해킹 의혹이 제기됐다. 당국은 경위를 조사 중이다.",
    card({ status: "allegation", entities: ["OpenAI"], hangulForms: ["오픈AI"] }),
    entry({ title: "OpenAI hacking allegations surface", summary: "Allegations surfaced." }),
    ["오픈AI"],
  );
  check("해킹 선두 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 무효 경계 내부 토큰: "슈퍼챗GPT"의 GPT는 독립 후보로 남아 추적에 걸린다
  const v = verifyAgainstCard(
    "오픈AI, 슈퍼챗GPT 기반 문서 분석 기능 확대 발표",
    "기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["OpenAI"], hangulForms: ["오픈AI"] }),
    entry({ title: "OpenAI expands document analysis", summary: "OpenAI shipped document analysis." }),
    ["오픈AI"],
  );
  check("슈퍼챗GPT 생성 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 시사점 근접 오형: 앤스로픽도 검출된다
  const v = verifyAgainstCard(
    "앤트로픽, 새 기능 공개하고 이용자 확대 추진 본격화",
    "앤스로픽의 기능 확대로 선택지 증가. 사용 중이면 적용 검토.",
    "",
    card({ entities: ["Anthropic"], hangulForms: ["앤트로픽"] }),
    entry({ title: "Anthropic launches feature", summary: "Anthropic shipped a feature." }),
    ["앤트로픽"],
  );
  check("시사점 오형 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}


// ---------- Codex 리뷰 21차 반영 케이스 ----------
{
  // 목록 밖 사건 명사: "오픈AI 파산, 재무 조작 의혹 확산"도 선두 단정 검출
  const v = verifyAgainstCard(
    "오픈AI 파산, 재무 조작 의혹 확산",
    "재무 조작 의혹이 확산되고 있다. 투자자는 공시 확인 필요.",
    "오픈AI의 재무 조작 의혹이 확산되고 있다. 당국은 자료를 살피고 있다.",
    card({ status: "allegation", entities: ["OpenAI"], hangulForms: ["오픈AI"] }),
    entry({ title: "OpenAI fraud allegations spread", summary: "Allegations surfaced." }),
    ["오픈AI"],
  );
  check("파산 선두 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 슈퍼챗GPT 전체 이름 검사: 내부 GPT가 추적돼도 전체는 걸린다
  const v = verifyAgainstCard(
    "오픈AI, 슈퍼챗GPT 기반 개발 도구 공개 확대 발표",
    "도구 공개로 선택지 증가. 개발자는 적용 검토.",
    "",
    card({ entities: ["OpenAI", "ChatGPT", "GPT"], hangulForms: ["오픈AI", "챗GPT"] }),
    entry({ title: "OpenAI and ChatGPT updates, GPT news", summary: "OpenAI, ChatGPT and GPT updates." }),
    ["오픈AI", "GPT"],
  );
  check("슈퍼챗GPT 전체 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 계수사 면제 한계: 금액을 인원수로 바꾸면 위반
  const v = verifyAgainstCard(
    "스타트업, 투자액 200만 명 유치 발표 논란 확산",
    "투자 유치로 자금 확보. 후속 라운드 일정 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup raises funds", summary: "The round totaled 2 million dollars." }),
    ["스타트업"],
  );
  check("달러→명 계수 교체 위반", v.filter((x) => x.kind === "number").length >= 1, true);
}
{
  // 미등록 단수 단위: "1 credit" → "1달러" 날조 검출
  const v = verifyAgainstCard(
    "스타트업, 호출당 1달러 과금하며 요금제 개편 본격화",
    "요금제 개편으로 비용 구조 변화. 사용자는 단가 확인 필요.",
    "",
    card({ entities: ["Startup"] }),
    entry({ title: "Startup changes pricing", summary: "The API used 1 credit per call." }),
    ["스타트업"],
  );
  check("1 credit→1달러 날조", v.filter((x) => x.kind === "number").length >= 1, true);
}
{
  // 딥테크는 딥시크의 오형이 아니다 (자소 무공유)
  const v = verifyAgainstCard(
    "딥시크, 새 모델 공개하고 개발자 기능 확대 추진",
    "딥테크 투자 확대로 선택지 증가. 투자자는 동향 확인 필요.",
    "",
    card({ entities: ["DeepSeek"], hangulForms: ["딥시크"] }),
    entry({ title: "DeepSeek launches model", summary: "DeepSeek shipped a model." }),
    ["딥시크"],
  );
  check("딥테크 오형 오탐 없음", v.filter((x) => x.kind === "entity").length, 0);
}


// ---------- Codex 리뷰 22차 반영 케이스 ----------
{
  // 원문 등장 일반 명사는 주체 이름이 아니다 — "오픈AI 파산, …" 단정 검출
  const v = verifyAgainstCard(
    "오픈AI 파산, 고객 자금 유용 의혹 조사",
    "자금 유용 의혹이 제기됐다. 투자자는 공시 확인 필요.",
    "오픈AI의 자금 유용 의혹이 제기됐다. 당국은 자료를 살피고 있다.",
    card({ status: "allegation", entities: ["OpenAI"], hangulForms: ["오픈AI"] }),
    entry({ title: "오픈AI 파산 의혹 확산", summary: "오픈AI 파산설이 돌고 있다." }),
    ["오픈AI"],
  );
  check("파산 주체구간 우회 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // "16GB로"는 이름 후보가 아니다 — 정상 측정 표기 무위반
  const v = verifyAgainstCard(
    "Orion, 새 모델 공개하고 추론 속도 개선 발표",
    "모델 공개로 선택지 증가. 사용 중이면 적용 검토.",
    "Orion이 메모리를 16GB로 늘렸다. 반응 속도가 주목된다.",
    card({ entities: ["Orion"] }),
    entry({ title: "Orion expands memory to 16GB", summary: "Orion bumped memory to 16GB." }),
    ["Orion"],
  );
  check("16GB로 후보 제외", v.filter((x) => x.kind === "entity").length, 0);
}
{
  // 관계절 과거 부인은 현재 단정을 면제하지 않는다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "오픈AI가 부인했던 유출 의혹이 사실로 확인됐다. 이용자는 개인정보 설정 점검 필요.",
    "",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("관계절 부인 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 23차 반영 케이스 ----------
{
  // "슈퍼GPT-5"는 숫자가 있어도 전체 이름 후보로 검사된다
  const v = verifyAgainstCard(
    "스타트업, 슈퍼GPT-5 기반 개발 도구 공개 확대 발표",
    "도구 공개로 선택지 증가. 개발자는 적용 검토.",
    "",
    card({ entities: ["GPT-5"] }),
    entry({ title: "Startup builds on GPT-5", summary: "A tool built on GPT-5." }),
    ["스타트업"],
  );
  check("슈퍼GPT-5 전체 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // 인용된 과거 부인("부인했다고 알려진")은 현재 단정을 면제하지 않는다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "업체가 부인했다고 알려진 유출 의혹이 사실로 확인됐다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("인용 부인 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 24차 반영 케이스 ----------
{
  // 상태 보존도 말미 부정만 인정: 관계절 부인으로 세 단위를 채우면 위반
  const v = verifyAgainstCard(
    "부인했다고 알려진 고객 정보 유출이 발생했다",
    "부인했다고 알려진 고객 정보 유출이 발생했다. 이용자는 개인정보 설정 점검 필요.",
    "부인했다고 알려진 고객 정보 유출이 발생했다. 조사가 진행 중이다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("관계절 부인 보존 우회 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // "24시AI"는 측정형이 아닌 이름 — 전체 후보로 검사된다
  const v = verifyAgainstCard(
    "OpenAI, 24시AI 기반 개발 도구 공개 확대 발표",
    "도구 공개로 선택지 증가. 개발자는 적용 검토.",
    "",
    card({ entities: ["OpenAI"], hangulForms: ["오픈AI"] }),
    entry({ title: "OpenAI expands tools, 24 templates", summary: "OpenAI shipped tools and 24 templates." }),
    ["OpenAI"],
  );
  check("24시AI 전체 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}


// ---------- Codex 리뷰 25차 반영 케이스 ----------
{
  // "24시간AI"·"16GB봇"은 측정 토큰이 아니라 이름 후보다
  const v = verifyAgainstCard(
    "OpenAI, 24시간AI 기반 개발 도구 공개 확대 발표",
    "도구 공개로 선택지 증가. 개발자는 적용 검토.",
    "새 모델은 16GB봇과 연동된다. 개발자 반응이 주목된다.",
    card({ entities: ["OpenAI"], hangulForms: ["오픈AI"] }),
    entry({ title: "OpenAI expands tools for 24 hours", summary: "OpenAI shipped tools." }),
    ["OpenAI"],
  );
  check("24시간AI·16GB봇 entity", v.filter((x) => x.kind === "entity").length >= 1, true);
}
{
  // "보고서"는 의혹 표지가 아니다
  const v = verifyAgainstCard(
    "구글, 사내 감사 대응 과정에서 핵심 내부 보고서 삭제",
    "핵심 보고서 삭제. 이용자는 후속 공지 확인 필요.",
    "구글이 핵심 내부 보고서를 삭제했다. 파장이 이어지고 있다.",
    card({ status: "allegation", entities: ["Google"], hangulForms: ["구글"] }),
    entry({ title: "Google accused of deleting report", summary: "Allegations surfaced." }),
    ["구글"],
  );
  check("보고서 표지 오인 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 부인 종결형은 상태 보존으로 인정된다
  const v = verifyAgainstCard(
    "구글, 데이터 유출을 부인한다",
    "구글은 데이터 유출을 부인한다. 이용자는 공식 발표 확인 필요.",
    "구글은 데이터 유출 의혹을 부인했다. 당국은 자료를 살피고 있다.",
    card({ status: "allegation", entities: ["Google"], hangulForms: ["구글"] }),
    entry({ title: "Google denies data leak claims", summary: "Google denied the claims." }),
    ["구글"],
  );
  check("부인 종결 보존", v.filter((x) => x.kind === "status").length, 0);
}


// ---------- Codex 리뷰 26차 반영 케이스 ----------
{
  // 다른 대상의 부인은 사건 확정을 면제하지 않는다
  const v = verifyAgainstCard(
    "구글, 유출이 사실로 확인된 뒤 책임을 부인한다",
    "유출이 사실로 확인된 뒤 책임을 부인한다. 이용자는 개인정보 설정 점검 필요.",
    "유출이 사실로 확인된 뒤 책임을 부인한다. 파장이 이어지고 있다.",
    card({ status: "allegation", entities: ["Google"], hangulForms: ["구글"] }),
    entry({ title: "Google accused of data leak", summary: "Allegations surfaced." }),
    ["구글"],
  );
  check("책임 부인 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 측정 토큰+조사(에서·까지)도 이름 후보에서 제외된다
  const v = verifyAgainstCard(
    "Orion, 새 모델 공개하고 추론 속도 개선 발표",
    "모델 공개로 선택지 증가. 사용 중이면 적용 검토.",
    "Orion이 메모리를 16GB에서 32GB까지 늘렸다.",
    card({ entities: ["Orion"] }),
    entry({ title: "Orion expands memory", summary: "Orion bumped memory from 16GB to 32GB." }),
    ["Orion"],
  );
  check("16GB에서 후보 제외", v.filter((x) => x.kind === "entity").length, 0);
}


// ---------- Codex 리뷰 27차 반영 케이스 ----------
{
  // 다른 주장의 부정("면책 주장은 사실이 아니다")은 유출 확정을 면제하지 않는다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출 의혹이 사실로 확인됐다는 점에서 회사의 면책 주장은 사실이 아니다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("타 주장 부정 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // "AI를"은 이름 후보가 아니다 — 정상 할 일 문장 무위반
  const v = verifyAgainstCard(
    "Acme, 새 언어 모델 공개하고 개발자 기능 확대 추진",
    "AI를 도입하기 전 비용 비교 필요. 모델 공개로 선택지 증가.",
    "",
    card({ entities: ["Acme"] }),
    entry({ title: "Acme launches a language model", summary: "Acme shipped a language model." }),
    ["Acme"],
  );
  check("AI를 후보 제외", v.filter((x) => x.kind === "entity").length, 0);
}


// ---------- Codex 리뷰 28차 반영 케이스 ----------
{
  // 다른 대상의 미확인이 유출 확정을 덮지 않는다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출이 사실로 확인된 상황에서 피해 규모는 확인되지 않았다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("타 대상 미확인 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 29차 반영 케이스 ----------
{
  // "확인된 바 없다"·"아닌 것으로 밝혀졌다"는 단정 오탐이 없다
  const v1 = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹은 사실로 확인된 바 없다. 이용자는 개인정보 설정 점검 필요.",
    "",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("확인된 바 없다 무위반", v1.filter((x) => x.kind === "status").length, 0);
  const v2 = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹은 사실이 아닌 것으로 밝혀졌다. 이용자는 개인정보 설정 점검 필요.",
    "",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("아닌 것으로 밝혀졌다 무위반", v2.filter((x) => x.kind === "status").length, 0);
}


// ---------- Codex 리뷰 30차 반영 케이스 ----------
{
  // "확인된 바 없음" 종결 제목도 상태 보존으로 인정된다
  const v = verifyAgainstCard(
    "오픈AI, 학습 데이터 무단 유출은 확인된 바 없음",
    "유출 의혹이 제기됐으나 확인된 바 없다. 이용자는 공식 발표 확인 필요.",
    "오픈AI의 학습 데이터 유출 의혹은 확인된 바 없다. 당국은 자료를 살피고 있다.",
    card({ status: "allegation", entities: ["OpenAI"], hangulForms: ["오픈AI"] }),
    entry({ title: "OpenAI accused of data leak", summary: "Allegations surfaced." }),
    ["오픈AI"],
  );
  check("확인된 바 없음 보존", v.filter((x) => x.kind === "status").length, 0);
}


// ---------- Codex 리뷰 31차 반영 케이스 ----------
{
  // 제목 말미 명사형 "확인"도 단정이다
  const v = verifyAgainstCard(
    "오픈AI, 고객 데이터 유출 의혹을 내부 조사로 확인",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "오픈AI의 고객 데이터 유출 의혹이 제기됐다. 회사는 조사 중이다.",
    card({ status: "allegation", entities: ["OpenAI"], hangulForms: ["오픈AI"] }),
    entry({ title: "OpenAI accused of data leak", summary: "Allegations surfaced." }),
    ["오픈AI"],
  );
  check("제목 말미 확인 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 32차 반영 케이스 ----------
{
  // 제목 말미 "미확인"은 단정이 아니다
  const v = verifyAgainstCard(
    "오픈AI, 개인정보 유출 의혹의 사실 여부는 미확인",
    "유출 의혹의 사실 여부는 미확인이다. 이용자는 공식 발표 확인 필요.",
    "오픈AI의 개인정보 유출 의혹은 미확인 상태다. 당국은 자료를 살피고 있다.",
    card({ status: "allegation", entities: ["OpenAI"], hangulForms: ["오픈AI"] }),
    entry({ title: "OpenAI accused of data leak", summary: "Allegations surfaced." }),
    ["오픈AI"],
  );
  check("말미 미확인 무위반", v.filter((x) => x.kind === "status").length, 0);
}


// ---------- Codex 리뷰 33차 반영 케이스 ----------
{
  // 과거형 연결 어미 부정: "확인되지 않았고 … 미확인"은 단정 오탐이 없다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출 의혹은 사실로 확인되지 않았고 피해 규모도 미확인이다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("않았고 부정 무위반", v.filter((x) => x.kind === "status").length, 0);
}


// ---------- Codex 리뷰 34차 반영 케이스 ----------
{
  // 부정 절 뒤의 사실 단정 절은 엄격 보존에서 걸린다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출 의혹은 사실로 확인되지 않았고 고객 정보는 유출됐다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("않았고 뒤 단정절 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 부인 종결 절의 단정은 부인된 주장의 내용 — 단정 위반 아님
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출이 사실로 확인됐다는 주장을 부인했다. 이용자는 개인정보 설정 점검 필요.",
    "",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("부인 종결 단정 무위반", v.filter((x) => x.kind === "status").length, 0);
}


// ---------- Codex 리뷰 35차 반영 케이스 ----------
{
  // 앞에 독립 확정 서술이 있으면 뒤의 의혹 부인이 면제하지 않는다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출이 사실로 확인된 뒤 회사는 의혹을 부인했다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("독립 확정+의혹 부인 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // "보도를 부인했다"도 인용형 부인 면제가 적용된다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출이 확인됐다는 보도를 부인했다. 이용자는 개인정보 설정 점검 필요.",
    "",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("보도를 부인 무위반", v.filter((x) => x.kind === "status").length, 0);
}
{
  // "확인되지 않았고"로 끝나는 절도 상태 보존으로 인정된다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출은 확인되지 않았고 추가 의혹은 조사 중이다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("않았고 절 보존", v.filter((x) => x.kind === "status").length, 0);
}


// ---------- Codex 리뷰 36차 반영 케이스 ----------
{
  // 인용 구간 앞의 독립 확정 서술은 부인 면제를 받지 못한다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출 의혹이 사실로 확인된 뒤 회사는 유출됐다는 주장을 부인했다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("인용 앞 독립 확정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 37차 반영 케이스 ----------
{
  // 경계 없는 독립 단정 + 뒤의 인용 부인: 단정이 검사를 빠져나가지 못한다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출이 사실로 확인됐는데 회사는 유출됐다는 주장을 부인했다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("됐는데 독립 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 38차 반영 케이스 ----------
{
  // 주어 생략 부인절: "됐는데도" 앞의 독립 단정이 분리돼 검출된다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출이 사실로 확인됐는데도 유출됐다는 주장을 부인했다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("됐는데도 독립 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 39차 반영 케이스 ----------
{
  // 비축약형 "확인되었는데" 앞 단정도 분리돼 검출된다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "고객 데이터 유출이 사실로 확인되었는데 유출됐다는 주장을 부인했다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("되었는데 독립 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 40차 반영 케이스 ----------
{
  // "확인되자" 앞 단정은 절 분리로 검출된다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출 의혹이 사실로 확인되자 외부로 확산됐다는 주장을 부인했다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("확인되자 독립 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 41차 반영 케이스 ----------
{
  // 구간 내부 선행 절("확인됐기에")이 있으면 인용 제거가 취소된다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출이 사실로 확인됐기에 해킹됐다는 주장을 부인했다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("됐기에 선행절 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 42차 반영 케이스 ----------
{
  // "확인됐으므로" 선행 절도 인용 제거가 취소된다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출 의혹이 사실로 확인됐으므로 해킹됐다는 주장을 부인했다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("됐으므로 선행절 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 43차 반영 케이스 ----------
{
  // "확인됐으니" 선행 단정도 인용 제거가 취소된다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "회사는 유출이 사실로 확인됐으니 해킹됐다는 주장을 부인했다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("됐으니 선행 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 44차 반영 케이스 ----------
{
  // 마지막 2토큰 안에 든 선행 단정("확인됐기에")도 제거가 취소된다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출이 확인됐기에 해킹됐다는 주장을 부인했다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("확인됐기에 선행 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 45차 반영 케이스 ----------
{
  // "확인된 것으로 결론났다"는 확정 서술이다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 내부 조사에서 확인된 것으로 결론났다. 이용자는 개인정보 설정 점검 필요.",
    "",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("결론났다 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 46차 반영 케이스 ----------
{
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출 의혹이 사실이라는 결론을 내렸다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("결론을 내렸다 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}


// ---------- Codex 리뷰 47차 반영 케이스 ----------
{
  // 연결형 "결론을 내렸으며"도 단정이다
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "유출 의혹이 제기됐다. 이용자는 개인정보 설정 점검 필요.",
    "유출 의혹이 사실이라는 결론을 내렸으며 회사는 해킹됐다는 주장을 부인했다.",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("내렸으며 단정 위반", v.filter((x) => x.kind === "status").length >= 1, true);
}
{
  // 다중 토큰 술어("결론에 도달했")가 인용 명제 안이면 정상 부인 보도
  const v = verifyAgainstCard(
    "테크기업, 고객 데이터 유출 의혹 제기",
    "회사는 유출 의혹이 사실이라는 결론에 도달했다는 주장을 부인했다. 이용자는 개인정보 설정 점검 필요.",
    "",
    card({ status: "allegation", entities: ["TechCorp"] }),
    entry({ title: "TechCorp accused of data leak", summary: "Allegations surfaced." }),
    ["테크기업"],
  );
  check("결론에 도달 인용 무위반", v.filter((x) => x.kind === "status").length, 0);
}

// ---------- buildPayloadFromCard / 프롬프트 스모크 ----------
{
  const p = buildPayloadFromCard(
    card({ importance: 88, hardGate: "malware", entities: ["LiteLLM"] }),
    { title: "LiteLLM 악성 릴리스 발견돼 긴급 대응 착수", takeaway: "악성 릴리스가 유포됐다. 사용자는 버전 확인 필요.", summary: "LiteLLM 악성 릴리스가 발견됐다. 패치가 배포됐다. 사용자는 업데이트해야 한다." },
    entry({ title: "Malicious LiteLLM release found", summary: "A malicious release." }),
  );
  check("빌드 등급 하드 게이트", p.grade, "important");
  check("빌드 메타 부착", [p.score, p.hardGate, p.card?.importance], [88, "malware", 88]);
}
check("factUser 스키마 포함", factUser(entry()).includes("hangulForms"), true);
check("writeUser 스키마 포함", writeUser(entry(), card({})).includes("usedNames"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
