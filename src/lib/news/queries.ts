import { NEWS_SOURCES } from "./sources";
import { publicFeedItems, realFeedItems } from "./data";
import {
  ensureSeeded,
  getBriefing,
  getNewsById,
  lastRunAt,
  listNews,
  listRuns,
} from "./repo";
import type { DeskPayload, FeedPayload, NewsItem } from "./types";

function briefingFrom(items: NewsItem[]): string[] {
  const pool = items.filter((i) => i.grade === "breaking" || i.grade === "important");
  const rest = items.filter((i) => i.grade !== "breaking" && i.grade !== "important");
  return [...pool, ...rest].slice(0, 6).map((i) => i.title);
}

export async function getFeed(): Promise<FeedPayload> {
  await ensureSeeded();
  const [raw, briefing, last] = await Promise.all([listNews(), getBriefing(), lastRunAt()]);
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
  await ensureSeeded();
  const [item, raw] = await Promise.all([getNewsById(id), listNews()]);
  return { now: Date.now(), item: item ?? null, items: publicFeedItems(raw) };
}

export async function getDesk(): Promise<DeskPayload> {
  await ensureSeeded();
  const [raw, briefing, last, runs] = await Promise.all([
    listNews(),
    getBriefing(),
    lastRunAt(),
    listRuns(),
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
