import { NEWS_SOURCES } from "./sources";
import {
  ensureSeeded,
  getBriefing,
  getNewsById,
  lastRunAt,
  listNews,
  listRuns,
} from "./repo";
import type { DeskPayload, FeedPayload, NewsItem } from "./types";

export async function getFeed(): Promise<FeedPayload> {
  await ensureSeeded();
  const [items, briefing, last] = await Promise.all([listNews(), getBriefing(), lastRunAt()]);
  return {
    now: Date.now(),
    items,
    briefingDate: briefing.date,
    briefingLines: briefing.lines,
    lastRunAt: last,
  };
}

export async function getItem(id: string): Promise<{
  now: number;
  item: NewsItem | null;
  items: NewsItem[];
}> {
  await ensureSeeded();
  const [item, items] = await Promise.all([getNewsById(id), listNews()]);
  return { now: Date.now(), item: item ?? null, items };
}

export async function getDesk(): Promise<DeskPayload> {
  const feed = await getFeed();
  const runs = await listRuns();
  return { ...feed, runs, sources: NEWS_SOURCES };
}
