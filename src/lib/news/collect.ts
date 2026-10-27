import { isSeedItem } from "./data";
import {
  chatJson,
  createLlmDeadline,
  llmDeadlineState,
  resolveLlm,
  setLlmCallLabel,
  setLlmDeadline,
  setLlmMetricsSink,
  updateLlmCallPass,
  type LlmCallMetrics,
  type LlmDeadlineContext,
} from "./llm";
import {
  assessShadow,
  buildPayloadFromCard,
  FACT_SYSTEM,
  factUser,
  fixTypos,
  hasStrongSignal,
  needsRewrite,
  parseFactCard,
  shouldDrop,
  verifyAgainstCard,
  WRITE_SYSTEM,
  writeUser,
} from "./desk";
import {
  COLLECT_COOLDOWN_MS,
  COLLECT_MAX_NEW,
  COLLECT_REWRITE_MAX,
  INGEST_MAX_BATCH,
  NEWS_SOURCES,
  SOURCE_RANK,
  type NewsSource,
} from "./sources";
import { decodeFeedBytes, parseFeedXml, parseNewsMarkdown } from "./parse";
import {
  abortStaleRuns,
  beginRun,
  countRecentInsertsBySource,
  deleteItem,
  ensureSeeded,
  finishRun,
  getDropLedgerSeen,
  getFeedCache,
  hash12,
  insertItem,
  lastRunAt,
  listAllSourceUrls,
  listNews,
  pruneDropLedger,
  pruneOldRuns,
  recordDropLedger,
  releaseCollectLock,
  setFeedCache,
  tryCollectLock,
  updateItem,
  updateRunStats,
  upsertBriefing,
} from "./repo";
import type {
  CollectDetail,
  CollectDurations,
  CollectResult,
  CollectStats,
  DropLedgerRow,
  FactCard,
  IngestPayload,
  NewsItem,
  ScoredEntry,
  SourceStageCounts,
} from "./types";

/** Phase 2 후속: 수집 규칙 버전. 수집·선택·등급 규칙이 바뀌면 올린다. */
export const COLLECT_RULE_VERSION = "p2f-1";

/** B1 확정 수치 (improvement-decision.md §2.3·§3 — 임의 변경 금지):
 *  LLM 마감 47초 / 종료 기한 55초 / 체인 시작 게이트 잔여 10초 / 포이즌 3회. */
export const LLM_DEADLINE_MS = 47_000;
export const FINISH_DEADLINE_MS = 55_000;
/** B1: 종료 기한에서 finishRun(최종 상태 기록)용으로 비워 두는 예비 시간.
 *  마감 구간 I/O(원장·브리핑·보존 정리)는 이 예비를 침범하지 않게 제한한다. */
export const FINISH_RESERVE_MS = 5_000;
export const CHAIN_START_GATE_MS = 10_000;
export const POISON_HOLD_LIMIT = 3;
/** B1 M6: running 행 stale 판정 기준 (10분 초과). */
export const STALE_RUN_MS = 10 * 60 * 1000;

/** B1: 포이즌 판정 — LLM 실패 보류 전용 카운터(llm_fail_count)가 3회
 *  누적됐거나, 이미 포이즌 제외된 URL인가. seen_count는 모든 탈락 사유가
 *  섞이는 누적이라 쓰지 않는다 (Codex 리뷰: 사유 혼합 오작동 + poison
 *  기록이 판정을 해제하는 문제). 한 번 제외되면 원장이 보존되는 동안
 *  (14일) 제외가 유지되고, 분류가 완료된 회차(keepFalse 등)가 끼면
 *  카운터가 리셋돼 재진입한다. */
export function isPoisonedHold(
  seen: { llmFailCount: number; lastStage: string } | undefined,
): boolean {
  if (!seen) return false;
  return seen.lastStage === "poison" || seen.llmFailCount >= POISON_HOLD_LIMIT;
}

/** B1: 회차 종료 상태 — 데드라인 보류·호출 중단이 있으면 partial. */
export function decideRunStatus(s: {
  heldDeadline?: number;
  callsAborted?: number;
}): "ok" | "partial" {
  return (s.heldDeadline ?? 0) > 0 || (s.callsAborted ?? 0) > 0 ? "partial" : "ok";
}

/** B1: 데드라인 게이트 — LLM 마감까지 잔여가 게이트(10초) 미만이면 새
 *  체인·패스를 시작하지 않는다. 데드라인 문맥이 없으면(ingest 경로) 항상 열려 있다. */
export function deadlineGateClosed(): boolean {
  const s = llmDeadlineState();
  return s !== null && s.remainingMs < CHAIN_START_GATE_MS;
}

/** B1: 방금 실패한 호출의 사유 분류 — 데드라인 중단이면 deadline, 아니면 llm-fail. */
export function currentFailureKind(): "deadline" | "llm-fail" {
  const s = llmDeadlineState();
  return s && (s.aborted || s.remainingMs <= 0) ? "deadline" : "llm-fail";
}

/** Phase 2 후속: 저빈도 소스 (7일 평균 1건/일 미만 — METR·Alignment Forum).
 *  신선도 6→48시간 + 두 소스 합쳐 회차당 최대 2건의 배치 기회 (편입 보장 없음). */
export const LOW_FREQ_SOURCE_IDS = new Set(["metr", "alignmentforum"]);

/**
 * Phase 2 후속: 드레인 24시간 추가 허용량. 기본 캡 6건은 유지하고,
 * 드레인으로 소스당 24시간 합계 최대 8건까지만 추가한다.
 * 일반 경로로는 24시간 삽입이 6건을 넘을 수 없으므로, 6건 초과분은
 * 전부 과거 드레인 삽입이다 — 별도 드레인 장부 없이 이 식으로 센다
 * (rewriteStale은 삽입이 아니라 갱신·삭제라 이 식을 깨지 않는다.
 * 단, ingestPayloads(X 보충 경로)는 캡을 우회하므로 그 경로가 다시
 * 살아나면 이 식은 과대 계상한다 — 그때는 드레인 장부로 바꿀 것).
 */
export function drainRemainingAllowance(recentInserts24h: number): number {
  return Math.max(0, 2 - Math.max(0, recentInserts24h - 6));
}

/** Phase 0 계측 카운터 초기화 (전 필드 0). */
export function newCollectStats(): CollectStats {
  return {
    rawFetched: 0,
    dropSkipHint: 0,
    dropVendorStory: 0,
    dropSecHint: 0,
    dropNoAiSignal: 0,
    dropUrlDup: 0,
    kept: 0,
    dropAlreadyInDb: 0,
    dropSourceCap: 0,
    dropBatchSourceCap: 0,
    dropSimilar: 0,
    dropBatchMax: 0,
    batch: 0,
    dropKeepFalse: 0,
    dropNewCap: 0,
    dropInsertFail: 0,
    keptNew: 0,
    drainCandidates: 0,
    drainBatch: 0,
    drainInserted: 0,
    tipSlotBatch: 0,
    tipSlotInserted: 0,
    lowFreqBatch: 0,
    lowFreqInserted: 0,
    generalWaitlist: 0,
    dropBatchFull: 0,
  };
}

/** S2 계측: 단계별 소요 시간 초기화 (전 필드 0). 관찰 전용. */
export function newCollectDurations(): CollectDurations {
  return {
    totalMs: 0,
    setupMs: 0,
    blockAMs: 0,
    pullMs: 0,
    rewriteMs: 0,
    dedupeMs: 0,
    batchMs: 0,
    ledeMs: 0,
    classifyMs: 0,
    insertMs: 0,
    finalizeMs: 0,
    llmCalls: 0,
    llmMaxCallMs: 0,
    llmMaxChainMs: 0,
  };
}

/**
 * Phase 2 후속: 저빈도 공유 상한 판정. 저빈도 소스의 배치 선택은 모든 레인
 * (일반·tip·드레인·반환)을 합쳐 회차당 최대 2건·소스당 1건으로 제한한다 —
 * 전용 슬롯 단계에서만 세면 일반 단계에서 이미 뽑힌 분이 상한을 넘는다
 * (Codex 리뷰 P1-2). check()와 드레인 단계가 함께 쓴다.
 */
export function lowFreqCapReached(totalSelected: number, perSourceSelected: number): boolean {
  return totalSelected >= 2 || perSourceSelected >= 1;
}

/**
 * Phase 2 후속: 배치 입장 캡 판정 (유사도 제외 순수 부분 — 테스트 가능).
 * 우선순위: inDb → 저빈도 공유 상한 → 소스캡 → 배치 소스캡.
 * 저빈도 상한이 소스캡보다 앞선다 — 두 캡이 동시에 걸린 저빈도 후보는
 * 소스캡 풀(드레인 대상)이 아니라 배치 소스캡 family로 종결해야 하기 때문이다
 * (Codex 3차 리뷰: 반환 단계 cap 분기가 저빈도 초과분을 sourceCap으로 뭉개던 문제).
 */
export function admissionCapDecision(args: {
  inDb: boolean;
  sourceCount: number;
  sourceCap: number;
  batchCount: number;
  batchSourceCap: number;
  isLowFreq: boolean;
  lowFreqTotal: number;
  lowFreqPerSource: number;
}): "inDb" | "cap" | "batchCap" | "pass" {
  if (args.inDb) return "inDb";
  if (args.isLowFreq && lowFreqCapReached(args.lowFreqTotal, args.lowFreqPerSource))
    return "batchCap";
  if (args.sourceCount >= args.sourceCap) return "cap";
  if (args.batchCount >= args.batchSourceCap) return "batchCap";
  return "pass";
}

/** Phase 2 후속: 소스별 단계 카운터 초기화. */
export function newSourceStageCounts(): SourceStageCounts {
  return {
    fetched: 0,
    kept: 0,
    inDb: 0,
    cap: 0,
    batchCap: 0,
    similar: 0,
    batch: 0,
    scored: 0,
    inserted: 0,
    drain: 0,
  };
}

const AI_HINT =
  /\b(ai|a\.i\.|llm|gpt-?\d*|chatgpt|claude|gemini|grok|openai|anthropic|xai|nvidia|hbm|gpu|agent|인공지능|생성형|챗봇|딥러닝|에이전트|언어\s*모델|파운데이션\s*모델)\b/i;
const SKIP_HINT =
  /장내매수|최대주주|액면병합|변경상장|유상증자|무상증자|주식\s*취득|임원\s*변동|거래정지|시간외|배당\s*공시|youtube|youtu\.be|노트북 후보|특징주|테마주|급등주|상한가|하한가|공시\b|거주 세계|자사주|만찬|국빈|시상식|포토\s*뉴스|오늘의 인물/i;

/**
 * 벤더 블로그(OpenAI/Google/NVIDIA 등)의 고객 사례(customer story)·에코시스템 홍보는 PR이므로 수집에서 제외.
 * 예: "Amp puts AI agents to work beyond code with OpenAI models" (출처: OpenAI)
 *     "SentinelOne cuts malware analysis from weeks to hours" (본문에 "With OpenAI Daybreak")
 *     "노르딕, 엔비디아 손잡고 유럽 AI 컴퓨팅 허브로" (출처: NVIDIA, blogs.nvidia.com)
 * 이런 글은 헤드라인의 주어가 타사인데 출처가 벤더라 독자를 혼란스럽게 한다.
 * (12차 평가: 출처 라벨 오류 1건→2건 확산의 실제 원인 — 매핑 버그가 아니라 고객 사례 유입)
 * (13차 평가: 벤더 필터가 "How..." 패턴만 보고 에코시스템 홍보 글을 통과시킴 — 파트너십 패턴 추가)
 */
const VENDOR_BLOG_SOURCES = new Set([
  "OpenAI",
  "Google AI",
  "Google DeepMind",
  "NVIDIA",
  "Hugging Face",
]);
/** 벤더 자사 블로그 도메인 (소스 라벨이 달라도 URL로 식별 — 방어선) */
const VENDOR_BLOG_DOMAINS =
  /(^|\.)blogs\.nvidia\.com$|(^|\.)openai\.com$|(^|\.)blog\.google$|(^|\.)deepmind\.google$|(^|\.)huggingface\.co$/i;
/** "How [기업] ..." — 고객 사례의 전형적인 제목 형식 (단, "How we ..."는 자사 글이므로 제외) */
const CUSTOMER_STORY_TITLE_HINT = /^how\s+(?!we\b)[a-z0-9]/i;
/** "with OpenAI models", "With OpenAI Daybreak", "using ChatGPT API" — 타사 주어 + 자사 제품 언급 */
const VENDOR_PRODUCT_HINT =
  /\b(with|using|built\s+with|powered\s+by)\s+(openai|chatgpt|gpt-?\d*|codex|gemini|deepmind|nvidia)\s+(models?|technology|api|platform|daybreak)\b/i;
/** "손잡고", "와 협력", "파트너십", "협업" — 벤더 블로그의 파트너십/에코시스템 홍보 발표 */
const PARTNERSHIP_HINT =
  /손잡고|손을\s*잡|파트너십|파트너\s*협력|제휴|합작|협업|공동\s*(개발|발표|연구|협력)|와\s*협력|과\s*협력|와\s*함께|과\s*함께|partners?\s+with|partnership|collaborat\w*|teams?\s+up\s+with|teaming\s+up|joins?\s+forces/i;

function isVendorBlog(e: RawEntry): boolean {
  if (VENDOR_BLOG_SOURCES.has(e.source)) return true;
  try {
    return VENDOR_BLOG_DOMAINS.test(new URL(e.sourceUrl).hostname);
  } catch {
    return false;
  }
}

function isVendorCustomerStory(e: RawEntry): boolean {
  if (!isVendorBlog(e)) return false;
  const text = `${e.title} ${e.summary}`;
  return (
    CUSTOMER_STORY_TITLE_HINT.test(text) ||
    VENDOR_PRODUCT_HINT.test(text) ||
    PARTNERSHIP_HINT.test(text)
  );
}

