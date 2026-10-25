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
  /** Phase 1 (2패스 데스크): Pass 1 사실 카드. 저장 시 repo가 무시하는 메타. */
  card?: FactCard;
  /** Phase 1: Pass 1 중요도 점수 (0~100). 거버너 순위·하한 판정용. */
  score?: number;
  /** Phase 1: 하드 게이트 적중 범주. 있으면 [중요] 보장. */
  hardGate?: HardGate | null;
  /** Phase 1: 보안 소스(SEC_TITLE_HINT 통과) 여부. 거버너 비율 상한 밖. */
  secHint?: boolean;
  /** Phase 1: 원문 대조 검증 실패로 보류(keep=false)된 경우 true. */
  held?: boolean;
};

/** Phase 1 하드 게이트 범주 — 적중하면 등급 거버너와 무관하게 [중요] 보장. */
export type HardGate = "supply-chain" | "malware" | "cve" | "outage" | "price-today";

/** 사실의 확정 상태. claim/allegation은 제목·시사점에서 사실로 단정하면 안 된다. */
export type FactStatus = "confirmed" | "claim" | "allegation";

/**
 * Phase 1 Pass 1 산출물 — 사실 카드.
 * 등급·제목·시사점은 여기서 확정하지 않는다. Pass 2는 이 카드와 원문만으로 쓴다.
 */
export type FactCard = {
  status: FactStatus;
  /** 원문 표기 그대로의 고유명사 (한글 원문이면 한글, 영문이면 영문). */
  entities: string[];
  /** 이 기사의 entities 중 데스크 등록 표기(ENTITY_FORMS)가 있는 이름의 한글 표기만.
   *  등록에 없는 외래 이름은 넣지 않는다 — Pass 2가 제목에서 라틴 표기를 유지한다. */
  hangulForms: string[];
  /** 무엇이 어떻게 달라졌나 — 변경점 한 줄. */
  change: string;
  /** 원문에 실제로 있는 수치만, 원문 표기 그대로. */
  numbers: string[];
  /** 근거 구절 — 원문에서 짧게 인용. */
  evidence: string;
  /** 중요도 점수 0~100 (등급이 아니라 순위·하한 판정용 원자재). */
  importance: number;
  /** 승격 근거 한 줄. 없으면 빈 문자열. */
  promotionReason: string;
  hardGate: HardGate | null;
  /** 당일·즉시·진행 중 — 속보 판정용 사실 여부. */
  immediate: boolean;
  tip: boolean;
  topics: string[];
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
  /** Phase 1 거버너: 비율 상한 때문에 [중요]→[참고]로 강등된 건수 (dropKeepFalse와 무관한 부가 정보). */
  govDemoted?: number;
  /** Phase 1 거버너: 이번 배치 편입 후 최근 40건 창의 [중요]급(속보 포함) 비율 (0~1). */
  govShareAfter?: number;
  /** Phase 1 거버너: 비율이 12~18% 밴드를 벗어났을 때의 검토 신호 (자동 강등 아님). */
  govSignal?: string;
  /** Phase 1: 원문 대조 검증 실패로 보류된 건수 (dropKeepFalse의 부분집합). */
  deskHeld?: number;
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
