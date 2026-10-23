import { TOPIC_MAP } from "./topics";
import type { Grade, IngestPayload, NewsItem } from "./types";

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

export const DESK_SYSTEM = `당신은 한국 AI 실무자용 뉴스 터미널 brief_의 편집장이다.
원문을 번역·축약하지 말고, 데스크가 다시 쓴다. JSON만 출력.

헤드라인
- 28~44자. 원문 제목 복사 금지. 부제·수치 나열 꼬리 자를 것.
- 주어(회사·제품·규제) + 행위. 제품·법안 이름만 '따옴표'.
- 말줄임표는 ... (점 세 개). 신문 인용문("기다릴 가치 있다")은 제목 끝이 짧을 때만.

시사점 takeaway — 원본 문장 뼈대
- 정확히 두 조각: "사실 한 줄. 할 일 한 줄."
- 첫 문장(사실)은 제목을 베껴쓰지 말고 해석을 얹을 것. 예: 제목이 "오픈AI 엔지니어 체포"라면 "내부자 위협 현실화."처럼 사건에 프레임을 씌울 것. "엔지니어가 체포됐다"는 리드 복사에 불과.
- 할 일은 구체적 행동으로: 누가 무엇을 해야 하는지 명시 ("도입 전 가격 비교 권장", "API 사용 중이면 폴백 로직 점검 필요").
- 할 일은 제목의 주장 방향과 일치시킬 것. 제목이 "쿼터 축소 의혹"이면 "축소 여부 확인 필요"처럼 같은 방향으로 — 반대 방향("상향 여부 확인") 금지.
- 금지: "~주시 필요", "~동향 주시", "~영향 주시", "~검토할 시점", "~검증해볼 시점", "~참고할 만함" 같은 관망형·모호한 어미. 막연한 표현으로 끝내지 말 것. 할 일 문장은 반드시 필요/검토/권장/주시/기회 중 하나로 끝낼 것. "확인."·"점검."으로만 끝내는 미완결 종결 금지 ("확인 필요"처럼 필요를 붙일 것).
- 제품·모델명은 한글 표기를 우선한다. 영문만으로 널리 쓰이는 이름(GPT-5, API 등)은 영문 그대로 쓴다. '영문(한글)' 병기는 쓰지 않는다.
- 고유명사 표기 고정: Gemini→'제미나이' (지미니 오기 금지), Kimi→'키미' (킴이 오기 금지), Canva→'캔바', Smaug→'스마우그'.
- 원문 첫 문장·리드 복사 금지. 명령조(해라·하라) 금지.
- 에디토리얼 프레임: 사건에 의미를 부여하는 한 단어를 첫 문장에 넣을 것.
  - 파산/몰락: "활성 1200만 서비스도 수익성·안전 소송에 무너져." (X: "파산 보호를 신청하고 매각을 추진 중")
  - 데이터 집중: "정부 사업 데이터가 AI허브로 집결." (X: "학습데이터의 개방이 법적으로 묶임")
  - 병목: "AI 도구만으론 부서 간 협업·승인 병목이 생산성을 가로막음." (X: "도구 도입이 늘고 있다")
  - 비용 누적: "에이전트의 백그라운드 자율 실행이 조용히 비용을 누적시킴." (X: "에이전트가 실행된다")

요약 summary
- 3문장. 사실만. 시사점과 겹치지 말 것.

등급 grade — 목표 분포: breaking 2~3%, important 12~18%, 나머지는 note.
- breaking: 지금 진행 중인 대형 서비스 장애, 당일 긴급 발표된 주요 출시, 즉시 적용되는 가격·정책 변경.
- important: 주요 모델·제품의 출시/공개, 가격·요금제 변동, 보안 취약점 발견, 대규모 계약·투자·인수합병, 규제·제재 발표, 업계 판도를 바꾸는 소식 — 이번 주 실무에 바로 닿는 것.
- important 제외 (note 이하): 벤더의 자체 역량·수치 홍보("위협 탐지 역량 23배 확대"), 하드웨어 액세서리(전력 모듈·쿨링·서버랙), 특정 지역 한정 출시("일본 출시"), M&A 논의·추진·검토 단계의 주식·지배구조 소식, 개인의 의견·전망 기사. 단 AI 랩의 대규모 인수합병 완료 건은 important.
- AI와 직접 관련 없는 M&A·지배구조·주식·공시 기사는 keep=false.
- tip: 무료 모델 공개, 프롬프트 기법, 로컬 LLM 설정법처럼 오늘 바로 쓰는 실용 정보. 침해 사고·보안 경고는 tip이 아니라 important/note.
- note: 위 어디에도 해당하지 않는 일반 업계 동향.

keep=false
- 주식·공시·특징주, 유튜브 라운드업, AI 무관, 만찬·참석·동행·포토, 인사 단신, 연예·문화·문학 화제, 개인 회고·감상 인터뷰, 소액 정부 지원 단신.`;

