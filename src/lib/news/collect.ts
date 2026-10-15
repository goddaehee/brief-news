import { isSeedItem } from "./data";
import { chatJson, resolveLlm } from "./llm";
import { deskUser, DESK_SYSTEM, needsRewrite, polishPayload, shouldDrop } from "./desk";
import {
  COLLECT_COOLDOWN_MS,
  COLLECT_MAX_NEW,
  COLLECT_REWRITE_MAX,
  INGEST_MAX_BATCH,
  NEWS_SOURCES,
  SOURCE_RANK,
} from "./sources";
import { decodeFeedBytes, parseFeedXml, parseNewsMarkdown } from "./parse";
import {
  beginRun,
  deleteItem,
  ensureSeeded,
  finishRun,
  insertItem,
  lastRunAt,
  listNews,
  releaseCollectLock,
  tryCollectLock,
  updateItem,
  upsertBriefing,
} from "./repo";
import type { CollectResult, IngestPayload } from "./types";

const AI_HINT =
  /\b(ai|a\.i\.|llm|gpt-?\d*|chatgpt|claude|gemini|grok|openai|anthropic|xai|nvidia|hbm|gpu|agent|인공지능|생성형|챗봇|딥러닝|에이전트|언어\s*모델|파운데이션\s*모델)\b/i;
const SKIP_HINT =
  /장내매수|최대주주|액면병합|변경상장|유상증자|무상증자|주식\s*취득|임원\s*변동|거래정지|시간외|배당\s*공시|youtube|youtu\.be|노트북 후보|특징주|테마주|급등주|상한가|하한가|공시\b|거주 세계|자사주|만찬|국빈|시상식|포토\s*뉴스|오늘의 인물/i;

/**
 * 벤더 블로그(OpenAI/Google/NVIDIA 등)의 고객 사례(customer story)는 PR이므로 수집에서 제외.
 * 예: "Amp puts AI agents to work beyond code with OpenAI models" (출처: OpenAI)
 *     "SentinelOne cuts malware analysis from weeks to hours" (본문에 "With OpenAI Daybreak")
 * 이런 글은 헤드라인의 주어가 타사인데 출처가 벤더라 독자를 혼란스럽게 한다.
 * (12차 평가: 출처 라벨 오류 1건→2건 확산의 실제 원인 — 매핑 버그가 아니라 고객 사례 유입)
 */
const VENDOR_BLOG_SOURCES = new Set([
  "OpenAI",
  "Google AI",
  "Google DeepMind",
  "NVIDIA",
  "Hugging Face",
]);
/** "How [기업] ..." — 고객 사례의 전형적인 제목 형식 (단, "How we ..."는 자사 글이므로 제외) */
const CUSTOMER_STORY_TITLE_HINT = /^how\s+(?!we\b)[a-z0-9]/i;
/** "with OpenAI models", "With OpenAI Daybreak", "using ChatGPT API" — 타사 주어 + 자사 제품 언급 */
const VENDOR_PRODUCT_HINT =
  /\b(with|using|built\s+with|powered\s+by)\s+(openai|chatgpt|gpt-?\d*|codex|gemini|deepmind|nvidia)\s+(models?|technology|api|platform|daybreak)\b/i;

function isVendorCustomerStory(e: RawEntry): boolean {
  if (!VENDOR_BLOG_SOURCES.has(e.source)) return false;
  const text = `${e.title} ${e.summary}`;
  return CUSTOMER_STORY_TITLE_HINT.test(text) || VENDOR_PRODUCT_HINT.test(text);
}

