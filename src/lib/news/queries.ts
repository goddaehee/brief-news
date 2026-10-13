import { NEWS_SOURCES } from "./sources";
import { getBriefingDate, publicFeedItems, realFeedItems } from "./data";
import {
  ensureSeeded,
  getBriefing,
  getNewsById,
  lastRunAt,
  listNews,
  listRuns,
} from "./repo";
import type { DeskPayload, FeedPayload, NewsItem } from "./types";

// DB가 멈춰도 페이지는 반드시 렌더되게: 실패하면 폴백 값을 쓴다.
// (서버리스에서 풀린 커넥션이 wedged 되면 쿼리가 영원히 안 끝나서
//  스트리밍 SSR이 무한 대기에 빠지는 것을 방지)
async function withFallback<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error("[news] db query failed, using fallback:", err instanceof Error ? err.message : err);
    return fallback;
  }
}

function briefingFrom(items: NewsItem[]): string[] {
  const pool = items.filter((i) => i.grade === "breaking" || i.grade === "important");
  const rest = items.filter((i) => i.grade !== "breaking" && i.grade !== "important");
  return [...pool, ...rest].slice(0, 6).map((i) => i.title);
}

export async function getFeed(): Promise<FeedPayload> {
  await withFallback(() => ensureSeeded(), undefined);
  const [raw, briefing, last] = await Promise.all([
    withFallback(() => listNews(), [] as NewsItem[]),
    withFallback(() => getBriefing(), { date: getBriefingDate(), lines: [] as string[] }),
    withFallback(() => lastRunAt(), null as number | null),
  ]);
  const items = publicFeedItems(raw);
  const real = realFeedItems(raw);
  const lines = briefing.lines.length >= 3 ? briefing.lines : briefingFrom(real);
  return {
    now: Date.now(),
    items,
    briefingDate: briefing.date,
    briefingLines: lines,
    lastRunAt: last,
  };
}

export async function getItem(id: string): Promise<{
  now: number;
  item: NewsItem | null;
  items: NewsItem[];
}> {
  await withFallback(() => ensureSeeded(), undefined);
  const [item, raw] = await Promise.all([
    withFallback(() => getNewsById(id), undefined as NewsItem | undefined),
    withFallback(() => listNews(), [] as NewsItem[]),
  ]);
  return { now: Date.now(), item: item ?? null, items: publicFeedItems(raw) };
}

export async function getDesk(): Promise<DeskPayload> {
  await withFallback(() => ensureSeeded(), undefined);
  const [raw, briefing, last, runs] = await Promise.all([
    withFallback(() => listNews(), [] as NewsItem[]),
    withFallback(() => getBriefing(), { date: getBriefingDate(), lines: [] as string[] }),
    withFallback(() => lastRunAt(), null as number | null),
    withFallback(() => listRuns(), []),
  ]);
  return {
    now: Date.now(),
    items: raw,
    briefingDate: briefing.date,
    briefingLines: briefing.lines,
    lastRunAt: last,
    runs,
    sources: NEWS_SOURCES,
  };
}