export function deskUser(entry: {
  title: string;
  source: string;
  sourceUrl: string;
  summary: string;
}): string {
  return `원문 제목: ${entry.title}
출처: ${entry.source}
링크: ${entry.sourceUrl}
발췌: ${entry.summary.slice(0, 500)}

예시(스타일만 복사, 내용 베끼지 말 것):
{"keep":true,"title":"오픈AI, 주요 신제품 출시 다음 주로 연기","takeaway":"대형 신제품 일주일 연기. 다음 주 발표에 맞춰 도입 계획 조정 필요.","summary":"오픈AI가 신제품 공개를 다음 주로 미뤘다. 데브데이 일정과 맞춘다. 기존 도입 일정을 한 주 뒤로 밀 여지가 있다.","grade":"important","tip":false,"topics":["openai"]}
{"keep":true,"title":"오픈AI, 'AI 정렬 실패' 사례 보고 체계 구축","takeaway":"모델 안전성·투명성 검증 절차 강화. 정렬 문제 대응 공론화에 대비 필요.","summary":"오픈AI가 정렬 실패 사례를 추적해 공개하는 보고 체계를 마련했다. 예상 밖 모델 행동을 조사 대상으로 올린다. 안전 거버넌스 논의가 제품 일정에 붙을 수 있다.","grade":"note","tip":false,"topics":["openai"]}
{"keep":true,"title":"협업툴 '플로우', 챗GPT·클로드 공식 앱 입점","takeaway":"국내 협업툴에서 챗GPT·클로드를 기본 연동할 수 있게 됨. 기업 워크플로우 적용 검토.","summary":"플로우가 챗GPT와 클로드 공식 앱을 등록했다. 메신저 안에서 두 모델을 호출한다. 국산 협업툴 중 공식 입점은 처음이다.","grade":"note","tip":false,"topics":["korea-ai","agent"]}
{"keep":true,"title":"오픈AI, API 장문 입력 요금 인하","takeaway":"장문 컨텍스트 호출 비용 부담 완화. 대량 문서 처리 워크로드라면 새 요금제 적용 시점 확인.","summary":"오픈AI가 API 장문 입력 요금을 인하했다. 128K 이상 구간 단가가 조정된다. 기존 배치 작업의 비용 재산정이 가능하다.","grade":"important","tip":false,"topics":["openai"]}
{"keep":true,"title":"앤트로픽, 클로드 API 장애 복구","takeaway":"2시간 장애 후 정상화. 클로드 API 연동 서비스는 장애 시간대 요청 누락 여부 점검.","summary":"앤트로픽 클로드 API에서 2시간 장애가 발생했다. 상태 페이지에 공지됐다. 현재는 정상화됐다.","grade":"important","tip":false,"topics":["anthropic"]}
{"keep":true,"title":"과기정통부, AI 기본법 시행령 입법예고","takeaway":"고영향 AI 의무 조항 세부 기준 공개. 해당 사업자는 의견 수렴 기간 내 적용 범위 주시.","summary":"과기정통부가 AI 기본법 시행령을 입법예고했다. 고영향 AI 판정 기준이 담겼다. 의견 수렴은 다음 달까지다.","grade":"note","tip":false,"topics":["korea-ai","regulation"]}
{"keep":true,"title":"슈나이더, 엔비디아 'GB300' 맞춤 전력 모듈 선봬","takeaway":"데이터센터 전력 장비 선택지 확대. 도입 예정 기업은 전력·냉각 요구 조건 비교 권장.","summary":"슈나이더가 GB300용 2.5MW 전력 모듈을 공개했다. 액체 냉각 대응 제품이다. 인프라 투자 계획이 있는 기업만 보면 된다.","grade":"note","tip":false,"topics":["hardware"]}
{"keep":true,"title":"게임 NPC 실시간 대화 구현 도구 'NPCTalk' 공개","takeaway":"오픈소스 NPC 대화 도구 등장. 유니티·언리얼 연동 예제가 있어 바로 실험해볼 기회.","summary":"NPCTalk가 공개됐다. 게임 NPC와 실시간 대화할 수 있는 오픈소스 도구다. 유니티와 언리얼 플러그인을 제공한다.","grade":"note","tip":true,"topics":["open-source"]}
{"keep":false,"title":"","takeaway":"","summary":"","grade":"note","tip":false,"topics":[]}

JSON 스키마:
{"keep":true,"title":"한국어 헤드라인","takeaway":"사실. 할 일.","summary":"3문장","grade":"breaking|important|note","tip":false,"topics":["openai"]}
topics 허용값: ${ALLOWED_TOPICS.join(", ")}`;
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

export function polishGrade(grade: Grade, title: string, takeaway: string, originalTitle = ""): Grade {
  // 16차: 승격 게이트는 제목 + 시사점 사실 부분만 본다 (할 일 상용구 오탐 방지)
  const t = `${title} ${factPart(takeaway)}`;
  if (grade === "breaking" && !/장애|다운|중단|지연|가격|인하|인상/.test(t)) return "note";
  // 32차: 강등·승격 모두 hasStrongSignal 단일 기준으로 통일.
  // 기존 IMPORTANT_HINT는 "규제·정책·법안" 같은 약한 단어만으로도 [중요]를 유지시켜
  // 주장성 기사(휴깅페이스 "규제 산업 전환 가속")가 과승격됐다 (31차 패널).
  let g = grade;
  // 36차: NOTE_FORCE가 걸리면 승격 라인이 다시 올리지 못하게 forced 플래그로 차단.
  const forced = forceNoteReason(title, takeaway);
  if (g === "important" && !forced && !hasStrongSignal(title, takeaway, originalTitle)) g = "note";
  if (g === "important" && forced) g = "note";
  if (g === "note" && !forced && hasStrongSignal(title, takeaway, originalTitle)) return "important";
  return g;
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
  // 32차: polishGrade와 동일하게 hasStrongSignal 단일 기준으로 통일 (핑퐁 방지).
  if (item.grade === "important" && !hasStrongSignal(item.title, item.takeaway, item.originalTitle)) return true;
  // 36차: NOTE_FORCE 강등 대상도 재작성 큐로 — 기존 과승격분(B01/B07/B08/B24류)이
  // polishGrade에서 note로 내려가게. 없으면 영원히 [중요]로 잔류함.
  if (item.grade === "important" && forceNoteReason(item.title, item.takeaway)) return true;
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

export function polishPayload(
  json: Record<string, unknown>,
  entry: { title: string; source: string; sourceUrl: string; summary: string; date: number },
): IngestPayload {
  // 26차 P0: 최종 출력 전 오타 교정 — 재작성 시 모델이 입력 오타를 답습하는 문제 대응
  const title = fixTypos(polishTitle(String(json.title || entry.title)));
  const takeaway = fixTypos(polishTakeaway(String(json.takeaway || entry.summary)));
  const summary = String(json.summary || entry.summary)
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
  const grade = polishGrade(
    json.grade === "breaking" || json.grade === "important" || json.grade === "note"
      ? json.grade
      : "note",
    title,
    takeaway,
    entry.title,
  );
  const topics = Array.isArray(json.topics)
    ? json.topics.filter((x): x is string => typeof x === "string" && Boolean(TOPIC_MAP[x])).slice(0, 4)
    : [];
  return {
    title,
    takeaway: takeaway || clipChars(entry.summary, 90),
    summary: summary || takeaway,
    source: entry.source,
    sourceUrl: entry.sourceUrl,
    originalTitle: entry.title,
    grade,
    tip: Boolean(json.tip),
    topics,
    publishedAt: entry.date,
    keep: json.keep === false ? false : true,
  };
}
