import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { getBriefingDate, getBriefingLines, getSeedItems } from "./data";
import { parseNewsMarkdown } from "./parse";
import type { Grade, IngestPayload, IngestRun, NewsItem } from "./types";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SCHEMA = `
create table if not exists news_items (
  id text primary key,
  published_at timestamptz not null,
  grade text not null,
  tip boolean not null default false,
  title text not null,
  takeaway text not null,
  summary text not null,
  source text not null,
  source_url text not null,
  original_title text not null,
  topics text not null default '[]',
  created_at timestamptz not null default now(),
  constraint news_items_grade_chk check (grade in ('breaking', 'important', 'note'))
);
create unique index if not exists news_items_source_url_uidx on news_items (source_url);
create index if not exists news_items_published_idx on news_items (published_at desc);
create table if not exists briefings (
  briefing_date text primary key,
  lines text not null,
  updated_at timestamptz not null default now()
);
create table if not exists ingest_runs (
  id serial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  fetched int not null default 0,
  inserted int not null default 0,
  skipped int not null default 0,
  note text
);
`;

function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function makeItemId(sourceUrl: string): string {
  return createHash("sha1").update(sourceUrl).digest("hex").slice(0, 12);
}

type NeonSql = (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

function getNeon(): NeonSql {
  const url = process.env.DATABASE_URL!.trim();
  const sql = neon(url);
  return async (query, params = []) => {
    const rows = await sql.query(query, params);
    return rows as Record<string, unknown>[];
  };
}

type Mem = {
  items: Map<string, NewsItem>;
  urls: Set<string>;
  briefings: Map<string, string[]>;
  runs: IngestRun[];
  seeded: boolean;
  runSeq: number;
};

const g = globalThis as typeof globalThis & { __briefMem__?: Mem };

function mem(): Mem {
  if (!g.__briefMem__) {
    g.__briefMem__ = {
      items: new Map(),
      urls: new Set(),
      briefings: new Map(),
      runs: [],
      seeded: false,
      runSeq: 1,
    };
  }
  return g.__briefMem__;
}

function mapNeonRow(row: Record<string, unknown>): NewsItem {
  let topics: string[] = [];
  try {
    const parsed = JSON.parse(String(row.topics ?? "[]"));
    if (Array.isArray(parsed)) topics = parsed.filter((t) => typeof t === "string");
  } catch {
    topics = [];
  }
  const published =
    typeof row.published_ms === "number"
      ? row.published_ms
      : row.published_at
        ? new Date(String(row.published_at)).getTime()
        : Date.now();
  return {
    id: String(row.id),
    publishedAt: Number(published),
    grade: row.grade as Grade,
    tip: Boolean(row.tip),
    title: String(row.title),
    takeaway: String(row.takeaway),
    summary: String(row.summary),
    source: String(row.source),
    sourceUrl: String(row.source_url),
    originalTitle: String(row.original_title),
    topics,
  };
}

let schemaPromise: Promise<void> | null = null;
async function ensureSchema() {
  if (!hasDatabaseUrl()) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getNeon();
      for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) {
        await sql(stmt);
      }
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

let seedPromise: Promise<void> | null = null;
export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = seedIfEmpty().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

async function ingestBundledMarkdown() {
  try {
    const raw = await readFile(join(process.cwd(), "content/news/_example.md"), "utf8");
    await insertItem(parseNewsMarkdown(raw));
  } catch {
    /* bundled file missing on some hosts */
  }
}

async function seedIfEmpty() {
  await ensureSchema();
  if (hasDatabaseUrl()) {
    const sql = getNeon();
    const count = await sql(`select count(*)::int as n from news_items`);
    if (Number(count[0]?.n ?? 0) > 0) return;
    const now = Date.now();
    for (const item of getSeedItems(now)) {
      await insertItem({
        id: item.id,
        title: item.title,
        takeaway: item.takeaway,
        summary: item.summary,
        source: item.source,
        sourceUrl: item.sourceUrl,
        originalTitle: item.originalTitle,
        grade: item.grade,
        tip: item.tip,
        topics: item.topics,
        publishedAt: item.publishedAt,
      });
    }
    await ingestBundledMarkdown();
    await upsertBriefing(getBriefingLines());
    await sql(
      `insert into ingest_runs (started_at, finished_at, status, fetched, inserted, skipped, note)
       values (now(), now(), 'seed', 0, $1, 0, 'seed corpus + markdown')`,
      [getSeedItems(now).length],
    );
    return;
  }

  const m = mem();
  if (m.seeded) return;
  const now = Date.now();
  for (const item of getSeedItems(now)) {
    m.items.set(item.id, item);
    m.urls.add(item.sourceUrl);
  }
  try {
    const raw = await readFile(join(process.cwd(), "content/news/_example.md"), "utf8");
    const payload = parseNewsMarkdown(raw);
    await insertItem(payload);
  } catch {
    /* skip */
  }
  m.briefings.set(getBriefingDate(), getBriefingLines());
  m.runs.unshift({
    id: m.runSeq++,
    startedAt: now,
    status: "seed",
    fetched: 0,
    inserted: m.items.size,
    skipped: 0,
    note: "seed corpus + markdown",
  });
  m.seeded = true;
}

export async function listNews(): Promise<NewsItem[]> {
  await ensureSchema();
  if (hasDatabaseUrl()) {
    const sql = getNeon();
    const rows = await sql(
      `select id, (extract(epoch from published_at) * 1000)::bigint as published_ms,
              grade, tip, title, takeaway, summary, source, source_url, original_title, topics
         from news_items order by published_at desc limit 200`,
    );
    return rows.map(mapNeonRow);
  }
  return [...mem().items.values()].sort((a, b) => b.publishedAt - a.publishedAt);
}

export async function getNewsById(id: string): Promise<NewsItem | undefined> {
  await ensureSchema();
  if (hasDatabaseUrl()) {
    const sql = getNeon();
    const rows = await sql(
      `select id, (extract(epoch from published_at) * 1000)::bigint as published_ms,
              grade, tip, title, takeaway, summary, source, source_url, original_title, topics
         from news_items where id = $1`,
      [id],
    );
    return rows[0] ? mapNeonRow(rows[0]) : undefined;
  }
  return mem().items.get(id);
}

export async function sourceUrlExists(sourceUrl: string): Promise<boolean> {
  if (hasDatabaseUrl()) {
    const sql = getNeon();
    const rows = await sql(`select 1 as n from news_items where source_url = $1 limit 1`, [
      sourceUrl,
    ]);
    return rows.length > 0;
  }
  return mem().urls.has(sourceUrl);
}

export async function insertItem(payload: IngestPayload): Promise<boolean> {
  const id = payload.id ?? makeItemId(payload.sourceUrl);
  const publishedAt = payload.publishedAt ?? Date.now();
  const topics = payload.topics ?? [];
  if (hasDatabaseUrl()) {
    const sql = getNeon();
    const rows = await sql(
      `insert into news_items (
          id, published_at, grade, tip, title, takeaway, summary,
          source, source_url, original_title, topics
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        on conflict (source_url) do nothing
        returning id`,
      [
        id,
        new Date(publishedAt).toISOString(),
        payload.grade ?? "note",
        payload.tip ?? false,
        payload.title,
        payload.takeaway,
        payload.summary,
        payload.source,
        payload.sourceUrl,
        payload.originalTitle || payload.title,
        JSON.stringify(topics),
      ],
    );
    return rows.length > 0;
  }
  const m = mem();
  if (m.urls.has(payload.sourceUrl)) return false;
  const item: NewsItem = {
    id,
    publishedAt,
    grade: payload.grade ?? "note",
    tip: payload.tip ?? false,
    title: payload.title,
    takeaway: payload.takeaway,
    summary: payload.summary,
    source: payload.source,
    sourceUrl: payload.sourceUrl,
    originalTitle: payload.originalTitle || payload.title,
    topics,
  };
  m.items.set(id, item);
  m.urls.add(payload.sourceUrl);
  return true;
}

export async function getBriefing(): Promise<{ date: string; lines: string[] }> {
  const date = getBriefingDate();
  if (hasDatabaseUrl()) {
    const sql = getNeon();
    const rows = await sql(`select lines from briefings where briefing_date = $1`, [date]);
    if (rows[0]) {
      try {
        const lines = JSON.parse(String(rows[0].lines));
        if (Array.isArray(lines) && lines.length) {
          return { date, lines: lines.filter((x) => typeof x === "string") };
        }
      } catch {
        /* fall through */
      }
    }
    return { date, lines: getBriefingLines() };
  }
  return { date, lines: mem().briefings.get(date) ?? getBriefingLines() };
}

export async function upsertBriefing(lines: string[], date = getBriefingDate()) {
  if (hasDatabaseUrl()) {
    const sql = getNeon();
    await sql(
      `insert into briefings (briefing_date, lines, updated_at)
       values ($1, $2, now())
       on conflict (briefing_date) do update set lines = excluded.lines, updated_at = now()`,
      [date, JSON.stringify(lines.slice(0, 8))],
    );
    return;
  }
  mem().briefings.set(date, lines.slice(0, 8));
}

export async function lastRunAt(): Promise<number | null> {
  if (hasDatabaseUrl()) {
    const sql = getNeon();
    const rows = await sql(
      `select (extract(epoch from started_at) * 1000)::bigint as ms
         from ingest_runs where status <> 'seed' order by started_at desc limit 1`,
    );
    return rows[0] ? Number(rows[0].ms) : null;
  }
  const run = mem().runs.find((r) => r.status !== "seed");
  return run?.startedAt ?? null;
}

export async function listRuns(): Promise<IngestRun[]> {
  if (hasDatabaseUrl()) {
    const sql = getNeon();
    const rows = await sql(
      `select id, (extract(epoch from started_at) * 1000)::bigint as started_ms,
              status, fetched, inserted, skipped, coalesce(note, '') as note
         from ingest_runs order by started_at desc limit 24`,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      startedAt: Number(r.started_ms),
      status: String(r.status),
      fetched: Number(r.fetched),
      inserted: Number(r.inserted),
      skipped: Number(r.skipped),
      note: String(r.note),
    }));
  }
  return mem().runs.slice(0, 24);
}

export async function beginRun(): Promise<number> {
  if (hasDatabaseUrl()) {
    const sql = getNeon();
    const rows = await sql(`insert into ingest_runs (status) values ('running') returning id`);
    return Number(rows[0]?.id ?? 0);
  }
  const m = mem();
  const id = m.runSeq++;
  m.runs.unshift({
    id,
    startedAt: Date.now(),
    status: "running",
    fetched: 0,
    inserted: 0,
    skipped: 0,
    note: "",
  });
  return id;
}

export async function finishRun(
  id: number,
  data: { status: string; fetched: number; inserted: number; skipped: number; note: string },
) {
  if (hasDatabaseUrl()) {
    const sql = getNeon();
    await sql(
      `update ingest_runs
          set finished_at = now(), status = $2, fetched = $3, inserted = $4, skipped = $5, note = $6
        where id = $1`,
      [id, data.status, data.fetched, data.inserted, data.skipped, data.note],
    );
    return;
  }
  const run = mem().runs.find((r) => r.id === id);
  if (run) Object.assign(run, data);
}
