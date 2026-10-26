import { TOPIC_MAP } from "./topics";
import type {
  EventType,
  FactCard,
  FactStatus,
  Grade,
  HardGate,
  ImpactBasis,
  IngestPayload,
  NewsItem,
  ShadowTier,
} from "./types";

export const ALLOWED_TOPICS = Object.keys(TOPIC_MAP);

/** Ceremony / photo ops. Original desk drops these. */
export const DROP_HINT =
  /만찬|국빈|동행|시상식|포토\s*뉴스|오늘의 인물|출근길|레드카펫|기념촬영|개막식 참석/i;

/** 제목 전용 잡음 패턴 (32차, 31차 패널). summary에 같은 단어가 있어도
 *  본문이 실무 내용일 수 있어 제목에만 적용한다. */
const TITLE_DROP_HINT =
  /산업대전|(박람회|엑스포)\s*(개막|개최)|신용시설|전환사채|회사채 발행|적자 현금흐름|분기 실적 발표|(골드만|모건스탠리|JP모건).{0,24}(전망|목표주가)/i;

/** 36차: 문화 화제성 잡음 — "네덜란드 밴드 뮤직비디오 화제", "문학상 논쟁".
 *  36차 재심 (Codex): "뮤직비디오 생성 API 가격 인하", "문학상 심사 AI 개인정보 유출" 같은
 *  제품·가격·보안 기사는 보존 — 제품/가격/보안 신호가 있으면 폐기하지 않음. */
const CULTURE_DROP_HINT = /뮤직비디오|문학상/;
// 36차 재심 v3: 장애·중단·제재·리콜·침해·소송도 보존
// ("문학상 심사 AI 서비스 장애로 접수 중단" 반례).
const CULTURE_KEEP_HINT = /API|가격|인하|인상|유출|보안|취약점|모델|출시|공개|장애|중단|제재|리콜|침해|소송/;
function titleCultureDrop(title: string): boolean {
  return CULTURE_DROP_HINT.test(title) && !CULTURE_KEEP_HINT.test(title);
}

/** Pipeline-now. Name-drops (출시·연구소) are 참고. */
/** 5차 평가: [중요] 7.5% 과소 (목표 12-18%). 힌트를 약간 복원.
 *  일반 출시/발표/협력은 제외 유지, 주요 모델 출시·보안 경고·대규모 계약 추가. */
export const IMPORTANT_HINT =
  /가격|인하|인상|침해|장애|중단|제재|유출|다운|수출 통제|계정 탈취|출시 연기|취약점|해킹|공격|위협|경고|주의보|소송|소환장|벌금|과징금|리콜|독점|반독점|규제|법안|정책|가이드라인|대규모 계약|대규모 투자|인수|합병|최초|기록|돌파|경신|오픈소스 공개|벤치마크|신모델 출시|신모델 공개|물리학 평가|신기록|주요 모델 출시|보안 경고|AI 자가복제|웜|사이버 공격|파산|상장|IPO/;

/** 의식/행사성 발표 제외: 모델 출시는 중요, 연구소 출범은 참고. 승격 게이트의 제외 조건. */
const CEREMONY_GUARD = /출범|연구소|연구센터|개소식|기념식/;

/** 프런티어 랩 × 프런티어 이벤트 승격 (14차 평가: promppy [중요] 커버리지 대응).
 *  예: "Anthropic IPO 로드쇼", "DeepSeek 3시간 장애", "오픈AI, GPT-6 아스트라 출시"
 *  LAB의 모델명은 버전 번호가 붙은 것만 포함 — "GPT 탑재 챗봇 출시" 같은 bare 언급은 과승격 방지. */
const FRONTIER_LAB =
  /오픈AI|OpenAI|앤트로픽|Anthropic|클로드|구글|Google|딥마인드|DeepMind|제미나이|Gemini|딥시크|DeepSeek|xAI|그록|Grok|메타|Meta|라마|Llama|미스트랄|Mistral|엔비디아|NVIDIA|GPT-?\d|Gemini ?\d|Claude ?\d|Grok ?\d|LFM ?\d|Nemotron|Muse|Wonder|Argon|Qwen|Gemma/i;
const FRONTIER_EVENT =
  /출시|공개|발표|지원 시작|기본 적용|기본값|벤치마크|벤치|평가|1위|신기록|돌파|경신|98점|99점|100점|IPO|상장|매출|실적|장애|다운|단종|가격|인하|인상|launch(?:es|ed)?|releases?d?|unveil(?:s|ed)?|announces?d?|outage|benchmark/i;

// 원제목 단독 승격용 강한 출시 신호 (29차 크로스 리뷰: announce/발표 같은 약한 신호는 제외 —
// "OpenAI announces partnership" 류 협력 발표가 원제목만으로 승격되는 과승격 재현됨)
const FRONTIER_EVENT_STRONG =
  /출시|단종|장애|launch(?:es|ed)?|releases?d?|unveil(?:s|ed)?|outage|benchmark/i;
// 영문 원제목의 행사성 가드 (CEREMONY_GUARD의 영문판 — "announces new research center" 승격 차단)
const CEREMONY_GUARD_EN = /research (?:center|centre|institute|lab)|inaugurat|opening ceremony/i;

// 29차 P0: 검사 대상에 원제목(originalTitle) 포함 — 데스크 LLM이 한글 제목을 다시 쓰며
// 원문의 출시 신호(release/launch/출시)가 탈락하면 승격이 누락됨
// (실측: Claude API 신규 버전, 원제에 "출시" 있는데 한글 제목은 "파라미터 제거"라 [참고]로 강등).
// 단, 원제목만으로 승격할 땐 강한 신호(FRONTIER_EVENT_STRONG)만 인정한다.
function isFrontierEvent(title: string, takeaway: string, originalTitle = ""): boolean {
  const desk = `${title} ${factPart(takeaway)}`;
  const all = `${desk} ${originalTitle}`;
  if (!FRONTIER_LAB.test(all)) return false;
  if (CEREMONY_GUARD.test(all) || CEREMONY_GUARD_EN.test(originalTitle)) return false;
  // 데스크 제목 자체의 이벤트 신호는 기존 판정 유지
  if (FRONTIER_EVENT.test(desk)) return true;
  // 원제목만으로 승격할 땐 강한 출시 신호만 인정
  return FRONTIER_EVENT_STRONG.test(originalTitle);
}

/** 시사점의 "할 일" 문장을 제외한 사실 부분만 반환.
 *  시사점 구조 "사실 한 줄. 할 일 한 줄."에서 할 일 문장은
 *  "비교 권장", "확인 필요" 같은 권유형 상용구라 승격 신호로 부적합.
 *  16차 결함: 에이수스("사양·가격 비교 권장"의 "가격"),
 *  리퀴드AI("벤치마크 대상 후보로 확인 권장"의 "벤치마크") 오승격.
 *  사실 문장의 신호(버셀 "커널 취약점")는 그대로 유지. */
export function factPart(takeaway: string): string {
  const t = takeaway.trim();
  // "사실 한 줄. 할 일 한 줄." → 마지막 문장이 권유형 어미면 할 일 문장으로 보고 제외.
  // 사실 문장은 명사형 종결("경쟁.", "확대.")도 허용되므로 문장 경계는 단순 ". " 기준.
  const idx = t.lastIndexOf(". ");
  if (idx > 0) {
    const last = t.slice(idx + 2).trim();
    if (last && /(필요|검토|권장|확인|점검)\.\s*$/.test(last)) {
      return t.slice(0, idx + 1).trim();
    }
  }
  return t;
}

export const LEAD_HINT = /마련했다|발표했다|밝혔다|나섰다|전했다|보도했다/;

// ============================================================================
// Phase 1: 2패스 데스크 (plan-final.md Phase 1)
// Pass 1 = 사실 카드 + 중요도 점수 + 승격 근거 (등급·제목·시사점을 확정하지 않음)
// Pass 2 = 사실 카드 기반으로만 제목·시사점 작성 + 원문 대조 검증 (collect.ts)
// 등급은 LLM이 아니라 코드가 정한다 — decideGrade(하드 게이트·점수·신호) +
// collect.ts의 등급 거버너(최근 40건 비율 12~18%).
// ============================================================================

export const FACT_SYSTEM = `당신은 한국 AI 실무자용 뉴스 터미널 brief_의 사실 분석가다.
기사에서 사실만 구조화해 뽑는다. 제목·시사점·등급은 절대 쓰지 않는다. JSON만 출력.

사실 카드 필드
- status: 사실의 확정 상태.
  - "confirmed": 공식 발표·문서·수치로 확인된 사실.
  - "claim": 특정 주체(회사·연구자·보도)의 주장·발표 수준. 검증이 끝나지 않았다.
  - "allegation": 의혹·논란·혐의 제기. 사실로 확정되지 않았다.
- entities: 기사에 등장하는 회사·제품·인물·법안 고유명사를 **원문 표기 그대로** (영문 원문이면 영문, 한글이면 한글). 임의로 음역하거나 번역하지 말 것.
- change: 무엇이 어떻게 달라졌나, 변경점 한 줄 (한국어).
- numbers: 원문에 실제로 등장하는 수치만, 원문 표기 그대로 배열로. 없는 수치를 만들지 말 것.
- evidence: 원문에서 근거 구절을 짧게 인용 (원문 언어 그대로).
- importance: 중요도 점수 0~100. 등급이 아니라 순위를 매기기 위한 원자재다.
  - 90+: 업계 판도를 바꾸는 사건 — 대형 서비스 장애·대규모 침해·주요 랩의 대표 모델 출시·법안 통과.
  - 70~89: 이번 주 실무에 바로 닿는 것 — 주요 모델·제품 출시/공개, 가격·요금제 변동, 보안 취약점, 대규모 계약·투자·인수 완료, 규제·제재 발표, 출시 연기.
  - 50~69: 의미 있는 업계 동향 — 일반 제품 소식, 연구 결과, 파트너십, 지역 출시.
  - 30~49: 단신·홍보성 — 벤더 자체 역량·수치 홍보, 하드웨어 액세서리, 의견·전망 기사.
  - 0~29: 실무 무관에 가까움.
- promotionReason: [중요] 후보라고 보는 근거 한 줄. 해당 없으면 빈 문자열.
- eventType: 사건 유형 6종 중 하나, 해당 없으면 null. 등급 결정에는 쓰지 않는
  섀도 기록용이다 (150건 누적 뒤에야 활성화 판정이 가능하다).
  - "product": 제품·모델 출시/도입 (신모델·신제품·기능 출시).
  - "infra": 인프라·공급 (컴퓨팅 용량·데이터센터·공급 능력 변화).
  - "investment": 투자·인수·계약 (금액·지분·계약 체결).
  - "regulation": 규제·법안·제재 (법안·정책·가이드라인·제재 발표).
  - "security": 보안·장애 (취약점·침해·악성코드·서비스 장애).
  - "research": 연구·평가 (논문·벤치마크·평가 결과).
- impactBasis: 이 사건이 실무에 미치는 구체적 영향 1개 이상, 아래 허용값만.
  허용값: "usability"(오늘 바로 쓸 수 있음), "cost"(비용·가격·요금 변화),
  "supply"(공급 능력·용량·가용성 변화), "scope"(적용 범위·대상·지역 변화),
  "legal"(법적 의무·컴플라이언스 변화), "security"(보안 위험·대응 변화).
  투자액 자체, 사건 유형 해당 자체만으로는 impactBasis에 넣지 말 것.
  규제 사건은 상태(발의·통과·서명·시행)를 change에 명시할 것.
- hardGate: 아래 범주에 정확히 해당하면 그 값, 아니면 null.
  - "supply-chain": 패키지·모델·데이터셋 공급망 공격 (악성 패키지 배포, 백도어 삽입 등).
  - "malware": 악성코드·랜섬웨어·침해 도구 자체가 주제인 사건.
  - "cve": CVE 번호가 부여된 취약점, 또는 패치가 필요한 구체적 취약점 공개.
  - "outage": 서비스 장애·중단·다운.
  - "price-today": 당일 적용되는 가격·요금제·쿼터 변경.
- immediate: 당일·즉시 적용되거나 지금 진행 중인 사건이면 true.
- tip: 무료 모델 공개, 프롬프트 기법, 로컬 LLM 설정법처럼 오늘 바로 쓰는 실용 정보면 true. 침해 사고·보안 경고는 tip이 아니다.
- hangulForms: entities 중 아래 **데스크 등록 표기**가 있는 이름의 한글 표기만 배열로. 등록 표기에 없는 외래 이름은 넣지 말 것 (제목에서 라틴 표기를 유지하게 된다).
  등록 표기: Gemini→제미나이, Kimi→키미, Canva→캔바, Smaug→스마우그, Anthropic→앤트로픽, Hugging Face→허깅페이스, DeepSeek→딥시크, DeepMind→딥마인드, NVIDIA→엔비디아, Google→구글, Meta→메타, Apple→애플, Amazon→아마존, Tesla→테슬라, Disney→디즈니, Microsoft→마이크로소프트, OpenAI→오픈AI, ChatGPT→챗GPT, Claude→클로드, Grok→그록, Llama→라마, Mistral→미스트랄, Qwen→큐원, Codex→코덱스, Cursor→커서, Railway→레일웨이, Opus→오퍼스, Cognition→코그니션, Snowflake→스노우플레이크, Nemotron→네모트론, a16z→에이16지, ForTy→포티, Argon→아르곤.
- topics: 아래 허용값 중에서.

keep=false
- 주식·공시·특징주, 유튜브 라운드업, AI 무관, 만찬·참석·동행·포토, 인사 단신, 연예·문화·문학 화제, 개인 회고·감상 인터뷰, 소액 정부 지원 단신.
- AI와 직접 관련 없는 M&A·지배구조·주식·공시 기사도 keep=false.`;

export function factUser(entry: {
  title: string;
  source: string;
  sourceUrl: string;
  summary: string;
}): string {
  return `원문 제목: ${entry.title}
출처: ${entry.source}
링크: ${entry.sourceUrl}
발췌: ${entry.summary.slice(0, 700)}

JSON 스키마:
{"keep":true,"status":"confirmed|claim|allegation","entities":["원문 표기 그대로"],"hangulForms":["등록 표기가 있는 이름의 한글 표기만"],"change":"변경점 한 줄","numbers":["원문 수치 그대로"],"evidence":"원문 근거 구절 인용","importance":0,"promotionReason":"","hardGate":null,"immediate":false,"tip":false,"topics":["openai"],"eventType":null,"impactBasis":[]}
hardGate 허용값: "supply-chain" | "malware" | "cve" | "outage" | "price-today" | null
eventType 허용값: "product" | "infra" | "investment" | "regulation" | "security" | "research" | null
impactBasis 허용값: "usability" | "cost" | "supply" | "scope" | "legal" | "security"
topics 허용값: ${ALLOWED_TOPICS.join(", ")}`;
}

const HARD_GATES: HardGate[] = ["supply-chain", "malware", "cve", "outage", "price-today"];

/** Pass 1 JSON → 사실 카드. 형식이 깨졌으면 null (호출측이 폴백 처리).
 *  status는 필수 — 누락·무효값을 confirmed로 승격하면 상태 검증 전체가
 *  무력화되므로 카드를 거부한다 (Codex 리뷰 P1). */
