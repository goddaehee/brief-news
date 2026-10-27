export type Grade = "breaking" | "important" | "note";

export type Topic = {
  slug: string;
  label: string;
};

export type NewsItem = {
  id: string;
  publishedAt: number;
  /** DB 삽입 시각 (epoch ms). 소스별 캡의 최근 점유 계산용 (Phase 2). */
  createdAt?: number;
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
  /** Phase 2 후속: 보류 사유 — 원문 대조 위반 종류(number/status/entity). */
  holdKinds?: string[];
};

/** Phase 1 하드 게이트 범주 — 적중하면 등급 거버너와 무관하게 [중요] 보장. */
export type HardGate = "supply-chain" | "malware" | "cve" | "outage" | "price-today";

/** 사실의 확정 상태. claim/allegation은 제목·시사점에서 사실로 단정하면 안 된다. */
export type FactStatus = "confirmed" | "claim" | "allegation";

/**
 * Phase 1 Pass 1 산출물 — 사실 카드.
 * 등급·제목·시사점은 여기서 확정하지 않는다. Pass 2는 이 카드와 원문만으로 쓴다.
 */
/** Phase 2 후속 (섀도 전용): Pass 1이 함께 산출하는 사건 유형 6종.
 *  등급 결정에는 사용하지 않는다 — decideGrade의 현행 AND 게이트가 유지된다.
 *  150건이 쌓인 뒤에야 활성화 판정이 가능하다. */
export type EventType =
  | "product"
  | "infra"
  | "investment"
  | "regulation"
  | "security"
  | "research";

/** Phase 2 후속 (섀도 전용): 사건이 실무에 미치는 구체적 영향 종류.
 *  투자액 자체, 사건 유형 해당 자체만으로는 여기에 넣지 않는다 (프롬프트 지시). */
export type ImpactBasis = "usability" | "cost" | "supply" | "scope" | "legal" | "security";

/** Phase 2 후속 (섀도 전용): 승격 티어. A는 즉시 후보, B는 섀도 결과 뒤
 *  플래그로 활성화하는 보류 후보 (랩 밖 GA 출시·대형 배포·주 단위 법 서명·
 *  투자 1억~10억 달러). 투자액 규모·주 단위 규제의 코드 단위 분리는
 *  150건 리뷰 과제로 남겨두고, 본 개정에서는 제품의 프런티어 여부만으로
 *  B를 가린다 (그 외 사건은 A로 기록). */
export type ShadowTier = "A" | "B";

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
  /** Phase 2 후속 (섀도 전용): 사건 유형. 없으면 null. */
  eventType?: EventType | null;
  /** Phase 2 후속 (섀도 전용): 구체적 영향 종류 목록. 없으면 []. */
  impactBasis?: ImpactBasis[];
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
  /** Phase 2 후속: kept 중 이미 DB에 있는 URL을 뺀 신규 후보 수 (kept − dropAlreadyInDb).
   *  다단계 선택은 전량을 검토하므로(조기 종료 없음) 이 값은 정확하다. */
  keptNew?: number;
  /** Phase 2 후속: 소스캡에 걸려 드레인 풀에 들어간 후보 수 (중복 제거 전 집계 기준 아님 — 풀 규모). */
  drainCandidates?: number;
  /** Phase 2 후속: 드레인으로 배치에 들어간 건수. */
  drainBatch?: number;
  /** Phase 2 후속: 드레인 레인에서 실제 편입된 건수. */
  drainInserted?: number;
  /** Phase 2 후속: tipLane 예약 슬롯으로 배치에 들어간 건수. */
  tipSlotBatch?: number;
  /** Phase 2 후속: tipLane 예약 슬롯에서 실제 편입된 건수. */
  tipSlotInserted?: number;
  /** Phase 2 후속: 저빈도(METR·Alignment Forum) 공유 슬롯으로 배치에 들어간 건수. */
  lowFreqBatch?: number;
  /** Phase 2 후속: 저빈도 공유 슬롯에서 실제 편입된 건수. */
  lowFreqInserted?: number;
  /** Phase 2 후속: 일반 22슬롯이 차서 반환 대기열에 들어간 건수 (반환 전 규모). */
  generalWaitlist?: number;
  /** Phase 2 후속: 배치 상한(24건)으로 편입되지 못한 검토済 후보 수.
   *  항등식: kept = inDb + cap + batchCap + similar + batchFull + batch. */
  dropBatchFull?: number;
  /** Phase 2 후속: 수집 규칙 버전 (규칙 변경 시 올린다). */
  ruleVersion?: string;
  /** Phase 2 후속: Pass 1·2에 쓴 LLM 모델명 (없으면 null). */
  model?: string | null;
  /** S2 계측: 단계별 소요 시간 (관찰 전용 — 선정·등급 로직과 무관). */
  durations?: CollectDurations;
};

