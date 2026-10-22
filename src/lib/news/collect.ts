import { isSeedItem } from "./data";
import { chatJson, resolveLlm } from "./llm";
import { deskUser, DESK_SYSTEM, fixTypos, needsRewrite, polishPayload, shouldDrop } from "./desk";
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
import type { CollectResult, IngestPayload, NewsItem } from "./types";

const AI_HINT =
  /\b(ai|a\.i\.|llm|gpt-?\d*|chatgpt|claude|gemini|grok|openai|anthropic|xai|nvidia|hbm|gpu|agent|인공지능|생성형|챗봇|딥러닝|에이전트|언어\s*모델|파운데이션\s*모델)\b/i;
const SKIP_HINT =
  /장내매수|최대주주|액면병합|변경상장|유상증자|무상증자|주식\s*취득|임원\s*변동|거래정지|시간외|배당\s*공시|youtube|youtu\.be|노트북 후보|특징주|테마주|급등주|상한가|하한가|공시\b|거주 세계|자사주|만찬|국빈|시상식|포토\s*뉴스|오늘의 인물/i;

/**
 * 벤더 블로그(OpenAI/Google/NVIDIA 등)의 고객 사례(customer story)·에코시스템 홍보는 PR이므로 수집에서 제외.
 * 예: "Amp puts AI agents to work beyond code with OpenAI models" (출처: OpenAI)
 *     "SentinelOne cuts malware analysis from weeks to hours" (본문에 "With OpenAI Daybreak")
 *     "노르딕, 엔비디아 손잡고 유럽 AI 컴퓨팅 허브로" (출처: NVIDIA, blogs.nvidia.com)
 * 이런 글은 헤드라인의 주어가 타사인데 출처가 벤더라 독자를 혼란스럽게 한다.
 * (12차 평가: 출처 라벨 오류 1건→2건 확산의 실제 원인 — 매핑 버그가 아니라 고객 사례 유입)
 * (13차 평가: 벤더 필터가 "How..." 패턴만 보고 에코시스템 홍보 글을 통과시킴 — 파트너십 패턴 추가)
 */
const VENDOR_BLOG_SOURCES = new Set([
  "OpenAI",
  "Google AI",
  "Google DeepMind",
  "NVIDIA",
  "Hugging Face",
]);
/** 벤더 자사 블로그 도메인 (소스 라벨이 달라도 URL로 식별 — 방어선) */
const VENDOR_BLOG_DOMAINS =
  /(^|\.)blogs\.nvidia\.com$|(^|\.)openai\.com$|(^|\.)blog\.google$|(^|\.)deepmind\.google$|(^|\.)huggingface\.co$/i;
/** "How [기업] ..." — 고객 사례의 전형적인 제목 형식 (단, "How we ..."는 자사 글이므로 제외) */
const CUSTOMER_STORY_TITLE_HINT = /^how\s+(?!we\b)[a-z0-9]/i;
/** "with OpenAI models", "With OpenAI Daybreak", "using ChatGPT API" — 타사 주어 + 자사 제품 언급 */
const VENDOR_PRODUCT_HINT =
  /\b(with|using|built\s+with|powered\s+by)\s+(openai|chatgpt|gpt-?\d*|codex|gemini|deepmind|nvidia)\s+(models?|technology|api|platform|daybreak)\b/i;
/** "손잡고", "와 협력", "파트너십", "협업" — 벤더 블로그의 파트너십/에코시스템 홍보 발표 */
const PARTNERSHIP_HINT =
  /손잡고|손을\s*잡|파트너십|파트너\s*협력|제휴|합작|협업|공동\s*(개발|발표|연구|협력)|와\s*협력|과\s*협력|와\s*함께|과\s*함께|partners?\s+with|partnership|collaborat\w*|teams?\s+up\s+with|teaming\s+up|joins?\s+forces/i;

function isVendorBlog(e: RawEntry): boolean {
  if (VENDOR_BLOG_SOURCES.has(e.source)) return true;
  try {
    return VENDOR_BLOG_DOMAINS.test(new URL(e.sourceUrl).hostname);
  } catch {
    return false;
  }
}