export function parseFactCard(json: Record<string, unknown>): FactCard | null {
  if (json.status !== "confirmed" && json.status !== "claim" && json.status !== "allegation") {
    return null;
  }
  const status: FactStatus = json.status;
  const entities = Array.isArray(json.entities)
    ? json.entities.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 12)
    : [];
  const numbers = Array.isArray(json.numbers)
    ? json.numbers.filter((x): x is string | number => typeof x === "string" || typeof x === "number").map(String).slice(0, 12)
    : [];
  const importanceRaw = typeof json.importance === "number" ? json.importance : Number(json.importance);
  if (!Number.isFinite(importanceRaw)) return null;
  const hardGate =
    typeof json.hardGate === "string" && (HARD_GATES as string[]).includes(json.hardGate)
      ? (json.hardGate as HardGate)
      : null;
  const topics = Array.isArray(json.topics)
    ? json.topics.filter((x): x is string => typeof x === "string" && Boolean(TOPIC_MAP[x])).slice(0, 4)
    : [];
  // hangulForms는 등록 표기(ENTITY_FORMS의 값)만 인정 — 모델이 임의 음역을
  // "등록 표기"라고 주장하는 것을 코드가 걸러낸다 (엔티티 잠금).
  const registeredForms = new Set(ENTITY_FORMS.map(([, hangul]) => hangul));
  const hangulForms = Array.isArray(json.hangulForms)
    ? json.hangulForms.filter((x): x is string => typeof x === "string" && registeredForms.has(x)).slice(0, 12)
    : [];
  // Phase 2 후속 (섀도 전용): eventType은 6종 허용값만, impactBasis는
  // 허용값만 남긴다. 무효·누락은 null/[]로 — 카드 자체를 거부하지 않는다
  // (섀도 필드라 Pass 1 본류 판정에 영향을 주지 않는다).
  const EVENT_TYPES = ["product", "infra", "investment", "regulation", "security", "research"];
  const IMPACT_BASES = ["usability", "cost", "supply", "scope", "legal", "security"];
  const eventType =
    typeof json.eventType === "string" && EVENT_TYPES.includes(json.eventType)
      ? (json.eventType as EventType)
      : null;
  const impactBasis = Array.isArray(json.impactBasis)
    ? json.impactBasis.filter(
        (x): x is ImpactBasis => typeof x === "string" && IMPACT_BASES.includes(x),
      )
    : [];
  return {
    status,
    entities,
    hangulForms,
    change: typeof json.change === "string" ? json.change : "",
    numbers,
    evidence: typeof json.evidence === "string" ? json.evidence : "",
    importance: Math.max(0, Math.min(100, Math.round(importanceRaw))),
    promotionReason: typeof json.promotionReason === "string" ? json.promotionReason : "",
    hardGate,
    immediate: json.immediate === true,
    tip: json.tip === true,
    topics,
    eventType,
    impactBasis,
  };
}

export const WRITE_SYSTEM = `당신은 한국 AI 실무자용 뉴스 터미널 brief_의 편집장이다.
입력으로 주어지는 **사실 카드와 원문만** 근거로 제목·시사점·요약을 다시 쓴다. JSON만 출력.
등급은 당신이 정하지 않는다 (출력에 포함하지 말 것).

사실 카드 준수 규칙 (원문 대조 검증 대상)
- 고유명사는 사실 카드 entities의 표기를 기준으로 쓴다. 카드에 없는 회사·제품·인물명을 새로 만들지 말 것.
- 수치는 사실 카드 numbers와 원문에 있는 것만 쓴다. 수치 변경·반올림·새 수치 생성 금지.
- status가 "claim"이면 주장으로, "allegation"이면 의혹·논란으로 쓴다. 사실로 단정하지 말 것.
- 할 일 문장은 제목·사실의 방향과 일치시킬 것. 제목이 "쿼터 축소 의혹"이면 "축소 여부 확인 필요"처럼 같은 방향으로 — 반대 방향("상향 여부 확인") 금지.

헤드라인
- 28~44자. 원문 제목 복사 금지. 부제·수치 나열 꼬리 자를 것.
- 주어(회사·제품·규제) + 행위. 제품·법안 이름만 '따옴표'.
- 말줄임표는 ... (점 세 개). 신문 인용문("기다릴 가치 있다")은 제목 끝이 짧을 때만.
- 제품·모델명은 사실 카드 hangulForms에 있는 등록 표기만 한글로 쓴다. hangulForms에 없는 외래 고유명사는 원문(라틴) 표기를 그대로 유지한다 — 임의 한글 음역 금지.
- usedNames: 제목에 쓴 고유명사를 **제목에 쓴 표기 그대로** 전부 나열한다. 검증에 쓰이므로 빠뜨리지 말 것.

시사점 takeaway — 원본 문장 뼈대
- 정확히 두 조각: "사실 한 줄. 할 일 한 줄."
- 첫 문장(사실)은 제목을 베껴쓰지 말고 해석을 얹을 것. 예: 제목이 "오픈AI 엔지니어 체포"라면 "내부자 위협 현실화."처럼 사건에 프레임을 씌울 것. "엔지니어가 체포됐다"는 리드 복사에 불과.
- 할 일은 구체적 행동으로: 누가 무엇을 해야 하는지 명시 ("도입 전 가격 비교 권장", "API 사용 중이면 폴백 로직 점검 필요").
- 금지: "~주시 필요", "~동향 주시", "~영향 주시", "~검토할 시점", "~검증해볼 시점", "~참고할 만함" 같은 관망형·모호한 어미. 막연한 표현으로 끝내지 말 것. 할 일 문장은 반드시 필요/검토/권장/주시/기회 중 하나로 끝낼 것. "확인."·"점검."으로만 끝내는 미완결 종결 금지 ("확인 필요"처럼 필요를 붙일 것).
- 제품·모델명은 한글 표기를 우선한다. 영문만으로 널리 쓰이는 이름(GPT-5, API 등)은 영문 그대로 쓴다. '영문(한글)' 병기는 쓰지 않는다.
- 원문 첫 문장·리드 복사 금지. 명령조(해라·하라) 금지.
- 에디토리얼 프레임: 사건에 의미를 부여하는 한 단어를 첫 문장에 넣을 것.
  - 파산/몰락: "활성 1200만 서비스도 수익성·안전 소송에 무너져." (X: "파산 보호를 신청하고 매각을 추진 중")
  - 데이터 집중: "정부 사업 데이터가 AI허브로 집결." (X: "학습데이터의 개방이 법적으로 묶임")
  - 병목: "AI 도구만으론 부서 간 협업·승인 병목이 생산성을 가로막음." (X: "도구 도입이 늘고 있다")
  - 비용 누적: "에이전트의 백그라운드 자율 실행이 조용히 비용을 누적시킴." (X: "에이전트가 실행된다")

요약 summary
- 3문장. 사실만. 시사점과 겹치지 말 것.`;

export function writeUser(
  entry: { title: string; source: string; sourceUrl: string; summary: string },
  card: FactCard,
  feedback?: { prevTitle: string; problems: string[] } | null,
): string {
  const fb = feedback
    ? `\n\n[재작성 지시] 직전 제목 "${feedback.prevTitle}"에 아래 문제가 있었다. 같은 사실을 유지하되 문제를 전부 고쳐서 다시 출력하라.\n${feedback.problems.map((p) => `- ${p}`).join("\n")}`
    : "";
  return `원문 제목: ${entry.title}
출처: ${entry.source}
링크: ${entry.sourceUrl}
발췌: ${entry.summary.slice(0, 500)}

사실 카드 (이 범위 밖의 사실을 만들지 말 것):
${JSON.stringify(card)}

예시(스타일만 복사, 내용 베끼지 말 것):
{"title":"오픈AI, 주요 신제품 출시 다음 주로 연기","takeaway":"대형 신제품 일주일 연기. 다음 주 발표에 맞춰 도입 계획 조정 필요.","summary":"오픈AI가 신제품 공개를 다음 주로 미뤘다. 데브데이 일정과 맞춘다. 기존 도입 일정을 한 주 뒤로 밀 여지가 있다.","usedNames":["오픈AI"]}
{"title":"오픈AI, 'AI 정렬 실패' 사례 보고 체계 구축","takeaway":"모델 안전성·투명성 검증 절차 강화. 정렬 문제 대응 공론화에 대비 필요.","summary":"오픈AI가 정렬 실패 사례를 추적해 공개하는 보고 체계를 마련했다. 예상 밖 모델 행동을 조사 대상으로 올린다. 안전 거버넌스 논의가 제품 일정에 붙을 수 있다.","usedNames":["오픈AI"]}
{"title":"협업툴 '플로우', 챗GPT·클로드 공식 앱 입점","takeaway":"국내 협업툴에서 챗GPT·클로드를 기본 연동할 수 있게 됨. 기업 워크플로우 적용 검토.","summary":"플로우가 챗GPT와 클로드 공식 앱을 등록했다. 메신저 안에서 두 모델을 호출한다. 국산 협업툴 중 공식 입점은 처음이다.","usedNames":["플로우","챗GPT","클로드"]}
{"title":"오픈AI, API 장문 입력 요금 인하","takeaway":"장문 컨텍스트 호출 비용 부담 완화. 대량 문서 처리 워크로드라면 새 요금제 적용 시점 확인.","summary":"오픈AI가 API 장문 입력 요금을 인하했다. 128K 이상 구간 단가가 조정된다. 기존 배치 작업의 비용 재산정이 가능하다.","usedNames":["오픈AI"]}
{"title":"앤트로픽, 클로드 API 장애 복구","takeaway":"2시간 장애 후 정상화. 클로드 API 연동 서비스는 장애 시간대 요청 누락 여부 점검.","summary":"앤트로픽 클로드 API에서 2시간 장애가 발생했다. 상태 페이지에 공지됐다. 현재는 정상화됐다.","usedNames":["앤트로픽","클로드"]}
{"title":"과기정통부, AI 기본법 시행령 입법예고","takeaway":"고영향 AI 의무 조항 세부 기준 공개. 해당 사업자는 의견 수렴 기간 내 적용 범위 주시.","summary":"과기정통부가 AI 기본법 시행령을 입법예고했다. 고영향 AI 판정 기준이 담겼다. 의견 수렴은 다음 달까지다.","usedNames":["과기정통부"]}
{"title":"슈나이더, 엔비디아 'GB300' 맞춤 전력 모듈 선봬","takeaway":"데이터센터 전력 장비 선택지 확대. 도입 예정 기업은 전력·냉각 요구 조건 비교 권장.","summary":"슈나이더가 GB300용 2.5MW 전력 모듈을 공개했다. 액체 냉각 대응 제품이다. 인프라 투자 계획이 있는 기업만 보면 된다.","usedNames":["슈나이더","엔비디아","GB300"]}
{"title":"게임 NPC 실시간 대화 구현 도구 'NPCTalk' 공개","takeaway":"오픈소스 NPC 대화 도구 등장. 유니티·언리얼 연동 예제가 있어 바로 실험해볼 기회.","summary":"NPCTalk가 공개됐다. 게임 NPC와 실시간 대화할 수 있는 오픈소스 도구다. 유니티와 언리얼 플러그인을 제공한다.","usedNames":["NPCTalk"]}

JSON 스키마:
{"title":"한국어 헤드라인","takeaway":"사실. 할 일.","summary":"3문장","usedNames":["제목에 쓴 고유명사 표기 그대로"]}${fb}`;
}

function hangulLen(s: string): number {
  return [...s].length;
}

function clipChars(s: string, max: number): string {
  if (hangulLen(s) <= max) return s;
  const cut = [...s].slice(0, max).join("");
  const marks = ["...", " · ", "·", ",", " "];
  let best = cut;
  for (const m of marks) {
    const i = cut.lastIndexOf(m);
    if (i >= Math.floor(max * 0.45)) {
      best = cut.slice(0, i);
      break;
    }
  }
  return best.replace(/[,\s·]+$/g, "").trim();
}

// HTML 엔티티 디코딩 (GLM 출력/RSS에 &amp; &quot; 등이 그대로 남는 경우)
// &amp;는 반드시 마지막에 디코딩 (이중 디코딩 방지: &amp;quot; → &quot; 리터럴 유지)
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&"); // &amp;는 마지막에
}

export function polishTitle(raw: string): string {
  // decodeEntities가 만드는 " (straight quote)는 기존 [""]→' 규칙과 충돌 없음 (curly만 대상)
  let t = decodeEntities(raw)
    .replace(/[“”]/g, "'")
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .replace(/^(속보|단독|종합|업데이트)\s*[|:：\-–]\s*/u, "")
    .trim();
  // 36차 재심 (Codex): "..." 부제 꼬리는 쉼표 치환으로 의미가 바뀌므로 여기서 고치지 않고
  // needsRewrite 트리거로 넘긴다 — LLM이 부제를 자르고 다시 쓰게.
  t = clipChars(t, 44);
  return t.slice(0, 56);
}