function lockOwner(): string {
  return `brief-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function collectOnce(): Promise<CollectResult> {
  await ensureSeeded();
  const owner = lockOwner();
  const locked = await tryCollectLock(owner);
  if (!locked) {
    return {
      ok: true,
      status: "rate_limited",
      fetched: 0,
      inserted: 0,
      skipped: 0,
      note: "다른 장비가 수집 중입니다. 같은 글을 두 번 요약하지 않습니다.",
      lastRunAt: await lastRunAt(),
    };
  }

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const last = await lastRunAt();
    if (last && Date.now() - last < COLLECT_COOLDOWN_MS) {
      return {
        ok: true,
        status: "rate_limited",
        fetched: 0,
        inserted: 0,
        skipped: 0,
        note: "최근 수집 후 10분이 지나지 않았습니다. 같은 파이프라인을 크론이 쳐도 중복 과금이 나지 않습니다.",
        lastRunAt: last,
      };
    }

    const runId = await beginRun();
    // B1 M6: 이전 회차가 플랫폼 강제 종료로 남긴 stale running 행을 aborted로
    // 마감한다. 락 보유·쿨다운 통과 직후라 동시 실행 회차와 간섭하지 않는다.
    let staleAborted = 0;
    try {
      staleAborted = await abortStaleRuns(Date.now() - STALE_RUN_MS);
      if (staleAborted > 0) {
        console.log(`[collect-m6] stale running ${staleAborted}건을 aborted로 정리`);
      }
    } catch {
      /* 상태 위생 목적 — 실패해도 수집은 계속한다 */
    }
    // 34차: 제목 재시도 예산은 run 지역 객체로 (전역 변수 초기화 경합 방지 — Codex 재심)
    const retryBudget: RetryBudget = { left: 12 };
    // Phase 0 계측: 단계별 탈락 카운터 (동작 변경 없는 순수 계측)
    const stats = newCollectStats();
    // S2 계측: 단계별 소요 시간 + LLM 호출 계측 (관찰 전용, 동작 불변).
    // stats.durations에 같은 객체를 걸어 두어 오류 시 부분 스냅샷에도 남긴다.
    const runStartedAt = Date.now();
    const durations = newCollectDurations();
    const llmMetrics: LlmCallMetrics = { calls: 0, maxMs: 0 };
    setLlmMetricsSink(llmMetrics);
    stats.durations = durations;
    if (staleAborted > 0) stats.staleRunsAborted = staleAborted;
    // B1: 2단계 데드라인 — LLM 마감은 회차 시작(runStartedAt) +47초.
    // 마감 타이머가 AbortController를 중단시켜 진행 중 fetch까지 취소한다.
    // 종료 기한 55초는 이 마감 + 마감 작업 실측(≤6.4초)으로 구조적으로 보장한다.
    const deadline: LlmDeadlineContext = createLlmDeadline(runStartedAt + LLM_DEADLINE_MS);
    setLlmDeadline(deadline);
    deadlineTimer = setTimeout(
      () => deadline.controller.abort(),
      Math.max(0, deadline.deadlineAt - Date.now()),
    );
    // B1: 단계 체크포인트 — 단계 경계마다 run 행 stats 스냅샷을 갱신한다.
    // 강제 종료돼도 마지막 단계까지의 부분 집계·호출 기록이 남는다.
    // 쓰기는 단계당 1회·짧은 타임아웃·fail-open으로 제한한다 (확정안).
    // Codex 리뷰: 지연된 쓰기가 더 새로운 스냅샷을 덮지 않도록 쓰기를
    // 체인으로 직렬화하고(스냅샷은 호출 시점에 고정), repo 쪽에서도
    // running 행만 갱신해 finishRun 이후 도착분을 무효화한다.
    /** B1: 종료 기한(55초)까지의 잔여. 마감 구간 판정은 이 값을 매번
     *  새로 계산한다 (한 번 계산한 플래그는 I/O가 기한을 넘기는 경우를
     *  놓친다 — Codex 3차 리뷰). */
    const finishRemainingMs = () => runStartedAt + FINISH_DEADLINE_MS - Date.now();
    /** B1 (Codex 4차 리뷰): 선택 I/O의 대기 자체를 (종료 잔여 − 예비)로
     *  제한한다. 시작 전 검사만으로는 호출 도중 기한을 넘기는 경우를 못
     *  막는다. 제한을 넘기면 기다리지 않고 진행한다 — 작업은 백그라운드로
     *  이어질 수 있고 전부 멱등·best-effort라 안전하다. 제한 안에서 난
     *  오류는 기존처럼 전파한다. */
    const FINISH_TIMEOUT = Symbol("finish-timeout");
    const awaitWithinFinishBudget = async (p: Promise<unknown>): Promise<boolean> => {
      const waitMs = Math.max(0, finishRemainingMs() - FINISH_RESERVE_MS);
      if (waitMs <= 0) {
        p.catch(() => undefined);
        return false;
      }
      const r = await Promise.race([
        p,
        new Promise((resolve) => setTimeout(() => resolve(FINISH_TIMEOUT), waitMs)),
      ]);
      if (r === FINISH_TIMEOUT) {
        p.catch(() => undefined);
        return false;
      }
      return true;
    };
    let checkpointChain: Promise<unknown> = Promise.resolve();
    const checkpoint = async (_stage: string) => {
      durations.totalMs = Date.now() - runStartedAt;
      durations.llmCalls = llmMetrics.calls;
      durations.llmMaxCallMs = llmMetrics.maxMs;
      durations.llmCallLog = deadline.calls.slice();
      const snap = JSON.parse(JSON.stringify(stats)) as CollectStats;
      const write = checkpointChain.then(() =>
        updateRunStats(runId, snap).catch(() => undefined),
      );
      checkpointChain = write;
      // B1 (Codex 재리뷰): 대기는 종료 예비(5초)를 남긴 잔여로 제한한다 —
      // 기한이 임박하면 기다리지 않고 진행한다. 쓰기 자체는 체인 순서대로
      // 이어지고, running 가드가 최종 기록을 보호한다.
      const waitMs = Math.max(
        0,
        Math.min(2000, finishRemainingMs() - FINISH_RESERVE_MS),
      );
      if (waitMs > 0) {
        try {
          await Promise.race([
            write,
            new Promise((resolve) => setTimeout(resolve, waitMs)),
          ]);
        } catch {
          /* 체크포인트 실패는 수집을 막지 않는다 */
        }
      }
    };
    // S2 계측: 단계 시작 시각 (0 = 미진입). 실패한 단계의 소요를 catch에서
    // 채우기 위해 지역 let으로 둔다 (Codex 리뷰 반영).
    let blockAStartedAt = 0;
    let pullStartedAt = 0;
    let rewriteStartedAt = 0;
    let dedupeStartedAt = 0;
    let batchStartedAt = 0;
    let ledeStartedAt = 0;
    let classifyStartedAt = 0;
    let insertStartedAt = 0;
    let finalizeStartedAt = 0;
    // 오류 시 부분 집계가 어느 단계에서 끊겼는지 표시하기 위한 진행 단계
    let statsStage = "pull";
    let fetched = 0;
    let inserted = 0;
    let skipped = 0;
    // B1 M3-lite: 재작성은 삽입 뒤에서 채운다 (블록A 병렬 실행에서 이동).
    let rewritten = 0;

    try {
      const existing = await listNews();
      // Phase 2: 중복 판정용 전체 URL은 200건 창(listNews)이 아니라
      // source_url 전체 조회로 구축한다 — 창 밖 중복이 분류(LLM)까지 간 뒤
      // 삽입 시점에 소실(dropInsertFail)되는 것을 막는다.
      // 조회 시점은 락·쿨다운 통과 직후·배치 루프 전. 이후 rewriteStale이
      // 병렬로 항목을 삭제하더라도 그 URL은 이번 run에서 보수적으로
      // '기존'으로 남는다 (허용 — 다음 run에서 재분류된다).
      const allSourceUrls = await listAllSourceUrls();
      // Phase 2 후속: 소스별 단계 맵 (ingest_runs 행·POST 응답에 남는다).
      const bySource = new Map<string, SourceStageCounts>();
      const srcCounts = (name: string): SourceStageCounts => {
        const c = bySource.get(name) ?? newSourceStageCounts();
        bySource.set(name, c);
        return c;
      };
      // B1 M3-lite: 재작성(rewriteStale)은 블록A 병렬에서 빼서 삽입 뒤로
      // 옮겼다 — 긴 재작성 회차가 분류 예산을 잠식하던 경로(17:00 회차
      // rewrite 15.4초)를 끊는다. 블록A는 이제 pull 단독이며 blockAMs는
      // pullMs와 같아진다. rewriteMs는 삽입 뒤 실행 지점에서 잰다.
      blockAStartedAt = Date.now();
      durations.setupMs = blockAStartedAt - runStartedAt;
      pullStartedAt = Date.now();
      let entries: RawEntry[];
      try {
        entries = await pullRss(stats, bySource);
      } finally {
        durations.pullMs = Date.now() - pullStartedAt;
        pullStartedAt = 0;
      }
      durations.blockAMs = Date.now() - blockAStartedAt;
      blockAStartedAt = 0;
      await checkpoint("pull");
      statsStage = "dedupe";
      // rewriteStale이 삭제/업데이트했을 수 있으므로 최신 피드로 다시 조회 후 중복 정리 (P2)
      dedupeStartedAt = Date.now();
      const deduped = await dedupeExisting(await listNews());
      durations.dedupeMs = Date.now() - dedupeStartedAt;
      dedupeStartedAt = 0;
      batchStartedAt = Date.now();
      fetched = entries.length;
      // B1 M3-lite: 재작성이 삽입 뒤로 이동해 이번 회차 재작성 건수를 편입
      // 상한에 결합할 수 없다. 상한은 AGENTS.md 문서값(신규 최대 6건)으로
      // 고정하고, 회차 총작업량은 데드라인이 bound한다.
      const newCap = COLLECT_MAX_NEW;
      // 중복 체크는 전체 URL Set으로 (순차 DB 왕복 제거). existingItems(200건 창)는
      // 유사도 검사·sourceCounts·거버너 용도로만 현행 유지한다.
      const existingUrls = new Set(allSourceUrls);
      const existingItems = existing.filter((i) => !isSeedItem(i));
      // 소스별 하드캡: 단일 소스 최대 6건 (풍선 효과 방지 — ZDNet 잡으니 인공지능신문이 올라옴)
      // Phase 2: 점유 계산을 '최근 24시간 삽입분'으로 바꾼다. 기존의 200건 창
      // 기준은 삽입이 멈추면 창이 화석화돼(9개 소스가 정확히 6건에서 동결)
      // 해당 소스의 신선 기사가 영구 차단되는 교착을 만들었다 (실측:
      // 창 최신 글이 23시간+ 정지, dropSourceCap이 배치 최대 탈락으로 고정).
      // 집계는 발행일 창과 무관하게 created_at으로 DB에서 직접 한다 —
      // 창 밖 백로그의 최근 삽입까지 세야 캡 보장이 새지 않는다 (Codex P2).
      // 풍선 방지 취지(최근 피드에서 단일 소스 점유 제한)는 24시간 기준으로 유지된다.
      const SOURCE_CAP = 6;
      const sourceCounts = await countRecentInsertsBySource(Date.now() - 24 * 3600 * 1000);
      // Phase 2 후속: 다단계 배치 선택 (배치·편입 상한 24건·6건은 유지).
      //  1) 일반: 최대 22슬롯 (tip 예약 2슬롯을 남긴다).
      //  2) tipLane 예약: 24건 중 2슬롯 (미사용분은 아래 단계로 반환, 편입 보장 없음).
      //  3) 저빈도 공유 슬롯: METR·Alignment Forum 합쳐 최대 2건·소스당 1건.
      //     상한은 전 레인 공유 카운터로 적용한다 — 일반 단계에서 이미 뽑힌
      //     분까지 합쳐 2건·소스당 1건을 넘지 않는다.
      //  4) 드레인 파일럿: 회차당 최대 4건, 소스당 회차당 1건·24h 추가 2건
      //     (합계 최대 8건), 발행 48h 이내·소스 내 오래된 것부터(FIFO).
      //     해당 소스의 최종 40건 창 점유 8건 이상이면 그 소스 드레인 중단.
      //  5) 반환: 일반 대기열을 남은 슬롯에 채운다.
      //     반환 후 남은 대기열은 배치 상한 탈락(dropBatchFull)으로 종결한다.
      // 소스캡에 걸린 후보는 즉시 탈락으로 세지 않고 드레인 풀에 모은 뒤
      // 드레인 단계에서 최종 판정한다 (선택되면 batch, 아니면 cap 탈락).
      // 배치 소스당 상한은 3→4건으로 올린다 (모든 레인 합산).
      // 전량을 검토하므로 조기 종료가 없고, 구 dropBatchMax(미검토 후순위)는
      // 항상 0이다 — 대신 대기열·풀 규모를 generalWaitlist·drainCandidates로 남긴다.
      // 항등식: kept = inDb + cap + batchCap + similar + batchFull + batch.
      const BATCH_MAX = 24;
      const BATCH_SOURCE_CAP = 4;
      const GENERAL_SLOTS = BATCH_MAX - 2;
      const TIP_RESERVE = 2;
      const LOWFREQ_ROUND_MAX = 2;
      const LOWFREQ_PER_SOURCE = 1;
      const DRAIN_ROUND_MAX = 4;
      const DRAIN_PER_SOURCE_ROUND = 1;
      const DRAIN_MAX_AGE_MS = 48 * 3600 * 1000;
      const WINDOW_40 = 40;
      statsStage = "batch";
      const batchSourceCounts = new Map<string, number>();
      const fresh: LaneEntry[] = [];
      // 원장 수집: 배치 단계 탈락 + 뒤의 분류·편입 탈락을 모아 finalize 전에 1번 쓴다.
      const ledgerRows: DropLedgerRow[] = [];
      const ledgerPush = (row: DropLedgerRow) => {
        ledgerRows.push(row);
      };
      // 최종 40건 창 소스별 점유 (드레인 중단 판정용 — 거버너 창과 동일).
      const window40Counts = new Map<string, number>();
      for (const i of existingItems.slice(0, WINDOW_40)) {
        window40Counts.set(i.source, (window40Counts.get(i.source) ?? 0) + 1);
      }
      const decided = new Set<string>();
      const capPool: RawEntry[] = [];
      const generalWaitlist: RawEntry[] = [];
      // Phase 2 후속 (Codex 리뷰 P1-2): 저빈도 선택량은 전 레인 공유 카운터로 센다.
      // 전용 슬롯 단계에서만 세면 일반 단계에서 뽑힌 분이 상한을 넘기기 때문이다.
      let lowFreqSelectedTotal = 0;
      const lowFreqSelectedBySource = new Map<string, number>();
      const findSimilar = (e: RawEntry): { id: string } | null => {
        const hit = existingItems.find(
          (i) =>
            tooSimilar(i.title, e.title, i.publishedAt, e.date) ||
            tooSimilar(i.originalTitle, e.title, i.publishedAt, e.date),
        );
        if (hit) return { id: hit.id };
        const f = fresh.find((x) => tooSimilar(x.title, e.title, x.date, e.date));
        if (f) return { id: hash12(f.sourceUrl) };
        return null;
      };
      const countDrop = (
        e: RawEntry,
        kind: "inDb" | "batchCap" | "similar",
        similarId?: string | null,
      ) => {
        skipped += 1;
        if (kind === "inDb") {
          stats.dropAlreadyInDb += 1;
          srcCounts(e.source).inDb += 1;
        } else if (kind === "batchCap") {
          stats.dropBatchSourceCap += 1;
          srcCounts(e.source).batchCap += 1;
          ledgerPush({
            urlHash: hash12(e.sourceUrl),
            titleHash: hash12(e.title),
            source: e.source,
            sourceId: e.sourceId,
            publishedAt: e.date,
            lastStage: "batchSourceCap",
            similarId: null,
          });
        } else {
          stats.dropSimilar += 1;
          srcCounts(e.source).similar += 1;
          ledgerPush({
            urlHash: hash12(e.sourceUrl),
            titleHash: hash12(e.title),
            source: e.source,
            sourceId: e.sourceId,
            publishedAt: e.date,
            lastStage: "similar",
            similarId: similarId ?? null,
          });
        }
        decided.add(e.sourceUrl);
      };
      const select = (e: RawEntry, lane: BatchLane) => {
        fresh.push({ ...e, lane });
        existingUrls.add(e.sourceUrl); // 같은 배치 내 중복 방지
        sourceCounts.set(e.source, (sourceCounts.get(e.source) ?? 0) + 1);
        batchSourceCounts.set(e.source, (batchSourceCounts.get(e.source) ?? 0) + 1);
        srcCounts(e.source).batch += 1;
        if (lane === "drain") srcCounts(e.source).drain += 1;
        if (e.sourceId && LOW_FREQ_SOURCE_IDS.has(e.sourceId)) {
          lowFreqSelectedTotal += 1;
          lowFreqSelectedBySource.set(
            e.sourceId,
            (lowFreqSelectedBySource.get(e.sourceId) ?? 0) + 1,
          );
        }
        decided.add(e.sourceUrl);
      };
      // 공통 검사: 입장 캡 판정(admissionCapDecision) + 유사 검사.
      // 저빈도 상한이 소스캡보다 앞선다 — 두 캡이 동시에 걸리면 batchCap 종결이다.
      // 반환: "ok" | "inDb" | "cap" | "batchCap" | "similar".
      const check = (e: RawEntry): "ok" | "inDb" | "cap" | "batchCap" | "similar" => {
        const cap = admissionCapDecision({
          inDb: existingUrls.has(e.sourceUrl),
          sourceCount: sourceCounts.get(e.source) ?? 0,
          sourceCap: SOURCE_CAP,
          batchCount: batchSourceCounts.get(e.source) ?? 0,
          batchSourceCap: BATCH_SOURCE_CAP,
          isLowFreq: Boolean(e.sourceId && LOW_FREQ_SOURCE_IDS.has(e.sourceId)),
          lowFreqTotal: lowFreqSelectedTotal,
          lowFreqPerSource: e.sourceId
            ? (lowFreqSelectedBySource.get(e.sourceId) ?? 0)
            : 0,
        });
        if (cap !== "pass") return cap;
        if (findSimilar(e)) return "similar";
        return "ok";
      };
      const runStage = (
        e: RawEntry,
        lane: BatchLane,
        slotLimit: () => boolean,
        onCapPool = true,
      ): boolean => {
        // slotLimit이 false면 이 단계의 슬롯이 찬 것 — 호출부가 순회를 멈춘다.
        if (!slotLimit()) return false;
        if (decided.has(e.sourceUrl)) return true;
        const r = check(e);
        if (r === "ok") {
          select(e, lane);
        } else if (r === "cap") {
          if (onCapPool) capPool.push(e);
          // 풀행은 아직 탈락이 아니다 — 드레인 단계에서 최종 판정한다.
          // decided에는 넣지 않는다 (드레인 단계에서 다시 본다).
        } else if (r === "inDb") {
          countDrop(e, "inDb");
        } else if (r === "batchCap") {
          countDrop(e, "batchCap");
        } else {
          countDrop(e, "similar", findSimilar(e)?.id ?? null);
        }
        return true;
      };
      // 1) 일반: 최대 22슬롯. 슬롯이 차면 통과 후보는 대기열로.
      for (const e of entries) {
        if (decided.has(e.sourceUrl)) continue;
        if (fresh.length >= GENERAL_SLOTS) {
          // 슬롯 초과 — 통과 후보만 대기열에 남기고 나머지는 그대로 판정한다.
          // (검사 순서: inDb·캡·배치캡·유사는 runStage와 동일하게 처리)
          const r = check(e);
          if (r === "ok") generalWaitlist.push(e);
          else if (r === "cap") capPool.push(e);
          else if (r === "inDb") countDrop(e, "inDb");
          else if (r === "batchCap") countDrop(e, "batchCap");
          else countDrop(e, "similar", findSimilar(e)?.id ?? null);
          continue;
        }
        runStage(e, "general", () => true);
      }
      // 2) tipLane 예약: 2슬롯 (미사용분은 드레인·반환 단계로).
      let tipSlotsUsed = 0;
      for (const e of entries) {
        if (tipSlotsUsed >= TIP_RESERVE || fresh.length >= BATCH_MAX) break;
        if (!e.tipLane || decided.has(e.sourceUrl)) continue;
        if (capPool.includes(e)) continue; // 이미 풀에 있음 — 드레인 단계에서 본다.
        const before = fresh.length;
        runStage(e, "tip", () => tipSlotsUsed < TIP_RESERVE && fresh.length < BATCH_MAX);
        if (fresh.length > before) tipSlotsUsed += 1;
      }
      stats.tipSlotBatch = tipSlotsUsed;
      // 3) 저빈도 공유 슬롯: 두 소스 합쳐 최대 2건·소스당 1건.
      let lowFreqUsed = 0;
      const lowFreqPerSource = new Map<string, number>();
      for (const e of entries) {
        if (lowFreqUsed >= LOWFREQ_ROUND_MAX || fresh.length >= BATCH_MAX) break;
        if (!e.sourceId || !LOW_FREQ_SOURCE_IDS.has(e.sourceId)) continue;
        if (decided.has(e.sourceUrl) || capPool.includes(e)) continue;
        if ((lowFreqPerSource.get(e.sourceId) ?? 0) >= LOWFREQ_PER_SOURCE) continue;
        const before = fresh.length;
        runStage(e, "lowfreq", () => fresh.length < BATCH_MAX);
        if (fresh.length > before) {
          lowFreqUsed += 1;
          lowFreqPerSource.set(e.sourceId, (lowFreqPerSource.get(e.sourceId) ?? 0) + 1);
        }
      }
      stats.lowFreqBatch = lowFreqUsed;
      // 4) 드레인 파일럿: 풀에서 발행 48h 이내만, 오래된 것부터(FIFO).
      // 소스당 회차 1건·24h 추가 2건·창 점유 8건·배치 소스당 4건을 모두 지킨다.
      stats.drainCandidates = capPool.length;
      const drainEligible = capPool
        .filter((e) => Date.now() - e.date <= DRAIN_MAX_AGE_MS)
        .sort((a, b) => a.date - b.date);
      let drainUsed = 0;
      const drainPerSource = new Map<string, number>();
      const drainSelected = new Set<string>();
      for (const e of drainEligible) {
        if (drainUsed >= DRAIN_ROUND_MAX || fresh.length >= BATCH_MAX) break;
        if ((drainPerSource.get(e.source) ?? 0) >= DRAIN_PER_SOURCE_ROUND) continue;
        if ((window40Counts.get(e.source) ?? 0) >= 8) continue;
        if (drainRemainingAllowance(sourceCounts.get(e.source) ?? 0) <= 0) continue;
        if ((batchSourceCounts.get(e.source) ?? 0) >= BATCH_SOURCE_CAP) continue;
        // 저빈도 공유 상한은 드레인에서도 적용된다 — 초과분은 배치 소스캡
        // family로 즉시 종결한다 (풀 확정 시 소스캡으로 뭉개지 않게).
        if (
          e.sourceId &&
          LOW_FREQ_SOURCE_IDS.has(e.sourceId) &&
          lowFreqCapReached(
            lowFreqSelectedTotal,
            lowFreqSelectedBySource.get(e.sourceId) ?? 0,
          )
        ) {
          countDrop(e, "batchCap");
          continue;
        }
        // 드레인 단계의 유사 재검사: 일반 단계 이후 fresh가 늘었을 수 있다.
        const sim = findSimilar(e);
        if (sim) {
          countDrop(e, "similar", sim.id);
          continue;
        }
        select(e, "drain");
        drainSelected.add(e.sourceUrl);
        drainUsed += 1;
        drainPerSource.set(e.source, (drainPerSource.get(e.source) ?? 0) + 1);
      }
      stats.drainBatch = drainUsed;
      // 드레인에 뽑히지 않은 풀 후보는 최종적으로 소스캡 탈락으로 확정한다
      // (창 점유·연령·쿼터로 걸러진 것 포함 — 다음 회차에 다시 풀에 들어간다).
      // 단, 저빈도 공유 상한에 이미 도달한 소스라면 초과분은 batchCap family로
      // 종결한다 (Codex 재리뷰 P1-2: 드레인 회차 상한·창 점유 등으로 먼저
      // 건너뛴 후보도 종결 시점의 상한으로 사유를 가린다).
      for (const e of capPool) {
        if (drainSelected.has(e.sourceUrl)) continue;
        if (decided.has(e.sourceUrl)) continue; // 유사·저빈도 탈락으로 이미 처리됨
        if (
          e.sourceId &&
          LOW_FREQ_SOURCE_IDS.has(e.sourceId) &&
          lowFreqCapReached(
            lowFreqSelectedTotal,
            lowFreqSelectedBySource.get(e.sourceId) ?? 0,
          )
        ) {
          countDrop(e, "batchCap");
          continue;
        }
        skipped += 1;
        stats.dropSourceCap += 1;
        srcCounts(e.source).cap += 1;
        ledgerPush({
          urlHash: hash12(e.sourceUrl),
          titleHash: hash12(e.title),
          source: e.source,
          sourceId: e.sourceId,
          publishedAt: e.date,
          lastStage: "sourceCap",
          similarId: null,
        });
        decided.add(e.sourceUrl);
      }
      // 5) 반환: 일반 대기열을 남은 슬롯에 채운다 (검사 재수행 — 슬롯 단계 이후
      // fresh·캡 상태가 바뀌었을 수 있다).
      for (const e of generalWaitlist) {
        if (fresh.length >= BATCH_MAX) break;
        if (decided.has(e.sourceUrl)) continue; // tip·저빈도 단계에서 이미 선택됨
        const r = check(e);
        if (r === "ok") select(e, "general");
        else if (r === "cap") {
          skipped += 1;
          stats.dropSourceCap += 1;
          srcCounts(e.source).cap += 1;
          ledgerPush({
            urlHash: hash12(e.sourceUrl),
            titleHash: hash12(e.title),
            source: e.source,
            sourceId: e.sourceId,
            publishedAt: e.date,
            lastStage: "sourceCap",
            similarId: null,
          });
          // Codex 재리뷰 P1-1: decided 누락 시 뒤의 잔여 루프가 같은 후보를
          // dropBatchFull로 이중 집계한다 — 여기서 종결한다.
          decided.add(e.sourceUrl);
        } else if (r === "batchCap") countDrop(e, "batchCap");
        else countDrop(e, "similar", findSimilar(e)?.id ?? null);
      }
      // 반환 후에도 남은 대기열은 배치 상한 탈락으로 종결한다 (Codex 리뷰 P1-1).
      // 종결하지 않으면 kept 항등식에서 누락된다 — dropBatchMax(미검토 후순위)와는
      // 별개로, 검토는 됐으나 슬롯이 없어 못 들어간 후보를 dropBatchFull로 센다.
      for (const e of generalWaitlist) {
        if (decided.has(e.sourceUrl)) continue;
        skipped += 1;
        stats.dropBatchFull = (stats.dropBatchFull ?? 0) + 1;
        ledgerPush({
          urlHash: hash12(e.sourceUrl),
          titleHash: hash12(e.title),
          source: e.source,
          sourceId: e.sourceId,
          publishedAt: e.date,
          lastStage: "batchFull",
          similarId: null,
        });
        decided.add(e.sourceUrl);
      }
      stats.generalWaitlist = generalWaitlist.length;
      stats.keptNew = stats.kept - stats.dropAlreadyInDb;
      stats.dropBatchMax = 0;
      stats.batch = fresh.length;
      durations.batchMs = Date.now() - batchStartedAt;
      batchStartedAt = 0;
      // B1 포이즌 가드: LLM 실패 보류가 3회 누적된 URL은 분류 예산을 다시
      // 태우지 않고 제외로 종결한다 (원문 삽입 종착지는 프로젝트 규칙과
      // 충돌해 확정안에서 배제됐다). 원장 조회 실패 시 가드 없이 진행한다.
      let poisonedUrls = new Set<string>();
      try {
        const seen = await getDropLedgerSeen(fresh.map((e) => hash12(e.sourceUrl)));
        poisonedUrls = new Set(
          fresh
            .filter((e) => isPoisonedHold(seen.get(hash12(e.sourceUrl))))
            .map((e) => e.sourceUrl),
        );
      } catch {
        /* fail-open — 가드는 최적화이지 수집의 전제가 아니다 */
      }
      if (poisonedUrls.size > 0) {
        console.log(`[collect-poison] LLM 실패 보류 3회 누적 ${poisonedUrls.size}건 제외`);
      }
      await checkpoint("batch");

      // P0-1: summary가 빈 fresh 후보는 기사 본문 첫 ~500자를 발췌해 보강 (제목만 보고 keep=false 탈락 방지)
      ledeStartedAt = Date.now();
      await Promise.all(
        fresh.map(async (entry) => {
          if (entry.summary && entry.summary.trim().length >= 40) return;
          const lede = await fetchArticleLede(entry.sourceUrl);
          if (lede) entry.summary = lede;
        }),
      );
      durations.ledeMs = Date.now() - ledeStartedAt;
      ledeStartedAt = 0;

      statsStage = "classify";
      classifyStartedAt = Date.now();
      // B1: 웨이브를 allSettled로 — 한 체인의 예외가 회차 전체를 죽이지
      // 않게 하고, 거부된 체인은 LLM 실패 보류로 종결한다. 포이즌 URL은
      // 분류 자체를 시작하지 않는다.
      const settled = await Promise.allSettled(
        fresh.map((entry) =>
          poisonedUrls.has(entry.sourceUrl)
            ? Promise.resolve(poisonPayload(entry))
            : timedClassifyEntry(entry, retryBudget, durations),
        ),
      );
      const classified = settled.map((r, i) =>
        r.status === "fulfilled" ? r.value : llmFailureHold(fresh[i], "llm-fail"),
      );
      // Phase 1: 등급 거버너 — 편입 대상에 최근 40건 비율 12~18% 적용.
      // 비율 이탈은 govSignal로만 남긴다 (자동 강등은 상한 초과 일반 승격분 한정).
      const gov = applyGovernor(classified, existingItems, newCap);
      stats.govDemoted = gov.demoted;
      stats.govShareAfter = gov.shareAfter;
      if (gov.signal) stats.govSignal = gov.signal;
      if (gov.demoted > 0 || gov.signal) {
        console.log(
          `[desk-governor] demoted=${gov.demoted} shareAfter=${gov.shareAfter.toFixed(3)}${gov.signal ? ` signal=${gov.signal}` : ""}`,
        );
      }
      // B1: 보류를 사유별로 분리한다. deskHeld는 기존 의미(원문 대조 위반
      // number/status/entity)만 유지하고, LLM 실패·데드라인은 별도 카운터로.
      const holdKindsOf = (p: IngestPayload) => p.holdKinds ?? [];
      const violationHeld = classified.filter(
        (p) =>
          p.held &&
          holdKindsOf(p).some((k) => k === "number" || k === "status" || k === "entity"),
      ).length;
      if (violationHeld > 0) stats.deskHeld = violationHeld;
      stats.heldDeadline = classified.filter(
        (p) => p.held && holdKindsOf(p).includes("deadline"),
      ).length;
      stats.heldLlmFail = classified.filter(
        (p) => p.held && holdKindsOf(p).includes("llm-fail"),
      ).length;
      // Phase 2 후속: Pass 1 건별 기록 (등급 결정에는 쓰지 않는 섀도 포함).
      // importance는 원값, 버킷은 조회 시 파생한다. grade는 거버너 적용 후 값.
      const scored: ScoredEntry[] = classified.map((payload, i) => {
        const entry = fresh[i];
        const card = payload.card;
        const shadow = card
          ? assessShadow(card, payload.title, payload.takeaway, payload.originalTitle)
          : { tier: "none" as const, promotesA: false, promotesAB: false, shadowGrade: "note" as const };
        srcCounts(entry.source).scored += 1;
        return {
          hash: hash12(entry.sourceUrl),
          titleHash: hash12(payload.originalTitle || entry.title),
          source: entry.source,
          sourceId: entry.sourceId,
          importance: payload.score ?? card?.importance ?? null,
          tip: payload.tip,
          eventType: card?.eventType ?? null,
          impactBasis: card?.impactBasis ?? [],
          hasEvidence: Boolean(card?.evidence && card.evidence.trim()),
          strongSignal: hasStrongSignal(payload.title, payload.takeaway, payload.originalTitle),
          shadowTier: shadow.tier,
          shadowGrade: shadow.shadowGrade,
          promotesA: shadow.promotesA,
          promotesAB: shadow.promotesAB,
          grade: payload.grade,
          lane: entry.lane,
          held: payload.held ?? false,
          holdKinds: payload.holdKinds ?? [],
        };
      });
      // S2 계측: classifyMs는 분류 웨이브 + 거버너 + 건별 기록 구간까지다.
      durations.classifyMs = Date.now() - classifyStartedAt;
      classifyStartedAt = 0;
      await checkpoint("classify");
      stats.ruleVersion = COLLECT_RULE_VERSION;
      stats.model = resolveLlm()?.model ?? null;
      statsStage = "insert";
      insertStartedAt = Date.now();
      // B1: 0도 명시적으로 남긴다 (부재와 0을 구분해 폴백 소멸을 검증 가능하게).
      stats.fallbackInserted = 0;
      stats.poisonExcluded = 0;
      for (let i = 0; i < classified.length; i++) {
        const payload = classified[i];
        const entry = fresh[i];
        const dropRow = (stage: DropLedgerRow["lastStage"]): DropLedgerRow => ({
          urlHash: hash12(payload.sourceUrl),
          titleHash: hash12(payload.originalTitle || entry.title),
          source: payload.source,
          sourceId: entry.sourceId,
          publishedAt: payload.publishedAt ?? entry.date,
          lastStage: stage,
          similarId: null,
        });
        if (payload.poisoned) {
          skipped += 1;
          stats.poisonExcluded = (stats.poisonExcluded ?? 0) + 1;
          ledgerPush(dropRow("poison"));
          continue;
        }
        if (payload.keep === false) {
          skipped += 1;
          stats.dropKeepFalse += 1;
          // B1: 보류 사유별로 원장 스테이지를 가른다 — LLM 실패는 llmFail
          // (포이즌 누적), 데드라인은 deadline (분류 미완료라 카운터 유지),
          // 그 외(위반 보류·LLM 탈락 판정)는 기존 keepFalse로 종결한다.
          const kinds = payload.holdKinds ?? [];
          const stage =
            payload.held && kinds.includes("llm-fail")
              ? "llmFail"
              : payload.held && kinds.includes("deadline")
                ? "deadline"
                : "keepFalse";
          ledgerPush(dropRow(stage));
          continue;
        }
        // P0-2: 분류 뒤 컷오프 — keep=true 중 상위 newCap건만 편입 (entries는 byDeskPriority 정렬 순서 유지)
        if (inserted >= newCap) {
          skipped += 1;
          stats.dropNewCap += 1;
          ledgerPush(dropRow("newCap"));
          continue;
        }
        const ok = await insertItem(payload);
        if (ok) {
          inserted += 1;
          // B1: 원문 폴백 삽입 계수 (LLM 설정 환경에서는 0 유지가 성공 지표).
          if (payload.rawFallback) {
            stats.fallbackInserted = (stats.fallbackInserted ?? 0) + 1;
          }
          srcCounts(payload.source).inserted += 1;
          if (entry.lane === "drain") stats.drainInserted = (stats.drainInserted ?? 0) + 1;
          if (entry.lane === "tip") stats.tipSlotInserted = (stats.tipSlotInserted ?? 0) + 1;
          if (entry.lane === "lowfreq") stats.lowFreqInserted = (stats.lowFreqInserted ?? 0) + 1;
        } else {
          skipped += 1;
          stats.dropInsertFail += 1;
          ledgerPush(dropRow("insertFail"));
        }
      }

      durations.insertMs = Date.now() - insertStartedAt;
      insertStartedAt = 0;
      await checkpoint("insert");
      // B1 M3-lite: 재작성을 삽입 뒤로 이동. 같은 데드라인·게이트가 적용돼
      // 잔여 예산 안에서만 돌고, 미완료분은 DB 상태(needsRewrite)에서 다음
      // 회차에 그대로 재도출된다 (멱등). 재작성 체인도 체크포인트 이후라
      // 여기서 죽어도 삽입분과 체크포인트는 남는다.
      statsStage = "rewrite";
      rewriteStartedAt = Date.now();
      const rewriteHolds: RewriteHoldSink = { deadline: 0, llmFail: 0 };
      try {
        rewritten = await rewriteStale(existing, retryBudget, durations, rewriteHolds);
      } finally {
        durations.rewriteMs = Date.now() - rewriteStartedAt;
        rewriteStartedAt = 0;
      }
      // B1 (Codex 리뷰): 재작성 보류도 partial 판정·노트에 합산한다.
      if (rewriteHolds.deadline > 0) {
        stats.heldDeadline = (stats.heldDeadline ?? 0) + rewriteHolds.deadline;
      }
      if (rewriteHolds.llmFail > 0) {
        stats.heldLlmFail = (stats.heldLlmFail ?? 0) + rewriteHolds.llmFail;
      }
      await checkpoint("rewrite");
      // B1: 원장 기록은 포이즌 가드의 입력이라 종료 기한 전에 먼저 남긴다
      // (best-effort — 실패해도 수집 결과는 유지한다). 대기는 종료 예비를
      // 남긴 잔여로 제한한다 — 넘기면 기다리지 않고 종료 기록을 우선한다
      // (쓰기 자체는 백그라운드에서 이어질 수 있다. Codex 3차 리뷰).
      const ledgerWrite = recordDropLedger(ledgerRows).catch((err) => {
        console.log(`[collect-ledger] 원장 기록 실패 (무시): ${err instanceof Error ? err.message : "unknown"}`);
      });
      await awaitWithinFinishBudget(ledgerWrite);
      statsStage = "finalize";
      finalizeStartedAt = Date.now();
      // B1 (Codex 재리뷰): 종료 기한(55초) 강제 — 잔여가 종료 예비 이하이면
      // 하우스키핑(브리핑 갱신·보존 정리)을 생략하고 finishRun(최종 상태
      // 기록)을 우선해, 플랫폼 강제 종료 전에 회차가 기록을 남기게 한다.
      // 판정은 각 단계 직전에 잔여를 새로 계산한다.
      if (finishRemainingMs() <= FINISH_RESERVE_MS) {
        console.log("[collect-deadline] 종료 기한 임박 — 브리핑·보존 정리를 생략하고 종료 기록을 우선");
      } else if (inserted > 0 || rewritten > 0 || deduped > 0) {
        // 대기 자체도 잔여로 제한한다 (시작 전 검사만으로는 부족 — Codex 4차).
        await awaitWithinFinishBudget(refreshBriefing());
      }

      let note =
        inserted > 0 || rewritten > 0 || deduped > 0
          ? `RSS ${fetched}건 중 ${inserted}건 편성${rewritten ? ` · ${rewritten}건 재작성` : ""}${deduped ? ` · ${deduped}건 중복 정리` : ""}${resolveLlm() ? "" : " · LLM 키 없음(원문 폴백)"}`
          : fetched === 0
            ? "RSS를 가져오지 못했습니다. 네트워크 또는 피드 주소를 확인하세요."
            : "새 소식이 없거나 모두 중복입니다.";
      if ((stats.heldDeadline ?? 0) > 0) {
        note += ` · 시간 예산으로 ${stats.heldDeadline}건 보류(다음 회차 재분류)`;
      }
      if ((stats.heldLlmFail ?? 0) > 0) {
        note += ` · LLM 실패 ${stats.heldLlmFail}건 보류(다음 회차 재분류)`;
      }

      // Phase 0 계측: 단계별 카운터를 구조화 로그로 남긴다 (Vercel 함수 로그).
      console.log(`[collect-stats] ${JSON.stringify(stats)}`);
      const detail: CollectDetail = {
        bySource: Object.fromEntries(bySource),
        scored,
      };
      try {
        // B1: 보존 정리는 건마다 잔여를 새로 검사하고 대기를 제한한다
        // (첫 번째 정리가 예비를 침범해도 두 번째가 따라 실행되지 않게).
        if (finishRemainingMs() > FINISH_RESERVE_MS) {
          await awaitWithinFinishBudget(pruneDropLedger(Date.now() - 14 * 24 * 3600 * 1000));
        }
        if (finishRemainingMs() > FINISH_RESERVE_MS) {
          await awaitWithinFinishBudget(pruneOldRuns(Date.now() - 90 * 24 * 3600 * 1000));
        }
      } catch {
        /* 보존 정리 실패는 무시 */
      }
      // S2 계측: finishRun이 stats를 직렬화하므로 그 직전에 마감 값을 채운다.
      durations.finalizeMs = Date.now() - finalizeStartedAt;
      finalizeStartedAt = 0;
      durations.totalMs = Date.now() - runStartedAt;
      durations.llmCalls = llmMetrics.calls;
      durations.llmMaxCallMs = llmMetrics.maxMs;
      // B1: 호출 결과 집계 + 부분 성공 판정. partial도 ok:true·완료 취급이라
      // lastRunAt·쿨다운은 정상 회차와 같고, 집계만 분리된다 (확정안).
      durations.llmCallLog = deadline.calls.slice();
      stats.callsAborted = deadline.calls.filter(
        (c) => c.outcome === "aborted" || c.outcome === "deadline",
      ).length;
      stats.callsTimedOut = deadline.calls.filter((c) => c.outcome === "timeout").length;
      const runStatus = decideRunStatus(stats);
      if (runStatus === "partial") {
        stats.partial = true;
        stats.abortReason = "llm-deadline";
      }
      await finishRun(runId, {
        status: runStatus,
        fetched,
        inserted,
        skipped,
        note,
        detail: {
          stats,
          bySource: detail.bySource,
          scored: detail.scored,
          ruleVersion: COLLECT_RULE_VERSION,
          model: stats.model ?? null,
        },
      });
      return {
        ok: true,
        status: runStatus,
        fetched,
        inserted,
        skipped,
        note,
        lastRunAt: Date.now(),
        stats,
        detail,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "collect failed";
      // 부분 집계 스냅샷: Promise.all의 다른 작업이 stats를 계속 바꿀 수 있어
      // 로그와 응답이 같은 복사본을 보도록 고정한다 (Codex 리뷰 반영).
      // S2 계측: 실패 지점까지의 소요·LLM 호출도 마감해 스냅샷에 남긴다.
      durations.totalMs = Date.now() - runStartedAt;
      durations.llmCalls = llmMetrics.calls;
      durations.llmMaxCallMs = llmMetrics.maxMs;
      // B1: 오류 스냅샷에도 호출 기록을 동봉한다.
      durations.llmCallLog = deadline.calls.slice();
      // S2 계측 (Codex 리뷰): 진행 중이던 단계는 시작 시각부터의 경과로 채우고,
      // durations는 복사본으로 고정한다 — Promise.all의 다른 갈래가 계속
      // 실행돼 원본을 바꿔도 로그·응답의 스냅샷은 변하지 않는다.
      if (blockAStartedAt > 0 && durations.blockAMs === 0)
        durations.blockAMs = Date.now() - blockAStartedAt;
      if (rewriteStartedAt > 0 && durations.rewriteMs === 0)
        durations.rewriteMs = Date.now() - rewriteStartedAt;
      if (pullStartedAt > 0 && durations.pullMs === 0)
        durations.pullMs = Date.now() - pullStartedAt;
      if (dedupeStartedAt > 0 && durations.dedupeMs === 0)
        durations.dedupeMs = Date.now() - dedupeStartedAt;
      if (batchStartedAt > 0 && durations.batchMs === 0)
        durations.batchMs = Date.now() - batchStartedAt;
      if (ledeStartedAt > 0 && durations.ledeMs === 0)
        durations.ledeMs = Date.now() - ledeStartedAt;
      if (classifyStartedAt > 0 && durations.classifyMs === 0)
        durations.classifyMs = Date.now() - classifyStartedAt;
      if (insertStartedAt > 0 && durations.insertMs === 0)
        durations.insertMs = Date.now() - insertStartedAt;
      if (finalizeStartedAt > 0 && durations.finalizeMs === 0)
        durations.finalizeMs = Date.now() - finalizeStartedAt;
      const statsSnapshot: CollectStats = {
        ...stats,
        durations: { ...durations },
        partial: true,
        failedStage: statsStage,
      };
      console.log(`[collect-stats] ${JSON.stringify(statsSnapshot)}`);
      await finishRun(runId, {
        status: "error",
        fetched,
        inserted,
        skipped,
        note: message,
        detail: { stats: statsSnapshot, ruleVersion: COLLECT_RULE_VERSION, model: stats.model ?? null },
      });
      return {
        ok: false,
        status: "error",
        fetched,
        inserted,
        skipped,
        note: message,
        lastRunAt: Date.now(),
        stats: statsSnapshot,
      };
    }
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    setLlmDeadline(null);
    setLlmMetricsSink(null);
    await releaseCollectLock(owner);
  }
}

type RawEntry = {
  title: string;
  sourceUrl: string;
  source: string;
  date: number;
  summary: string;
  titleMustMatch?: boolean;
  secTitleHint?: boolean;
  /** Phase 2 후속: 소스 id (저빈도 슬롯·원장 귀속용). 구 캐시 페이로드에는 없을 수 있다. */
  sourceId?: string;
  /** Phase 2 후속: 팁 레인 소속 (sources.ts tipLane). */
  tipLane?: boolean;
};

/** Phase 2 후속: 배치 진입 레인. */
type BatchLane = "general" | "tip" | "lowfreq" | "drain";
type LaneEntry = RawEntry & { lane: BatchLane };

/** P0-1: RSS에 description이 없는 기사는 본문 첫 ~500자를 발췌 (제목만 보고 탈락 방지). 실패 시 "" 반환. */
async function fetchArticleLede(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "brief-news-collector/1.0 (+https://brief.news)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

// 34차: 보안 와이어 전용 제목 힌트 — AI/LLM 신호가 제목에 없으면 제외.
// Codex 반례 반영: 부분 문자열 "ai"(Daily·Airdrop·chain)와 일반 "API"/"agent"
// 단독 통과를 막기 위해 토큰 경계·제품명 목록으로 판정한다. "LiteLLM"·"Ollama"
// 같은 제품명은 명시 포함.
export const SEC_TITLE_HINT =
  /\b(ai|llm|gpt|mcp)\b|agentic|ai agent|machine learning|claude|gemini|openai|anthropic|chatgpt|litellm|ollama|langchain|hugging|deepseek|copilot|에이전트|인공지능|챗봇|딥러닝|머신러닝|생성형/i;

/** Phase 0 계측: keepEntry 탈락 사유. null이면 keep 통과. 판정 로직은 기존 keepEntry와 동일. */
export type KeepDropReason = "skipHint" | "vendorStory" | "secHint" | "noAiSignal";

export function keepDropReason(e: RawEntry): KeepDropReason | null {
  if (SKIP_HINT.test(e.title) || SKIP_HINT.test(e.summary)) return "skipHint";
  if (isVendorCustomerStory(e)) return "vendorStory";
  if (e.secTitleHint && !SEC_TITLE_HINT.test(e.title)) return "secHint";
  const target = e.titleMustMatch ? e.title : `${e.title} ${e.summary}`;
  return AI_HINT.test(target) ? null : "noAiSignal";
}

function keepEntry(e: RawEntry): boolean {
  return keepDropReason(e) === null;
}

/** Nitter status URLs -> canonical x.com URLs (Nitter instances are flaky). */
function rewriteNitterUrl(url: string): string {
  const m = url.match(/^https?:\/\/[^/]+\/([^/?#]+)\/status\/(\d+)/);
  if (m) return `https://x.com/${m[1]}/status/${m[2]}`;
  return url;
}

