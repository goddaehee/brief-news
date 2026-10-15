import { TOPIC_MAP } from "./topics";
import type { Grade, IngestPayload, NewsItem } from "./types";

export const ALLOWED_TOPICS = Object.keys(TOPIC_MAP);

/** Ceremony / photo ops. Original desk drops these. */
export const DROP_HINT =
  /만찬|국빈|동행|시상식|포토\s*뉴스|오늘의 인물|출근길|레드카펫|기념촬영|개막식 참석/i;

/** Pipeline-now. Name-drops (출시·연구소) are 참고. */
/** 5차 평가: [중요] 7.5% 과소 (목표 12-18%). 힌트를 약간 복원.
 *  일반 출시/발표/협력은 제외 유지, 주요 모델 출시·보안 경고·대규모 계약 추가. */
export const IMPORTANT_HINT =
  /가격|인하|인상|침해|장애|중단|제재|유출|다운|수출 통제|계정 탈취|출시 연기|취약점|해킹|공격|위협|경고|주의보|소송|벌금|과징금|리콜|독점|반독점|규제|법안|정책|가이드라인|대규모 계약|대규모 투자|인수|합병|최초|기록|돌파|경신|오픈소스 공개|벤치마크|신모델 출시|신모델 공개|물리학 평가|신기록|주요 모델 출시|보안 경고|AI 자가복제|웜|사이버 공격|파산|상장|IPO/;

/** 의식/행사성 발표 제외: 모델 출시는 중요, 연구소 출범은 참고. 승격 게이트의 제외 조건. */
const CEREMONY_GUARD = /출범|연구소|연구센터|개소식|기념식/;

/** 프런티어 랩 × 프런티어 이벤트 승격 (14차 평가: promppy [중요] 커버리지 대응).
 *  예: "Anthropic IPO 로드쇼", "DeepSeek 3시간 장애", "오픈AI, GPT-6 아스트라 출시"
 *  LAB의 모델명은 버전 번호가 붙은 것만 포함 — "GPT 탑재 챗봇 출시" 같은 bare 언급은 과승격 방지. */
const FRONTIER_LAB =
  /오픈AI|OpenAI|앤트로픽|Anthropic|구글|Google|딥마인드|DeepMind|제미나이|Gemini|딥시크|DeepSeek|xAI|그록|Grok|메타|Meta|라마|Llama|미스트랄|Mistral|엔비디아|NVIDIA|GPT-?\d|Gemini ?\d|Claude ?\d|Grok ?\d|LFM ?\d/i;
const FRONTIER_EVENT =
  /출시|공개|발표|벤치마크|벤치|평가|1위|신기록|돌파|경신|98점|99점|100점|IPO|상장|매출|실적|장애|다운|단종|가격|인하|인상/i;