export function polishTakeaway(raw: string): string {
  let t = decodeEntities(raw)
    .replace(/[“”]/g, "'")
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    // 21차 루프3: GLM 괄호 아티팩트 정리 — 라틴괄호 제거보다 먼저 처리
    // "챗(클로드) 안에서" → "클로드 안에서". "Maia(마이아)"는 [가-힣]+에 안 걸려서 보존.
    .replace(/챗\((클로드|GPT)\)/g, "$1")
    // 32차: 확인된 병기 쌍만 한글로 (31차 패널 지적 2건).
    // 일반 규칙으로 "GPT-5(지피티)"까지 지우면 제품명이 사라져(크로스 리뷰)
    // 알려진 쌍만 맵으로 변환하고 나머지는 건드리지 않는다.
    .replace(/Claude Code\(클로드 코드\)/g, "클로드 코드")
    .replace(/Railway\(레일웨이\)/g, "레일웨이")
    .replace(/([가-힣]+)\(\1\)/g, "$1") // "인공지능(인공지능)" 같은 중복 제거
    .replace(/\([^)]*[A-Za-z][^)]*\)/g, "")
    .replace(/[A-Za-z]{3,}·[A-Za-z]{3,}/g, "")
    .replace(/것으로 보인다\.?/g, ".")
    .replace(/것으로 풀이된다\.?/g, ".")
    .replace(/전망이다\.?/g, "전망.")
    .replace(/(합니다|입니다|됩니다|있습니다)\./g, "다.")
    .replace(/점검해라\.?/g, "점검 필요.")
    .replace(/준비해야 한다\.?/g, "미리 준비할 것.")
    .replace(/([가-힣])해라\.?/g, "$1 필요.")
    .replace(/([가-힣])하라\.?/g, "$1 것.")
    .replace(/\s+/g, " ")
    .replace(/\.{2,}/g, ".")
    .trim();

  // 36차: "가." 종결도 문장 경계로 인정 — "오픈 웨이트 에이전트 모델 추가. 투게더..."
  // 같은 3문장 시사점이 parts.slice(0,2)를 우회하던 구멍 (35차 B09 미니맥스).
  let parts = t.split(/(?<=다\.|가\.|함\.|음\.|됨\.|필요\.|검토\.|권장\.|주시\.|전망\.|기회\.)\s+/u).filter((p) => p.trim());
  if (parts.some((p) => LEAD_HINT.test(p) && hangulLen(p) > 50)) {
    const action = parts.filter((p) => /필요|검토|권장|주시|기회|확인/.test(p));
    parts = action.length ? action.slice(0, 2) : parts.filter((p) => !LEAD_HINT.test(p)).slice(0, 2);
  }
  // 문장 경계 기준으로 자르기: 90자를 넘으면 두 번째 문장을 통째로 버림 (중간 절단 금지)
  // Claude 지적: clipChars가 문장 중간을 자르면서 서술어 탈락 파편 생성
  parts = parts.slice(0, 2);
  let combined = parts.join(" ").trim();
  if (hangulLen(combined) > 90 && parts.length > 1) {
    // 두 문장 합이 90자 초과 → 첫 문장만 사용 (완결성 우선)
    combined = parts[0].trim();
  }
  t = combined;
  // 그래도 90자 초과 시: 90자 이내의 마지막 문장 경계에서 자름 (중간 절단 절대 금지)
  if (hangulLen(t) > 90) {
    const truncated = [...t].slice(0, 90).join("");
    // 문장 종결 패턴 (다., 요., 필요., 권장. 등) 중 90자 내 마지막 위치 찾기
    const endPattern = /(다\.|함\.|음\.|됨\.|요\.|필요\.|검토\.|권장\.|주시\.|전망\.|기회\.)/gu;
    let lastEnd = -1;
    let m;
    while ((m = endPattern.exec(truncated)) !== null) {
      lastEnd = m.index + m[0].length;
    }
    if (lastEnd > 45) {
      // 45자 이후에 문장 경계가 있으면 거기서 자름
      t = truncated.slice(0, lastEnd).trim();
    } else {
      // 문장 경계가 없으면 연결어미(하니/으니/으며/고/면서/지만/는데)에서 자름
      // 예: "본격화하니 국산 챗봇." → "본격화했다." (연결어미 앞까지만)
      const connPattern = /(하니|으니|이며|이고|면서|지만|는데|해서|되어|되며|하고|거나|면|라면|거든|으니까|더라면|수록|아|어|여)\s*/gu;
      let lastConn = -1;
      let cm;
      while ((cm = connPattern.exec(truncated)) !== null) {
        lastConn = cm.index + cm[0].length;
      }
      if (lastConn > 30) {
        // 연결어미 앞 부분만 사용하고 문장 종결로 변환
        let head = truncated.slice(0, lastConn).trim();
        // 연결어미 제거하고 종결형으로
        head = head.replace(/(하니|으니|이며|이고|면서|지만|는데|해서|되어|되며|하고|거나|면|라면|거든|으니까|더라면|수록|아|어|여)\s*$/, "");
        // ",다." 버그 방지: 끝의 쉼표·불릿·특수문자 제거 후 종결형 추가
        head = head.replace(/[,·•\-–—:;]+$/, "").trim();
        // "·"로 시작하는 불릿 제거
        head = head.replace(/^[·•\-–—\s]+/, "").trim();
        if (!head) head = truncated.slice(0, lastConn).trim().replace(/[,·•\-–—:;]+$/, "").trim();
        t = head + (head.endsWith("다") ? "." : "다.");
      } else {
        // 연결어미도 없으면 마지막 공백에서 자름 (단어 중간 절단 금지)
        // 예: "국산 칩 스펙" → "국산 칩." (스펙을 스.로 자르지 않음)
        const lastSpace = truncated.lastIndexOf(" ");
        if (lastSpace > 30) {
          let head = truncated.slice(0, lastSpace).trim();
          // 끝의 쉼표·불릿 제거, "·" 시작 제거
          head = head.replace(/[,·•\-–—:;]+$/, "").trim();
          head = head.replace(/^[·•\-–—\s]+/, "").trim();
          // 마지막 단어가 조사/명사로 끝나면 완결형으로
          if (!/[.다함음요]$/.test(head)) head += "다.";
          t = head;
        } else {
          const firstSent = t.split(/(?<=다\.|함\.|음\.|됨\.|요\.)\s*/u)[0];
          t = firstSent && hangulLen(firstSent) <= 90 ? firstSent.trim() : truncated.trim();
        }
      }
    }
  }
  if (t && !/[.다함음요]$/.test(t)) t += ".";
  // fail-closed 게이트: 어떤 문장이라도 아티팩트가 있으면 첫 문장만 사용
  // 깨진 문장은 안 보여주는 게 낫다. 고치려 하지 말고 버림.
  // 검사: ",다." anywhere, "·" 시작 (어느 문장이든), 마지막 문장 미완결
  const sentences = t.split(/(?<=다\.|요\.|필요\.|검토\.|권장\.|확인\.|점검\.|주시\.|전망\.|기회\.)\s*/u).filter((s) => s.trim());
  const hasArtifact = sentences.some((s) => /,다\.|^[·•\-–—]/.test(s.trim())) ||
    (sentences.length > 0 && !/(다\.|요\.|필요\.|검토\.|권장\.|확인\.|점검\.|주시\.|전망\.|기회\.)$/.test(sentences[sentences.length - 1].trim()));
  if (hasArtifact && sentences.length > 1) {
    // 첫 문장이 깨끗하면 첫 문장만 사용
    const first = sentences[0].trim();
    if (!/,다\.|^[·•\-–—]/.test(first) && /(다\.|요\.|필요\.|검토\.|권장\.|확인\.|점검\.|주시\.|전망\.|기회\.)$/.test(first)) {
      t = first;
    }
  } else if (hasArtifact && sentences.length === 1) {
    // 단일 문장인데 아티팩트가 있으면 첫 문장을 완결형으로
    let first = sentences[0].trim().replace(/,다\./g, "다.").replace(/^[·•\-–—\s]+/, "").trim();
    if (!/(다\.|요\.)$/.test(first)) first = first.replace(/[,·•\-–—:;]+$/, "").trim() + "다.";
    t = first;
  }
  // 최종 정리: ",다." 제거, "·" 시작 제거
  t = t.replace(/,다\./g, "다.").replace(/,다$/g, "다.");
  t = t.replace(/^[·•\-–—\s]+/, "").trim();
  // 단어 중간 절단 방지: 마지막 단어가 1-2자로 잘린 것 같으면 제거
  // 예: "엣지 디바이스 펌웨다." → "엣지 디바이스." (펌웨는 "펌웨어"의 잘림)
  // 단, 정당한 1-2자 단어(것, 것, 수, 등)는 유지
  const words = t.split(/\s+/);
  if (words.length > 1) {
    const last = words[words.length - 1];
    // "펌웨다.", "스다." 같은 패턴: 2-3자 + "다." 이고, 앞 단어가 명사로 끝나면 잘림으로 판단
    const cutPattern = /^([가-힣]{1,2})다\.$/;
    const m = last.match(cutPattern);
    if (m && !/^(것|수|등|점|건|때|곳|일|년|월|주|개|명|차|번|등)$/.test(m[1])) {
      // 앞 문맥 확인: 잘린 단어가 명사구 뒤에 있으면 제거
      words.pop();
      t = words.join(" ");
      if (!/[.다함음요]$/.test(t)) t += ".";
    }
  }
  // 32차: bare "확인."/"점검." 종결을 저장 전에 완결형으로 (크로스 리뷰:
  // 교정 없이 needsRewrite만 켜면 재작성 큐에서 같은 항목이 반복된다).
  // X 경로의 fixBareEnding과 동일 규칙을 데스크 패스에도 적용.
  t = t.replace(
    /(?<!필요|권장|검토|주시|기회)\s*(확인|점검)\.\s*$/,
    (m, verb) => ` ${verb} 필요.`,
  ).trim();
  return t;
}

/** Phase 1: 중요도 점수 절대 하한 — 미달이면 쿼터(거버너 여유)가 남아도 승격 금지. */
export const IMPORTANCE_FLOOR = 70;

/** 하드 게이트의 결정론 근사 — needsRewrite가 [중요] 유지 타당성을 볼 때 쓴다.
 *  STRONG_HINT가 이미 커버하는 범주(장애·취약점·가격·공격) 외에, 신호 단어 없이도
 *  게이트로 승격되는 공급망·악성 패키지 패턴만 명시한다. */
export const HARD_GATE_HINT = /공급망|악성\s*(패키지|코드|모듈|라이브러리)|백도어/;

/**
 * Phase 1 등급 결정 (단일 기사 기준). LLM은 등급을 정하지 않는다.
 * 1) 하드 게이트 적중 → [중요] 보장. outage/price-today + 당일·진행 중이면 [속보].
 * 2) NOTE_FORCE(벤더 홍보·액세서리·지역 출시·M&A 논의) → [참고] (기존 과승격 교정 유지).
 * 3) 중요도 점수 ≥ IMPORTANCE_FLOOR 이고 강한 신호가 있을 때만 [중요] 후보.
 *    점수만으로 신호 없이 승격시키지 않는 이유: needsRewrite의 [중요] 타당성 검사가
 *    hasStrongSignal 기준이라, 신호 없는 [중요]는 재작성 큐에서 영원히 핑퐁한다.
 *    분포 조정(순위·쿼터)은 이 후보군 안에서 거버너(collect.ts)가 담당한다.
 */
export function decideGrade(
  card: FactCard,
  title: string,
  takeaway: string,
  originalTitle = "",
): Grade {
  const t = `${title} ${factPart(takeaway)}`;
  if (card.hardGate) {
    if (
      (card.hardGate === "outage" || card.hardGate === "price-today") &&
      card.immediate &&
      /장애|다운|중단|가격|인하|인상/.test(t)
    ) {
      return "breaking";
    }
    return "important";
  }
  if (forceNoteReason(title, takeaway)) return "note";
  if (card.importance >= IMPORTANCE_FLOOR && hasStrongSignal(title, takeaway, originalTitle)) {
    return "important";
  }
  return "note";
}

/**
 * Phase 2 후속 — 섀도 승격 판정 (등급 결정에 사용하지 않는다).
 *
 * decideGrade·needsRewrite의 현행 AND 게이트는 그대로 두고, 새 신호 체계가
 * 되었을 때 어떤 기사가 [중요]가 될지를 기록만 한다. 섀도 데이터가 150건
 * 쌓인 뒤에야 활성화 판정이 가능하다 — 이 함수의 결과가 150건 미만에서
 * 등급을 바꾸는 일은 없다.
 *
 * 승격 요건 (패널 채택): importance ≥ 70 + 확인된 사건(eventType) +
 * 구체적 영향 근거 1개 이상(impactBasis) + 원문 근거(evidence) 존재.
 * 투자액 단독·유형 해당 단독은 프롬프트 지시로 impactBasis에서 제외한다
 * (코드로 검증하지 않는다 — 150건 리뷰에서 검증).
 * NOTE_FORCE 강등 대상은 섀도에서도 승격하지 않는다.
 *
 * 티어: 제품 사건에서 프런티어 랩(FRONTIER_LAB) 주체가 아니면 B.
 * 투자액 규모(1억~10억 달러)와 주 단위 규제의 코드 단위 분리는 150건
 * 리뷰 과제로 남긴다 — 본 개정에서는 투자·규제 사건을 A로 기록한다.
 * hardGate 적중분은 이미 [중요]이므로 섀도 등급을 important로 미러링한다
 * (신규 승격 집계에서 자동 제외된다).
 */
export type ShadowAssessment = {
  tier: ShadowTier | "none";
  promotesA: boolean;
  promotesAB: boolean;
  shadowGrade: Grade;
};

export function assessShadow(
  card: Pick<FactCard, "importance" | "hardGate" | "eventType" | "impactBasis" | "evidence" | "entities">,
  title: string,
  takeaway: string,
  originalTitle = "",
): ShadowAssessment {
  if (card.hardGate) {
    return { tier: "A", promotesA: true, promotesAB: true, shadowGrade: "important" };
  }
  const eventType = card.eventType ?? null;
  if (!eventType) {
    return { tier: "none", promotesA: false, promotesAB: false, shadowGrade: "note" };
  }
  const actorText = `${(card.entities ?? []).join(" ")} ${title} ${originalTitle}`;
  const tier: ShadowTier =
    eventType === "product" && !FRONTIER_LAB.test(actorText) ? "B" : "A";
  const hasImpact =
    (card.impactBasis ?? []).length > 0 && Boolean(card.evidence && card.evidence.trim());
  const qualifies =
    card.importance >= IMPORTANCE_FLOOR &&
    hasImpact &&
    !forceNoteReason(title, takeaway);
  return {
    tier,
    promotesA: qualifies && tier === "A",
    promotesAB: qualifies,
    shadowGrade: qualifies && tier === "A" ? "important" : "note",
  };
}

/** 36차: [중요] 강등 강제 패턴. hasStrongSignal이 true여도 note로 내린다.
 *  (위협·unveil·Nemotron 같은 신호가 벤더 홍보·액세서리·지역 출시를 승격시키던 구멍)
 *  needsRewrite에서도 사용 — 기존 과승격분을 재작성 큐로 끌어내기 위해 export.
 *  36차 재심: 리콜·침해·유출·장애·제재 같은 강한 리스크 신호가 있으면 강등하지 않음
 *  ("서버랙 화재 위험으로 전량 리콜", "탐지율 조작 혐의로 제재" 반례 — Codex). */
const NOTE_FORCE: [RegExp, string][] = [
  // "테슬라·스페이스X 합병 논의 시작" — M&A 논의 단계는 루머성 지배구조 (완료된 건은 제외).
  // 설은 '설명' 오탐 방지용 경계 (Codex: "인수 완료 설명" 반례).
  [/(합병|인수|매각).{0,12}(논의|추진|검토|수순)|(?<![가-힣])(인수설|합병설|매각설)(?![가-힣])/, "M&A 논의"],
  // "슈나이더, 엔비디아 'GB300' 맞춤 2.5MW 전력 모듈 선봬" — 하드웨어 액세서리
  [/(전력\s*모듈|쿨링\s*시스템|냉각\s*장치|서버\s*랙|\bUPS\b)/, "HW 액세서리"],
  // "센티넬원, AI 위협 탐지 역량 1년 새 23배 확대" — 벤더 홍보성 역량 수치
  [/(역량|커버리지|탐지율|정확도).{0,12}(확대|강화|성장|달성|경신)/, "역량 홍보"],
  // "메타 AI 에이전트 '뮤즈' 일본 출시" — 지역 한정 출시
  [/(일본|유럽|동남아|인도|중동|남미|호주|캐나다).{0,24}(출시|진출|선봬|공개)/, "지역 출시"],
];