/** Phase 2: 소스 1개의 피드를 조건부 GET으로 가져와 파싱한다 (pullRss의 단위). */
export async function fetchSourceEntries(src: NewsSource): Promise<RawEntry[]> {
  try {
    // 조건부 GET — 피드가 바뀌지 않았으면(304) 본문을 받지 않는다.
    // 대형·저빈도 피드(METR 4.1MB 전문)의 매 수집 전량 수신 낭비 방지
    // (Phase 2 패널 조건). 캐시 조회·저장 실패는 수집을 막지 않는다.
    let cache: { etag?: string; lastModified?: string; updatedAt?: number; payload?: string } = {};
    try {
      cache = await getFeedCache(src.id);
    } catch {
      cache = {};
    }
    const headers: Record<string, string> = {
      "User-Agent": "brief-news-collector/1.0 (+https://brief.news)",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html",
    };
    // TTL: 캐시가 6시간 이상 오래되면 조건부 헤더를 보내지 않고 전량 받는다.
    // 서버가 ETag를 잘못 운용(내용이 바뀌어도 같은 값)하는 경우에도 최대
    // 6시간마다 실본문으로 캐시를 되돌리는 안전장치다.
    const FEED_CACHE_TTL_MS = 6 * 3600 * 1000;
    const cacheFresh = cache.updatedAt != null && Date.now() - cache.updatedAt < FEED_CACHE_TTL_MS;
    if (cacheFresh && cache.etag) headers["If-None-Match"] = cache.etag;
    if (cacheFresh && cache.lastModified) headers["If-Modified-Since"] = cache.lastModified;
    const res = await fetch(src.rss, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 304) {
      // 변경 없음 — 마지막 200의 파싱 결과를 그대로 재반환한다. 빈 배열을
      // 돌리면 캡·우선순위에 밀렸던 후보가 재평가 기회 없이 사라진다
      // (Codex 리뷰 P1). 저장본이 없거나 깨졌으면 빈 배열.
      if (cache.payload) {
        try {
          const stored = JSON.parse(cache.payload) as RawEntry[];
          if (Array.isArray(stored)) return stored;
        } catch {
          /* 저장본 파싱 실패 — 빈 배열로 폴백 */
        }
      }
      return [] as RawEntry[];
    }
    if (!res.ok) return [] as RawEntry[];
    const buf = new Uint8Array(await res.arrayBuffer());
    const xml = decodeFeedBytes(buf, res.headers.get("content-type") ?? "");
    const parsed = parseFeedXml(xml, src.name).map((e) => ({
      title: e.title,
      sourceUrl: src.id.startsWith("x-") ? rewriteNitterUrl(e.link) : e.link,
      source: src.name,
      date: e.date,
      summary: e.summary,
      titleMustMatch: Boolean(src.titleMustMatch),
      secTitleHint: Boolean(src.secTitleHint),
      sourceId: src.id,
      tipLane: Boolean(src.tipLane),
    }));
    // 검증자·파싱 결과 저장은 본문을 끝까지 읽고 파싱까지 성공한 뒤에만 한다.
    // 먼저 저장하면 본문 전송 실패 시 캐시만 갱신돼 다음 304에서
    // 피드를 영구히 놓친다 (Codex 리뷰 P1).
    try {
      await setFeedCache(src.id, {
        etag: res.headers.get("etag") ?? undefined,
        lastModified: res.headers.get("last-modified") ?? undefined,
        payload: JSON.stringify(parsed),
      });
    } catch {
      /* 캐시 저장 실패는 무시 — 다음 수집에서 다시 받는다 */
    }
    return parsed;
  } catch {
    return [] as RawEntry[];
  }
}