function isVendorCustomerStory(e: RawEntry): boolean {
  if (!isVendorBlog(e)) return false;
  const text = `${e.title} ${e.summary}`;
  return (
    CUSTOMER_STORY_TITLE_HINT.test(text) ||
    VENDOR_PRODUCT_HINT.test(text) ||
    PARTNERSHIP_HINT.test(text)
  );
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
      // rewriteStale이 삭제/업데이트했을 수 있으므로 최신 피드로 다시 조회 후 중복 정리 (P2)
      const deduped = await dedupeExisting(await listNews());
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
      // P0-2: 컷오프는 분류 뒤로 이동. 후보를 넉넉히(최대 15건·소스당 최대 2건) 수집 → 전원 분류 → keep=true 중 상위 newCap건만 편입
      const BATCH_MAX = 15;
      const BATCH_SOURCE_CAP = 2;
      const batchSourceCounts = new Map<string, number>();
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
        // 배치 내 소스당 최대 2건 — 고순위 소스(AI타임스 등)의 슬롯 독점 방지
        const batchCount = batchSourceCounts.get(e.source) ?? 0;
        if (batchCount >= BATCH_SOURCE_CAP) {
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
        batchSourceCounts.set(e.source, batchCount + 1);
        if (fresh.length >= BATCH_MAX) break;
      }

      // P0-1: summary가 빈 fresh 후보는 기사 본문 첫 ~500자를 발췌해 보강 (제목만 보고 keep=false 탈락 방지)
      await Promise.all(
        fresh.map(async (entry) => {
          if (entry.summary && entry.summary.trim().length >= 40) return;
          const lede = await fetchArticleLede(entry.sourceUrl);
          if (lede) entry.summary = lede;
        }),
      );

      const classified = await Promise.all(fresh.map((entry) => classifyEntry(entry)));
      for (const payload of classified) {
        if (payload.keep === false) {
          skipped += 1;
          continue;
        }
        // P0-2: 분류 뒤 컷오프 — keep=true 중 상위 newCap건만 편입 (entries는 byDeskPriority 정렬 순서 유지)
        if (inserted >= newCap) {
          skipped += 1;
          continue;
        }
        const ok = await insertItem(payload);
        if (ok) inserted += 1;
        else skipped += 1;
      }

      if (inserted > 0 || rewritten > 0 || deduped > 0) await refreshBriefing();

      const note =
        inserted > 0 || rewritten > 0 || deduped > 0
          ? `RSS ${fetched}건 중 ${inserted}건 편성${rewritten ? ` · ${rewritten}건 재작성` : ""}${deduped ? ` · ${deduped}건 중복 정리` : ""}${resolveLlm() ? "" : " · LLM 키 없음(원문 폴백)"}`
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

/** P0-1: RSS에 description이 없는 기사는 본문 첫 ~500자를 발췌 (제목만 보고 탈락 방지). 실패 시 "" 반환. */
async function fetchArticleLede(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "brief-news-collector/1.0 (+https://brief.news)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

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

// 표시 정규화: 고유명사 오타·표기 변형을 표준 표기로 (화면 표시용)
// normalizeProductNames()는 중복 비교용(전부 영문 통일)이고,
// 이건 표시 텍스트에 직접 적용 — 오타가 피드에 그대로 노출되는 것을 방지.
// 17차 P0: X @Reuters 신규 기사의 "앤스로픽" 오타 재유입 대응.
const DISPLAY_NAME_MAP: [RegExp, string][] = [
  [/앤스로픽/gi, "앤트로픽"],
];

function normalizeDisplayNames(s: string): string {
  let out = s;
  for (const [re, rep] of DISPLAY_NAME_MAP) out = out.replace(re, rep);
  return out;
}

// 26차 P0-2: X 파이프라인 품질 린터 — bare "확인."/"점검." 어미를 완결형으로 교정.
// X 수집은 desk.ts의 needsRewrite를 우회하므로 여기서 직접 처리.
function fixBareEnding(s: string): string {
  // "… 확인." → "… 확인 필요." (단, 이미 "확인 필요." 등이면 그대로)
  return s.replace(
    /(?<!필요|권장|검토|주시|기회)\s*(확인|점검)\.\s*$/,
    (m, verb) => ` ${verb} 필요.`
  ).trim();
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
  // 24차 P0: 오타/파편을 일반 stale보다 먼저 처리 — "앤스로픽"이 3라운드 정체된 원인.
  // needsRewrite는 통과하는데 큐 앞에서 밀려서 처리 안 됨.
  // 28차: 노려는 추가 (TYPO_HINT와 일치)
  const typoHint = /앤스로픽|펌웨다|현실회(?![복피])|&(quot|amp|apos|lt|gt|#\d+);|챗\(클로드\)|노려는|(?<=\s)대익(?=\s)/;
  const stale = existing
    .filter((i) => !isSeedItem(i) && needsRewrite(i))
    .sort((a, b) => {
      const aUrgent = typoHint.test(a.title) || typoHint.test(a.takeaway) ? 0 : 1;
      const bUrgent = typoHint.test(b.title) || typoHint.test(b.takeaway) ? 0 : 1;
      return aUrgent - bUrgent;
    })
    .slice(0, COLLECT_REWRITE_MAX);
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

// ============ dedupeExisting (P2): 기존 피드 중복 정리 ============
// 수집 시점 tooSimilar는 신규 입고분에만 동작하므로, 기존-기존 쌍은
// 여기서 잡는다. rewriteStale 다음에 collect 트랜잭션 안에서 실행.
// 안전장치: run당 최대 DEDUPE_DELETE_CAP건 삭제, 초과분은 다음 run으로.
const DEDUPE_DELETE_CAP = 3;

/** 등급 점수: [속보] > [중요] > [참고] > [팁] (4자 패널 합의) */
function gradeRank(i: Pick<NewsItem, "grade" | "tip">): number {
  if (i.grade === "breaking") return 30;
  if (i.grade === "important") return 20;
  return i.tip ? 0 : 10; // [참고] 10 > [팁] 0
}

/**
 * 클러스터 내 순위 점수 (높을수록 유지):
 * 등급 → 품질(needsRewrite 통과) → 신선도(publishedAt 최신)
 */
function rankScore(i: NewsItem): number {
  return (
    gradeRank(i) * 1e12 -
    (needsRewrite(i) ? 1e9 : 0) +
    Math.min(i.publishedAt, 9999999999999)
  );
}

function pickWinner(cluster: NewsItem[]): NewsItem {
  return [...cluster].sort((a, b) => rankScore(b) - rankScore(a))[0];
}

// 지역/범위 스코프 키워드: 두 제목의 스코프가 다르면 다른 소식이다.
// 예: "동남아 에이전틱 AI 진출" vs "아태 5개국 스마트시티 진출" → 각도 다름 → 둘 다 유지
const SCOPE_KEYWORDS = [
  "동남아",
  "동남아시아",
  "아태",
  "아시아태평양",
  "아시아",
  "북미",
  "남미",
  "미국",
  "중국",
  "일본",
  "유럽",
  "영국",
  "독일",
  "프랑스",
  "인도",
  "중동",
  "아프리카",
  "오세아니아",
  "국내",
  "해외",
  "글로벌",
];
const SCOPE_COUNT_HINT = /\d+\s*개(국|사|곳)/;

function scopeSet(title: string): Set<string> {
  const norm = normalizeProductNames(title).toLowerCase();
  const found = new Set<string>();
  for (const k of SCOPE_KEYWORDS) if (norm.includes(k)) found.add(k);
  const m = norm.match(SCOPE_COUNT_HINT);
  if (m) found.add(m[0].replace(/\s+/g, ""));
  return found;
}

/** 두 제목의 스코프가 같은가? 다르면 다른 각도 → 삭제 대상에서 제외 */
function sameScope(a: string, b: string): boolean {
  const sa = scopeSet(a);
  const sb = scopeSet(b);
  if (sa.size === 0 && sb.size === 0) return true; // 스코프 언급 없으면 같은 소식으로 간주
  if (sa.size !== sb.size) return false;
  for (const s of sa) if (!sb.has(s)) return false;
  return true;
}

/** 수집 시점과 동일한 판정 (제목+원문 대칭 비교). 중복이면 사유 문자열 반환. */
function dupPairReason(a: NewsItem, b: NewsItem): string | null {
  const pairs: [string, string][] = [
    [a.title, b.title],
    [a.originalTitle, b.title],
    [a.title, b.originalTitle],
  ];
  let similar = false;
  for (const [x, y] of pairs) {
    if (tooSimilar(x, y, a.publishedAt, b.publishedAt)) {
      similar = true;
      break;
    }
  }
  if (!similar) return null;
  // 로그용 사유 분류
  const fx = foldTitle(a.title);
  const fy = foldTitle(b.title);
  if (fx && fy) {
    if (fx === fy) return "fold일치";
    if (fx.length >= 12 && fy.length >= 12 && (fx.includes(fy) || fy.includes(fx)))
      return "fold포함";
  }
  if (sharesTopicAnchor(a.title, b.title, a.publishedAt, b.publishedAt))
    return "주제앵커(고유명사 2개+)";
  return "토큰겹침";
}

async function dedupeExisting(existing: NewsItem[]): Promise<number> {
  const items = existing.filter((i) => !isSeedItem(i));
  if (items.length < 2) return 0;

  // Union-Find로 중복 클러스터 탐지
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (let x = 0; x < items.length; x++) {
    for (let y = x + 1; y < items.length; y++) {
      const a = items[x];
      const b = items[y];
      const reason = dupPairReason(a, b);
      if (!reason) continue;
      // 소프트 중복(같은 발표·다른 각도)은 삭제 대상에서 제외
      if (!sameScope(a.title, b.title)) {
        console.log(
          `[dedupe] 스코프 다름 → 유지: "${a.title.slice(0, 36)}" / "${b.title.slice(0, 36)}" (${reason})`,
        );
        continue;
      }
      union(a.id, b.id);
    }
  }

  const clusters = new Map<string, NewsItem[]>();
  for (const i of items) {
    const r = find(i.id);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r)!.push(i);
  }

  let deleted = 0;
  const ordered = [...clusters.values()]
    .filter((c) => c.length > 1)
    .sort((p, q) => q.length - p.length || p[0].id.localeCompare(q[0].id));

  for (const cluster of ordered) {
    if (deleted >= DEDUPE_DELETE_CAP) break;
    const winner = pickWinner(cluster);
    const losers = cluster
      .filter((i) => i.id !== winner.id)
      .sort((p, q) => rankScore(p) - rankScore(q)); // 점수 낮은(버릴) 순
    for (const loser of losers) {
      if (deleted >= DEDUPE_DELETE_CAP) break;
      const reason = dupPairReason(loser, winner) ?? "중복";
      const ok = await deleteItem(loser.id);
      console.log(
        `[dedupe] 삭제 "${loser.title.slice(0, 40)}" (id=${loser.id}) ← 유지 "${winner.title.slice(0, 40)}" (id=${winner.id}) [${reason}]${ok ? "" : " [삭제실패]"}`,
      );
      if (ok) deleted += 1;
    }
  }
  return deleted;
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

/** 영문 우세 판정 (29차 P0): 한글 음절 비율이 낮으면 영문 원문으로 본다. */
function isEnglishDominant(s: string): boolean {
  const hangul = (s.match(/[가-힣]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const letters = hangul + latin;
  if (letters < 8) return false;
  return hangul / letters < 0.3;
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
  for (let item of items.slice(0, INGEST_MAX_BATCH)) {
    if (!item.title || !item.sourceUrl) {
      skipped += 1;
      continue;
    }
    // 29차 크로스 리뷰: 중복 URL은 데스크 패스(LLM) 전에 제외 — 이미 있는 기사를
    // 영문 게이트가 먼저 재작성하고 뒤늦게 버리는 LLM 낭비 방지.
    if (existingUrls.has(item.sourceUrl)) {
      skipped += 1;
      continue;
    }
    // P0-1 (17차): 표시 정규화 — 외래 고유명사 오타를 표준 표기로 통일 (앤스로픽 → 앤트로픽).
    // 중복 비교 전에 적용하면 오타 변형도 같은 기사로 잡히고, 피드에도 오타가 노출되지 않음.
    item.title = normalizeDisplayNames(item.title);
    if (item.takeaway) item.takeaway = normalizeDisplayNames(item.takeaway);
    if (item.summary) item.summary = normalizeDisplayNames(item.summary);
    if (item.originalTitle) item.originalTitle = normalizeDisplayNames(item.originalTitle);
    // 26차 P0-2: X 파이프라인 bare 어미 교정 — "… 확인." → "… 확인 필요."
    if (item.takeaway) item.takeaway = fixBareEnding(item.takeaway);
    // 28차 P0: X 경로 desk 품질 게이트 — fixTypos 적용 (polishPayload와 동일한 교정)
    item.title = fixTypos(item.title);
    if (item.takeaway) item.takeaway = fixTypos(item.takeaway);
    if (item.summary) item.summary = fixTypos(item.summary);
    // 29차 P0: 영문 미번역 게이트 — X ingest 번역 폴백으로 들어온 영문 제목·시사점이
    // 그대로 피드 최상위에 노출됨 (실측: [속보] 2건 제목·시사점 100% 영문, 요약=시사점 동일 문장).
    // 영문 우세면 즉시 넣지 말고 RSS와 같은 데스크 패스(classifyEntry)로 한국어 재작성을 강제한다.
    // 제목·시사점이 모두 영문 우세일 때만 발동 — 영문 제품명이 많은 정상 한글 제목
    // ("NVIDIA Nemotron 3.5 공개" + 한글 시사점)의 오탐 방지 (29차 크로스 리뷰).
    // 유사도 검사는 최종(한국어) 제목 기준으로 해야 하므로 그보다 앞에 둔다.
    if (isEnglishDominant(item.title) && (!item.takeaway || isEnglishDominant(item.takeaway))) {
      const desked = await classifyEntry({
        title: item.originalTitle || item.title,
        sourceUrl: item.sourceUrl,
        source: item.source,
        date: item.publishedAt ?? Date.now(),
        summary: item.summary || item.takeaway || "",
      });
      // 강제 재작성 경로에서는 데스크가 실제로 다시 쓴 경우(keep===true)에만 입고한다.
      // LLM 실패 폴백(keep 필드 없음)·드롭 판정·결과가 여전히 영문이면 넣지 않는다 —
      // 게이트가 오히려 새 영문 노출 통로가 되는 것 방지 (29차 크로스 리뷰 블로커).
      if (
        desked.keep !== true ||
        isEnglishDominant(desked.title) ||
        (desked.takeaway && isEnglishDominant(desked.takeaway))
      ) {
        skipped += 1;
        continue;
      }
      item = desked;
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