function lockOwner(): string {
  return `brief-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function collectOnce(): Promise<CollectResult> {
  await ensureSeeded();
  const owner = lockOwner();
  const locked = await tryCollectLock(owner);
  if (!locked) {
    return {
      ok: true,
      status: "rate_limited",
      fetched: 0,
      inserted: 0,
      skipped: 0,
      note: "다른 장비가 수집 중입니다. 같은 글을 두 번 요약하지 않습니다.",
      lastRunAt: await lastRunAt(),
    };
  }

  try {
    const last = await lastRunAt();
    if (last && Date.now() - last < COLLECT_COOLDOWN_MS) {
      return {
        ok: true,
        status: "rate_limited",
        fetched: 0,
        inserted: 0,
        skipped: 0,
        note: "최근 수집 후 10분이 지나지 않았습니다. 같은 파이프라인을 크론이 쳐도 중복 과금이 나지 않습니다.",
        lastRunAt: last,
      };
    }

    const runId = await beginRun();
    let fetched = 0;
    let inserted = 0;
    let skipped = 0;

    try {
      const existing = await listNews();
      // rewriteStale과 pullRss는 독립적이므로 병렬 실행 (Vercel 60초 제한 대응)
      const [rewritten, entries] = await Promise.all([
        rewriteStale(existing),
        pullRss(),
      ]);
      fetched = entries.length;
      const fresh: RawEntry[] = [];
      const newCap = rewritten > 0 ? Math.min(3, COLLECT_MAX_NEW) : COLLECT_MAX_NEW;
      // DB 쿼리 대신 메모리의 existing Set으로 중복 체크 (순차 DB 왕복 제거)
      const existingUrls = new Set(existing.filter((i) => !isSeedItem(i)).map((i) => i.sourceUrl));
      const existingItems = existing.filter((i) => !isSeedItem(i));
      // 소스별 하드캡: 단일 소스 최대 6건 (풍선 효과 방지 — ZDNet 잡으니 인공지능신문이 올라옴)
      const SOURCE_CAP = 6;
      const sourceCounts = new Map<string, number>();
      for (const item of existingItems) {
        sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
      }
      for (const e of entries) {
        if (existingUrls.has(e.sourceUrl)) {
          skipped += 1;
          continue;
        }
        // 소스별 캡 체크: 이미 6건 이상인 소스는 스킵
        const sourceCount = sourceCounts.get(e.source) ?? 0;
        if (sourceCount >= SOURCE_CAP) {
          skipped += 1;
          continue;
        }
        if (
          existingItems.some(
            (i) =>
              tooSimilar(i.title, e.title, i.publishedAt, e.date) ||
              tooSimilar(i.originalTitle, e.title, i.publishedAt, e.date),
          ) ||
          fresh.some((f) => tooSimilar(f.title, e.title, f.date, e.date))
        ) {
          skipped += 1;
          continue;
        }
        fresh.push(e);
        existingUrls.add(e.sourceUrl); // 같은 배치 내 중복 방지
        sourceCounts.set(e.source, sourceCount + 1);
        if (fresh.length >= newCap) break;
      }

      const classified = await Promise.all(fresh.map((entry) => classifyEntry(entry)));
      for (const payload of classified) {
        if (payload.keep === false) {
          skipped += 1;
          continue;
        }
        const ok = await insertItem(payload);
        if (ok) inserted += 1;
        else skipped += 1;
      }

      if (inserted > 0 || rewritten > 0) await refreshBriefing();

      const note =
        inserted > 0 || rewritten > 0
          ? `RSS ${fetched}건 중 ${inserted}건 편성${rewritten ? ` · ${rewritten}건 재작성` : ""}${resolveLlm() ? "" : " · LLM 키 없음(원문 폴백)"}`
          : fetched === 0
            ? "RSS를 가져오지 못했습니다. 네트워크 또는 피드 주소를 확인하세요."
            : "새 소식이 없거나 모두 중복입니다.";

      await finishRun(runId, {
        status: "ok",
        fetched,
        inserted,
        skipped,
        note,
      });
      return {
        ok: true,
        status: "ok",
        fetched,
        inserted,
        skipped,
        note,
        lastRunAt: Date.now(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "collect failed";
      await finishRun(runId, {
        status: "error",
        fetched,
        inserted,
        skipped,
        note: message,
      });
      return {
        ok: false,
        status: "error",
        fetched,
        inserted,
        skipped,
        note: message,
        lastRunAt: Date.now(),
      };
    }
  } finally {
    await releaseCollectLock(owner);
  }
}

type RawEntry = {
  title: string;
  sourceUrl: string;
  source: string;
  date: number;
  summary: string;
  titleMustMatch?: boolean;
};

function keepEntry(e: RawEntry): boolean {
  if (SKIP_HINT.test(e.title) || SKIP_HINT.test(e.summary)) return false;
  if (isVendorCustomerStory(e)) return false;
  const target = e.titleMustMatch ? e.title : `${e.title} ${e.summary}`;
  return AI_HINT.test(target);
}

/** Nitter status URLs -> canonical x.com URLs (Nitter instances are flaky). */
function rewriteNitterUrl(url: string): string {
  const m = url.match(/^https?:\/\/[^/]+\/([^/?#]+)\/status\/(\d+)/);
  if (m) return `https://x.com/${m[1]}/status/${m[2]}`;
  return url;
}