export function forceNoteReason(title: string, takeaway: string): string | null {
  // 36차 재심 v3 (Codex):
  // - 법안·규제 기사는 강등하지 않음 ("유럽, AI 법안 통과 및 적용 지침 공개" 반례).
  // - 리스크 가드는 제목 + 시사점(명사형 "공격자/위협의"는 제거 후 판정).
  //   "슈나이더, 서버랙 공급 계획 수정" + 시사점 "화재 위험으로 전량 리콜" 보존.
  if (/(법안|규제)/.test(title)) return null;
  if (RISK_HINT.test(title)) return null;
  // "(공격|위협)(자의|의|자)" 명사형 제거 — "공격자의 흔적"은 사건이 아님.
  // 36차 재심 v4 (Codex): 접미부 필수 — optional이면 "사이버 공격 발생."의 독립된
  // "공격"까지 지워져 RISK 보호가 무력화됨. "공격 발생"은 보호되어야 함.
  const takeawayRisk = factPart(takeaway).replace(/(공격|위협)(자의|의|자)(?![가-힣])\s*/g, "");
  if (RISK_HINT.test(takeawayRisk)) return null;
  const t = `${title} ${factPart(takeaway)}`;
  for (const [re, reason] of NOTE_FORCE) {
    if (re.test(t)) return reason;
  }
  return null;
}

/** 강한 중요 신호 (32차). 약한 정책 단어(규제·정책·법안·가이드라인 단독)는 제외.
 *  데이터셋·지도 공개는 리스크 신호가 동반될 때만 중요 후보가 된다
 *  (31차: 딥마인드 ForTy 삼림 지도 — 무료 데이터 공개가 [중요]로 과승격). */
const STRONG_HINT =
  /가격|인하|인상|침해|장애|중단|제재|유출|다운|수출 통제|계정 탈취|출시 연기|취약점|해킹|공격|소송|소환장|벌금|과징금|리콜|반독점|대규모 계약|대규모 투자|인수|합병|오픈소스 공개|벤치마크|신모델 출시|신모델 공개|신기록|주요 모델 출시|보안 경고|사이버 공격|AI 자가복제|웜|파산|상장|IPO|법안 통과/;
// 36차 재심: 쿼터·요금제는 변경 맥락과 결합될 때만 강한 신호.
// "AI 쿼터백 훈련 도구 공개" (Codex 반례) 같은 오탐 방지.
// 36차 재심 v3: "AI 쿼터백 훈련 기능 확대" — 쿼터(?!백)으로 쿼터백 제외.
const QUOTA_CHANGE_HINT =
  /(쿼터(?!백)|요금제).{0,12}(축소|확대|인상|인하|변경|제한|조정|개편)|(축소|확대|인상|인하|변경|제한).{0,12}(쿼터(?!백)|요금제)/;
const DATASET_RELEASE = /지도|데이터셋|데이터 세트|말뭉치|코퍼스/;
const RISK_HINT = /침해|유출|장애|중단|가격|인하|인상|제재|소송|소환장|취약점|해킹|공격|연기|단종|벌금|과징금|리콜/;

export function hasStrongSignal(title: string, takeaway: string, originalTitle = ""): boolean {
  const t = `${title} ${factPart(takeaway)}`;
  if (STRONG_HINT.test(t)) return true;
  // 36차: 쿼터·요금제 변경 ("클로드 오퍼스 5.5 이용량 쿼터 몰래 축소 의혹" — 35차 Grok 과소 지적)
  if (QUOTA_CHANGE_HINT.test(t)) return true;
  // 데이터셋·지도 공개는 그 자체(프런티어 이벤트 경로)만으로 승격하지 않는다.
  // 단, 법안 통과·제재 같은 명시적 강한 신호가 있으면 그 경로는 그대로 인정
  // (32차 크로스 리뷰: "데이터셋 공개 의무화 법안 통과"까지 막는 모순 교정).
  if (DATASET_RELEASE.test(title) && !RISK_HINT.test(t)) return false;
  return isFrontierEvent(title, takeaway, originalTitle);
}

export function shouldDrop(title: string, summary: string): boolean {
  return (
    DROP_HINT.test(title) ||
    DROP_HINT.test(summary) ||
    TITLE_DROP_HINT.test(title) ||
    titleCultureDrop(title)
  );
}

// 단어 중간 절단 아티팩트 (LLM이 음절을 떨어뜨린 경우 — 예: "펌웨어다" → "펌웨다", "현실화" → "현실회")
// 17차 P0: "[중요] 앤트로픽" 시사점 "…엣지 디바이스 펌웨다." 7라운드 잔존.
// dedupe 승자라 삭제 대상이 아니고, 기존 파편 검사(완결 어미 기준)는
// "펌웨다."를 정상 종결로 통과시켜서 별도 감지가 필요함.
// 20차: 제목 절단("…자기개선 루프 현실회")도 감지 — needsRewrite에서 제목도 검사.
// (?![복피]) — "현실회복"/"현실회피" 같은 정상 단어 오탐 방지. 절단 아티팩트는
// 뒤에 복/피가 올 수 없음 ("현실화"의 음절 탈락이므로).
// 향후 발견되는 패턴은 여기에 누적.
const TRUNCATED_HINT = /펌웨다|현실회(?![복피])|다다\.|요요\.|됨됨\.|니다다\.|것\.다\./;

function looksTruncated(s: string): boolean {
  return TRUNCATED_HINT.test(s ?? "");
}