async function pullRss(
  stats?: CollectStats,
  bySource?: Map<string, SourceStageCounts>,
): Promise<RawEntry[]> {
  const results = await Promise.all(NEWS_SOURCES.map((src) => fetchSourceEntries(src)));
  // Phase 2 후속: 구 feed_cache 페이로드(배포 전 저장본)에는 sourceId·tipLane이
  // 없을 수 있다 — 소스별로 다시 채워 넣는다 (304 재반환 경로 포함).
  const enriched = results.map((list, i) =>
    list.map((e) => ({
      ...e,
      sourceId: NEWS_SOURCES[i].id,
      tipLane: NEWS_SOURCES[i].tipLane ?? e.tipLane,
    })),
  );
  const raw = enriched.flat();
  if (stats) stats.rawFetched += raw.length;
  if (bySource) {
    enriched.forEach((list, i) => {
      const c = bySource.get(NEWS_SOURCES[i].name) ?? newSourceStageCounts();
      c.fetched += list.length;
      bySource.set(NEWS_SOURCES[i].name, c);
    });
  }
  const keptEntries = raw.filter((e) => {
    const reason = keepDropReason(e);
    if (!reason) {
      if (bySource) {
        const c = bySource.get(e.source) ?? newSourceStageCounts();
        c.kept += 1;
        bySource.set(e.source, c);
      }
      return true;
    }
    if (stats) {
      if (reason === "skipHint") stats.dropSkipHint += 1;
      else if (reason === "vendorStory") stats.dropVendorStory += 1;
      else if (reason === "secHint") stats.dropSecHint += 1;
      else stats.dropNoAiSignal += 1;
    }
    return false;
  });
  const sorted = keptEntries.sort(byDeskPriority);
  const deduped = sorted.filter(
    (e, i, arr) => arr.findIndex((x) => x.sourceUrl === e.sourceUrl) === i,
  );
  if (stats) {
    stats.dropUrlDup += sorted.length - deduped.length;
    stats.kept += deduped.length;
  }
  return deduped;
}

