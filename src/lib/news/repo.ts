import { createHash } from "node:crypto";
import postgres from "postgres";
import { getBriefingDate, getBriefingLines, getSeedItems } from "./data";
import type { Grade, IngestPayload, IngestRun, NewsItem } from "./types";

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
create table if not exists collect_lock (
  id smallint primary key default 1 check (id = 1),
  locked_at timestamptz,
  owner text
);
create table if not exists feed_cache (
  source_id text primary key,
  etag text,
  last_modified text,
  payload text,
  updated_at timestamptz not null default now()
);
insert into collect_lock (id) values (1) on conflict (id) do nothing
`;

const LOCK_STALE_MS = 8 * 60 * 1000;

function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function makeItemId(sourceUrl: string): string {
  return createHash("sha1").update(sourceUrl).digest("hex").slice(0, 12);
}

type SqlFn = (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const g = globalThis as typeof globalThis & {
  __briefMem__?: Mem;
  __briefPg__?: ReturnType<typeof postgres>;
};

const QUERY_TIMEOUT_MS = 15000;

function getSql(): SqlFn {
  if (!g.__briefPg__) {
    const url = process.env.DATABASE_URL!.trim();
    g.__briefPg__ = postgres(url, {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      ssl: "require",
      onnotice: () => undefined,
    });
  }
  const client = g.__briefPg__;
  return async (query, params = []) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const rows = await Promise.race([
        client.unsafe(query, params as postgres.ParameterOrJSON<never>[]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            // Drop the pooled client: a query that never settles means the
            // underlying connection is wedged. Discard the pool so the next
            // call reconnects instead of queueing behind the dead connection.
            g.__briefPg__ = undefined;
            try {
              void client.end({ timeout: 1 });
            } catch {
              /* ignore */
            }
            reject(new Error(`db query timed out after ${QUERY_TIMEOUT_MS}ms`));
          }, QUERY_TIMEOUT_MS);
        }),
      ]);
      return rows as unknown as Record<string, unknown>[];
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

type Mem = {
  items: Map<string, NewsItem>;
  urls: Set<string>;
  briefings: Map<string, string[]>;
  runs: IngestRun[];
  seeded: boolean;
  runSeq: number;
  lockUntil: number;
  lockOwner: string | null;
  feedCache: Map<string, FeedCache>;
};

function mem(): Mem {
  if (!g.__briefMem__) {
    g.__briefMem__ = {
      items: new Map(),
      urls: new Set(),
      briefings: new Map(),
      runs: [],
      seeded: false,
      runSeq: 1,
      lockUntil: 0,
      lockOwner: null,
      feedCache: new Map(),
    };
  }
  return g.__briefMem__;
}

function mapRow(row: Record<string, unknown>): NewsItem {
  let topics: string[] = [];
  try {
    const parsed = JSON.parse(String(row.topics ?? "[]"));
    if (Array.isArray(parsed)) topics = parsed.filter((t) => typeof t === "string");
  } catch {
    topics = [];
  }
  const published =
    row.published_ms != null
      ? Number(row.published_ms)
      : row.published_at
        ? new Date(String(row.published_at)).getTime()
        : Date.now();
  return {
    id: String(row.id),
    publishedAt: Number(published),
    createdAt: row.created_ms == null ? undefined : Number(row.created_ms),
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
      const sql = getSql();
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

async function seedIfEmpty() {
  await ensureSchema();
  if (hasDatabaseUrl()) {
    return;
  }

  const m = mem();
  if (m.seeded) return;
  const now = Date.now();
  for (const item of getSeedItems(now)) {
    m.items.set(item.id, item);
    m.urls.add(item.sourceUrl);
  }
  m.briefings.set(getBriefingDate(), getBriefingLines());
  m.runs.unshift({
    id: m.runSeq++,
    startedAt: now,
    status: "seed",
    fetched: 0,
    inserted: m.items.size,
    skipped: 0,
    note: "preview seed corpus",
  });
  m.seeded = true;
}

export async function tryCollectLock(owner: string): Promise<boolean> {
  await ensureSchema();
  if (hasDatabaseUrl()) {
    const sql = getSql();
    const rows = await sql(
      `update collect_lock
          set locked_at = now(), owner = $1
        where id = 1
          and (locked_at is null or locked_at < now() - interval '8 minutes')
        returning id`,
      [owner],
    );
    return rows.length > 0;
  }
  const m = mem();
  const now = Date.now();
  if (m.lockUntil > now) return false;
  m.lockOwner = owner;
  m.lockUntil = now + LOCK_STALE_MS;
  return true;
}

export async function releaseCollectLock(owner: string): Promise<void> {
  if (hasDatabaseUrl()) {
    const sql = getSql();
    await sql(`update collect_lock set locked_at = null, owner = null where id = 1 and owner = $1`, [
      owner,
    ]);
    return;
  }
  const m = mem();
  if (m.lockOwner === owner) {
    m.lockOwner = null;
    m.lockUntil = 0;
  }
}

export async function listNews(): Promise<NewsItem[]> {
  await ensureSchema();
  if (hasDatabaseUrl()) {
    const sql = getSql();
    const rows = await sql(
      `select id, (extract(epoch from published_at) * 1000) as published_ms,
              (extract(epoch from created_at) * 1000) as created_ms,
              grade, tip, title, takeaway, summary, source, source_url, original_title, topics
         from news_items order by published_at desc limit 200`,
    );
    return rows.map(mapRow);
  }
  // 메모리 경로도 DB 경로의 limit 200과 동일하게 맞춘다 (200건 창 용도).
  return [...mem().items.values()].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 200);
}

/**
 * 중복 판정 전용 전체 source_url 조회.
 * listNews()(최신 200건 창)와 용도를 분리한다: 피드 표시·유사도·소스캡·
 * 거버너는 200건 창으로 충분하지만, 중복 판정은 창 밖의 URL까지 알아야
 * 분류(LLM)까지 거친 뒤 삽입 시점에 소실되는 일이 없다.
 * DB 경로는 컬럼 1개만 조회한다 — news_items_source_url_uidx (unique index)가
 * 있어 index-only scan이 가능하다. 순서는 무관하다 (Set 구축 전용).
 */
export async function listAllSourceUrls(): Promise<string[]> {
  await ensureSchema();
  if (hasDatabaseUrl()) {
    const sql = getSql();
    const rows = await sql(`select source_url from news_items`);
    return rows.map((row) => String(row.source_url));
  }
  return [...mem().urls];
}

/**
 * Phase 2: 소스별 최근 삽입 건수 (sourceCap 판정용).
 * listNews()는 발행일 상위 200건 창이라, 창 밖 백로그의 최근 삽입을
 * 세지 못해 캡이 샌다 (Codex 리뷰 P2). 발행일 창과 무관하게
 * created_at >= sinceMs 조건으로 DB에서 직접 집계한다.
 * createdAt이 없는 항목(시드 등)은 발행일로 폴백한다.
 */
export async function countRecentInsertsBySource(sinceMs: number): Promise<Map<string, number>> {
  await ensureSchema();
  const counts = new Map<string, number>();
  if (hasDatabaseUrl()) {
    const sql = getSql();
    const rows = await sql(
      `select source, count(*) as n from news_items where created_at >= $1 group by source`,
      [new Date(sinceMs).toISOString()],
    );
    for (const row of rows) counts.set(String(row.source), Number(row.n));
    return counts;
  }
  for (const item of mem().items.values()) {
    const at = item.createdAt ?? item.publishedAt;
    if (at >= sinceMs) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
  }
  return counts;
}

/**
 * Phase 2: 피드 조건부 GET(ETag / Last-Modified) 캐시.
 * METR(4.1MB 전문 피드)처럼 크고 저빈도인 피드를 매 수집마다 전량 받는
 * 낭비를 줄인다 (Phase 2 패널 조건). 캐시는 최적화일 뿐이라, 호출부는
 * 조회·저장 실패를 무시하고 수집을 계속할 수 있게 설계한다.
 */
export type FeedCache = {
  etag?: string;
  lastModified?: string;
  updatedAt?: number;
  /** 마지막 200 응답의 파싱 결과(JSON 문자열). 304일 때 그대로 재반환해
   * 캡에 밀린 후보가 다음 수집에서도 재평가되게 한다 (Codex 리뷰 P1).
   * 직렬화·역직렬화는 호출부(collect)가 담당한다. */
  payload?: string;
};

export async function getFeedCache(sourceId: string): Promise<FeedCache> {
  await ensureSchema();
  if (hasDatabaseUrl()) {
    const sql = getSql();
    const rows = await sql(
      `select etag, last_modified, payload, (extract(epoch from updated_at) * 1000) as updated_ms
         from feed_cache where source_id = $1`,
      [sourceId],
    );
    if (!rows[0]) return {};
    return {
      etag: rows[0].etag == null ? undefined : String(rows[0].etag),
      lastModified: rows[0].last_modified == null ? undefined : String(rows[0].last_modified),
      updatedAt: rows[0].updated_ms == null ? undefined : Number(rows[0].updated_ms),
      payload: rows[0].payload == null ? undefined : String(rows[0].payload),
    };
  }
  return mem().feedCache.get(sourceId) ?? {};
}

export async function setFeedCache(sourceId: string, cache: FeedCache): Promise<void> {
  await ensureSchema();
  if (hasDatabaseUrl()) {
    const sql = getSql();
    await sql(
      `insert into feed_cache (source_id, etag, last_modified, payload, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (source_id) do update
         set etag = excluded.etag, last_modified = excluded.last_modified,
             payload = coalesce(excluded.payload, feed_cache.payload), updated_at = now()`,
      [sourceId, cache.etag ?? null, cache.lastModified ?? null, cache.payload ?? null],
    );
    return;
  }
  // 메모리 경로: updatedAt은 호출부가 준 값을 존중한다 (TTL 테스트용).
  // DB 경로는 now()로 고정되며 updatedAt 파라미터를 쓰지 않는다.
  // payload를 넘기지 않으면 기존 저장본을 유지한다 (DB coalesce와 동일 의미).
  const prev = mem().feedCache.get(sourceId);
  mem().feedCache.set(sourceId, {
    ...cache,
    payload: cache.payload ?? prev?.payload,
    updatedAt: cache.updatedAt ?? Date.now(),
  });
}

export type SearchSort = "new" | "relevant";

export async function searchNews(
  q: string,
  opts: { grade?: string; sort?: SearchSort; limit?: number; offset?: number } = {},
): Promise<{ items: NewsItem[]; total: number }> {
  const grade = opts.grade ?? "all";
  const sort: SearchSort = opts.sort ?? "new";
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);
  // ILIKE 특수문자 이스케이프: %, _, \ 를 리터럴로 취급
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const matchFields = (i: NewsItem) => {
    const ql = q.toLowerCase();
    return (
      i.title.toLowerCase().includes(ql) ||
      i.takeaway.toLowerCase().includes(ql) ||
      i.summary.toLowerCase().includes(ql)
    );
  };
  const matchGrade = (i: NewsItem) => {
    if (grade === "tip") return i.tip;
    if (grade === "all") return true;
    return i.grade === grade;
  };
  const relevanceScore = (i: NewsItem) => {
    const ql = q.toLowerCase();
    if (i.title.toLowerCase().includes(ql)) return 2;
    if (i.takeaway.toLowerCase().includes(ql)) return 1;
    return 0;
  };

  await ensureSchema();
  if (hasDatabaseUrl()) {
    const sql = getSql();
    const conditions: string[] = [
      `(title ilike $1 escape '\\' or takeaway ilike $1 escape '\\' or summary ilike $1 escape '\\')`,
    ];
    const params: unknown[] = [like];
    if (grade === "tip") {
      conditions.push(`tip = true`);
    } else if (grade !== "all") {
      conditions.push(`grade = $${params.length + 1}`);
      params.push(grade);
    }
    const where = `where ${conditions.join(" and ")}`;
    const countRows = await sql(`select count(*) as n from news_items ${where}`, params);
    const total = Number(countRows[0]?.n ?? 0);
    const orderBy =
      sort === "relevant"
        ? `order by case when title ilike $1 escape '\\' then 0 when takeaway ilike $1 escape '\\' then 1 else 2 end, published_at desc`
        : `order by published_at desc`;
    const rows = await sql(
      `select id, (extract(epoch from published_at) * 1000) as published_ms,
              (extract(epoch from created_at) * 1000) as created_ms,
              grade, tip, title, takeaway, summary, source, source_url, original_title, topics
         from news_items ${where} ${orderBy} limit ${limit} offset ${offset}`,
      params,
    );
    return { items: rows.map(mapRow), total };
  }

  const matched = [...mem().items.values()].filter((i) => matchGrade(i) && matchFields(i));
  matched.sort((a, b) => {
    if (sort === "relevant") {
      const diff = relevanceScore(b) - relevanceScore(a);
      if (diff !== 0) return diff;
    }
    return b.publishedAt - a.publishedAt;
  });
  return { items: matched.slice(offset, offset + limit), total: matched.length };
}

export async function getNewsById(id: string): Promise<NewsItem | undefined> {
  await ensureSchema();
  if (hasDatabaseUrl()) {
    const sql = getSql();
    const rows = await sql(
      `select id, (extract(epoch from published_at) * 1000) as published_ms,
              (extract(epoch from created_at) * 1000) as created_ms,
              grade, tip, title, takeaway, summary, source, source_url, original_title, topics
         from news_items where id = $1`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  }
  return mem().items.get(id);
}

export async function sourceUrlExists(sourceUrl: string): Promise<boolean> {
  if (hasDatabaseUrl()) {
    const sql = getSql();
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
    const sql = getSql();
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
        payload.grade,
        payload.tip,
        payload.title,
        payload.takeaway,
        payload.summary,
        payload.source,
        payload.sourceUrl,
        payload.originalTitle,
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
    createdAt: Date.now(),
    grade: payload.grade,
    tip: payload.tip,
    title: payload.title,
    takeaway: payload.takeaway,
    summary: payload.summary,
    source: payload.source,
    sourceUrl: payload.sourceUrl,
    originalTitle: payload.originalTitle,
    topics,
  };
  m.items.set(id, item);
  m.urls.add(payload.sourceUrl);
  return true;
}

export async function updateItem(id: string, payload: IngestPayload): Promise<boolean> {
  const topics = payload.topics ?? [];
  if (hasDatabaseUrl()) {
    const sql = getSql();
    const rows = await sql(
      `update news_items set
          grade = $2, tip = $3, title = $4, takeaway = $5, summary = $6,
          original_title = $7, topics = $8
        where id = $1
        returning id`,
      [
        id,
        payload.grade,
        payload.tip,
        payload.title,
        payload.takeaway,
        payload.summary,
        payload.originalTitle,
        JSON.stringify(topics),
      ],
    );
    return rows.length > 0;
  }
  const m = mem();
  const prev = m.items.get(id);
  if (!prev) return false;
  m.items.set(id, {
    ...prev,
    grade: payload.grade,
    tip: payload.tip,
    title: payload.title,
    takeaway: payload.takeaway,
    summary: payload.summary,
    originalTitle: payload.originalTitle,
    topics,
  });
  return true;
}

export async function deleteItem(id: string): Promise<boolean> {
  if (hasDatabaseUrl()) {
    const sql = getSql();
    const rows = await sql(`delete from news_items where id = $1 returning source_url`, [id]);
    return rows.length > 0;
  }
  const m = mem();
  const prev = m.items.get(id);
  if (!prev) return false;
  m.items.delete(id);
  m.urls.delete(prev.sourceUrl);
  return true;
}

export async function upsertBriefing(lines: string[], date = getBriefingDate()) {
  if (hasDatabaseUrl()) {
    const sql = getSql();
    await sql(
      `insert into briefings (briefing_date, lines, updated_at)
       values ($1,$2,now())
       on conflict (briefing_date) do update set lines = excluded.lines, updated_at = now()`,
      [date, JSON.stringify(lines)],
    );
    return;
  }
  mem().briefings.set(date, lines);
}

export async function getBriefing(): Promise<{ date: string; lines: string[] }> {
  const date = getBriefingDate();
  if (hasDatabaseUrl()) {
    const sql = getSql();
    const rows = await sql(`select lines from briefings where briefing_date = $1`, [date]);
    if (!rows[0]) return { date, lines: [] };
    try {
      const parsed = JSON.parse(String(rows[0].lines));
      return { date, lines: Array.isArray(parsed) ? parsed.map(String) : [] };
    } catch {
      return { date, lines: [] };
    }
  }
  return { date, lines: mem().briefings.get(date) ?? [] };
}

export async function beginRun(): Promise<number> {
  if (hasDatabaseUrl()) {
    const sql = getSql();
    const rows = await sql(`insert into ingest_runs (status) values ('running') returning id`);
    return Number(rows[0]?.id);
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
  });
  return id;
}

export async function finishRun(
  id: number,
  info: { status: string; fetched: number; inserted: number; skipped: number; note?: string },
) {
  if (hasDatabaseUrl()) {
    const sql = getSql();
    await sql(
      `update ingest_runs set finished_at = now(), status = $2, fetched = $3, inserted = $4, skipped = $5, note = $6 where id = $1`,
      [id, info.status, info.fetched, info.inserted, info.skipped, info.note ?? null],
    );
    return;
  }
  const run = mem().runs.find((r) => r.id === id);
  if (run) {
    run.finishedAt = Date.now();
    run.status = info.status;
    run.fetched = info.fetched;
    run.inserted = info.inserted;
    run.skipped = info.skipped;
    run.note = info.note;
  }
}

export async function listRuns(limit = 12): Promise<IngestRun[]> {
  if (hasDatabaseUrl()) {
    const sql = getSql();
    const rows = await sql(
      `select id, (extract(epoch from started_at) * 1000) as started_ms,
              (extract(epoch from finished_at) * 1000) as finished_ms,
              status, fetched, inserted, skipped, note
         from ingest_runs order by id desc limit $1`,
      [limit],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      startedAt: Number(row.started_ms),
      finishedAt: row.finished_ms == null ? undefined : Number(row.finished_ms),
      status: String(row.status),
      fetched: Number(row.fetched),
      inserted: Number(row.inserted),
      skipped: Number(row.skipped),
      note: row.note == null ? undefined : String(row.note),
    }));
  }
  return mem().runs.slice(0, limit);
}

export async function lastRunAt(): Promise<number | null> {
  if (hasDatabaseUrl()) {
    const sql = getSql();
    const rows = await sql(
      `select (extract(epoch from finished_at) * 1000) as ms
         from ingest_runs
        where status <> 'seed' and finished_at is not null
        order by finished_at desc limit 1`,
    );
    return rows[0]?.ms == null ? null : Number(rows[0].ms);
  }
  const run = mem().runs.find((r) => r.status !== "seed" && r.finishedAt);
  return run?.finishedAt ?? null;
}