// HTML 엔티티 잔존 — 제목/시사점에 `&quot;`, `&amp;` 등이 그대로 노출된 경우.
// 21차 P0: `&quot;` 4건이 46자 미만이라 재작성 큐에 안 들어감.
// decodeEntities는 신규 유입에만 적용되므로 기존분은 재작성으로 정리.
// decodeEntities가 처리하는 엔티티와 일치시킬 것 (&apos; 포함).
const ENTITY_HINT = /&(quot|amp|apos|lt|gt|#\d+);/;

// 24차 P0: 외래 고유명사 오타 — "앤스로픽"이 3라운드 연속 rewriteStale 큐에 정체.
// needsRewrite에서 직접 감지해야 재작성 대상이 됨.
// 27차: "노려는" 추가 — X 경로 기존 기사 처리용.
// 29차: "대익" 추가 — Grok 발견: "보안 위협 대익 자동화" (대응 오기).
// 단독 단어로 공백 사이에 있을 때만 — "김대익" 같은 인명 오교정 방지 (29차 크로스 리뷰 재현).
// 36차: 35차 패널 발견분 — 지미니(제미나이), 토효율(토큰 효율), 킴이(키미),
// 칸바(캔바, 34차 교정은 있었으나 힌트 누락), 스모그-네모트론(Smaug 오역).
// 36차 재심 (Codex): 인명·일반명사 오교정 방지 — 제품 문맥이 확인될 때만.
// 킴이는 K3.1/모델/버전이 뒤따를 때만, 지미니는 "구글 지미니"일 때만,
// 토효율은 단독 단어일 때만 ("국토효율" 보호).
const TYPO_HINT = /앤스로픽|클로드\(챗\)|챗\(클로드\)|노려는|시크릟|휴깅페이스|제약가(?=\s|$)|스노우플레이스|(?<=\s)대익(?=\s)|구글 지미니|지미니(?=\s*(,|지도|검색|캘린더|앱|구글|기능|$))|(?<![가-힣])토효율(?![가-힣])|킴이(?=\s*['"‘’“”]?\s*[Kk]\d)|칸바(?=[\s,·ㆍ:])|스모그-네모트론/i;

export function needsRewrite(
  item: Pick<NewsItem, "title" | "takeaway" | "summary" | "grade" | "originalTitle">,
): boolean {
  if (shouldDrop(item.title, item.summary)) return true;
  if (hangulLen(item.title) > 46) return true;
  // 32차: 제목 하한 (31차 패널: 28자 미만 12건). 데스크 규격 28~44자.
  // 34차: 33차 패널이 원문 길이(공백·기호 포함) 기준으로 재니 하한 미달이
  // 25%였다 — hangulLen 27이면 원문 27자일 수 있어 임계를 28로 올린다.
  if (hangulLen(item.title) < 28) return true;
  // 36차: "..." 부제 꼬리 — "파이어웍스, 'M3.1 Flash' 서버리스 출시...M3 절반 가격"
  // (35차 패널: 부제·수치 꼬리 금지 위반). 여기서 자르지 않고 재작성 큐로.
  // 36차 재심 v3: 짧은 꼬리("...무료")도 감지 — 끝의 ... 뒤에 내용이 있으면 전부.
  if (/\.\.\.\s*.+$/.test(item.title)) return true;
  if (hangulLen(item.takeaway) > 95) return true;
  if (LEAD_HINT.test(item.takeaway) && hangulLen(item.takeaway) > 55) return true;
  if (/해라|하라/.test(item.takeaway)) return true;
  if (/[A-Za-z]{4,}·[A-Za-z]{4,}/.test(item.takeaway)) return true;
  // 16차: 힌트 검사는 시사점 사실 부분만 (할 일 상용구 오탐 방지).
  // 32차: 등급 결정과 동일하게 hasStrongSignal 단일 기준으로 통일 (핑퐁 방지).
  // Phase 1: 하드 게이트(공급망·악성 패키지) 승격분은 신호가 없어도 [중요] 유지가
  // 정상이므로 재작성 대상에서 제외한다 (decideGrade와 정합).
  if (
    item.grade === "important" &&
    !hasStrongSignal(item.title, item.takeaway, item.originalTitle) &&
    !HARD_GATE_HINT.test(`${item.title} ${factPart(item.takeaway)}`)
  )
    return true;
  // 36차: NOTE_FORCE 강등 대상도 재작성 큐로 — 기존 과승격분(B01/B07/B08/B24류)이
  // 등급 결정에서 note로 내려가게. 없으면 영원히 [중요]로 잔류함.
  // Phase 1 (Codex 리뷰 P2): 하드 게이트 승격분은 decideGrade와 우선순위를 맞춰
  // 면제한다 — 겹치면 재작성할 때마다 중요로 돌아와 큐에 영원히 남는다.
  if (
    item.grade === "important" &&
    forceNoteReason(item.title, item.takeaway) &&
    !HARD_GATE_HINT.test(`${item.title} ${factPart(item.takeaway)}`)
  )
    return true;
  // 승격: [참고]인데 강한 중요 신호가 있으면 재작성 → polishGrade 승격 로직이 적용됨
  // (기존 [참고] 기사는 승격 로직 배포 전 분류분이라 재작성이 필요)
  // 36차 재심 (Codex): NOTE_FORCE 강등 대상은 승격 재작성에서 제외 — 강등 후에도
  // 재작성 대상으로 남아 예산을 반복 소비하던 핑퐁 방지.
  if (
    item.grade === "note" &&
    !forceNoteReason(item.title, item.takeaway) &&
    hasStrongSignal(item.title, item.takeaway, item.originalTitle)
  )
    return true;
  // 파편 시사점: 아티팩트 패턴이면 무조건 재작성 (길이 조건 제거 — Claude 발견: 파편은 짧아서 기존 조건에 안 걸림)
  // ",다.", "·" 시작, 조사/명사 단독 종결, 단어 중간 절단
  const takeaway = item.takeaway.trim();
  if (/,다\.|^[·•\-–—]/.test(takeaway)) return true;
  // 17차 P0: 단어 중간 절단 아티팩트("펌웨다.", "다다." 등)는 무조건 재작성
  // 20차: 제목도 검사 ("현실회" 같은 제목 음절 탈락)
  if (looksTruncated(item.title) || looksTruncated(takeaway) || looksTruncated(item.summary)) return true;
  // 21차 P0: HTML 엔티티 잔존 — decodeEntities는 신규 유입에만 적용되므로 기존분은 재작성으로 정리
  if (ENTITY_HINT.test(item.title) || ENTITY_HINT.test(item.takeaway)) return true;
  // 24차 P0: 외래 고유명사 오타 — "앤스로픽"이 3라운드 연속 rewriteStale 큐에 정체
  if (TYPO_HINT.test(item.title) || TYPO_HINT.test(item.takeaway)) return true;
  // 마지막 문장이 조사(에/의/를/을/가/이/와/과/로/에서/에게)로 끝나면 파편
  if (/(에|의|를|을|가|이|와|과|로|에서|에게|한테|보다|처럼)\.$/.test(takeaway)) return true;
  // 마지막 문장이 명사 단독으로 끝나면 파편 (예: "국산 챗봇.", "가격·성능.", "해당 지역.")
  // 단, 완결형 어미(다./요./필요./권장./검토./확인./점검.)로 끝나면 완결
  // 36차: 가\.도 경계로 (polishTakeaway와 동일 — 3문장 시사점이 어미 검사를 우회하던 구멍)
  const sentences = takeaway.split(/(?<=다\.|가\.|요\.|필요\.|검토\.|권장\.|확인\.|점검\.|주시\.|전망\.|기회\.)\s*/u);
  const lastSent = sentences[sentences.length - 1]?.trim() ?? "";
  if (lastSent && !/(다\.|요\.|필요\.|검토\.|권장\.|확인\.|점검\.|주시\.|전망\.|기회\.)$/.test(lastSent)) {
    // 마지막 문장이 완결 어미로 안 끝나면 파편 (길이 무관)
    // 단, 동사형 종결(진출., 확대., 강화., 묶임., 지목됨.)은 완결로 인정
    if (!/(출|입|화|강|약|임|됨|남|됨|됨|씀|옴|감|남|됨|됨|됨)\.$/.test(lastSent)) {
      return true;
    }
  }
  // 20차: 시사점 마지막 문장이 할 일 어미로 끝나지 않으면 재작성
  // "…몰릴 수 있다.", "…진입.", "…해야 한다." 같은 사실 서술형 결말 방지
  // 32차: 허용 어미를 AGENTS.md 기준 5종(필요/검토/권장/주시/기회)으로 통일.
  // bare "확인."/"점검."은 미완결로 본다 (31차 패널: 어미 위반 3건이 전부 이 케이스).
  // "확인 필요."처럼 필요로 끝나면 통과한다.
  if (lastSent && !/(필요|검토|권장|주시|기회)\.$/.test(lastSent)) return true;
  // 21차 루프3: bare "점검."/"확인." + 조건문(면/거든/다면) → 미완결로 보고 재작성
  // "있다면 … 점검." (미완결) vs "보안 설정을 재점검." (정상)
  // (?![을를이가은는의에로와과도만]) — "화면을/화면에서" 같은 명사+조사 오탐 방지
  // (?<![화측장단양전후내외표반국대]) — "양면 인쇄", "화면 확인" 같은 명사+면 오탐 방지
  // 주의: [^.]*$ 형태는 시사점이 항상 "."로 끝나서 매칭 불가 — 조건문 존재만 검사
  if (
    lastSent &&
    /(점검|확인)\.\s*$/.test(lastSent) &&
    /(?<![화측장단양전후내외표반국대])(면|거든|다면)(?![을를이가은는의에로와과도만])/.test(lastSent)
  )
    return true;
  return false;
}

// 26차 P0: 재작성 출력 후처리 오타 교정 — Codex 발견: TYPO_HINT로 감지는 되나
// 모델이 오타난 제목을 입력으로 받아 새 시사점에도 오타를 답습함.
// polishPayload에서 최종 출력 전에 교정.
const TYPO_FIX: [RegExp, string][] = [
  [/앤스로픽/g, "앤트로픽"],
  [/챗\(클로드\)/g, "클로드"],
  [/클로드\(챗\)/g, "클로드"],
  // 26차: Gemini 발견 "노려는" → "노리는"
  [/노려는/g, "노리는"],
  // 29차: Grok 발견 "대익" → "대응" ("보안 위협 대익 자동화").
  // 공백 사이의 단독 사용만 교정 — 인명("김대익") 오교정 방지.
  [/(?<=\s)대익(?=\s)/g, "대응"],
  // 31차: 패널 발견 "시크릟" → "시크릿" (레일웨이 유출 기사 시사점).
  [/시크릟/g, "시크릿"],
  // 32차: 표기 통일 — "휴깅페이스" → "허깅페이스" (X 경로는 DISPLAY_NAME_MAP이,
  // RSS·재작성 경로는 여기가 담당).
  [/휴깅페이스/g, "허깅페이스"],
  // 34차: 33차 패널 발견 — "제약가"(제약이), "스노우플레이스"(스노우플레이크),
  // "칸바"(캔바, Canva 한국 표기). "칸바스"(캔버스)와 충돌 방지 lookahead.
  // 34차: "제약가"는 공백·문장 끝 앞일 때만 (제약가격→제약이격 오교정 방지 —
  // Codex 반례), "칸바"는 구분자 앞일 때만 (인명 등 고유명사 보호).
  [/제약가(?=\s|$)/g, "제약이"],
  [/스노우플레이스/g, "스노우플레이크"],
  [/칸바(?=[\s,·ㆍ:])/g, "캔바"],
  // 36차: 35차 패널 발견 — "킴이"→키미 (원본 표기 Kimi K3.1(키미)), "스모그-네모트론"→스마우그-네모트론
  // (Smaug는 /smaʊɡ/ — 스모그는 smog). 36차 재심: 킴이는 K3.1/모델/버전이 뒤따를 때만
  // ("스티브 킴이" 인명 보호), 지미니는 "구글 지미니"일 때만, 토효율은 단독 단어일 때만.
  [/구글 지미니/g, "구글 제미나이"],
  [/지미니(?=\s*(,|지도|검색|캘린더|앱|구글|기능|$))/g, "제미나이"],  // 36차 실측: "지미니, 구글" — "지미니 크리켓"은 보호
  [/(?<![가-힣])토효율(?![가-힣])/g, "토큰 효율"],
  [/킴이(?=\s*['"‘’“”]?\s*[Kk]\d)/g, "키미"],  // 36차 실측: 따옴표 허용 ("킴이 'K3.1'")
  [/스모그-네모트론/gi, "스마우그-네모트론"],
];

function fixTypos(s: string): string {
  let out = s;
  for (const [re, rep] of TYPO_FIX) out = out.replace(re, rep);
  return out;
}

// 28차 P0: X ingest 경로에서 사용 — desk 품질 게이트
export { fixTypos };

// ============================================================================
// Phase 1: 엔티티 잠금 (plan-final.md Phase 1)
// 한글 음역은 등록 표기(ENTITY_FORMS)만 허용하고, 없으면 라틴 표기를 유지한다.
//
// 설계 근거 (실측 보정): "제목의 모든 한글 토큰을 허용 집합과 대조"하는 전면
// 허용목록 방식은 실제 제목 90건(양쪽 RSS)으로 보정한 결과 89건이 오탐이었다 —
// 한국어 제목 어휘(전략·도구·소진 같은 일반 단어)를 사전으로 열거할 수 없기
// 때문이다. 그래서 잠금은 피해가 실증된 두 채널로 구조화한다.
//  1) 근접 오형 검출: 등록 표기와 편집거리 가까운 한글 토큰(지미니↔제미나이,
//     킴이↔키미, 스모그↔스마우그, 휴깅↔허깅, 앤스로픽↔앤트로픽)은 오역·오타로
//     보고 위반 처리한다. 원문(한국어 출처)에 그대로 있는 토큰은 면제.
//  2) usedNames 추적: Pass 2가 제목에 쓴 고유명사를 스스로 선언하게 하고,
//     각 표기가 카드 entities·등록 표기·원문 중 하나로 추적되지 않으면 위반.
//     임의 음역(레일웨이식 신규 음역 포함)은 여기서 걸린다.
// 오타 사전(TYPO_FIX)에 표제어를 추가하는 패치는 이 구조로 대체하고 중단한다
// (36차가 마지막 — plan-final.md 중단 목록). ENTITY_FORMS의 등록분은 기존
// 음역 사전(normalizeProductNames·DISPLAY_NAME_MAP·데스크 표기 고정·
// polishTakeaway 병기 교정)에서 이미 확정된 표기의 이관이다.
// ============================================================================

/** 데스크 등록 표기 (라틴 원형 → 한글 표기). 여기 없는 외래 이름은 라틴 유지. */
export const ENTITY_FORMS: [string, string][] = [
  ["Gemini", "제미나이"],
  ["Kimi", "키미"],
  ["Canva", "캔바"],
  ["Smaug", "스마우그"],
  ["Anthropic", "앤트로픽"],
  ["Hugging Face", "허깅페이스"],
  ["DeepSeek", "딥시크"],
  ["DeepMind", "딥마인드"],
  ["NVIDIA", "엔비디아"],
  ["Google", "구글"],
  ["Meta", "메타"],
  ["Apple", "애플"],
  ["Amazon", "아마존"],
  ["Tesla", "테슬라"],
  ["Disney", "디즈니"],
  ["Microsoft", "마이크로소프트"],
  ["OpenAI", "오픈AI"],
  ["ChatGPT", "챗GPT"],
  ["Claude", "클로드"],
  ["Grok", "그록"],
  ["Llama", "라마"],
  ["Mistral", "미스트랄"],
  ["Qwen", "큐원"],
  ["Codex", "코덱스"],
  ["Cursor", "커서"],
  ["Railway", "레일웨이"],
  ["Opus", "오퍼스"],
  ["Cognition", "코그니션"],
  ["Snowflake", "스노우플레이크"],
  ["Nemotron", "네모트론"],
  ["a16z", "에이16지"],
  ["ForTy", "포티"],
  ["Argon", "아르곤"],
];

/** 한글 토큰 추출 (2자 이상 연속 한글). */
function hangulTokens(s: string): string[] {
  return s.match(/[가-힣]{2,}/g) ?? [];
}

/** 등록 표기의 한글 토큰 집합 (근접 오형 검출의 기준). */
const REGISTERED_HANGUL_TOKENS = new Set(
  ENTITY_FORMS.flatMap(([, hangul]) => hangulTokens(hangul)).filter((t) => t.length >= 2),
);

function levenshtein(a: string, b: string): number {
  const ac = [...a];
  const bc = [...b];
  let prev = Array.from({ length: bc.length + 1 }, (_, i) => i);
  for (let i = 1; i <= ac.length; i++) {
    const cur = [i];
    for (let j = 1; j <= bc.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ac[i - 1] === bc[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[bc.length];
}

/** 근접 오형 검출에서 면제하는 일반 외래어 — 등록 표기와 음절이 겹치는
 *  보통명사라 오형이 아니다 (클라우드↔클로드, 스마트↔스마우그). */
const NEAR_MISS_EXEMPT = new Set(["클라우드", "스마트"]);

/**
 * 등록 표기의 근접 오형인지 판정한다.
 * 실측 보정 (양쪽 RSS 제목 90건): 편집거리 ≤2 전면 적용은 코드↔코덱스,
 * 구독↔구글 같은 무관한 단어까지 57건을 오탐했다. 그래서 규칙을 좁힌다.
 * - 2음절 등록형(구글·키미·메타 등)은 대상에서 제외 — 그 오형(킴이·칸바)은
 *   TYPO_HINT 린트와 usedNames 추적이 담당한다.
 * - 같은 길이: 편집거리 ≤1 (앤스로픽↔앤트로픽, 휴깅페이스↔허깅페이스).
 * - 길이 차 1: 음절 겹침 ≥2/3 + 편집거리 ≤2 (스모그↔스마우그).
 * - 등록 표기로 시작하는 복합어(오픈소스·캔버스)는 면제.
 * 지미니(↔제미나이, 편집거리 3)는 이 검출이 아니라 TYPO_HINT와
 * usedNames 추적(카드에 없는 표기)이 잡는다.
 */
function isNearMissVariant(token: string, registered: string): boolean {
  if (token.length < 3 || registered.length < 3) return false;
  if (token === registered) return false;
  if (NEAR_MISS_EXEMPT.has(token)) return false;
  // 등록 토큰으로 시작하는 복합어(오픈소스·구글링·캔버스)는 그 자체로 면제
  for (const head of REGISTERED_HANGUL_TOKENS) {
    if (head.length >= 2 && token.startsWith(head)) return false;
  }
  const lenDiff = Math.abs(token.length - registered.length);
  if (lenDiff > 1) return false;
  if (lenDiff === 0) {
    if (levenshtein(token, registered) > 1) return false;
    // 치환된 음절이 자소(초성 또는 중성)를 공유할 때만 오형으로 본다 —
    // "딥테크↔딥시크"처럼 자소가 전부 다른 실재 외래어를 오탐하지 않기
    // 위해서다 (Codex 리뷰 21차 P2).
    const a = [...token];
    const b = [...registered];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const ca = a[i].codePointAt(0)! - 0xac00;
      const cb = b[i].codePointAt(0)! - 0xac00;
      if (ca < 0 || cb < 0) return false;
      const choSame = Math.floor(ca / 588) === Math.floor(cb / 588);
      const jungSame = Math.floor((ca % 588) / 28) === Math.floor((cb % 588) / 28);
      if (!choSame && !jungSame) return false;
    }
    return true;
  }
  // 길이 차 1: 첫 음절이 같고(스모그↔스마우그) 음절 겹침 ≥2/3 + 편집거리 ≤2.
  // 첫 음절 조건이 없으면 레트로↔앤트로픽(트·로 우연 겹침) 같은 오탐이 생긴다.
  if (token[0] !== registered[0]) return false;
  const regSyllables = [...registered];
  const common = [...token].filter((ch) => {
    const i = regSyllables.indexOf(ch);
    if (i < 0) return false;
    regSyllables.splice(i, 1);
    return true;
  }).length;
  if (common * 3 < 2 * Math.min(token.length, registered.length)) return false;
  return levenshtein(token, registered) <= 2;
}

/** 제목에서 등록 표기의 근접 오형 토큰을 찾는다 (엔티티 잠금 채널 1). */
export function findNearMissEntities(title: string, sourceText: string): string[] {
  const bad: string[] = [];
  for (const token of hangulTokens(title)) {
    if (REGISTERED_HANGUL_TOKENS.has(token)) continue;
    if (sourceText.includes(token)) continue; // 원문이 쓴 표기는 원문 표기로 인정
    for (const registered of REGISTERED_HANGUL_TOKENS) {
      if (isNearMissVariant(token, registered)) {
        if (!bad.includes(token)) bad.push(token);
        break;
      }
    }
  }
  return bad;
}

const GENERIC_LATIN_WORDS = new Set([
  "ai", "api", "llm", "gpu", "sdk", "os", "ui", "pc", "it",
  "us", "uk", "eu", "un", "ceo", "cto", "cfo",
  "app", "web", "the", "and", "for", "with", "new", "data",
]);

const nameNorm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 라틴 이름이 단어 경계로 등장하는가 — "metadata"가 "Meta" 등장으로
 *  오인되지 않게 경계를 검사한다 (Codex 리뷰 2차 P1). */
function latinAppears(text: string, latin: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(latin)}(?![A-Za-z0-9])`, "i").test(text);
}

/** 이 기사에 실제로 등장한 등록 표기 쌍만 추린다 (Codex 리뷰 P1:
 *  등록 사전 전체를 허용하면 기사에 없는 회사명을 새로 넣어도 통과한다). */
function presentRegisteredPairs(
  card: FactCard,
  entry: { title: string; summary: string },
): [string, string][] {
  const sourceText = `${entry.title} ${entry.summary}`;
  // hangulForms는 모델 선언일 뿐 독립 근거가 아니다 — 대응 라틴명이
  // 원문·entities에 있거나, 한글 표기 자체가 원문에 있을 때만 등장으로
  // 인정한다 (Codex 리뷰 14차 P1).
  return ENTITY_FORMS.filter(
    ([latin, hangul]) =>
      latinAppears(sourceText, latin) ||
      card.entities.some((e) => latinAppears(e, latin)) ||
      hangulNameAppears(sourceText, hangul),
  );
}

const PARTICLE_SUFFIXES = [
  "에서는", "으로는", "까지는", "에서도", "이라고", "라는", "가", "는", "은", "이",
  "을", "를", "의", "와", "과", "도", "만", "에", "에서", "으로", "로", "부터",
  "까지", "처럼", "보다", "께", "한테", "에게", "랑", "조차", "마저",
];

/** 토큰 전체가 숫자+측정 단위(+조사)인 형태 — 이름 후보에서 제외한다. */
const MEASURE_TOKEN_RE = new RegExp(
  `^\\d[\\d,]*(?:\\.\\d+)?(ms|gb|mb|tb|kb|mw|kw|ghz|mhz|khz|hz|mm|cm|km|kg|fps|rpm|px|달러|원|유로|토큰|밀리초|시간|개|건|명|회|종|위|점|배|%)(${[...PARTICLE_SUFFIXES].sort((a, b) => b.length - a.length).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})?$`,
  "i",
);

const REGISTERED_FORM_STRINGS = ENTITY_FORMS.map(([, hangul]) => hangul);
const MIXED_REGISTERED_FORMS = REGISTERED_FORM_STRINGS.filter((h) => /[A-Za-z0-9]/.test(h));

/** 한글 이름이 독립 표기(또는 조사 결합)로 등장했는지 — 부분 문자열
 *  ("파이프라인" 속 "라인", "메타데이터" 속 "메타")은 등장이 아니다
 *  (Codex 리뷰 15차 P1). */
function hangulNameAppears(text: string, name: string): boolean {
  if (/[A-Za-z0-9]/.test(name)) return mixedFormAppears(text, name);
  return hangulTokens(text).some(
    (t) => t === name || (t.startsWith(name) && PARTICLE_SUFFIXES.some((p) => t === name + p)),
  );
}

/** 혼합형 등록 표기(오픈AI·챗GPT·에이16지)가 텍스트에 등장했는지 — 한글
 *  토큰으로 쪼개면 "오픈"만 남아 "오픈소스" 같은 무관한 단어에 걸린다
 *  (Codex 리뷰 8차 P1). 전체 표기 + 조사 결합까지만 등장으로 본다. */
/** 혼합형 등록 표기의 유효 등장 위치들 — 양쪽 경계를 본다. 왼쪽에 글자가
 *  붙으면 더 큰 이름의 일부("슈퍼챗GPT")이고, 오른쪽은 조사 뒤에 경계가
 *  있어야 한다("오픈AI도우미"는 "오픈AI"+"도"가 아니다) (Codex 17·20차). */
function mixedFormOccurrences(text: string, form: string): number[] {
  const afterSuffixes = [...PARTICLE_SUFFIXES, "용"];
  const out: number[] = [];
  let idx = text.indexOf(form);
  while (idx >= 0) {
    const prev = idx > 0 ? text[idx - 1] : "";
    if (!(prev && /[A-Za-z0-9가-힣]/.test(prev))) {
      const rest = text.slice(idx + form.length);
      if (!rest) out.push(idx);
      else {
        const next = rest[0];
        if (/[^A-Za-z0-9가-힣]/.test(next)) out.push(idx);
        else if (/[가-힣]/.test(next)) {
          const ok = afterSuffixes.some((p) => {
            if (!rest.startsWith(p)) return false;
            const after = rest[p.length] ?? "";
            return !after || /[^가-힣]/.test(after);
          });
          if (ok) out.push(idx);
        }
      }
    }
    idx = text.indexOf(form, idx + 1);
  }
  return out;
}

function mixedFormAppears(text: string, form: string): boolean {
  return mixedFormOccurrences(text, form).length > 0;
}

/** 텍스트에서 고유명사 후보를 뽑는다 — 등록 한글형은 조사 결합형("메타가")도
 *  잡고, 라틴은 소문자 시작("fakegpt")·2글자("HP")도 후보에 넣는다
 *  (Codex 리뷰 5·6차 P1). */
function candidateNames(text: string): string[] {
  const hTokens = hangulTokens(text);
  return [
    ...[...REGISTERED_HANGUL_TOKENS].filter((r) =>
      hTokens.some(
        (t) => t === r || (t.startsWith(r) && PARTICLE_SUFFIXES.some((p) => t === r + p)),
      ),
    ),
    // 한국 고유명사도 후보다 — 근거 없는 회사명을 중간에 끼워 넣는 우회
    // 차단 (Codex 리뷰 15차 P1).
    ...[...NATIVE_KOREAN_NAMES].filter((n) => hangulNameAppears(text, n)),
    // 혼합 토큰 전체("슈퍼챗GPT")도 후보다 — 내부 라틴만으로는 전체 이름의
    // 추적성을 보장할 수 없다 (Codex 리뷰 21차 P1).
    ...text
      .split(/[\s,·"“”'‘’()[\]「」]+/u)
      .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
      // 숫자로 시작하는 혼합 토큰("16GB로")은 측정 표기라 이름 후보가
      // 아니다 (Codex 리뷰 22차 P1). 숫자가 뒤에 붙은 이름("슈퍼GPT-5")은
      // 후보로 남긴다 (Codex 리뷰 23차 P1).
      // 토큰 전체가 숫자+측정 단위(+조사)인 경우("16GB로"·"16GB에서")만
      // 제외한다 — 단위 뒤에 이름이 붙은 토큰("24시간AI"·"16GB봇")은
      // 후보로 남긴다 (Codex 리뷰 24~26차 P1/P2).
      .filter(
        (t) =>
          /[가-힣]/.test(t) && /[A-Za-z]/.test(t) && !MEASURE_TOKEN_RE.test(t),
      )
      .map((t) => stripParticle(t))
      // 조사 제거 후 순수 라틴 약어("AI를"→"AI")는 이름 후보가 아니다
      // (Codex 리뷰 27차 P2).
      .filter(
        (t) =>
          !/^[A-Za-z]+$/.test(t) ||
          (!GENERIC_LATIN_WORDS.has(t.toLowerCase()) && !LATIN_UNITS.has(t.toLowerCase())),
      ),
    ...MIXED_REGISTERED_FORMS.filter((f) => mixedFormAppears(text, f)),
    ...(text.matchAll(/[A-Za-z][A-Za-z0-9.-]{1,}/g) ?? [])
      // 후행 구두점을 먼저 제거한 길이로 겹침을 판정한다 ("챗GPT."의 "GPT.")
      // (Codex 리뷰 11차 P2).
      .map((m) => ({ word: m[0].replace(/[.-]+$/, ""), index: m.index }))
      // 수치에 붙은 단위("10ms"·"16GB"·"2.5MW")는 이름이 아니다 (Codex 9차 P1).
      .filter((c) => !(c.index > 0 && /[\d.]/.test(text[c.index - 1])))
      // 혼합 등록형 내부의 라틴 부분("챗GPT" 속 "GPT")은 독립 후보가 아니다
      // — 단, 유효 등장 구간 안에서만 제외한다. "슈퍼챗GPT"처럼 경계가
      // 무효한 등장은 제외 근거가 되지 않는다 (Codex 리뷰 10·20차 P1).
      .filter((c) => {
        const end = c.index + c.word.length;
        return !MIXED_REGISTERED_FORMS.some((f) =>
          mixedFormOccurrences(text, f).some(
            (idx) => c.index >= idx && end <= idx + f.length,
          ),
        );
      })
      .map((c) => c.word)
      .filter(
        (w) =>
          w.length >= 2 &&
          !GENERIC_LATIN_WORDS.has(w.toLowerCase()) &&
          !LATIN_UNITS.has(w.toLowerCase()),
      ),
  ];
}

const LATIN_UNITS = new Set([
  "ms", "gb", "mb", "tb", "kb", "mw", "kw", "ghz", "mhz", "hz", "mm", "cm", "km", "kg", "fps", "rpm",
]);

/** 한국 고유명사 — 외국 이름의 음역이 아니라 원래 한글로 쓰는 이름이라
 *  잠금 대상이 아니다 (삼성전자·카카오 등). 단, 무조건 면제가 아니라 대응
 *  라틴명이 원문·카드에 있을 때만 인정한다 — 기사에 없는 회사로 주체를
 *  바꾸는 날조까지 면제하지 않기 위해서다 (Codex 리뷰 13차 P1). */
const NATIVE_LATIN_MAP: Record<string, string[]> = {
  삼성전자: ["Samsung"],
  삼성: ["Samsung"],
  현대차: ["Hyundai"],
  현대자동차: ["Hyundai"],
  기아: ["Kia"],
  카카오: ["Kakao"],
  네이버: ["Naver"],
  쿠팡: ["Coupang"],
  토스: ["Toss"],
  라인: ["Line"],
  한화: ["Hanwha"],
  롯데: ["Lotte"],
  신세계: ["Shinsegae"],
  SK하이닉스: ["SK hynix", "SK Hynix"],
  포스코: ["POSCO"],
  넷마블: ["Netmarble"],
  넥슨: ["Nexon"],
  크래프톤: ["Krafton"],
  하이브: ["HYBE"],
  배달의민족: ["Baemin", "Woowa"],
  당근: ["Danggeun", "Karrot"],
  야놀자: ["Yanolja"],
  무신사: ["Musinsa"],
  컬리: ["Kurly"],
};
const NATIVE_KOREAN_NAMES = new Set(Object.keys(NATIVE_LATIN_MAP));
/** 대응 라틴명이 일반어라 원문 등장만으로는 근거가 안 되는 이름. */
const NATIVE_ENTITY_ONLY = new Set(["라인", "토스"]);

/** 인용부호 속 단일 토큰 한글 이름 — 데스크가 새 이름을 소개하는 표면이라
 *  후보 추출·선두 검사에서 빠져도 여기서 잡는다 (Codex 리뷰 14차 P1). */
function quotedHangulNames(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/'([^'\s]{2,30})'|"([^"\s]{2,30})"|「([^」\s]{2,30})」/g)) {
    const inner = m[1] ?? m[2] ?? m[3] ?? "";
    if (/[가-힣]/.test(inner)) out.push(inner);
  }
  return out;
}
/** 제목 선두 주체로 흔한 기관·지명·통칭 — 미등록 음역 검사에서 제외. */
const COMMON_SUBJECTS = new Set([
  "정부", "국회", "법원", "검찰", "경찰", "당국", "연구진", "업계", "시장",
  "국내", "해외", "전국", "서울", "부산", "대구", "인천", "광주", "대전",
  "울산", "미국", "중국", "일본", "유럽", "금융위", "금감원", "한은", "과기부",
  "오픈소스", "클라우드", "인공지능", "반도체", "전기차", "배터리", "로봇",
  "테크기업", "빅테크", "스타트업", "플랫폼사", "게임사",
]);

/** 제목 선두 주체 토큰들 — 데스크 제목은 "주체, 행위" 구조라 첫 쉼표 앞이
 *  주체 이름이다. 병렬 주체("구글·퍼플렉시티")는 전수 반환한다
 *  (Codex 리뷰 13차 P1). 조사 결합형은 원형 그대로 반환하고, 조사 제거는
 *  검사 쪽에서 원형 추적이 실패할 때만 시도한다 (이름 끝음절 오제거 방지
 *  — Codex 리뷰 16차 P2). */
function titleHeadSubjects(title: string): string[] {
  const head = (title.split(",")[0] ?? "").trim();
  return head
    .split("·")
    .map((part) => (part.trim().split(/\s+/)[0] ?? "").trim())
    .filter(Boolean);
}

function stripParticle(tok: string): string {
  const suffixes = [...PARTICLE_SUFFIXES].sort((a, b) => b.length - a.length);
  for (const p of suffixes) {
    if (tok.length - p.length >= 2 && tok.endsWith(p)) return tok.slice(0, -p.length);
  }
  return tok;
}

/** 추적성 판정기: 표기가 이 기사의 카드·원문·등장한 등록 표기로 설명되는가.
 *  라틴 단어는 단어 경계로 본다 ("metadata"가 "Meta"를 추적 가능하게
 *  만들지 않는다 — Codex 3차 P1). */
function makeTraceChecker(
  card: FactCard,
  entry: { title: string; summary: string },
): (name: string) => boolean {
  const sourceText = `${entry.title} ${entry.summary}`;
  // 추적 근거는 원문 + 카드의 원어 이름(entities)뿐이다 — 모델이 쓴 한국어
  // change를 근거로 삼으면 미등록 음역이 스스로를 정당화한다 (Codex 13차 P1).
  const cardText = card.entities.join(" ");
  const present = presentRegisteredPairs(card, entry);
  const presentHangulTokens = new Set([
    ...present.flatMap(([, hangul]) => hangulTokens(hangul)),
  ]);
  const allowedFull = new Set<string>([
    ...card.entities.map(nameNorm),
    ...present.flatMap(([latin, hangul]) => [nameNorm(latin), nameNorm(hangul)]),
  ]);
  return (name: string): boolean => {
    // 한국 고유명사는 대응 라틴명이 원문·카드에 있을 때만 추적 인정.
    if (NATIVE_KOREAN_NAMES.has(name)) {
      if (hangulNameAppears(sourceText, name)) return true;
      // 일반어와 겹치는 이름(라인↔line, 토스↔toss)은 원문의 일반 단어
      // 등장으로 인정하지 않는다 — entities 근거만 인정 (Codex 14차 P1).
      if (NATIVE_ENTITY_ONLY.has(name)) {
        return (NATIVE_LATIN_MAP[name] ?? []).some((latin) =>
          card.entities.some((e) => latinAppears(e, latin)),
        );
      }
      return (NATIVE_LATIN_MAP[name] ?? []).some(
        (latin) => latinAppears(sourceText, latin) || card.entities.some((e) => latinAppears(e, latin)),
      );
    }
    if (allowedFull.has(nameNorm(name))) return true;
    // 혼합형 이름(오픈AI 등)은 전체 표기로만 추적한다 — "오픈" 부분 일치가
    // "오픈소스"에 걸려 통과하는 우회 차단 (Codex 리뷰 8차 P1).
    if (/[가-힣]/.test(name) && /[A-Za-z0-9]/.test(name)) {
      return hangulNameAppears(sourceText, name) || mixedFormAppears(cardText, name);
    }
    // 원문 그대로의 표기는 한글 이름만 인정한다 — 라틴 이름의 부분 일치
    // ("Metadata" 속 "Meta")가 경계 검사를 우회하지 않게 (Codex 4차 P1).
    if (!/[A-Za-z]/.test(name) && hangulNameAppears(sourceText, name)) return true;
    const hTokens = hangulTokens(name);
    const latinWords = (name.match(/[A-Za-z][A-Za-z0-9.-]*/g) ?? []).filter(
      (w) => w.length >= 2 && !GENERIC_LATIN_WORDS.has(w.toLowerCase()),
    );
    const hangulOk = hTokens.every(
      (t) => presentHangulTokens.has(t) || hangulNameAppears(sourceText, t),
    );
    // 라틴 이름인데 검사할 단어가 전부 걸러지면(일반 약어뿐) 빈 every()가
    // 참이 되는 우회를 막는다 — 이름 전체의 경계 등장으로 판정한다
    // (Codex 리뷰 6차 P1: "HP" 사례).
    if (/[A-Za-z]/.test(name) && latinWords.length === 0) {
      return hangulOk && (latinAppears(sourceText, name) || latinAppears(cardText, name));
    }
    const latinOk = latinWords.every(
      (w) =>
        latinAppears(sourceText, w) ||
        latinAppears(cardText, w) ||
        present.some(([latin]) => latin.toLowerCase() === w.toLowerCase()),
    );
    return hangulOk && latinOk;
  };
}

/**
 * usedNames 추적 검사 (엔티티 잠금 채널 2).
 * - 선언 자체가 없으면 form 위반 (재작성으로 선언을 강제한다 — Codex 리뷰 P1).
 * - 제목에 등록 표기·라틴 고유명사가 있는데 선언에서 빠졌으면 form 위반 (완전성).
 * - 선언된 표기는 이 기사의 카드·원문·등장한 등록 표기로만 추적 가능해야 한다.
 */
function checkUsedNames(
  usedNames: unknown,
  title: string,
  card: FactCard,
  entry: { title: string; summary: string },
): CardViolation[] {
  const violations: CardViolation[] = [];
  // 선언 누락이어도 제목 후보의 완전성·추적성 검사는 계속한다 — 누락을
  // 우회로로 만들지 않는다 (Codex 리뷰 4차 P1).
  if (!Array.isArray(usedNames)) {
    violations.push({
      kind: "form",
      detail: "usedNames가 누락됐다 — 제목에 쓴 고유명사를 usedNames에 표기 그대로 전부 선언할 것",
    });
  }
  const declared = (Array.isArray(usedNames) ? usedNames : []).filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  // 완전성은 이름 구성요소(스크립트 단위 토큰)의 정확 일치로 본다 —
  // "GPT" 선언이 "FakeGPT"를 선언한 것으로 둔갑하는 부분일치 우회 방지
  // (Codex 리뷰 2차 P1).
  const nameComponents = (s: string): string[] =>
    (s.match(/[A-Za-z0-9]+|[가-힣]+/g) ?? []).map(nameNorm);
  const declaredComponents = new Set(declared.flatMap(nameComponents));
  const titleComponents = new Set(nameComponents(title));
  const titleNames = candidateNames(title);
  const isTraceable = makeTraceChecker(card, entry);
  const entityFlagged = new Set<string>();
  for (const t of titleNames) {
    if (!nameComponents(t).every((c) => declaredComponents.has(c))) {
      violations.push({
        kind: "form",
        detail: `제목의 고유명사 "${t}"이(가) usedNames 선언에서 빠졌다 — 쓴 표기는 전부 선언할 것`,
      });
    }
    // 추적 검사는 선언 충족과 무관하게 모든 후보에 적용한다 — 선언을
    // 구성요소로 쪼개 등록하면 후보 자체의 검사를 건너뛰는 우회 차단
    // (Codex 리뷰 9차 P1: ["오픈","AI"] 분리 선언 사례).
    if (!isTraceable(t)) {
      entityFlagged.add(nameNorm(t));
      violations.push({
        kind: "entity",
        detail: `제목의 고유명사 "${t}"이(가) 이 기사의 사실 카드·등록 표기·원문 어디에도 없다 — 없는 명칭 생성 금지`,
      });
    }
  }
  // 역방향: 선언된 이름의 구성요소가 제목에 실제로 있어야 한다.
  for (const name of declared) {
    if (!nameComponents(name).every((c) => titleComponents.has(c))) {
      violations.push({
        kind: "form",
        detail: `usedNames의 "${name}"이(가) 제목에 없다 — 제목에 쓴 고유명사만 선언할 것`,
      });
    }
  }
  for (const name of declared) {
    if (entityFlagged.has(nameNorm(name))) continue;
    if (isTraceable(name)) continue;
    violations.push({
      kind: "entity",
      detail: `제목의 고유명사 "${name}"이(가) 이 기사의 사실 카드·등록 표기·원문 어디에도 없다 — 등록 표기가 없으면 라틴 표기를 유지할 것`,
    });
  }
  return violations;
}

// ============================================================================
// Phase 1: 원문 대조 검증 (Pass 2 산출물 vs 사실 카드·원문)
// 없는 명칭 생성(entity) · 수치 변경(number) · 의혹을 사실로 단정(status)을 잡는다.
// 근거는 원문(entry)뿐이다 — Pass 1이 만든 numbers/change는 모델 산출물이라
// 그 자체를 허용 근거로 쓰면 검증이 순환한다 (Codex 리뷰 P1). evidence는
// 원문에 그대로 있는 인용일 때만 근거로 인정한다.
// ============================================================================

export type CardViolation = { kind: "entity" | "number" | "status" | "form"; detail: string };

type NumFact = { value: number; unit: string; raw: string };

const NUM_SCALE: Record<string, number> = {
  천: 1e3,
  만: 1e4,
  억: 1e8,
  조: 1e12,
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
  k: 1e3,
  m: 1e6,
  b: 1e9,
};
const NUM_UNIT_EN: Record<string, string> = {
  dollar: "달러",
  dollars: "달러",
  usd: "달러",
  percent: "%",
  x: "배",
  seconds: "s",
  second: "s",
  secs: "s",
  sec: "s",
  minutes: "min",
  minute: "min",
  mins: "min",
  min: "min",
  hours: "h",
  hour: "h",
  hrs: "h",
  hr: "h",
};
/** 단일 패스 수치 추출. 숫자 중간에서 시작하는 매치를 lookbehind로 막고
 *  ("23x"가 "2"+"3배"로 분해되지 않게), $ 접두사와 배율을 한 번에 소비한다
 *  ("$2 million" = 200만 달러 — Codex 리뷰 5차 P1). 배율은 연속 합성
 *  ("2천만"·"5천억")과 영문 축약(""$3M"·"70B")까지 값으로 정규화한다
 *  (Codex 리뷰 6차 P1/P2). */
/** 측정 단위(ms·GB·MW·시간 단어)는 배율보다 먼저 식별한다 — "10ms"의 m을
 *  million으로 먹는 오추출 방지 (Codex 리뷰 11차 P1). */
const NUM_ANY =
  /(?<![\d,.])([-−])?(\$)?(\d[\d,]*(?:\.\d+)?)(?:\s*(ms|gb|mb|tb|kb|mw|kw|ghz|mhz|khz|hz|mm|cm|km|kg|fps|rpm|px|seconds?|secs?|minutes?|mins?|hours?|hrs?)|((?:\s*(?:만|억|조|천|thousand|million|billion|trillion|[KMBkmb]))*)\s*(달러|원|유로|%|배|토큰|개|건|명|회|종|단계|위|점|밀리초|시간|분|초|dollars?|usd|percent|x|s|h|w|g|b)?)(?![A-Za-z0-9])/gi;
const NUM_SCALE_TOKEN = /(만|억|조|천|thousand|million|billion|trillion|[KMBkmb])/gi;
const NUM_UNIT_KO: Record<string, string> = {
  밀리초: "ms",
  시간: "h",
  분: "min",
  초: "s",
};
const NUM_UNIT_PLURAL: Record<string, string> = {
  tokens: "토큰",
  token: "토큰",
  users: "명",
  user: "명",
  requests: "건",
  request: "건",
  points: "점",
  point: "점",
  items: "개",
  item: "개",
  views: "회",
  view: "회",
  downloads: "건",
  download: "건",
  subscribers: "명",
  subscriber: "명",
  members: "명",
  member: "명",
  orders: "건",
  order: "건",
};
/** 한국어 계수사는 의미 단위가 아니라 문법적 조수사라 단위 대조에서 면제. */
const COUNTER_UNITS = new Set(["개", "건", "명", "회", "종", "위", "단계"]);
const CURRENCY_UNITS = new Set(["달러", "원", "유로"]);
/** 후행 단위 포착에서 제외할 영문 기능어. */
const UNIT_FUNCTION_WORDS = new Set([
  "in", "on", "at", "of", "to", "for", "per", "and", "or", "the", "an",
  "by", "with", "from", "than", "more", "new", "total", "about", "over",
  "under", "after", "before", "during", "via", "is", "are", "was", "were",
  "has", "had", "will", "can", "its", "this", "that", "each",
]);

/** 수치 사실을 값+단위로 정규화한다 — 한글 배율(만/억/조/천)과 영문 배율
 *  (thousand/million/billion·K/M/B)·통화(dollars→달러)·배수(x→배)를 같은
 *  값 공간에서 대조해 "2 million dollars"→"2억 원" 같은 변경도 잡는다
 *  (Codex 리뷰 4차 P1). */
function extractNumFacts(s: string): NumFact[] {
  const facts: NumFact[] = [];
  for (const m of s.matchAll(NUM_ANY)) {
    let mult = 1;
    let unit = "";
    if (m[4]) {
      // 측정 단위 우선 경로 — 배율을 소비하지 않는다.
      const raw = m[4].toLowerCase();
      unit = NUM_UNIT_EN[raw] ?? raw;
    } else {
      for (const t of (m[5] ?? "").matchAll(NUM_SCALE_TOKEN)) {
        mult *= NUM_SCALE[t[1].toLowerCase()] ?? 1;
      }
      unit = m[6] ?? "";
      if (unit && NUM_UNIT_KO[unit]) unit = NUM_UNIT_KO[unit];
      else if (unit && /^[A-Za-z]+$/.test(unit)) {
        unit = NUM_UNIT_EN[unit.toLowerCase()] ?? unit.toLowerCase();
      }
      // 목록에 없는 영문 단위어("2 million tokens"·"1 token")도 단위로
      // 포착한다 — 단위 미추출을 이용해 금액으로 바꿔치기하는 날조 차단
      // (Codex 리뷰 17·18차 P1/P2).
      if (!unit && !m[2]) {
        const tail = s.slice(m.index + m[0].length).match(/^\s+([A-Za-z]{3,}s?)\b/);
        if (tail) {
          const w = tail[1].toLowerCase();
          if (NUM_UNIT_PLURAL[w]) unit = NUM_UNIT_PLURAL[w];
          else if (w.endsWith("s")) unit = NUM_UNIT_PLURAL[w.slice(0, -1)] ?? w.slice(0, -1);
          // 미등록 단수 단위("1 credit")는 소문자 시작일 때만 원형 그대로
          // 포착한다 — 대문자 시작은 이름일 수 있어 제외 (Codex 21차 P1).
          else if (/^[a-z]/.test(tail[1]) && !UNIT_FUNCTION_WORDS.has(w)) unit = w;
        }
      }
    }
    if (!unit && m[2]) unit = "달러";
    let value = Number((parseFloat(m[3].replace(/,/g, "")) * mult).toPrecision(12));
    // 부호는 단어에 붙은 하이픈("GPT-5")과 구분해 값에 반영한다 — 부호 앞이
    // 영숫자가 아니면(공백·시작·괄호) 실제 음수다 (Codex 리뷰 12차 P2).
    if (m[1] && (m.index === 0 || !/[A-Za-z0-9]/.test(s[m.index - 1]))) value = -value;
    if (Number.isFinite(value)) facts.push({ value, unit, raw: m[0].trim() });
  }
  return facts;
}

/** 문장 분리: 마침표 뒤 공백이 없어도 나누되, 마침표 양쪽이 모두 숫자인
 *  소수점(2.5)만 경계에서 제외한다 (Codex 리뷰 10·11차 P1). */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    cur += ch;
    if (ch === ".") {
      const prev = text[i - 1] ?? "";
      const next = text[i + 1] ?? "";
      if (/\d/.test(prev) && /\d/.test(next)) continue;
      out.push(cur);
      cur = "";
      while (text[i + 1] === " ") i++;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}
const STATUS_MARKER = /의혹|주장|논란|혐의|추정|제보|우려|가능성|전망|보고(?!서)|알려져/;
const ASSERTIVE_HINT = /확인됐|확인되었|확인했다|확인한다|확인됨|확인\.|확정됐|확정되었|확정했다|확정한다|확정됨|확정\.|입증됐|입증되었|입증했다|입증됨|입증\.|드러났다|밝혀졌다|사실로|결론났다|결론(?:을|를)?\s?내렸|결론이 났|결론에 도달했|판명됐다|판명되었다|확인된 것으로|확정된 것으로|입증된 것으로/;
/** 부정·미확인 문맥 — 단정 신호가 있어도 의혹 보존 문장이다 (Codex 15차 P2).
 *  부인은 종결형만 인정한다 — 관계절의 과거 부인("부인했던 …이 사실로
 *  확인됐다")은 현재 단정의 부정이 아니다 (Codex 리뷰 22차 P1). */
const NEGATED_ASSERT = /(확인|확정|입증)되지|확인되지 않|사실이 아니|아닌 것으로|부인했(다|음|다고)|부인한다(?=[.,\s]|$)|미확인|확인된 바 없/;
/** 제목 끝의 명사형 단정 ("…유출 확정"·"…내부 조사로 확인") — 문장 종결이
 *  없어 ASSERTIVE_HINT로 못 잡는다 (Codex 리뷰 3·31차). */
const TITLE_ASSERTIVE = /(확정|입증|확인)\s*$/;

export function verifyAgainstCard(
  title: string,
  takeaway: string,
  summary: string,
  card: FactCard,
  entry: { title: string; summary: string },
  usedNames?: unknown,
): CardViolation[] {
  const violations: CardViolation[] = [];
  const sourceText = `${entry.title} ${entry.summary}`;
  // 1) 엔티티 잠금 — 근접 오형(채널 1, 제목·시사점·요약) + usedNames 추적(채널 2).
  for (const token of findNearMissEntities(`${title} ${takeaway} ${summary}`, sourceText)) {
    violations.push({
      kind: "entity",
      detail: `"${token}"은(는) 등록 표기의 오형으로 보인다 — 등록 표기를 정확히 쓰거나 라틴 표기를 유지할 것`,
    });
  }
  violations.push(...checkUsedNames(usedNames, title, card, entry));
  // 1a) 제목 선두 주체 — 등록에 없는 한글 음역(퍼플렉시티 등)은 후보 추출에
  // 걸리지 않으므로, "주체, 행위" 구조의 선두 토큰을 별도로 검사한다
  // (Codex 리뷰 12차 P1). 한국 고유명사·기관 통칭은 면제.
  {
    const trace = makeTraceChecker(card, entry);
    // 선두 검사는 "주체, 행위" 쉼표 구조에서만 적용한다 — 쉼표 없는 제목의
    // 첫 단어를 고유명사로 단정하면 정상 제목을 오판한다 (Codex 15차 P2).
    const headSegment = (title.split(",")[0] ?? "").trim();
    const headTokenCount = headSegment.split(/[·\s]+/).filter(Boolean).length;
    const subjects =
      title.includes(",") && headTokenCount <= 3 ? titleHeadSubjects(title) : [];
    for (const rawSubject of subjects) {
      const subject = stripParticle(rawSubject);
      if (
        rawSubject.length >= 2 &&
        /[가-힣]/.test(rawSubject) &&
        !COMMON_SUBJECTS.has(rawSubject) &&
        !COMMON_SUBJECTS.has(subject) &&
        !violations.some(
          (v) =>
            v.kind === "entity" &&
            (v.detail.includes(`"${rawSubject}"`) || v.detail.includes(`"${subject}"`)),
        ) &&
        !trace(rawSubject) &&
        !trace(subject)
      ) {
        violations.push({
          kind: "entity",
          detail: `제목의 주체 "${subject}"이(가) 등록 표기에 없는 한글 표기다 — 등록 표기가 없으면 라틴 표기를 유지할 것`,
        });
      }
    }
  }
  // 1b) 본문 추적성 — 제목뿐 아니라 시사점·요약에 생성된 명칭도 잡는다
  // (Codex 리뷰 7차 P1). 제목에서 이미 검사한 이름은 건너뛴다.
  {
    const trace = makeTraceChecker(card, entry);
    const titleNameNorms = new Set(candidateNames(title).map(nameNorm));
    const bodyNames = candidateNames(`${takeaway} ${summary}`).filter(
      (n) => !titleNameNorms.has(nameNorm(n)),
    );
    for (const n of bodyNames) {
      if (!trace(n)) {
        violations.push({
          kind: "entity",
          detail: `본문의 고유명사 "${n}"이(가) 이 기사의 사실 카드·등록 표기·원문 어디에도 없다 — 없는 명칭 생성 금지`,
        });
      }
    }
    // 1c) 인용부호 속 한글 이름 — 제목·본문 어디에 있든 추적 검사한다.
    const quoted = quotedHangulNames(`${title} ${takeaway} ${summary}`);
    for (const n of quoted) {
      if (
        !violations.some((v) => v.kind === "entity" && v.detail.includes(`"${n}"`)) &&
        !trace(n)
      ) {
        violations.push({
          kind: "entity",
          detail: `인용 표기된 고유명사 "${n}"이(가) 이 기사의 사실 카드·등록 표기·원문 어디에도 없다 — 없는 명칭 생성 금지`,
        });
      }
    }
  }
  // 2) 수치 대조 — 숫자 자체의 생성 + 단위 변경을 본다.
  // 단위 쌍은 "같은 숫자가 원문에서 다른 단위와 붙어 있을 때만" 위반으로 한다:
  // 영문 원문의 "2 hours"를 "2시간"으로 옮기는 정상 번역까지 잡으면 오탐이다.
  const evidenceOk =
    card.evidence.trim().length >= 4 && sourceText.includes(card.evidence.trim());
  const ground = evidenceOk ? `${sourceText} ${card.evidence}` : sourceText;
  const groundFacts = extractNumFacts(ground);
  const groundValues = new Set(groundFacts.map((f) => f.value));
  const groundUnitsByValue = new Map<number, Set<string>>();
  for (const f of groundFacts) {
    if (!f.unit) continue;
    if (!groundUnitsByValue.has(f.value)) groundUnitsByValue.set(f.value, new Set());
    groundUnitsByValue.get(f.value)!.add(f.unit);
  }
  const outputText = `${title} ${takeaway} ${summary}`;
  const reportedValues = new Set<number>();
  for (const f of extractNumFacts(outputText)) {
    if (reportedValues.has(f.value)) continue;
    if (!groundValues.has(f.value)) {
      reportedValues.add(f.value);
      // 값 자체가 원문에 없다 — 생성·변경·배율 탈락(2만→2)이 모두 여기서 잡힌다.
      violations.push({
        kind: "number",
        detail: `원문에 없는 수치 "${f.raw}" — 수치 생성·변경·배율 탈락 금지`,
      });
      continue;
    }
    // 값은 같지만 단위가 원문의 그 값에 붙은 단위와 다르면 통화·단위 변경이다.
    // 원문에 단위가 없을 때(영문 "2 hours"→"2시간")는 단위를 문제 삼지 않고,
    // 한국어 계수사(개·건·명 등)는 원문 단위가 통화가 아닐 때만 면제한다 —
    // 금액을 인원수로 바꾸는 변경까지 면제하지 않는다 (Codex 리뷰 21차 P1).
    const groundUnits = groundUnitsByValue.get(f.value);
    const counterSwap = COUNTER_UNITS.has(f.unit);
    const groundHasCurrency = groundUnits
      ? [...groundUnits].some((u) => CURRENCY_UNITS.has(u))
      : false;
    if (
      f.unit &&
      (!counterSwap || groundHasCurrency) &&
      groundUnits &&
      groundUnits.size > 0 &&
      !groundUnits.has(f.unit)
    ) {
      reportedValues.add(f.value);
      violations.push({
        kind: "number",
        detail: `수치 "${f.raw}"의 단위가 원문(${[...groundUnits].join("·")})과 다르다 — 단위 변경 금지`,
      });
    }
  }
  // 3) 상태 대조 — 단위(제목·사실 문장·요약 문장)별로 본다. 표지가 다른
  // 문장에 있어도 단정형 문장은 면제되지 않는다 ("유출 의혹이 사실로
  // 확인됐다"처럼 한 문장 안에 표지와 단정이 같이 있어도 위반 — Codex 2차).
  if (card.status !== "confirmed") {
    const fact = factPart(takeaway);
    // 상태 보존 인정: 의혹 표지 또는 명시적 미확인·부정 표현 (Codex 16차 P2).
    // 절 단위로 보되, 단위 전체 판정(preservedAll)은 모든 절이 보존될 때만
    // 인정한다 — 한 절의 미확인이 다른 절의 단정을 덮지 않게 (Codex 17차 P1).
    const clausesOf = (t: string) =>
      t.split(/(?<=됐고|됐으며|했고|했으며|됐지만|했지만|않았고|않았으며|됐는데도|됐는데|했는데도|했는데|였는데도|였는데|되었는데도|되었는데|되었고|되었으며|되자마자|되자|하자|되니|하니|되면서|이며|이고|하고|하며|지만|으나|인데)|[,;]/u).filter((c) => c.trim());
    // 부정 면제는 절 말미의 술어 부정만 인정한다 — 관계절 속 과거
    // 부인·인용("부인했다고 알려진")은 상태 보존 근거가 아니다
    // (Codex 리뷰 22~24차 P1).
    const tailNegated = (c: string) => {
      const tail = c.trim().replace(/[."'”]+$/, "");
      return /(확인|확정|입증)되지 않았다$|(확인|확정|입증)되지 않았고$|(확인|확정|입증)되지 않았으며$|(확인|확정|입증)되지 않아$|(확인|확정|입증)되지 않는다$|사실이 아니다$|아닌 것으로 (밝혀졌다|드러났다|전해졌다)$|부인했다$|부인했음$|부인한다$|부인한다고 (전했다|밝혔다)$|미확인이다$|미확인$|확인된 바 없(?:다|음|는)$/.test(tail);
    };
    const clausePreserved = (c: string) => STATUS_MARKER.test(c) || tailNegated(c);
    // 판정은 문장→절 순서로 쪼갠 뒤 한다 — 여러 문장 전체를 한 절로 보면
    // 말미 앵커가 마지막 문장에만 걸려 앞 문장의 부정이 사라진다.
    const sentenceClauses = (t: string) => splitSentences(t).flatMap((s) => clausesOf(s));
    const preservedAny = (t: string) => sentenceClauses(t).some(clausePreserved);
    const preservedAll = (t: string) => sentenceClauses(t).every(clausePreserved);
    if (!preservedAny(title) && !preservedAny(fact)) {
      violations.push({
        kind: "status",
        detail: `사실 상태가 ${card.status}인데 의혹·주장 표지 없이 단정함 — "~의혹/주장/논란"으로 쓸 것`,
      });
    }
    // 의혹(allegation)은 단위별 상태 보존을 강제한다 — 제목·사실부·요약 중
    // 어느 하나라도 표지를 잃으면 그 단위가 사건을 사실로 단정하게 된다
    // (Codex 리뷰 4차 P1). 주장(claim)은 업체 주장을 평서로 전하는 제목이
    // 데스크 관행이라 합산 표지 + 단정 검출로 충분하다.
    if (card.status === "allegation") {
      // 제목·사실부는 절 단위 전부 보존, 요약은 단위 내 보존 + 첫 문장
      // 절 단위 보존 (요약의 반응·배경 문장까지 표지를 강제하지 않는다).
      // 제목의 선두 주체 구간(첫 쉼표 앞)은 사건 절이 아니라 제외한다 —
      // 단, 구간의 모든 토큰이 이름·통칭으로 구성될 때만 주체 구간으로
      // 인정한다. 사건 명사 목록에 의존하면 목록 밖 사건(파산·체포 등)이
      // 우회하므로 구성을 본다 (Codex 리뷰 19~21차 P1).
      const headSeg = (title.split(",")[0] ?? "").trim();
      // 이름다움은 후보·카드 선언·통칭 집합으로만 판정한다 — 원문에 등장한
      // 일반 명사(파산 등)를 추적 가능 여부로 인정하면 사건 단정이 주체
      // 구간으로 둔갑한다 (Codex 리뷰 22차 P1).
      const headNameSet = new Set(
        [...candidateNames(headSeg), ...card.entities, ...card.hangulForms].map(nameNorm),
      );
      const headTokens = headSeg.split(/[·\s]+/).filter(Boolean);
      const headIsSubjectZone =
        title.includes(",") &&
        headTokens.length > 0 &&
        headTokens.length <= 3 &&
        headTokens.every((tok) => {
          const stripped = stripParticle(tok);
          return (
            /^[A-Za-z]/.test(tok) ||
            COMMON_SUBJECTS.has(tok) ||
            COMMON_SUBJECTS.has(stripped) ||
            headNameSet.has(nameNorm(tok)) ||
            headNameSet.has(nameNorm(stripped))
          );
        });
      const titleEvent = headIsSubjectZone ? title.slice(title.indexOf(",") + 1) : title;
      const units: Array<[string, string, boolean]> = [
        ["제목", titleEvent, true],
        ["시사점 사실부", fact, true],
        ["요약", summary, false],
      ];
      for (const [label, text, strict] of units) {
        if (text && !(strict ? preservedAll(text) : preservedAny(text))) {
          violations.push({
            kind: "status",
            detail: `의혹 기사인데 ${label}에 의혹·주장 표지가 없다 — 단정으로 읽힌다. ${label}에도 표지를 유지할 것`,
          });
        }
      }
      // 요약은 첫 문장이 사건 요지다 — 표지가 뒤 문장에만 있으면 첫 문장의
      // 단정이 그대로 게시된다 (Codex 리뷰 6차 P1).
      const firstSentence = splitSentences(summary)[0] ?? "";
      if (firstSentence && !preservedAll(firstSentence)) {
        violations.push({
          kind: "status",
          detail: `의혹 기사인데 요약 첫 문장에 의혹·주장 표지가 없다 — 첫 문장부터 표지를 유지할 것`,
        });
      }
    }
    const units = [
      title,
      ...splitSentences(fact),
      ...splitSentences(summary),
    ];
    for (const unit of units) {
      if (!unit) continue;
      // 부정 판정은 절 단위로 한다 — 문장 다른 절의 미확인 표현이 단정절을
      // 면제하지 않는다 (Codex 리뷰 16차 P1).
      const clauses = clausesOf(unit);
      // 단정 판정은 부정 구간을 먼저 제거하고 본다 — "사실로 확인되지
      // 않았다"의 단정은 부정 구간 안에 있지만, "사실로 확인된 상황에서
      // 피해 규모는 확인되지 않았다"의 단정은 구간 밖에 남는다. 말미
      // 패턴 일치가 아니라 단정 자체가 부정되는지를 본다 (Codex 26~28차).
      const NEG_SPAN = /(사실로\s+)?(확인|확정|입증)되지\s*않(?:았다|았고|았으며|았지만|는다|아|은|고|으며|지만)|(사실로\s+)?확인된 바 없(?:다|음|는)|(?:사실이\s+)?아닌 것으로 (?:밝혀졌다|드러났다|전해졌다)|미확인/g;
      const DENIAL_TAIL = /(부인했다|부인했음|부인한다|부인한다고 (?:전했다|밝혔다))\s*$/;
      const QUOTED_DENIAL = /(?:다는|라는|다고|라고)\s*(?:주장|의혹|보도|사실|혐의|내용|소문|루머)(?:을|를|은|에 대해|에 대해서)?\s*부인(?:했다|했음|한다|한다고 (?:전했다|밝혔다))?/;
      const badClause = clauses.some((c) => {
        let stripped = c.replace(NEG_SPAN, " ");
        // "…확인됐다는 주장을 부인했다" — 부인에 귀속된 인용 구간만
        // 검사에서 제외하고, 구간 앞의 독립 서술은 계속 검사한다
        // ("확인된 뒤 회사는 유출됐다는 주장을 부인했다"의 앞부분 단정은
        // 부인 대상이 아니다). "책임을 부인" 같은 다른 대상 부인은
        // 인용형이 없어 제외되지 않는다 (Codex 리뷰 26·34~36차).
        if (DENIAL_TAIL.test(c.trim().replace(/[."'”]+$/, ""))) {
          const m = QUOTED_DENIAL.exec(stripped);
          if (m) {
            const before = stripped.slice(0, m.index);
            // 인용 구간의 시작 = 마지막 경계(뒤·후·쉼표) 또는 인용 직전의
            // 마지막 주어 토큰 시작. 경계가 없으면 절 전체가 인용 구간인
            // 경우뿐이므로, 독립 단정이 앞에 있으면 주어 경계가 잡는다
            // ("확인됐는데 회사는 …주장을 부인했다") (Codex 리뷰 37차 P1).
            let cut = Math.max(
              before.lastIndexOf(" 뒤 "),
              before.lastIndexOf(" 후 "),
              before.lastIndexOf(", "),
              before.lastIndexOf(" 그리고 "),
              before.lastIndexOf(" 그러나 "),
            );
            for (const sm of before.matchAll(/[가-힣A-Za-z0-9]+(?:은|는|이|가)\s/g)) {
              if (sm.index > cut) cut = sm.index;
            }
            const kept = (cut >= 0 ? before.slice(0, cut) : "") + stripped.slice(m.index + m[0].length);
            // 안전 불변식: ① 구간 앞에 단정이 남아 있거나 ② 구간 내부
            // 인용 직전에 연결 어미로 끝나는 선행 절이 있으면("…확인됐기에
            // 해킹됐다는 주장") 제거를 취소한다 — 인용 범위를 확실히
            // 식별하지 못하면 앞선 단정 구간을 보존 (Codex 리뷰 40·41차).
            const beforeSeg = cut >= 0 ? before.slice(0, cut) : "";
            const segPre = stripped.slice(cut >= 0 ? cut : 0, m.index);
            // 구간 내부 선행 단정 검출: 인용 명제는 인용 표지에 붙은
            // 마지막 술어 토큰뿐이다(직전이 정확히 "사실로"일 때만 함께
            // 포함 — "사실로 확인됐"). 그 창 밖에 단정 신호가 있으면
            // ("확인됐기에 해킹됐다는 주장") 선행 독립 단정이 구간에
            // 섞인 것이므로 제거를 취소한다 (Codex 리뷰 41~44차 P1).
            const segTokensWithPos: { text: string; index: number }[] = [];
            for (const tm of segPre.matchAll(/\S+/g)) segTokensWithPos.push({ text: tm[0], index: tm.index });
            let winStart = segTokensWithPos.length ? segTokensWithPos[segTokensWithPos.length - 1].index : 0;
            if (
              segTokensWithPos.length >= 2 &&
              segTokensWithPos[segTokensWithPos.length - 2].text === "사실로"
            ) {
              winStart = segTokensWithPos[segTokensWithPos.length - 2].index;
            }
            let priorClauseInSeg = false;
            for (const am of segPre.matchAll(new RegExp(ASSERTIVE_HINT.source, "g"))) {
              // 다중 토큰 술어("결론에 도달했")는 창과 겹치면 명제 내부로
              // 본다 — 매치 끝이 창 시작보다 앞에 있을 때만 선행 단정
              // (Codex 리뷰 47차 P2).
              if (am.index + am[0].length <= winStart) priorClauseInSeg = true;
            }
            if (
              !priorClauseInSeg &&
              !ASSERTIVE_HINT.test(beforeSeg) &&
              !TITLE_ASSERTIVE.test(beforeSeg.trim())
            ) {
              stripped = kept;
            }
          }
        }
        return ASSERTIVE_HINT.test(stripped) || TITLE_ASSERTIVE.test(stripped.trim());
      });
      if (badClause) {
        violations.push({
          kind: "status",
          detail: `사실 상태가 ${card.status}인데 단정형 문장이 있다: "${unit.slice(0, 40)}" — 확정되지 않은 사건을 확인된 것처럼 쓰지 말 것`,
        });
        break;
      }
    }
  }
  // 동일 detail 중복 제거 (같은 수치가 제목·시사점에 반복될 때)
  const seen = new Set<string>();
  return violations.filter((v) => {
    const key = `${v.kind}|${v.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Pass 1 카드 + Pass 2 산출물 → 최종 페이로드. 등급은 decideGrade가 정한다. */
export function buildPayloadFromCard(
  card: FactCard,
  write: { title?: unknown; takeaway?: unknown; summary?: unknown },
  entry: { title: string; source: string; sourceUrl: string; summary: string; date: number },
): IngestPayload {
  // 26차 P0: 최종 출력 전 오타 교정 — 재작성 시 모델이 입력 오타를 답습하는 문제 대응
  const title = fixTypos(polishTitle(String(write.title || entry.title)));
  const takeaway = fixTypos(polishTakeaway(String(write.takeaway || entry.summary)));
  const summary = fixTypos(
    String(write.summary || entry.summary)
      .replace(/…/g, "...")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 900),
  );
  return {
    title,
    takeaway: takeaway || clipChars(entry.summary, 90),
    summary: summary || takeaway,
    source: entry.source,
    sourceUrl: entry.sourceUrl,
    originalTitle: entry.title,
    grade: decideGrade(card, title, takeaway, entry.title),
    tip: card.tip,
    topics: card.topics,
    publishedAt: entry.date,
    keep: true,
    card,
    score: card.importance,
    hardGate: card.hardGate,
  };
}