function isFrontierEvent(title: string, takeaway: string): boolean {
  const t = `${title} ${factPart(takeaway)}`;
  return FRONTIER_LAB.test(t) && FRONTIER_EVENT.test(t) && !CEREMONY_GUARD.test(t);
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
- 금지: "~주시 필요", "~동향 주시", "~영향 주시", "~검토할 시점", "~검증해볼 시점", "~참고할 만함" 같은 관망형·모호한 어미. 막연한 표현으로 끝내지 말 것. 할 일 문장은 반드시 필요/권장/검토/확인/점검 중 하나로 끝낼 것.
- 제품·모델명은 영문 병기: "Maia(마이아)", "Claude Code(클로드 코드)".
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
- tip: 무료 모델 공개, 프롬프트 기법, 로컬 LLM 설정법처럼 오늘 바로 써먹을 수 있는 실용 정보.
- note: 위 어디에도 해당하지 않는 일반 업계 동향.

keep=false
- 주식·공시·특징주, 유튜브 라운드업, AI 무관, 만찬·참석·동행·포토, 인사 단신.`;

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
  t = clipChars(t, 44);
  return t.slice(0, 56);
}

export function polishTakeaway(raw: string): string {
  let t = decodeEntities(raw)
    .replace(/[“”]/g, "'")
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
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

  let parts = t.split(/(?<=다\.|함\.|음\.|됨\.|필요\.|검토\.|권장\.|주시\.|전망\.|기회\.)\s+/u).filter((p) => p.trim());
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
  return t;
}

export function polishGrade(grade: Grade, title: string, takeaway: string): Grade {
  // 16차: 승격 게이트는 제목 + 시사점 사실 부분만 본다 (할 일 상용구 오탐 방지)
  const t = `${title} ${factPart(takeaway)}`;
  if (grade === "breaking" && !/장애|다운|중단|지연|가격|인하|인상/.test(t)) return "note";
  // 강등: LLM이 important로 매겼어도 힌트 미매치 → note
  // (15차 리뷰: 여기서 바로 return 하지 않고 아래 승격 검사로 흘려보낸다 — 힌트는 양방향 게이트)
  let g = grade;
  if (g === "important" && !IMPORTANT_HINT.test(t)) g = "note";
  // 승격: LLM이 note로 매겼어도 강한 중요 신호가 있으면 important로 승격
  // (강등된 important도 여기서 구제됨 — 대칭 게이트)
  // 15차 평가: 프런티어 모델 출시·벤치마크·실적도 승격 (promppy [중요] 커버리지 대응)
  // 의식/행사성 제외 가드는 isFrontierEvent 내부에만 — 리스크 경로는 막지 않는다
  if (g === "note" && (IMPORTANT_HINT.test(t) || isFrontierEvent(title, takeaway))) {
    return "important";
  }
  return g;
}

export function shouldDrop(title: string, summary: string): boolean {
  return DROP_HINT.test(title) || DROP_HINT.test(summary);
}

// 단어 중간 절단 아티팩트 (LLM이 음절을 떨어뜨린 경우 — 예: "펌웨어다" → "펌웨다", "현실화" → "현실회")
// 17차 P0: "[중요] 앤트로픽" 시사점 "…엣지 디바이스 펌웨다." 7라운드 잔존.
// dedupe 승자라 삭제 대상이 아니고, 기존 파편 검사(완결 어미 기준)는
// "펌웨다."를 정상 종결로 통과시켜서 별도 감지가 필요함.
// 20차: 제목 절단("…자기개선 루프 현실회")도 감지 — needsRewrite에서 제목도 검사.
// (?![복피]) — "현실회복"/"현실회피" 같은 정상 단어 오탐 방지. 절단 아티팩트는
// 뒤에 복/피가 올 수 없음 ("현실화"의 음절 탈락이므로).
// 향후 발견되는 패턴은 여기에 누적.
const TRUNCATED_HINT = /펌웨다|현실회(?![복피])|다다\.|요요\.|됨됨\.|니다다\./;

function looksTruncated(s: string): boolean {
  return TRUNCATED_HINT.test(s ?? "");
}

export function needsRewrite(item: Pick<NewsItem, "title" | "takeaway" | "summary" | "grade">): boolean {
  if (shouldDrop(item.title, item.summary)) return true;
  if (hangulLen(item.title) > 46) return true;
  if (hangulLen(item.takeaway) > 95) return true;
  if (LEAD_HINT.test(item.takeaway) && hangulLen(item.takeaway) > 55) return true;
  if (/해라|하라/.test(item.takeaway)) return true;
  if (/[A-Za-z]{4,}·[A-Za-z]{4,}/.test(item.takeaway)) return true;
  // 16차: 힌트 검사는 시사점 사실 부분만 (할 일 상용구 오탐 방지).
  // 프런티어 승격분(로봇팔 벤치, 베라 CPU 랙)도 힌트로 인정 — 매 수집마다 재작성 방지.
  const ttw = `${item.title} ${factPart(item.takeaway)}`;
  if (item.grade === "important" && !(IMPORTANT_HINT.test(ttw) || isFrontierEvent(item.title, item.takeaway))) return true;
  // 승격: [참고]인데 강한 중요 신호가 있으면 재작성 → polishGrade 승격 로직이 적용됨
  // (기존 [참고] 기사는 승격 로직 배포 전 분류분이라 재작성이 필요)
  // 15차 평가: 프런티어 이벤트도 승격 대상 ([중요] 커버리지)
  // (15차 리뷰: 의식/행사성 제외 가드는 isFrontierEvent 내부에만 — 리스크 경로는 막지 않는다)
  if (item.grade === "note" && (IMPORTANT_HINT.test(ttw) || isFrontierEvent(item.title, item.takeaway)))
    return true;
  // 파편 시사점: 아티팩트 패턴이면 무조건 재작성 (길이 조건 제거 — Claude 발견: 파편은 짧아서 기존 조건에 안 걸림)
  // ",다.", "·" 시작, 조사/명사 단독 종결, 단어 중간 절단
  const takeaway = item.takeaway.trim();
  if (/,다\.|^[·•\-–—]/.test(takeaway)) return true;
  // 17차 P0: 단어 중간 절단 아티팩트("펌웨다.", "다다." 등)는 무조건 재작성
  // 20차: 제목도 검사 ("현실회" 같은 제목 음절 탈락)
  if (looksTruncated(item.title) || looksTruncated(takeaway) || looksTruncated(item.summary)) return true;
  // 마지막 문장이 조사(에/의/를/을/가/이/와/과/로/에서/에게)로 끝나면 파편
  if (/(에|의|를|을|가|이|와|과|로|에서|에게|한테|보다|처럼)\.$/.test(takeaway)) return true;
  // 마지막 문장이 명사 단독으로 끝나면 파편 (예: "국산 챗봇.", "가격·성능.", "해당 지역.")
  // 단, 완결형 어미(다./요./필요./권장./검토./확인./점검.)로 끝나면 완결
  const sentences = takeaway.split(/(?<=다\.|요\.|필요\.|검토\.|권장\.|확인\.|점검\.|주시\.|전망\.|기회\.)\s*/u);
  const lastSent = sentences[sentences.length - 1]?.trim() ?? "";
  if (lastSent && !/(다\.|요\.|필요\.|검토\.|권장\.|확인\.|점검\.|주시\.|전망\.|기회\.)$/.test(lastSent)) {
    // 마지막 문장이 완결 어미로 안 끝나면 파편 (길이 무관)
    // 단, 동사형 종결(진출., 확대., 강화., 묶임., 지목됨.)은 완결로 인정
    if (!/(출|입|화|강|약|임|됨|남|됨|됨|씀|옴|감|남|됨|됨|됨)\.$/.test(lastSent)) {
      return true;
    }
  }
  // 20차: 시사점 마지막 문장이 할 일 어미(필요/권장/검토/확인/점검/주시/기회)로 끝나지 않으면 재작성
  // "…몰릴 수 있다.", "…진입.", "…해야 한다." 같은 사실 서술형 결말 방지
  if (lastSent && !/(필요|권장|검토|확인|점검|주시|기회)\.$/.test(lastSent)) return true;
  return false;
}

export function polishPayload(
  json: Record<string, unknown>,
  entry: { title: string; source: string; sourceUrl: string; summary: string; date: number },
): IngestPayload {
  const title = polishTitle(String(json.title || entry.title));
  const takeaway = polishTakeaway(String(json.takeaway || entry.summary));
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
