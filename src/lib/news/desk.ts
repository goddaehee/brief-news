import { TOPIC_MAP } from "./topics";
import type { Grade, IngestPayload, NewsItem } from "./types";

export const ALLOWED_TOPICS = Object.keys(TOPIC_MAP);

/** Ceremony / photo ops. Original desk drops these. */
export const DROP_HINT =
  /만찬|국빈|동행|시상식|포토\s*뉴스|오늘의 인물|출근길|레드카펫|기념촬영|개막식 참석/i;

/** Pipeline-now. Name-drops (출시·연구소) are 참고. */
export const IMPORTANT_HINT =
  /연기|가격|인하|인상|침해|장애|중단|제재|유출|다운|수출 통제|유출|계정 탈취|출시 연기/;

export const LEAD_HINT = /마련했다|발표했다|밝혔다|나섰다|전했다|보도했다/;

export const DESK_SYSTEM = `당신은 한국 AI 실무자용 뉴스 터미널 brief_의 편집장이다.
원문을 번역·축약하지 말고, 데스크가 다시 쓴다. JSON만 출력.

헤드라인
- 28~44자. 원문 제목 복사 금지. 부제·수치 나열 꼬리 자를 것.
- 주어(회사·제품·규제) + 행위. 제품·법안 이름만 '따옴표'.
- 말줄임표는 ... (점 세 개). 신문 인용문("기다릴 가치 있다")은 제목 끝이 짧을 때만.

시사점 takeaway — 원본 문장 뼈대
- 정확히 두 조각: "사실 한 줄. 할 일 한 줄."
- 할 일 어미: 필요 / 검토 / 권장 / 주시 / 기회. 명령조(해라·하라) 금지.
- 원문 첫 문장·리드 복사 금지. 영어 괄호 병기 금지.

요약 summary
- 3문장. 사실만. 시사점과 겹치지 말 것.

등급 grade
- 기본 note(참고). 원본 피드도 열의 70% 이상이 참고.
- important: 출시 연기·가격·침해·장애·제재처럼 이번 주 파이프라인에 바로 닿을 때만.
- breaking: 장애, 당일 출시, 즉시 가격 변경만.
- tip: 무료 모델·프롬프트·로컬 설정처럼 오늘 바로 쓸 수 있을 때만.

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
{"keep":true,"title":"오픈AI, 'AI 정렬 실패' 사례 보고 체계 구축","takeaway":"모델 안전성·투명성 검증 절차 강화. 정렬 문제 대응이 공론화될 전망.","summary":"오픈AI가 정렬 실패 사례를 추적해 공개하는 보고 체계를 마련했다. 예상 밖 모델 행동을 조사 대상으로 올린다. 안전 거버넌스 논의가 제품 일정에 붙을 수 있다.","grade":"note","tip":false,"topics":["openai"]}
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

export function polishTitle(raw: string): string {
  let t = raw
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
  let t = raw
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
  t = parts.slice(0, 2).join(" ").trim();
  t = clipChars(t, 90);
  if (t && !/[.다함음요]$/.test(t)) t += ".";
  return t;
}

export function polishGrade(grade: Grade, title: string, takeaway: string): Grade {
  const t = `${title} ${takeaway}`;
  if (grade === "breaking" && !/장애|다운|중단|지연|가격|인하|인상/.test(t)) return "note";
  if (grade === "important" && !IMPORTANT_HINT.test(t)) return "note";
  return grade;
}

export function shouldDrop(title: string, summary: string): boolean {
  return DROP_HINT.test(title) || DROP_HINT.test(summary);
}

export function needsRewrite(item: Pick<NewsItem, "title" | "takeaway" | "summary" | "grade">): boolean {
  if (shouldDrop(item.title, item.summary)) return true;
  if (hangulLen(item.title) > 46) return true;
  if (hangulLen(item.takeaway) > 95) return true;
  if (LEAD_HINT.test(item.takeaway) && hangulLen(item.takeaway) > 55) return true;
  if (/해라|하라/.test(item.takeaway)) return true;
  if (/[A-Za-z]{4,}·[A-Za-z]{4,}/.test(item.takeaway)) return true;
  if (item.grade === "important" && !IMPORTANT_HINT.test(`${item.title} ${item.takeaway}`)) return true;
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
