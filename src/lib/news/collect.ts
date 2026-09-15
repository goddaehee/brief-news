import { TOPIC_MAP } from "./topics";
import {
  COLLECT_COOLDOWN_MS,
  COLLECT_MAX_NEW,
  INGEST_MAX_BATCH,
  NEWS_SOURCES,
} from "./sources";
import { decodeFeedBytes, parseFeedXml, parseNewsMarkdown } from "./parse";
import {
  beginRun,
  ensureSeeded,
  finishRun,
  insertItem,
  lastRunAt,
  listNews,
  sourceUrlExists,
  upsertBriefing,
} from "./repo";
import type { CollectResult, Grade, IngestPayload } from "./types";

const ALLOWED_TOPICS = Object.keys(TOPIC_MAP);
const AI_HINT =
  /\b(ai|a\.i\.|llm|gpt-?\d*|chatgpt|claude|gemini|grok|openai|anthropic|xai|nvidia|hbm|gpu|agent|인공지능|생성형|챗봇|딥러닝|에이전트|언어\s*모델|파운데이션\s*모델)\b/i;
const SKIP_HINT =
  /장내매수|최대주주|액면병합|변경상장|유상증자|무상증자|주식\s*취득|임원\s*변동|거래정지|시간외|배당\s*공시/;

export async function collectOnce(): Promise<CollectResult> {
  await ensureSeeded();
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
    const entries = await pullRss();
    fetched = entries.length;
    const fresh = [];
    for (const e of entries) {
      if (await sourceUrlExists(e.sourceUrl)) {
        skipped += 1;
        continue;
      }
      fresh.push(e);
      if (fresh.length >= COLLECT_MAX_NEW) break;
    }

    const classified = await Promise.all(fresh.map((entry) => classifyEntry(entry)));
    for (const payload of classified) {
      const ok = await insertItem(payload);
      if (ok) inserted += 1;
      else skipped += 1;
    }

    if (inserted > 0) await refreshBriefing();

    const note =
      inserted > 0
        ? `RSS ${fetched}건 중 ${inserted}건 편성`
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
  const target = e.titleMustMatch ? e.title : `${e.title} ${e.summary}`;
  return AI_HINT.test(target);
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
          sourceUrl: e.link,
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
    .sort((a, b) => b.date - a.date)
    .filter((e, i, arr) => arr.findIndex((x) => x.sourceUrl === e.sourceUrl) === i);
}

async function classifyEntry(entry: RawEntry): Promise<IngestPayload> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return fallbackPayload(entry);

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 420,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "당신은 한국 AI 실무자용 뉴스 터미널의 편집기다. 단순 번역이 아니라 ‘그래서 실무자가 뭘 하면 되는지’를 한 줄로 적는다. 말투: 짧고 단호. ‘~필요’, ‘~고려’, ‘~주시’, ‘~시점’. JSON만 출력.",
          },
          {
            role: "user",
            content: `원문 제목: ${entry.title}\n출처: ${entry.source}\n링크: ${entry.sourceUrl}\n발췌: ${entry.summary.slice(0, 600)}\n\nJSON 스키마:\n{"title":"한국어 헤드라인","takeaway":"한 줄 시사점","summary":"3~5문장 요약","grade":"breaking|important|note","tip":false,"topics":["openai"]}\ntopics 허용값: ${ALLOWED_TOPICS.join(", ")}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return fallbackPayload(entry);
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    const json = extractJson(text);
    if (!json) return fallbackPayload(entry);
    return {
      title: String(json.title || entry.title).slice(0, 180),
      takeaway: String(json.takeaway || entry.summary).slice(0, 220),
      summary: String(json.summary || entry.summary).slice(0, 1200),
      source: entry.source,
      sourceUrl: entry.sourceUrl,
      originalTitle: entry.title,
      grade: asGrade(json.grade),
      tip: Boolean(json.tip),
      topics: Array.isArray(json.topics)
        ? json.topics.filter((t) => typeof t === "string" && TOPIC_MAP[t]).slice(0, 4)
        : [],
      publishedAt: entry.date,
    };
  } catch {
    return fallbackPayload(entry);
  }
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
    ["디지털투데이", "korea-ai"],
    ["aitimes", "korea-ai"],
    ["etnews", "korea-ai"],
  ];
  for (const [k, slug] of rules) {
    if (t.includes(k) && !found.includes(slug)) found.push(slug);
    if (found.length >= 3) break;
  }
  return found;
}

function asGrade(v: unknown): Grade {
  return v === "breaking" || v === "important" || v === "note" ? v : "note";
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function refreshBriefing() {
  const items = await listNews();
  const lines = items
    .filter((i) => i.grade === "breaking" || i.grade === "important")
    .slice(0, 6)
    .map((i) => i.title);
  if (lines.length) await upsertBriefing(lines);
}

export async function ingestPayloads(items: IngestPayload[]): Promise<{ inserted: number; skipped: number }> {
  await ensureSeeded();
  let inserted = 0;
  let skipped = 0;
  for (const item of items.slice(0, INGEST_MAX_BATCH)) {
    if (!item.title || !item.sourceUrl) {
      skipped += 1;
      continue;
    }
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