function hasHangul(s: string): boolean {
  return /[\uAC00-\uD7A3]/.test(s);
}

export function byDeskPriority(a: RawEntry, b: RawEntry): number {
  // Phase 2 후속: 저빈도 소스(METR·Alignment Forum)는 신선도 창 6→48시간.
  // 빈도가 낮아 6시간 창을 벗어나면 기회 자체가 사라지기 때문이다.
  const recency = (e: RawEntry) => {
    const windowMs =
      (e.sourceId && LOW_FREQ_SOURCE_IDS.has(e.sourceId) ? 48 : 6) * 60 * 60 * 1000;
    return Date.now() - e.date < windowMs ? 1 : 0;
  };
  const ra = recency(a);
  const rb = recency(b);
  if (ra !== rb) return rb - ra;
  const pa = SOURCE_RANK[a.source] ?? 1;
  const pb = SOURCE_RANK[b.source] ?? 1;
  if (pa !== pb) return pb - pa;
  const ha = hasHangul(a.title) ? 1 : 0;
  const hb = hasHangul(b.title) ? 1 : 0;
  if (ha !== hb) return hb - ha;
  return b.date - a.date;
}

function foldTitle(s: string): string {
  return normalizeProductNames(s)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^0-9a-z\uAC00-\uD7A3]+/gi, "")
    .slice(0, 96);
}