async function pullRss(): Promise<RawEntry[]> {
  const results = await Promise.all(
    NEWS_SOURCES.map(async (src) => {
      try {
        const res = await fetch(src.rss, {
          headers: {
            "User-Agent": "brief-news-collector/1.0 (+https://brief.news)",
            Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html",
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return [] as RawEntry[];
        const buf = new Uint8Array(await res.arrayBuffer());
        const xml = decodeFeedBytes(buf, res.headers.get("content-type") ?? "");
        return parseFeedXml(xml, src.name).map((e) => ({
          title: e.title,
          sourceUrl: src.id.startsWith("x-") ? rewriteNitterUrl(e.link) : e.link,
          source: src.name,
          date: e.date,
          summary: e.summary,
          titleMustMatch: Boolean(src.titleMustMatch),
        }));
      } catch {
        return [] as RawEntry[];
      }
    }),
  );
  return results
    .flat()
    .filter(keepEntry)
    .sort(byDeskPriority)
    .filter((e, i, arr) => arr.findIndex((x) => x.sourceUrl === e.sourceUrl) === i);
}

function hasHangul(s: string): boolean {
  return /[\uAC00-\uD7A3]/.test(s);
}

function byDeskPriority(a: RawEntry, b: RawEntry): number {
  const recency = (e: RawEntry) => (Date.now() - e.date < 6 * 60 * 60 * 1000 ? 1 : 0);
  const ra = recency(a);
  const rb = recency(b);
  if (ra !== rb) return rb - ra;
  const pa = SOURCE_RANK[a.source] ?? 1;
  const pb = SOURCE_RANK[b.source] ?? 1;
  if (pa !== pb) return pb - pa;
  const ha = hasHangul(a.title) ? 1 : 0;
  const hb = hasHangul(b.title) ? 1 : 0;
  if (ha !== hb) return hb - ha;
  return b.date - a.date;
}

function foldTitle(s: string): string {
  return normalizeProductNames(s)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^0-9a-z\uAC00-\uD7A3]+/gi, "")
    .slice(0, 96);
}

// 영문/한글 표기 변형 통일 (예: Gemini ↔ 제미나이, ChatGPT ↔ 챗GPT)
// 표기만 다른 중복 기사를 잡기 위한 정규화
function normalizeProductNames(s: string): string {
  const map: [RegExp, string][] = [
    [/제미나이/gi, "gemini"],
    [/챗gpt/gi, "chatgpt"],
    [/챗지피티/gi, "chatgpt"],
    [/클로드/gi, "claude"],
    [/오픈ai/gi, "openai"],
    [/앤스로픽/gi, "anthropic"],
    [/앤트로픽/gi, "anthropic"],
    [/딥시크/gi, "deepseek"],
    [/아르곤/gi, "argon"],
    [/엔비디아/gi, "nvidia"],
    [/구글/gi, "google"],
    [/마이크로소프트/gi, "microsoft"],
    [/메타/gi, "meta"],
    [/애플/gi, "apple"],
    [/아마존/gi, "amazon"],
    [/테슬라/gi, "tesla"],
    [/디즈니/gi, "disney"],
    [/캐릭터닷ai/gi, "characterai"],
    [/캐릭터ai/gi, "characterai"],
  ];
  let out = s;
  for (const [re, rep] of map) out = out.replace(re, rep);
  return out;
}

function tooSimilar(a: string, b: string, da?: number, db?: number): boolean {
  const fa = foldTitle(a);
  const fb = foldTitle(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  if (fa.length >= 12 && fb.length >= 12 && (fa.includes(fb) || fb.includes(fa))) return true;
  // 주제 앵커 규칙 (P1): 핵심 고유명사 2개 이상 공유 → 같은 사건
  if (sharesTopicAnchor(a, b, da, db)) return true;
  // 같은 사건을 다르게 쓴 제목: 핵심 토큰 겹침으로 잡는다.
  // 토큰 단계에도 정규화 적용 (P1): "앤스로픽/앤트로픽" 같은 표기 변형 흡수
  const tokens = (s: string) =>
    new Set(
      normalizeProductNames(s)
        .toLowerCase()
        .replace(/[^0-9a-z\uAC00-\uD7A3]+/gi, " ")
        .split(" ")
        .filter((t) => t.length >= 2),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size >= 3 && tb.size >= 3) {
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter += 1;
    if (inter >= 3 && inter / Math.min(ta.size, tb.size) >= 0.6) return true;
  }
  return false;
}

// 앵커 불용어: 일반 명사·보도 상투어는 고유명사가 아니므로 앵커에서 제외.
// 오탐 사례: "삼성전자, 차세대 AI 반도체 HBM4 양산 돌입" vs
// "SK하이닉스, AI 서버용 HBM4 출하 확대" → "ai"+"hbm" 2개로 오탐.
const ANCHOR_STOPWORDS = new Set([
  // 영문 도메인 일반어
  "ai", "hbm", "llm", "gpu", "npu", "api", "sdk", "it", "os", "pc",
  "vr", "ar", "xr", "cloud", "data", "edge", "agent", "chat", "bot",
  // 한글 도메인 일반어
  "모델", "기술", "개발", "반도체", "서버", "데이터", "학습", "추론",
  "플랫폼", "서비스", "솔루션", "시스템", "시장", "산업", "국내", "글로벌",
  "차세대", "신규", "최신", "대형", "소형",
  // 보도 상투어 (행위·상태)
  "출시", "발표", "공개", "진출", "확대", "돌입", "양산", "출하", "도입",
  "적용", "지원", "선정", "추진", "강화", "협력", "인수", "투자", "출범",
  "개최", "개시",
]);

// 주제 앵커 규칙 (P1): 정규화된 고유명사 토큰(영문 2자+, 한글 2자+) 중
// 양쪽 모두에 등장하는 앵커가 2개 이상이면 같은 사건으로 간주.
// ("카카오 FDE" vs "카카오 카나나"는 공유 앵커 1개라 안전)
// 불용어 제외 + 공통 앵커 중 최소 1개는 영문 고유명사여야 오탐 방지.
// pubDate 차이가 72시간을 넘으면 후속 보도로 보고 비교 제외.
function sharesTopicAnchor(a: string, b: string, da?: number, db?: number): boolean {
  if (da != null && db != null && Math.abs(da - db) > 72 * 3600 * 1000) return false;
  const anchors = (s: string): Set<string> => {
    const raw = normalizeProductNames(s).toLowerCase().match(/[a-z]{2,}|[\uAC00-\uD7A3]{2,}/g) ?? [];
    // 한글 조사 탈락 (카카오가 → 카카오) + 불용어 제외
    return new Set(
      raw
        .map((t) => t.replace(/(에서|으로|에게|부터|까지|처럼|보다|은|는|이|가|을|를|의|에|와|과|도|만|로)$/, ""))
        .filter((t) => t.length >= 2 && !ANCHOR_STOPWORDS.has(t)),
    );
  };
  const A = anchors(a);
  const B = anchors(b);
  const common = [...A].filter((t) => B.has(t));
  if (common.length < 2) return false;
  // 일반 명사 2개가 앵커를 채우는 오탐 방지: 최소 1개는 영문 고유명사(회사·제품명)
  return common.some((t) => /^[a-z]+$/.test(t));
}

async function rewriteStale(existing: Awaited<ReturnType<typeof listNews>>): Promise<number> {
  if (!resolveLlm()) return 0;
  const stale = existing.filter((i) => !isSeedItem(i) && needsRewrite(i)).slice(0, COLLECT_REWRITE_MAX);
  // 순차 처리 시 최대 3×25초=75초 → 병렬로 변경 (Vercel 60초 제한 대응)
  const results = await Promise.all(
    stale.map(async (item): Promise<number> => {
      if (shouldDrop(item.title, item.summary) || shouldDrop(item.originalTitle, item.summary)) {
        return (await deleteItem(item.id)) ? 1 : 0;
      }
      const payload = await classifyEntry({
        title: item.originalTitle || item.title,
        sourceUrl: item.sourceUrl,
        source: item.source,
        date: item.publishedAt,
        summary: item.summary,
      });
      if (payload.keep === false) {
        return (await deleteItem(item.id)) ? 1 : 0;
      }
      payload.publishedAt = item.publishedAt;
      return (await updateItem(item.id, payload)) ? 1 : 0;
    }),
  );
  return results.reduce((a, b) => a + b, 0);
}

async function classifyEntry(entry: RawEntry): Promise<IngestPayload> {
  if (shouldDrop(entry.title, entry.summary)) {
    return { ...fallbackPayload(entry), keep: false };
  }
  if (!resolveLlm()) return fallbackPayload(entry);

  const json = await chatJson({
    system: DESK_SYSTEM,
    user: deskUser(entry),
  });

  if (!json) return fallbackPayload(entry);
  if (json.keep === false) {
    return { ...fallbackPayload(entry), keep: false };
  }
  const payload = polishPayload(json, entry);
  if (shouldDrop(payload.title, payload.summary)) {
    return { ...payload, keep: false };
  }
  return payload;
}

function fallbackPayload(entry: RawEntry): IngestPayload {
  const takeaway = (entry.summary || entry.title).slice(0, 160);
  const topics = guessTopics(`${entry.title} ${entry.summary} ${entry.source}`);
  return {
    title: entry.title.slice(0, 180),
    takeaway,
    summary: entry.summary.slice(0, 800) || takeaway,
    source: entry.source,
    sourceUrl: entry.sourceUrl,
    originalTitle: entry.title,
    grade: "note",
    tip: false,
    topics,
    publishedAt: entry.date,
  };
}

function guessTopics(text: string): string[] {
  const t = text.toLowerCase();
  const found: string[] = [];
  const rules: [string, string][] = [
    ["kimi k3", "kimi-k3"],
    ["kimi-k3", "kimi-k3"],
    ["kimik3", "kimi-k3"],
    ["kimi", "kimi-k3"],
    ["opus 5", "opus-5"],
    ["opus-5", "opus-5"],
    ["opus5", "opus-5"],
    ["bonsai 27", "bonsai-27b"],
    ["bonsai-27", "bonsai-27b"],
    ["bonsai", "bonsai-27b"],
    ["claude code", "claude-code"],
    ["claude-code", "claude-code"],
    ["claudecode", "claude-code"],
    ["openai", "openai"],
    ["gpt", "openai"],
    ["anthropic", "anthropic"],
    ["claude", "claude"],
    ["gemini", "google"],
    ["google", "google"],
    ["deepmind", "google"],
    ["xai", "xai"],
    ["grok", "xai"],
    ["agent", "agent"],
    ["에이전트", "agent"],
    ["local", "local-llm"],
    ["open source", "open-source"],
    ["opensource", "open-source"],
    ["오픈소스", "open-source"],
    ["nvidia", "hardware"],
    ["gpu", "hardware"],
    ["hbm", "hardware"],
    ["secur", "security"],
    ["regulat", "regulation"],
    ["규제", "regulation"],
    ["prompt", "prompt"],
    ["프롬프트", "prompt"],
    ["benchmark", "benchmark"],
    ["벤치마크", "benchmark"],
    ["korea", "korea-ai"],
    ["네이버", "korea-ai"],
    ["삼성", "korea-ai"],
    ["하이퍼클로바", "korea-ai"],
    ["타임스", "korea-ai"],
    ["zdnet", "korea-ai"],
    ["전자신문", "korea-ai"],
    ["바이라인", "korea-ai"],
    ["테크m", "korea-ai"],
    ["디일렉", "korea-ai"],
    ["인공지능신문", "korea-ai"],
    ["aitimes", "korea-ai"],
    ["etnews", "korea-ai"],
  ];
  for (const [k, slug] of rules) {
    if (t.includes(k) && !found.includes(slug)) found.push(slug);
    if (found.length >= 3) break;
  }
  return found;
}

async function refreshBriefing() {
  const items = (await listNews()).filter((i) => !isSeedItem(i));
  if (!items.length) return;
  const pool = items.filter((i) => i.grade === "breaking" || i.grade === "important");
  const rest = items.filter((i) => !pool.includes(i));
  const lines = [...pool, ...rest].slice(0, 6).map((i) => i.title);
  await upsertBriefing(lines);
}

export async function ingestPayloads(items: IngestPayload[]): Promise<{ inserted: number; skipped: number }> {
  await ensureSeeded();
  // P0: RSS 수집 경로와 동일한 중복 검사. X 보충 수집이 볼륨을 키우기 전 구멍 봉쇄.
  // (X 배치는 건수가 적어 전체 조회 부담이 작다)
  const existingItems = (await listNews()).filter((i) => !isSeedItem(i));
  const existingUrls = new Set(existingItems.map((i) => i.sourceUrl));
  const batch: IngestPayload[] = [];
  let inserted = 0;
  let skipped = 0;
  for (const item of items.slice(0, INGEST_MAX_BATCH)) {
    if (!item.title || !item.sourceUrl) {
      skipped += 1;
      continue;
    }
    if (existingUrls.has(item.sourceUrl)) {
      skipped += 1;
      continue;
    }
    if (
      existingItems.some(
        (i) =>
          tooSimilar(i.title, item.title, i.publishedAt, item.publishedAt) ||
          tooSimilar(i.originalTitle, item.title, i.publishedAt, item.publishedAt),
      ) ||
      batch.some((f) => tooSimilar(f.title, item.title, f.publishedAt, item.publishedAt))
    ) {
      skipped += 1;
      continue;
    }
    batch.push(item);
    existingUrls.add(item.sourceUrl);
    const ok = await insertItem(item);
    if (ok) inserted += 1;
    else skipped += 1;
  }
  if (inserted > 0) await refreshBriefing();
  return { inserted, skipped };
}

export async function ingestMarkdownBatch(markdownFiles: string[]) {
  const payloads = markdownFiles.map(parseNewsMarkdown);
  return ingestPayloads(payloads);
}
