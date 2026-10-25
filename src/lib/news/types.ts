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
  keep?: boolean;
};

/**
 * Phase 0 누락 귀속 계측 — 수집 파이프라인 단계별 카운터.
 * fetched(rawFetched) → keep 판정 → URL 중복 제거 → 배치(소스캡·유사도)
 * → LLM keep 판정 → newCap → 저장(inserted) 순으로 어디서 몇 건이
 * 어떤 사유로 빠지는지를 센다. 동작 변경 없는 순수 계측이다.
 */
export type CollectStats = {
  /** 피드에서 파싱한 원시 건수 (keepEntry 필터 전) */
  rawFetched: number;
  /** keepEntry 탈락: SKIP_HINT(주식·공시·행사성 등) */
  dropSkipHint: number;
  /** keepEntry 탈락: 벤더 블로그 고객 사례·파트너십 홍보 */
  dropVendorStory: number;
  /** keepEntry 탈락: 보안 소스인데 제목에 AI 신호 없음 */
  dropSecHint: number;
  /** keepEntry 탈락: AI 신호 없음 */
  dropNoAiSignal: number;
  /** pullRss 내 동일 URL 중복 제거 */
  dropUrlDup: number;
  /** keep 판정 + URL 중복 제거를 통과한 후보 수 (기존 fetched와 동일) */
  kept: number;
  /** 배치 탈락: 이미 피드에 있는 URL */
  dropAlreadyInDb: number;
  /** 배치 탈락: 소스별 기존 점유 캡 SOURCE_CAP */
  dropSourceCap: number;
  /** 배치 탈락: 배치 내 소스당 캡 BATCH_SOURCE_CAP */
  dropBatchSourceCap: number;
  /** 배치 탈락: 기존·배치 내 기사와 유사 (dedupe) */
  dropSimilar: number;
  /** 배치 탈락: BATCH_MAX 도달로 아예 검토하지 못한 후순위 */
  dropBatchMax: number;
  /** 분류(LLM)에 들어간 건수 */
  batch: number;
  /** classifyEntry keep=false (shouldDrop·LLM 판정) */
  dropKeepFalse: number;
  /** keep=true이나 신규 캡 newCap 초과 */
  dropNewCap: number;
  /** insertItem 실패 */
  dropInsertFail: number;
  /** 오류로 중단된 부분 집계일 때만 true. 항등식은 정상 완료 실행에서만 성립한다. */
  partial?: boolean;
  /** partial일 때 실패한 단계 (pull/dedupe/batch/classify/insert/finalize) */
  failedStage?: string;
};

export type CollectResult = {
  ok: boolean;
  status: "ok" | "rate_limited" | "error";
  fetched: number;
  inserted: number;
  skipped: number;
  note: string;
  lastRunAt: number | null;
  /** Phase 0 계측. 수집이 실제 실행된 경우에만 포함된다. */
  stats?: CollectStats;
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
