-- Shared news corpus. Unowned rows (no user_id): world-readable feed.
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