/** S2 계측: 수집 회차 단계별 소요 시간 (ms). 전부 관찰 전용이며 수집 동작을
 *  바꾸지 않는다. blockAMs는 pull·rewrite 병렬 블록의 벽시계 시간이라
 *  pullMs·rewriteMs와 겹친다 (합산 금지). totalMs는 beginRun 직후부터
 *  finishRun 직전까지 — 락 획득·쿨다운 대기는 포함하지 않는다.
 *  classifyMs는 분류 웨이브 + 거버너 + 건별 기록 구간을 함께 잰다. */
export type CollectDurations = {
  totalMs: number;
  setupMs: number;
  blockAMs: number;
  pullMs: number;
  rewriteMs: number;
  dedupeMs: number;
  batchMs: number;
  ledeMs: number;
  classifyMs: number;
  insertMs: number;
  finalizeMs: number;
  /** 회차 중 chatJson 총 호출 수 (재작성 체인 포함). */
  llmCalls: number;
  /** 단일 chatJson 호출의 최장 소요 (ms). */
  llmMaxCallMs: number;
  /** 기사 1건 classifyEntry 체인의 최장 소요 (ms). */
  llmMaxChainMs: number;
};

/** Phase 2 후속: 소스별 단계 카운터. kept_new와 함께 ingest_runs 행에
 *  bySource JSON으로 남는다 (회차당 약 2KB). fetched·kept는 pullRss가,
 *  나머지는 배치·분류·편입 단계가 채운다. */
export type SourceStageCounts = {
  fetched: number;
  kept: number;
  inDb: number;
  cap: number;
  batchCap: number;
  similar: number;
  batch: number;
  scored: number;
  inserted: number;
  drain: number;
};

/** Phase 2 후속: Pass 1 건별 기록 (배치 진입 기사만). importance는 원값으로
 *  남긴다 — 버킷은 조회 시 파생한다 (69/70 경계 정보 손실 방지).
 *  shadowGrade는 등급 결정에 쓰지 않는다 (150건 누적 뒤 활성화 판정용). */
export type ScoredEntry = {
  /** URL 해시 (sha1 앞 12자리). 본문·제목 원문은 저장하지 않는다. */
  hash: string;
  /** 원문 제목 해시 (sha1 앞 12자리). */
  titleHash: string;
  source: string;
  sourceId?: string;
  importance: number | null;
  tip: boolean;
  eventType: EventType | null;
  impactBasis: ImpactBasis[];
  /** Pass 1 evidence(원문 인용)가 비어 있지 않은지. 원문 근거 필수 조건. */
  hasEvidence: boolean;
  /** 기존 신호 판정 (hasStrongSignal — 최종 제목·시사점·원제목 기준). */
  strongSignal: boolean;
  /** 섀도 티어. 사건 유형이 없으면 "none". */
  shadowTier: ShadowTier | "none";
  /** 티어 A만 활성화했을 때의 섀도 등급 (hardGate분은 important로 미러링). */
  shadowGrade: Grade;
  /** 티어 A만 활성화했을 때 승격 여부 (shadowGrade와 동일 정보의 불리언형). */
  promotesA: boolean;
  /** 티어 A+B를 모두 활성화했을 때 승격 여부. 티어 B 자격 충족분은
   *  shadowGrade가 note여도 promotesAB가 true라 사후 구분이 된다. */
  promotesAB: boolean;
  /** 거버너 적용 후 최종 등급. */
  grade: Grade;
  /** 배치 진입 레인. */
  lane: "general" | "tip" | "lowfreq" | "drain";
  /** 원문 대조 검증 실패 보류 여부. */
  held: boolean;
  /** 보류 사유 (number/status/entity). */
  holdKinds: string[];
};

/** Phase 2 후속: 건별 탈락 원장 행. URL·제목은 해시만 남긴다.
 *  같은 URL은 upsert로 1행 유지 (first_seen 유지, last_seen·seen_count 갱신). */
export type DropLedgerRow = {
  urlHash: string;
  titleHash: string;
  source: string;
  sourceId?: string;
  publishedAt: number;
  lastStage:
    | "sourceCap"
    | "batchSourceCap"
    | "similar"
    | "keepFalse"
    | "newCap"
    | "insertFail"
    | "batchFull";
  similarId?: string | null;
};

/** Phase 2 후속: 회차 상세 (POST 응답·ingest_runs 행에 함께 남는다). */
export type CollectDetail = {
  bySource: Record<string, SourceStageCounts>;
  scored: ScoredEntry[];
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
  /** Phase 2 후속: 소스별 맵 + Pass 1 건별 기록. */
  detail?: CollectDetail;
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
  /** Phase 2 후속: 회차 상세 (ingest_runs 행의 stats·by_source·scored 컬럼). */
  stats?: CollectStats;
  bySource?: Record<string, SourceStageCounts>;
  scored?: ScoredEntry[];
  ruleVersion?: string;
  model?: string | null;
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
