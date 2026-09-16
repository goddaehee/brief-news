export type Grade = "breaking" | "important" | "note";

export type Topic = {
  slug: string;
  label: string;
};

export type NewsItem = {
  id: string;
  publishedAt: number;
  grade: Grade;
  tip: boolean;
  title: string;
  takeaway: string;
  summary: string;
  source: string;
  sourceUrl: string;
  originalTitle: string;
  topics: string[];
};

export type FilterKey = "all" | "breaking" | "important" | "note" | "tip";

export type Reaction = "useful" | "hot" | "meh";

export type IngestPayload = {
  id?: string;
  title: string;
  takeaway: string;
  summary: string;
  source: string;
  sourceUrl: string;
  originalTitle: string;
  grade: Grade;
  tip: boolean;
  topics: string[];
  publishedAt?: number;
};

export type CollectResult = {
  ok: boolean;
  status: "ok" | "rate_limited" | "error";
  fetched: number;
  inserted: number;
  skipped: number;
  note: string;
  lastRunAt: number | null;
};

export type IngestRun = {
  id: number;
  startedAt: number;
  finishedAt?: number;
  status: string;
  fetched: number;
  inserted: number;
  skipped: number;
  note?: string;
};

export type FeedPayload = {
  now: number;
  items: NewsItem[];
  briefingDate: string;
  briefingLines: string[];
  lastRunAt: number | null;
};

export type DeskPayload = FeedPayload & {
  runs: IngestRun[];
  sources: { id: string; name: string; rss: string }[];
};