// 영문/한글 표기 변형 통일 (예: Gemini ↔ 제미나이, ChatGPT ↔ 챗GPT)
// 표기만 다른 중복 기사를 잡기 위한 정규화
function normalizeProductNames(s: string): string {
  const map: [RegExp, string][] = [
    [/제미나이/gi, "gemini"],
    [/챗gpt/gi, "chatgpt"],
    [/챗지피티/gi, "chatgpt"],
    [/클로드/gi, "claude"],
    [/오픈ai/gi, "openai"],
    [/앤스로픽/gi, "anthropic"],
    [/앤트로픽/gi, "anthropic"],
    [/딥시크/gi, "deepseek"],
    [/딥마인드/gi, "deepmind"],
    [/휴깅페이스/gi, "huggingface"],
    [/허깅페이스/gi, "huggingface"],
    [/스페이스x/gi, "spacex"],
    // 32차: 음역-원어 쌍 (31차 ForTy 중복 쌍: '포티' vs 'ForTy')
    [/포티/gi, "forty"],
    [/아르곤/gi, "argon"],
    // 36차: 35차 킴이/키미 K3.1 중복 쌍. 36차 재심 (Codex): 인명 오정규화 방지 —
    // 킴이는 K3.1/모델/버전이 뒤따를 때만 ("스티브 킴이" 보호), 키미는 표준 표기라 전역.
    // 스모그는 "-네모트론"이 뒤따를 때만 (Smaug 제품 문맥 — "스모그 예측 AI" 보호).
    [/킴이(?=\s*['"‘’“”]?\s*[Kk]\d)/gi, "kimi"],  // 36차 재심 v3: K+숫자만. 36차 실측: 따옴표 허용
    [/키미/gi, "kimi"],
    [/스모그(?=-?네모트론)/gi, "smaug"],
    [/스마우그/gi, "smaug"],
    // 36차: 네모트론 ↔ Nemotron — "스모그-네모트론" vs "Smaug-Nemotron" 쌍.
    [/네모트론/gi, "nemotron"],
    // 36차 실측: "에이16지, 크립토 펀드 '프론티어'" vs "a16z, 크립토 조직 '프론티어'" 중복 쌍
    [/에이16지/gi, "a16z"],
    [/엔비디아/gi, "nvidia"],
    [/구글/gi, "google"],
    [/마이크로소프트/gi, "microsoft"],
    [/메타/gi, "meta"],
    [/애플/gi, "apple"],
    [/아마존/gi, "amazon"],
    [/테슬라/gi, "tesla"],
    [/디즈니/gi, "disney"],
    [/캐릭터닷ai/gi, "characterai"],
    [/캐릭터ai/gi, "characterai"],
  ];
  let out = s;
  for (const [re, rep] of map) out = out.replace(re, rep);
  return out;
}

// 표시 정규화: 고유명사 오타·표기 변형을 표준 표기로 (화면 표시용)
// normalizeProductNames()는 중복 비교용(전부 영문 통일)이고,
// 이건 표시 텍스트에 직접 적용 — 오타가 피드에 그대로 노출되는 것을 방지.
// 17차 P0: X @Reuters 신규 기사의 "앤스로픽" 오타 재유입 대응.
const DISPLAY_NAME_MAP: [RegExp, string][] = [
  [/앤스로픽/gi, "앤트로픽"],
  // 32차: 표기 통일 (31차 Grok: 같은 회사가 휴깅/허깅으로 갈림) + 오타 즉시 교정
  [/휴깅페이스/gi, "허깅페이스"],
  [/시크릟/g, "시크릿"],
  // 36차: 35차 패널 발견분 (X 경로 중복 비교 전 정규화용 — fixTypos와 동일 교정).
  // 36차 재심: 제품 문맥 한정 (desk.ts TYPO_FIX와 동일 가드).
  [/킴이(?=\s*['"‘’“”]?\s*[Kk]\d)/g, "키미"],
  [/구글 지미니/g, "구글 제미나이"],
  [/지미니(?=\s*(,|지도|검색|캘린더|앱|구글|기능|$))/g, "제미나이"],
];

function normalizeDisplayNames(s: string): string {
  let out = s;
  for (const [re, rep] of DISPLAY_NAME_MAP) out = out.replace(re, rep);
  return out;
}

// 26차 P0-2: X 파이프라인 품질 린터 — bare "확인."/"점검." 어미를 완결형으로 교정.
// X 수집은 desk.ts의 needsRewrite를 우회하므로 여기서 직접 처리.
function fixBareEnding(s: string): string {
  // "… 확인." → "… 확인 필요." (단, 이미 "확인 필요." 등이면 그대로)
  return s.replace(
    /(?<!필요|권장|검토|주시|기회)\s*(확인|점검)\.\s*$/,
    (m, verb) => ` ${verb} 필요.`
  ).trim();
}

export function tooSimilar(a: string, b: string, da?: number, db?: number): boolean {
  const fa = foldTitle(a);
  const fb = foldTitle(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  if (fa.length >= 12 && fb.length >= 12 && (fa.includes(fb) || fb.includes(fa))) return true;
  // 주제 앵커 규칙 (P1): 핵심 고유명사 2개 이상 공유 → 같은 사건
  if (sharesTopicAnchor(a, b, da, db)) return true;
  // 같은 사건을 다르게 쓴 제목: 핵심 토큰 겹침으로 잡는다.
  // 토큰 단계에도 정규화 적용 (P1): "앤스로픽/앤트로픽" 같은 표기 변형 흡수
  // 36차 재심: "ai"는 토큰에서 제외 — "엔비디아, 스모그 예측 AI" vs
  // "엔비디아, Smaug 추론 AI"가 {nvidia, ai, 공개} 3개로 오탐되던 문제 (Codex).
  // 앵커 경로의 ANCHOR_STOPWORDS와 같은 취지.
  const tokens = (s: string) =>
    new Set(
      normalizeProductNames(s)
        .toLowerCase()
        .replace(/[^0-9a-z\uAC00-\uD7A3]+/gi, " ")
        .split(" ")
        .filter((t) => t.length >= 2 && t !== "ai"),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size >= 3 && tb.size >= 3) {
    let inter = 0;
    // 36차 재심 v3: 독립 버전 토큰(v2·k3·4o)은 겹침 수에서 제외
    // ("구글, 'Gemma' v2 공개" vs "구글, 'Imagen' v2 공개"가 {구글, v2, 공개}로 오탐).
    // 제품 결합형(kimik3·gemmav2)은 제외 대상이 아님 — 앵커 경로와 동일 기준.
    for (const t of ta) if (tb.has(t) && !/^(?!a16z$)[a-z]?\d[\w.]*$/i.test(t)) inter += 1;
    if (inter >= 3 && inter / Math.min(ta.size, tb.size) >= 0.6) return true;
    // 32차 메모: 비율 완화(0.5)는 시도했으나 "삼성전자·SK하이닉스 HBM 가격 인상" vs
    // "…생산시설 투자 확대"(공유 4·0.57) 같은 다른 사건 쌍을 오인해 철회.
    // ForTy 쌍은 normalizeProductNames 확장(딥마인드→deepmind, 포티→forty)으로
    // 공유 5개·0.71이 되어 기존 0.6 기준으로 잡힌다.
  }
  return false;
}

// 앵커 불용어: 일반 명사·보도 상투어는 고유명사가 아니므로 앵커에서 제외.
// 오탐 사례: "삼성전자, 차세대 AI 반도체 HBM4 양산 돌입" vs
// "SK하이닉스, AI 서버용 HBM4 출하 확대" → "ai"+"hbm" 2개로 오탐.
const ANCHOR_STOPWORDS = new Set([
  // 영문 도메인 일반어
  "ai", "hbm", "llm", "gpu", "npu", "api", "sdk", "it", "os", "pc",
  "vr", "ar", "xr", "cloud", "data", "edge", "agent", "chat", "bot",
  // 한글 도메인 일반어
  "모델", "기술", "개발", "반도체", "서버", "데이터", "학습", "추론",
  "플랫폼", "서비스", "솔루션", "시스템", "시장", "산업", "국내", "글로벌",
  "차세대", "신규", "최신", "대형", "소형",
  // 보도 상투어 (행위·상태)
  "출시", "발표", "공개", "진출", "확대", "돌입", "양산", "출하", "도입",
  "적용", "지원", "선정", "추진", "강화", "협력", "인수", "투자", "출범",
  "개최", "개시",
]);

// 주제 앵커 규칙 (P1): 정규화된 고유명사 토큰(영문 2자+, 한글 2자+) 중
// 양쪽 모두에 등장하는 앵커가 2개 이상이면 같은 사건으로 간주.
// ("카카오 FDE" vs "카카오 카나나"는 공유 앵커 1개라 안전)
// 불용어 제외 + 공통 앵커 중 최소 1개는 영문 고유명사여야 오탐 방지.
// pubDate 차이가 72시간을 넘으면 후속 보도로 보고 비교 제외.
function sharesTopicAnchor(a: string, b: string, da?: number, db?: number): boolean {
  if (da != null && db != null && Math.abs(da - db) > 72 * 3600 * 1000) return false;
  const anchors = (s: string): Set<string> => {
    // 36차: 버전 토큰도 앵커로 — "킴이 K3.1" vs "키미 K3.1" 쌍은 공통 앵커가
    // kimi 1개뿐이라 잡히지 않았음. [a-z\d]{2,}에 문자 필수 조건으로 숫자만("23") 제외.
    // 36차 재심 (Codex): 버전은 제품과 묶어서 비교 — "Gemma v2" vs "Imagen v2"가
    // google+v2 공유로 오탐되던 문제. "Gemma v2" → "gemmav2 gemma" 형태로 복합 앵커 생성.
    // 36차 재심 v3: 인용부호 허용 ("구글, 'Gemma' v2 공개" 반례).
    const compounded = normalizeProductNames(s)
      .toLowerCase()
      .replace(/([a-z]{3,})['"’”]?\s+['"’”]?([a-z]?\d[\w.]*)/g, "$1$2 $1");  // 36차 재심 v4: k3 포함
    const raw = compounded.match(/[a-z\d]{2,}|[\uAC00-\uD7A3]{2,}/g) ?? [];
    // 한글 조사 탈락 (카카오가 → 카카오) + 불용어 제외
    return new Set(
      raw
        .filter((t) => /[a-z\uAC00-\uD7A3]/.test(t)) // 문자 없는 순수 숫자는 앵커 제외
        .map((t) => t.replace(/(에서|으로|에게|부터|까지|처럼|보다|은|는|이|가|을|를|의|에|와|과|도|만|로)$/, ""))
        .filter((t) => t.length >= 2 && !ANCHOR_STOPWORDS.has(t)),
    );
  };
  const A = anchors(a);
  const B = anchors(b);
  // 36차 재심 v3: 독립 버전 토큰(v2·k3·3.5)은 공통 앵커 수에서 제외.
  // "구글, 'Gemma' v2" vs "구글, 'Imagen' v2"는 공통이 {google} 1개가 되어 오탐 방지.
  // 제품 결합형(kimik3·gemmav2)은 제외 대상이 아님.
  const VERSION_TOKEN = /^(?!a16z$)[a-z]?\d[\w.]*$/i;  // 36차 실측 후속: a16z만 예외 (k3.1·r10·o3mini 회귀 방지)
  const common = [...A].filter((t) => B.has(t) && !VERSION_TOKEN.test(t));
  if (common.length < 2) return false;
  // 일반 명사 2개가 앵커를 채우는 오탐 방지: 최소 1개는 영문 고유명사(회사·제품명)
  // 32차: 영문 앵커는 3자 이상만 인정 — "SK하이닉스"에서 잘린 "sk" 같은
  // 혼합 표기 파편이 앵커로 세는 오탐 차단 (크로스 리뷰 반례).
  // 36차: 버전 토큰(k3·v2)은 2자부터 앵커로 인정 — 단, 3자 이상 영문 앵커 1개는
  // 여전히 필수이므로 "sk"+"hbm4" 같은 파편 조합으로는 오탐되지 않음.
  // ForTy 쌍은 normalizeProductNames(딥마인드→deepmind, 포티→forty) 덕에
  // tooSimilar 토큰 경로(공유 5개·0.71)로 잡히므로 앵커 규칙은 보수적으로 유지.
  return common.some((t) => /^(a16z|[a-z]{3,})$/.test(t));  // 36차 실측 후속: a16z만 예외 (32차 sk·hbm4 가드 유지)
}

/** B1: 재작성 경로의 LLM 실패·데드라인 보류 건수 싱크 (partial 집계용). */
export type RewriteHoldSink = { deadline: number; llmFail: number };

export async function rewriteStale(
  existing: Awaited<ReturnType<typeof listNews>>,
  budget?: RetryBudget,
  durations?: CollectDurations,
  holdSink?: RewriteHoldSink,
): Promise<number> {
  if (!resolveLlm()) return 0;
  // 24차 P0: 오타/파편을 일반 stale보다 먼저 처리 — "앤스로픽"이 3라운드 정체된 원인.
  // needsRewrite는 통과하는데 큐 앞에서 밀려서 처리 안 됨.
  // 28차: 노려는 추가 (TYPO_HINT와 일치)
  // 36차: 35차 패널 발견분 추가. 36차 재심: desk.ts TYPO_HINT와 동일 가드 (인명·일반명사 보호).
  const typoHint = /앤스로픽|펌웨다|현실회(?![복피])|&(quot|amp|apos|lt|gt|#\d+);|챗\(클로드\)|노려는|시크릟|제약가(?=\s|$)|스노우플레이스|(?<=\s)대익(?=\s)|구글 지미니|지미니(?=\s*(,|지도|검색|캘린더|앱|구글|기능|$))|(?<![가-힣])토효율(?![가-힣])|킴이(?=\s*['"‘’“”]?\s*[Kk]\d)|칸바(?=[\s,·ㆍ:])|스모그-네모트론/i;
  const stale = existing
    .filter((i) => !isSeedItem(i) && needsRewrite(i))
    .sort((a, b) => {
      const aUrgent = typoHint.test(a.title) || typoHint.test(a.takeaway) ? 0 : 1;
      const bUrgent = typoHint.test(b.title) || typoHint.test(b.takeaway) ? 0 : 1;
      return aUrgent - bUrgent;
    })
    .slice(0, COLLECT_REWRITE_MAX);
  // 순차 처리 시 최대 3×25초=75초 → 병렬로 변경 (Vercel 60초 제한 대응)
  const results = await Promise.all(
    stale.map(async (item): Promise<number> => {
      if (shouldDrop(item.title, item.summary) || shouldDrop(item.originalTitle, item.summary)) {
        return (await deleteItem(item.id)) ? 1 : 0;
      }
      const payload = await timedClassifyEntry({
        title: item.originalTitle || item.title,
        sourceUrl: item.sourceUrl,
        source: item.source,
        date: item.publishedAt,
        summary: item.summary,
      }, budget, durations);
      // B1: LLM 실패·데드라인 보류는 삭제도 갱신도 하지 않는다 — 기존 글을
      // 그대로 두고 다음 회차 재도출에 맡긴다 (LLM 스톨이 기존 글 삭제로
      // 번지는 것 방지). 보류 건수는 싱크로 회차 통계(partial 판정)에 합산한다.
      // 원문 대조 위반 보류는 B1 이전과 동일하게 아래 삭제 경로를 탄다.
      if (payload.held) {
        const kinds = payload.holdKinds ?? [];
        if (kinds.includes("deadline") || kinds.includes("llm-fail")) {
          if (holdSink) {
            if (kinds.includes("deadline")) holdSink.deadline += 1;
            else holdSink.llmFail += 1;
          }
          return 0;
        }
      }
      if (payload.keep === false) {
        return (await deleteItem(item.id)) ? 1 : 0;
      }
      payload.publishedAt = item.publishedAt;
      return (await updateItem(item.id, payload)) ? 1 : 0;
    }),
  );
  return results.reduce((a, b) => a + b, 0);
}

// ============ dedupeExisting (P2): 기존 피드 중복 정리 ============
// 수집 시점 tooSimilar는 신규 입고분에만 동작하므로, 기존-기존 쌍은
// 여기서 잡는다. rewriteStale 다음에 collect 트랜잭션 안에서 실행.
// 안전장치: run당 최대 DEDUPE_DELETE_CAP건 삭제, 초과분은 다음 run으로.
const DEDUPE_DELETE_CAP = 3;

/** 등급 점수: [속보] > [중요] > [참고] > [팁] (4자 패널 합의) */
function gradeRank(i: Pick<NewsItem, "grade" | "tip">): number {
  if (i.grade === "breaking") return 30;
  if (i.grade === "important") return 20;
  return i.tip ? 0 : 10; // [참고] 10 > [팁] 0
}

/**
 * 클러스터 내 순위 점수 (높을수록 유지):
 * 등급 → 품질(needsRewrite 통과) → 신선도(publishedAt 최신)
 */
function rankScore(i: NewsItem): number {
  return (
    gradeRank(i) * 1e12 -
    (needsRewrite(i) ? 1e9 : 0) +
    Math.min(i.publishedAt, 9999999999999)
  );
}

function pickWinner(cluster: NewsItem[]): NewsItem {
  return [...cluster].sort((a, b) => rankScore(b) - rankScore(a))[0];
}

// 지역/범위 스코프 키워드: 두 제목의 스코프가 다르면 다른 소식이다.
// 예: "동남아 에이전틱 AI 진출" vs "아태 5개국 스마트시티 진출" → 각도 다름 → 둘 다 유지
const SCOPE_KEYWORDS = [
  "동남아",
  "동남아시아",
  "아태",
  "아시아태평양",
  "아시아",
  "북미",
  "남미",
  "미국",
  "중국",
  "일본",
  "유럽",
  "영국",
  "독일",
  "프랑스",
  "인도",
  "중동",
  "아프리카",
  "오세아니아",
  "국내",
  "해외",
  // 32차: "글로벌" 제외 — "글로벌 삼림 지도"처럼 대상의 속성으로 붙는 경우가 많아
  // 스코프 차이로 오인해 중복 정리를 막았다 (ForTy 쌍 실측). 지역명은 유지.
];
const SCOPE_COUNT_HINT = /\d+\s*개(국|사|곳)/;

function scopeSet(title: string): Set<string> {
  const norm = normalizeProductNames(title).toLowerCase();
  const found = new Set<string>();
  for (const k of SCOPE_KEYWORDS) if (norm.includes(k)) found.add(k);
  const m = norm.match(SCOPE_COUNT_HINT);
  if (m) found.add(m[0].replace(/\s+/g, ""));
  return found;
}

/** 두 제목의 스코프가 같은가? 다르면 다른 각도 → 삭제 대상에서 제외 */
function sameScope(a: string, b: string): boolean {
  const sa = scopeSet(a);
  const sb = scopeSet(b);
  if (sa.size === 0 && sb.size === 0) return true; // 스코프 언급 없으면 같은 소식으로 간주
  if (sa.size !== sb.size) return false;
  for (const s of sa) if (!sb.has(s)) return false;
  return true;
}

/** 수집 시점과 동일한 판정 (제목+원문 대칭 비교). 중복이면 사유 문자열 반환. */
function dupPairReason(a: NewsItem, b: NewsItem): string | null {
  const pairs: [string, string][] = [
    [a.title, b.title],
    [a.originalTitle, b.title],
    [a.title, b.originalTitle],
  ];
  let similar = false;
  for (const [x, y] of pairs) {
    if (tooSimilar(x, y, a.publishedAt, b.publishedAt)) {
      similar = true;
      break;
    }
  }
  if (!similar) return null;
  // 로그용 사유 분류
  const fx = foldTitle(a.title);
  const fy = foldTitle(b.title);
  if (fx && fy) {
    if (fx === fy) return "fold일치";
    if (fx.length >= 12 && fy.length >= 12 && (fx.includes(fy) || fy.includes(fx)))
      return "fold포함";
  }
  if (sharesTopicAnchor(a.title, b.title, a.publishedAt, b.publishedAt))
    return "주제앵커(고유명사 2개+)";
  return "토큰겹침";
}

async function dedupeExisting(existing: NewsItem[]): Promise<number> {
  const items = existing.filter((i) => !isSeedItem(i));
  if (items.length < 2) return 0;

  // Union-Find로 중복 클러스터 탐지
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (let x = 0; x < items.length; x++) {
    for (let y = x + 1; y < items.length; y++) {
      const a = items[x];
      const b = items[y];
      const reason = dupPairReason(a, b);
      if (!reason) continue;
      // 소프트 중복(같은 발표·다른 각도)은 삭제 대상에서 제외
      if (!sameScope(a.title, b.title)) {
        console.log(
          `[dedupe] 스코프 다름 → 유지: "${a.title.slice(0, 36)}" / "${b.title.slice(0, 36)}" (${reason})`,
        );
        continue;
      }
      union(a.id, b.id);
    }
  }

  const clusters = new Map<string, NewsItem[]>();
  for (const i of items) {
    const r = find(i.id);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r)!.push(i);
  }

  let deleted = 0;
  const ordered = [...clusters.values()]
    .filter((c) => c.length > 1)
    .sort((p, q) => q.length - p.length || p[0].id.localeCompare(q[0].id));

  for (const cluster of ordered) {
    if (deleted >= DEDUPE_DELETE_CAP) break;
    const winner = pickWinner(cluster);
    const losers = cluster
      .filter((i) => i.id !== winner.id)
      .sort((p, q) => rankScore(p) - rankScore(q)); // 점수 낮은(버릴) 순
    for (const loser of losers) {
      if (deleted >= DEDUPE_DELETE_CAP) break;
      const reason = dupPairReason(loser, winner) ?? "중복";
      const ok = await deleteItem(loser.id);
      console.log(
        `[dedupe] 삭제 "${loser.title.slice(0, 40)}" (id=${loser.id}) ← 유지 "${winner.title.slice(0, 40)}" (id=${winner.id}) [${reason}]${ok ? "" : " [삭제실패]"}`,
      );
      if (ok) deleted += 1;
    }
  }
  return deleted;
}

// 34차: 제목 하한 재시도의 run당 총량 상한 (호출 예산 통제 — Codex 재심).
// 전역 변수가 아니라 진입 함수가 만든 지역 객체를 호출 경로로 전달한다.
type RetryBudget = { left: number };

// ============================================================================
// Phase 1: 등급 거버너 (plan-final.md Phase 1)
// 최근 40건 창 기준 [중요]급(속보 포함) 비율 12~18%를 지킨다.
// - 하드 게이트 적중 건과 보안 힌트(SEC_TITLE_HINT) 통과 건은 상한 밖 (면제).
// - 나머지는 Pass 1 중요도 점수 순위 + 거버너 슬롯으로 승격 여부를 정한다.
//   절대 하한(점수 미달 승격 금지)은 decideGrade가 이미 적용한 상태다.
// - 비율 이탈은 자동 강등이 아니라 stats.govSignal + 로그로 남기는 검토 신호다.
//   단, 상한을 넘는 "일반 승격분"만 [참고]로 내린다 (면제분은 건드리지 않음).
// ============================================================================

export type GovernorResult = { demoted: number; shareAfter: number; signal?: string };

const GOVERNOR_BAND_MIN = 0.12;
const GOVERNOR_BAND_MAX = 0.18;
const GOVERNOR_WINDOW = 40;

function isTopGrade(p: Pick<IngestPayload, "grade">): boolean {
  return p.grade === "important" || p.grade === "breaking";
}

export function applyGovernor(
  payloads: IngestPayload[],
  recent: NewsItem[],
  newCap: number,
): GovernorResult {
  // 삽입 루프와 동일 순서로 실제 편입될 건만 대상 (keep=true 상위 newCap건)
  const willInsert: IngestPayload[] = [];
  for (const p of payloads) {
    if (p.keep === false) continue;
    if (willInsert.length >= newCap) break;
    willInsert.push(p);
  }
  // 최종 창 시뮬레이션: 기존 + 신규를 publishedAt 순으로 합쳐 최근 40건만 남긴다.
  // 신규가 밀어내는 오래된 기사까지 반영해야 비율이 실제 피드와 일치한다
  // (Codex 리뷰 P1 — 46건으로 나눈 근사 금지).
  type WinEntry = { top: boolean; publishedAt: number; payload?: IngestPayload; exempt: boolean };
  const win: WinEntry[] = [
    ...recent.map((i) => ({ top: isTopGrade(i), publishedAt: i.publishedAt, exempt: true })),
    ...willInsert.map((p) => ({
      top: isTopGrade(p),
      publishedAt: p.publishedAt ?? 0,
      payload: p,
      exempt: p.hardGate != null || p.secHint === true,
    })),
  ]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, GOVERNOR_WINDOW);
  const total = win.length;
  if (total === 0) return { demoted: 0, shareAfter: 0 };
  let topCount = win.filter((w) => w.top).length;
  const maxTop = Math.floor(GOVERNOR_BAND_MAX * total);
  // 강등은 점수 낮은 후보부터 — 면제분과 기존 기사는 건드리지 않는다.
  const candidates = win
    .filter((w) => w.payload && !w.exempt && w.top)
    .sort((a, b) => (a.payload!.score ?? 0) - (b.payload!.score ?? 0));
  let demoted = 0;
  for (const c of candidates) {
    if (topCount <= maxTop) break;
    c.payload!.grade = "note";
    topCount -= 1;
    demoted += 1;
  }
  const shareAfter = topCount / total;
  let signal: string | undefined;
  if (shareAfter > GOVERNOR_BAND_MAX) {
    signal = `비율 ${(shareAfter * 100).toFixed(1)}% — 하드 게이트·보안 면제로 상한 18% 초과 (자동 강등 안 함, 검토 신호)`;
  } else if (shareAfter < GOVERNOR_BAND_MIN) {
    signal = `비율 ${(shareAfter * 100).toFixed(1)}% — 하한 12% 미달 (승격 후보 부족, 검토 신호)`;
  }
  return { demoted, shareAfter, signal };
}

/** Phase 1 Pass 2 호출 — 사실 카드 기반 작성. feedback이 있으면 재작성 지시 포함. */
async function writeFromCard(
  entry: RawEntry,
  card: FactCard,
  feedback: { prevTitle: string; problems: string[] } | null,
): Promise<Record<string, unknown> | null> {
  updateLlmCallPass(feedback ? "write-retry" : "write");
  return chatJson({ system: WRITE_SYSTEM, user: writeUser(entry, card, feedback) });
}

/** B1: LLM 실패·데드라인 보류 페이로드. 원문 폴백과 같은 모양이지만
 *  keep=false라 삽입되지 않고, 다음 회차 피드에 다시 나타나 재분류된다.
 *  데드라인만 도입하면 원문 삽입이 늘어나는 부작용을 원천 차단한다 (확정안). */
function llmFailureHold(entry: RawEntry, kind: "llm-fail" | "deadline"): IngestPayload {
  return { ...fallbackPayload(entry), keep: false, held: true, holdKinds: [kind] };
}

/** B1: 포이즌 제외 페이로드 (분류 예산을 태우지 않고 종결). */
function poisonPayload(entry: RawEntry): IngestPayload {
  return { ...fallbackPayload(entry), keep: false, poisoned: true };
}

/** S2 계측: classifyEntry 체인(기사 1건의 직렬 LLM 호출 묶음) 소요를 재서
 *  durations.llmMaxChainMs에 최장값만 남긴다. durations가 없으면 그대로 위임 (동작 불변). */
async function timedClassifyEntry(
  entry: RawEntry,
  budget: RetryBudget | undefined,
  durations?: CollectDurations,
): Promise<IngestPayload> {
  // B1: 호출 기록 라벨 (기사 해시) — 패스는 classifyEntry가 단계마다 갱신한다.
  setLlmCallLabel({ key: hash12(entry.sourceUrl) });
  if (!durations) return classifyEntry(entry, budget);
  const startedAt = Date.now();
  try {
    return await classifyEntry(entry, budget);
  } finally {
    const ms = Date.now() - startedAt;
    if (ms > durations.llmMaxChainMs) durations.llmMaxChainMs = ms;
  }
}

export async function classifyEntry(entry: RawEntry, budget?: RetryBudget): Promise<IngestPayload> {
  if (shouldDrop(entry.title, entry.summary)) {
    return { ...fallbackPayload(entry), keep: false };
  }
  if (!resolveLlm()) {
    // LLM 미설정 경로는 현행 유지한다 (운용 상태이지 타임아웃이 아니다 —
    // 확정안). 단, 원문 폴백 삽입으로 셀 수 있게 표시만 남긴다.
    const raw = fallbackPayload(entry);
    raw.rawFallback = true;
    return raw;
  }
  // B1: 체인 시작 게이트 — 마감까지 잔여가 부족하면 시작하지 않고 보류한다
  // (시작해 봐야 중단이 확정적인 체인의 예산 낭비 방지).
  if (deadlineGateClosed()) return llmFailureHold(entry, "deadline");

  // ---- Pass 1: 사실 카드 + 중요도 점수 + 승격 근거 (등급·제목·시사점 미확정) ----
  updateLlmCallPass("fact");
  const factJson = await chatJson({ system: FACT_SYSTEM, user: factUser(entry) });
  // B1: LLM 실패(Pass1 null)는 원문 삽입이 아니라 보류로 전환한다.
  if (!factJson) return llmFailureHold(entry, currentFailureKind());
  if (factJson.keep === false) {
    return { ...fallbackPayload(entry), keep: false };
  }
  const card = parseFactCard(factJson);
  if (!card) return llmFailureHold(entry, "llm-fail");

  // ---- Pass 2: 사실 카드 기반으로만 제목·시사점 작성 ----
  // B1: 패스 시작 전에도 잔여를 확인한다 (동적 데드라인의 패스 단위 전파).
  if (deadlineGateClosed()) return llmFailureHold(entry, "deadline");
  const write = await writeFromCard(entry, card, null);
  if (!write) return llmFailureHold(entry, currentFailureKind());
  let usedNames: unknown = write.usedNames;
  let payload = buildPayloadFromCard(card, write, entry);
  payload.secHint = Boolean(entry.secTitleHint);
  if (shouldDrop(payload.title, payload.summary)) {
    return { ...payload, keep: false };
  }

  // ---- 원문 대조 검증 + 재작성 (34차 제목 하한 재시도와 통합, run당 예산 공유) ----
  let violations = verifyAgainstCard(payload.title, payload.takeaway, payload.summary, card, entry, usedNames);
  const titleShort = [...payload.title].length < 28;
  // B1: 재작성 패스도 게이트를 지난다 — 잔여가 부족하면 재시도를 건너뛰고
  // 현재 페이로드의 검증 결과(위반 시 보류)로 종결한다.
  if ((violations.length > 0 || titleShort) && budget && budget.left > 0 && !deadlineGateClosed()) {
    budget.left -= 1;
    const problems = violations.map((v) => v.detail);
    if (titleShort) {
      problems.push(
        `제목이 ${[...payload.title].length}자로 28자 하한에 못 미친다. 같은 사실을 유지하되 주어·대상·수치·범위 같은 구체 맥락을 원문에서 보강해 28~44자로 다시 쓸 것.`,
      );
    }
    const retryWrite = await writeFromCard(entry, card, { prevTitle: payload.title, problems });
    if (retryWrite) {
      const retryPayload = buildPayloadFromCard(card, retryWrite, entry);
      retryPayload.secHint = Boolean(entry.secTitleHint);
      // 재시도 채택 조건 (Codex 리뷰 P2 + 3차): 28자 하한을 채웠거나,
      // 원래도 하한 이상이었는데 줄지 않았을 때만 채택한다. 하한 미달인
      // 원본(20자)을 25자로 "개선"하는 채택은 구 34차 규칙 위반이라 금지.
      const prevLen = [...payload.title].length;
      const newLen = [...retryPayload.title].length;
      if (
        !shouldDrop(retryPayload.title, retryPayload.summary) &&
        (newLen >= 28 || (prevLen >= 28 && newLen >= prevLen))
      ) {
        payload = retryPayload;
        usedNames = retryWrite.usedNames;
        violations = verifyAgainstCard(payload.title, payload.takeaway, payload.summary, card, entry, usedNames);
      }
    }
  }
  // 재시도 후에도 남은 위반 처리:
  // - entity: 라틴 표기 폴백 — 원문 제목으로 되돌린다 (원문 표기는 잠금을 통과).
  // - number/status: 보류 — 삽입하지 않으면 다음 수집에서 다시 분류된다.
  // - form(usedNames 선언 형식)만 남으면 내용은 수용하고 로그만 남긴다.
  if (violations.some((v) => v.kind === "entity")) {
    payload = buildPayloadFromCard(
      card,
      { title: entry.title, takeaway: payload.takeaway, summary: payload.summary },
      entry,
    );
    payload.secHint = Boolean(entry.secTitleHint);
    // 폴백 제목은 원문 표기 그 자체라 usedNames 추적은 생략 (근접 오형은 원문 면제)
    violations = verifyAgainstCard(payload.title, payload.takeaway, payload.summary, card, entry);
  }
  // 폴백 후에도 남은 entity 위반(요약의 오형 등)도 보류한다 — 제목만 갈고
  // 요약을 그대로 수용하면 잠금이 무력화된다 (Codex 리뷰 2차 P2).
  const hardLeft = violations.filter(
    (v) => v.kind === "number" || v.kind === "status" || v.kind === "entity",
  );
  if (hardLeft.length > 0) {
    console.log(
      `[desk-hold] 보류 "${entry.title.slice(0, 50)}" — ${hardLeft.map((v) => v.detail).join(" / ")}`,
    );
    return { ...payload, keep: false, held: true, holdKinds: hardLeft.map((v) => v.kind) };
  }
  const formLeft = violations.filter((v) => v.kind === "form");
  if (formLeft.length > 0) {
    console.log(
      `[desk-guard] usedNames 형식 위반 수용 "${entry.title.slice(0, 50)}" — ${formLeft.map((v) => v.detail).join(" / ")}`,
    );
  }
  return payload;
}

function fallbackPayload(entry: RawEntry): IngestPayload {
  const takeaway = (entry.summary || entry.title).slice(0, 160);
  const topics = guessTopics(`${entry.title} ${entry.summary} ${entry.source}`);
  return {
    title: entry.title.slice(0, 180),
    takeaway,
    summary: entry.summary.slice(0, 800) || takeaway,
    source: entry.source,
    sourceUrl: entry.sourceUrl,
    originalTitle: entry.title,
    grade: "note",
    tip: false,
    topics,
    publishedAt: entry.date,
  };
}

function guessTopics(text: string): string[] {
  const t = text.toLowerCase();
  const found: string[] = [];
  const rules: [string, string][] = [
    ["kimi k3", "kimi-k3"],
    ["kimi-k3", "kimi-k3"],
    ["kimik3", "kimi-k3"],
    ["kimi", "kimi-k3"],
    ["opus 5", "opus-5"],
    ["opus-5", "opus-5"],
    ["opus5", "opus-5"],
    ["bonsai 27", "bonsai-27b"],
    ["bonsai-27", "bonsai-27b"],
    ["bonsai", "bonsai-27b"],
    ["claude code", "claude-code"],
    ["claude-code", "claude-code"],
    ["claudecode", "claude-code"],
    ["openai", "openai"],
    ["gpt", "openai"],
    ["anthropic", "anthropic"],
    ["claude", "claude"],
    ["gemini", "google"],
    ["google", "google"],
    ["deepmind", "google"],
    ["xai", "xai"],
    ["grok", "xai"],
    ["agent", "agent"],
    ["에이전트", "agent"],
    ["local", "local-llm"],
    ["open source", "open-source"],
    ["opensource", "open-source"],
    ["오픈소스", "open-source"],
    ["nvidia", "hardware"],
    ["gpu", "hardware"],
    ["hbm", "hardware"],
    ["secur", "security"],
    ["regulat", "regulation"],
    ["규제", "regulation"],
    ["prompt", "prompt"],
    ["프롬프트", "prompt"],
    ["benchmark", "benchmark"],
    ["벤치마크", "benchmark"],
    ["korea", "korea-ai"],
    ["네이버", "korea-ai"],
    ["삼성", "korea-ai"],
    ["하이퍼클로바", "korea-ai"],
    ["타임스", "korea-ai"],
    ["zdnet", "korea-ai"],
    ["전자신문", "korea-ai"],
    ["바이라인", "korea-ai"],
    ["테크m", "korea-ai"],
    ["디일렉", "korea-ai"],
    ["인공지능신문", "korea-ai"],
    ["aitimes", "korea-ai"],
    ["etnews", "korea-ai"],
  ];
  for (const [k, slug] of rules) {
    if (t.includes(k) && !found.includes(slug)) found.push(slug);
    if (found.length >= 3) break;
  }
  return found;
}

async function refreshBriefing() {
  const items = (await listNews()).filter((i) => !isSeedItem(i));
  if (!items.length) return;
  const pool = items.filter((i) => i.grade === "breaking" || i.grade === "important");
  const rest = items.filter((i) => !pool.includes(i));
  const lines = [...pool, ...rest].slice(0, 6).map((i) => i.title);
  await upsertBriefing(lines);
}

/** 영문 우세 판정 (29차 P0): 한글 음절 비율이 낮으면 영문 원문으로 본다. */
function isEnglishDominant(s: string): boolean {
  const hangul = (s.match(/[가-힣]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const letters = hangul + latin;
  if (letters < 8) return false;
  return hangul / letters < 0.3;
}

export async function ingestPayloads(items: IngestPayload[]): Promise<{ inserted: number; skipped: number }> {
  const retryBudget: RetryBudget = { left: 12 };
  await ensureSeeded();
  // P0: RSS 수집 경로와 동일한 중복 검사. X 보충 수집이 볼륨을 키우기 전 구멍 봉쇄.
  // Phase 2: existingUrls는 collectOnce와 동일하게 source_url 전체 조회로 구축한다
  // (컬럼 1개만 조회하므로 부담이 작다). existingItems(200건 창)는
  // 유사도 검사용으로 현행 유지.
  const existingItems = (await listNews()).filter((i) => !isSeedItem(i));
  const existingUrls = new Set(await listAllSourceUrls());
  const batch: IngestPayload[] = [];
  let inserted = 0;
  let skipped = 0;
  for (let item of items.slice(0, INGEST_MAX_BATCH)) {
    if (!item.title || !item.sourceUrl) {
      skipped += 1;
      continue;
    }
    // 29차 크로스 리뷰: 중복 URL은 데스크 패스(LLM) 전에 제외 — 이미 있는 기사를
    // 영문 게이트가 먼저 재작성하고 뒤늦게 버리는 LLM 낭비 방지.
    if (existingUrls.has(item.sourceUrl)) {
      skipped += 1;
      continue;
    }
    // P0-1 (17차): 표시 정규화 — 외래 고유명사 오타를 표준 표기로 통일 (앤스로픽 → 앤트로픽).
    // 중복 비교 전에 적용하면 오타 변형도 같은 기사로 잡히고, 피드에도 오타가 노출되지 않음.
    item.title = normalizeDisplayNames(item.title);
    if (item.takeaway) item.takeaway = normalizeDisplayNames(item.takeaway);
    if (item.summary) item.summary = normalizeDisplayNames(item.summary);
    if (item.originalTitle) item.originalTitle = normalizeDisplayNames(item.originalTitle);
    // 26차 P0-2: X 파이프라인 bare 어미 교정 — "… 확인." → "… 확인 필요."
    if (item.takeaway) item.takeaway = fixBareEnding(item.takeaway);
    // 28차 P0: X 경로 desk 품질 게이트 — fixTypos 적용 (polishPayload와 동일한 교정)
    item.title = fixTypos(item.title);
    if (item.takeaway) item.takeaway = fixTypos(item.takeaway);
    if (item.summary) item.summary = fixTypos(item.summary);
    // 29차 P0: 영문 미번역 게이트 — X ingest 번역 폴백으로 들어온 영문 제목·시사점이
    // 그대로 피드 최상위에 노출됨 (실측: [속보] 2건 제목·시사점 100% 영문, 요약=시사점 동일 문장).
    // 영문 우세면 즉시 넣지 말고 RSS와 같은 데스크 패스(classifyEntry)로 한국어 재작성을 강제한다.
    // 제목·시사점이 모두 영문 우세일 때만 발동 — 영문 제품명이 많은 정상 한글 제목
    // ("NVIDIA Nemotron 3.5 공개" + 한글 시사점)의 오탐 방지 (29차 크로스 리뷰).
    // 유사도 검사는 최종(한국어) 제목 기준으로 해야 하므로 그보다 앞에 둔다.
    if (isEnglishDominant(item.title) && (!item.takeaway || isEnglishDominant(item.takeaway))) {
      const desked = await classifyEntry({
        title: item.originalTitle || item.title,
        sourceUrl: item.sourceUrl,
        source: item.source,
        date: item.publishedAt ?? Date.now(),
        summary: item.summary || item.takeaway || "",
      }, retryBudget);
      // 강제 재작성 경로에서는 데스크가 실제로 다시 쓴 경우(keep===true)에만 입고한다.
      // LLM 실패 폴백(keep 필드 없음)·드롭 판정·결과가 여전히 영문이면 넣지 않는다 —
      // 게이트가 오히려 새 영문 노출 통로가 되는 것 방지 (29차 크로스 리뷰 블로커).
      if (
        desked.keep !== true ||
        isEnglishDominant(desked.title) ||
        (desked.takeaway && isEnglishDominant(desked.takeaway))
      ) {
        skipped += 1;
        continue;
      }
      item = desked;
    }
    if (
      existingItems.some(
        (i) =>
          tooSimilar(i.title, item.title, i.publishedAt, item.publishedAt) ||
          tooSimilar(i.originalTitle, item.title, i.publishedAt, item.publishedAt),
      ) ||
      batch.some((f) => tooSimilar(f.title, item.title, f.publishedAt, item.publishedAt))
    ) {
      skipped += 1;
      continue;
    }
    batch.push(item);
    existingUrls.add(item.sourceUrl);
    const ok = await insertItem(item);
    if (ok) inserted += 1;
    else skipped += 1;
  }
  if (inserted > 0) await refreshBriefing();
  return { inserted, skipped };
}

export async function ingestMarkdownBatch(markdownFiles: string[]) {
  const payloads = markdownFiles.map(parseNewsMarkdown);
  return ingestPayloads(payloads);
}
