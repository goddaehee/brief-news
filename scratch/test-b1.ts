// B1 (수집 타임아웃 개선 확정안) 단위 테스트 — 2단계 데드라인·원문 폴백
// 삽입 제거(보류 전환)·포이즌 가드·partial 상태·체크포인트·M6 잔류 정리.
// 메모리 모드(DATABASE_URL 없음) + fetch 스텁으로 검증한다.
import {
  CHAIN_START_GATE_MS,
  classifyEntry,
  currentFailureKind,
  deadlineGateClosed,
  decideRunStatus,
  FINISH_DEADLINE_MS,
  FINISH_RESERVE_MS,
  isPoisonedHold,
  LLM_DEADLINE_MS,
  POISON_HOLD_LIMIT,
  rewriteStale,
  type RewriteHoldSink,
} from "../src/lib/news/collect";
import {
  chatJson,
  classifyCallOutcome,
  createLlmDeadline,
  effectiveCallTimeoutMs,
  LLM_CALL_CAP_MS,
  setLlmCallLabel,
  setLlmDeadline,
  setLlmMetricsSink,
  updateLlmCallPass,
  type LlmCallMetrics,
} from "../src/lib/news/llm";
import {
  abortStaleRuns,
  beginRun,
  finishRun,
  getDropLedgerSeen,
  insertItem,
  lastRunAt,
  listNews,
  listRuns,
  recordDropLedger,
  updateRunStats,
} from "../src/lib/news/repo";
import { newCollectStats } from "../src/lib/news/collect";

delete process.env.DATABASE_URL;
delete process.env.LLM_API_KEY;
delete process.env.XAI_API_KEY;
process.env.GLM_API_KEY = "test-key-b1";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} => ${JSON.stringify(actual)}${ok ? "" : ` (기대 ${JSON.stringify(expected)})`}`);
}

// ---------- fetch 스텁 ----------
const realFetch = globalThis.fetch;
type FetchImpl = (url: unknown, opts: { signal?: AbortSignal }) => Promise<unknown>;
function stubFetch(impl: FetchImpl) {
  globalThis.fetch = impl as unknown as typeof fetch;
}
function jsonOk(obj: Record<string, unknown>): Promise<unknown> {
  return Promise.resolve({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }),
  });
}
function httpFail(): Promise<unknown> {
  return Promise.resolve({ ok: false, json: async () => ({}) });
}
function hangUntilAbort(opts: { signal?: AbortSignal }): Promise<unknown> {
  return new Promise((_, reject) => {
    opts.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
}
function resetLlmContext() {
  setLlmDeadline(null);
  setLlmMetricsSink(null);
  setLlmCallLabel(null);
}

const entry = (n: number) => ({
  title: "테스트 기사 제목입니다",
  sourceUrl: `https://example.com/b1-${n}`,
  source: "Example",
  date: Date.now(),
  summary: "요약 텍스트입니다.",
});

const FACT_JSON = {
  status: "confirmed",
  entities: [] as string[],
  hangulForms: [] as string[],
  change: "변경 사항",
  numbers: [] as string[],
  evidence: "원문 근거 구절",
  importance: 50,
  promotionReason: "",
  hardGate: null,
  immediate: false,
  tip: false,
  topics: [] as string[],
};
const WRITE_JSON = {
  title: "새 인공지능 모델의 성능 개선 결과가 공개됐다",
  takeaway: "모델 성능이 개선됐다. 도입 검토 필요.",
  summary: "성능 개선 요약 본문이다.",
  usedNames: [] as string[],
};

async function main() {
  // ---------- 확정 수치 ----------
  check("LLM 마감 47초", LLM_DEADLINE_MS, 47000);
  check("종료 기한 55초", FINISH_DEADLINE_MS, 55000);
  check("종료 예비 5초", FINISH_RESERVE_MS, 5000);
  check("체인 시작 게이트 10초", CHAIN_START_GATE_MS, 10000);
  check("포이즌 한계 3회", POISON_HOLD_LIMIT, 3);
  check("호출 캡 25초", LLM_CALL_CAP_MS, 25000);

  // ---------- effectiveCallTimeoutMs ----------
  check("유효 타임아웃: 문맥 없음", effectiveCallTimeoutMs(1000, null), 25000);
  check("유효 타임아웃: 잔여 충분", effectiveCallTimeoutMs(1000, 61000), 25000);
  check("유효 타임아웃: 잔여 8초", effectiveCallTimeoutMs(1000, 9000), 8000);
  check("유효 타임아웃: 마감 경과", effectiveCallTimeoutMs(1000, 500), 0);

  // ---------- classifyCallOutcome ----------
  check("결과 분류 ok", classifyCallOutcome({ hasData: true, deadlineAborted: true, timedOut: true }), "ok");
  check("결과 분류 aborted", classifyCallOutcome({ hasData: false, deadlineAborted: true, timedOut: true }), "aborted");
  check("결과 분류 timeout", classifyCallOutcome({ hasData: false, deadlineAborted: false, timedOut: true }), "timeout");
  check("결과 분류 empty", classifyCallOutcome({ hasData: false, deadlineAborted: false, timedOut: false }), "empty");

  // ---------- decideRunStatus ----------
  check("상태 ok", decideRunStatus({}), "ok");
  check("상태 partial(데드라인 보류)", decideRunStatus({ heldDeadline: 1 }), "partial");
  check("상태 partial(호출 중단)", decideRunStatus({ callsAborted: 2 }), "partial");
  check("상태 ok(타임아웃만)", decideRunStatus({ heldDeadline: 0, callsAborted: 0 }), "ok");

  // ---------- isPoisonedHold (llm_fail_count 전용 카운터 기준) ----------
  check("포이즌 없음(undefined)", isPoisonedHold(undefined), false);
  check("포이즌 2회", isPoisonedHold({ llmFailCount: 2, lastStage: "llmFail" }), false);
  check("포이즌 3회", isPoisonedHold({ llmFailCount: 3, lastStage: "llmFail" }), true);
  check("포이즌: seen 혼합과 무관", isPoisonedHold({ llmFailCount: 1, lastStage: "llmFail" }), false);
  check("포이즌 제외 상태 유지", isPoisonedHold({ llmFailCount: 0, lastStage: "poison" }), true);

  // ---------- chatJson: 정상 + 계측 + 라벨 ----------
  {
    resetLlmContext();
    const sink: LlmCallMetrics = { calls: 0, maxMs: 0 };
    setLlmMetricsSink(sink);
    const dl = createLlmDeadline(Date.now() + 60000);
    setLlmDeadline(dl);
    setLlmCallLabel({ key: "abc123" });
    updateLlmCallPass("fact");
    stubFetch(() => jsonOk({ a: 1 }));
    const r = await chatJson({ system: "s", user: "u" });
    check("chatJson 정상 반환", r, { a: 1 });
    check("chatJson 계측 calls", sink.calls, 1);
    check("호출 기록 outcome", dl.calls[0]?.outcome, "ok");
    check("호출 기록 key", dl.calls[0]?.key, "abc123");
    check("호출 기록 pass", dl.calls[0]?.pass, "fact");
    check("호출 기록 timeoutMs", dl.calls[0]?.timeoutMs, 25000);
    resetLlmContext();
  }

  // ---------- chatJson: 마감 경과 — 시작하지 않음 ----------
  {
    resetLlmContext();
    const dl = createLlmDeadline(Date.now() - 1);
    setLlmDeadline(dl);
    let fetchCalls = 0;
    stubFetch(() => {
      fetchCalls += 1;
      return jsonOk({ a: 1 });
    });
    const r = await chatJson({ system: "s", user: "u" });
    check("마감 경과 null", r, null);
    check("마감 경과 fetch 미호출", fetchCalls, 0);
    check("마감 경과 outcome", dl.calls[0]?.outcome, "deadline");
    check("마감 경과 ms", dl.calls[0]?.ms, 0);
    check("마감 경과 timeoutMs", dl.calls[0]?.timeoutMs, 0);
    resetLlmContext();
  }

  // ---------- chatJson: 데드라인 abort가 진행 중 fetch를 실제로 취소 ----------
  {
    resetLlmContext();
    const dl = createLlmDeadline(Date.now() + 60000);
    setLlmDeadline(dl);
    stubFetch((_url, opts) => hangUntilAbort(opts));
    const started = Date.now();
    const timer = setTimeout(() => dl.controller.abort(), 200);
    const r = await chatJson({ system: "s", user: "u" });
    const elapsed = Date.now() - started;
    clearTimeout(timer);
    check("abort 시 null", r, null);
    check("abort outcome", dl.calls[0]?.outcome, "aborted");
    check("abort로 즉시 종료(<3초)", elapsed < 3000, true);
    resetLlmContext();
  }

  // ---------- 게이트·실패 분류 (collect 헬퍼) ----------
  {
    resetLlmContext();
    check("게이트: 문맥 없음 열림", deadlineGateClosed(), false);
    check("실패 분류: 문맥 없음 llm-fail", currentFailureKind(), "llm-fail");
    const dl = createLlmDeadline(Date.now() + 5000);
    setLlmDeadline(dl);
    check("게이트: 잔여 5초 닫힘", deadlineGateClosed(), true);
    check("실패 분류: 잔여 있음 llm-fail", currentFailureKind(), "llm-fail");
    dl.controller.abort();
    check("실패 분류: abort됨 deadline", currentFailureKind(), "deadline");
    resetLlmContext();
  }

  // ---------- classifyEntry: Pass1 실패 → 원문 삽입이 아니라 보류 ----------
  {
    resetLlmContext();
    stubFetch(() => httpFail());
    const p = await classifyEntry(entry(1));
    check("Pass1 실패 keep", p.keep, false);
    check("Pass1 실패 held", p.held, true);
    check("Pass1 실패 holdKinds", p.holdKinds, ["llm-fail"]);
    check("Pass1 실패 rawFallback 아님", p.rawFallback, undefined);
  }

  // ---------- classifyEntry: 카드 파싱 실패 → 보류 ----------
  {
    resetLlmContext();
    stubFetch(() => jsonOk({ status: "bogus" }));
    const p = await classifyEntry(entry(2));
    check("카드 파싱 실패 held", p.held, true);
    check("카드 파싱 실패 holdKinds", p.holdKinds, ["llm-fail"]);
  }

  // ---------- classifyEntry: Pass2 실패 → 보류 ----------
  {
    resetLlmContext();
    let n = 0;
    stubFetch(() => {
      n += 1;
      return n === 1 ? jsonOk(FACT_JSON) : httpFail();
    });
    const p = await classifyEntry(entry(3));
    check("Pass2 실패 held", p.held, true);
    check("Pass2 실패 holdKinds", p.holdKinds, ["llm-fail"]);
    check("Pass2 실패 호출 수", n, 2);
  }

  // ---------- classifyEntry: Pass1 keep=false → 보류가 아닌 탈락 ----------
  {
    resetLlmContext();
    stubFetch(() => jsonOk({ ...FACT_JSON, keep: false }));
    const p = await classifyEntry(entry(4));
    check("keep=false 탈락 keep", p.keep, false);
    check("keep=false 탈락 held 아님", p.held, undefined);
  }

  // ---------- classifyEntry: 게이트 닫힘 → 호출 없이 데드라인 보류 ----------
  {
    resetLlmContext();
    const dl = createLlmDeadline(Date.now() + 5000);
    setLlmDeadline(dl);
    let fetchCalls = 0;
    stubFetch(() => {
      fetchCalls += 1;
      return jsonOk(FACT_JSON);
    });
    const p = await classifyEntry(entry(5));
    check("게이트 보류 held", p.held, true);
    check("게이트 보류 holdKinds", p.holdKinds, ["deadline"]);
    check("게이트 보류 fetch 미호출", fetchCalls, 0);
    resetLlmContext();
  }

  // ---------- classifyEntry: 정상 경로 (회귀) ----------
  {
    resetLlmContext();
    let n = 0;
    stubFetch(() => {
      n += 1;
      return n === 1 ? jsonOk(FACT_JSON) : jsonOk(WRITE_JSON);
    });
    const p = await classifyEntry(entry(6));
    check("정상 경로 keep", p.keep, true);
    check("정상 경로 held 아님", p.held, undefined);
    check("정상 경로 rawFallback 아님", p.rawFallback, undefined);
    check("정상 경로 제목은 재작성본", p.title, WRITE_JSON.title);
  }

  // ---------- classifyEntry: LLM 미설정 → 기존 폴백 유지 + 표시 ----------
  {
    resetLlmContext();
    delete process.env.GLM_API_KEY;
    const p = await classifyEntry(entry(7));
    check("LLM 미설정 rawFallback 표시", p.rawFallback, true);
    check("LLM 미설정 held 아님", p.held, undefined);
    check("LLM 미설정 keep 미지정(기존 동작)", p.keep, undefined);
    process.env.GLM_API_KEY = "test-key-b1";
  }

  // ---------- repo: 체크포인트 갱신 ----------
  {
    const stats = newCollectStats();
    stats.rawFetched = 77;
    const id = await beginRun();
    await updateRunStats(id, stats);
    const run = (await listRuns(10)).find((r) => r.id === id);
    check("체크포인트 stats 반영", run?.stats?.rawFetched, 77);
    check("체크포인트 상태는 running 유지", run?.status, "running");
    await finishRun(id, { status: "ok", fetched: 0, inserted: 0, skipped: 0 });
  }

  // ---------- repo: M6 stale 정리 + lastRunAt에서 aborted 제외 ----------
  {
    const okId = await beginRun();
    await finishRun(okId, { status: "ok", fetched: 1, inserted: 1, skipped: 0 });
    const t1 = await lastRunAt();
    check("lastRunAt 기록됨", typeof t1, "number");
    const staleId = await beginRun();
    const aborted = await abortStaleRuns(Date.now() + 1000);
    check("stale 정리 1건 이상", aborted >= 1, true);
    const staleRun = (await listRuns(10)).find((r) => r.id === staleId);
    check("stale 행 aborted", staleRun?.status, "aborted");
    check("lastRunAt은 aborted 제외", await lastRunAt(), t1);
    const freshId = await beginRun();
    check("신선한 running은 정리 안 됨", await abortStaleRuns(Date.now() - 1000), 0);
    const freshRun = (await listRuns(10)).find((r) => r.id === freshId);
    check("신선한 행 running 유지", freshRun?.status, "running");
    await finishRun(freshId, { status: "partial", fetched: 0, inserted: 0, skipped: 0 });
    const partialRun = (await listRuns(10)).find((r) => r.id === freshId);
    check("partial 행 상태", partialRun?.status, "partial");
    check("partial은 lastRunAt에 포함", await lastRunAt(), partialRun?.finishedAt);
  }

  // ---------- repo: 포이즌 가드 원장 카운터 전이 ----------
  {
    const row = (stage: "llmFail" | "keepFalse" | "batchFull" | "poison" | "deadline") => ({
      urlHash: "b1poison0001",
      titleHash: "b1poison0002",
      source: "Example",
      publishedAt: Date.now(),
      lastStage: stage,
      similarId: null,
    });
    const seenOf = async () => (await getDropLedgerSeen(["b1poison0001"])).get("b1poison0001");
    await recordDropLedger([row("llmFail")]);
    await recordDropLedger([row("batchFull")]);
    await recordDropLedger([row("batchFull")]);
    check("원장: 배치 단계는 카운터 유지", (await seenOf())?.llmFailCount, 1);
    check("원장: seen_count는 전 사유 누적", (await seenOf())?.seenCount, 3);
    check("원장: 혼합 3회 기록이어도 포이즌 아님", isPoisonedHold(await seenOf()), false);
    await recordDropLedger([row("llmFail")]);
    check("원장: llmFail 2회", (await seenOf())?.llmFailCount, 2);
    await recordDropLedger([row("keepFalse")]);
    check("원장: 분류 완료 시 리셋", (await seenOf())?.llmFailCount, 0);
    await recordDropLedger([row("llmFail")]);
    await recordDropLedger([row("llmFail")]);
    await recordDropLedger([row("deadline")]);
    check("원장: 데드라인 보류는 카운터 유지", (await seenOf())?.llmFailCount, 2);
    check("원장: 데드라인 보류 후에도 포이즌 아님", isPoisonedHold(await seenOf()), false);
    await recordDropLedger([row("llmFail")]);
    check("원장: llmFail 3회 누적", (await seenOf())?.llmFailCount, 3);
    check("원장: 3회 → 포이즌", isPoisonedHold(await seenOf()), true);
    await recordDropLedger([row("poison")]);
    check("원장: poison 기록 후에도 카운터 유지", (await seenOf())?.llmFailCount, 3);
    check("원장: poison 기록 후에도 제외 유지", isPoisonedHold(await seenOf()), true);
    check("원장 미등록 해시", (await getDropLedgerSeen(["b1unknown000"])).get("b1unknown000"), undefined);
  }

  // ---------- repo: 체크포인트 가드 — 종료된 행은 덮지 않음 ----------
  {
    const id = await beginRun();
    const during = newCollectStats();
    during.rawFetched = 77;
    await updateRunStats(id, during);
    const finalStats = newCollectStats();
    finalStats.rawFetched = 5;
    await finishRun(id, {
      status: "ok",
      fetched: 0,
      inserted: 0,
      skipped: 0,
      detail: { stats: finalStats },
    });
    const late = newCollectStats();
    late.rawFetched = 99;
    await updateRunStats(id, late);
    const run = (await listRuns(10)).find((r) => r.id === id);
    check("종료 후 체크포인트는 무효", run?.stats?.rawFetched, 5);
    check("종료 행 상태 유지", run?.status, "ok");
  }

  // ---------- rewriteStale: LLM 실패·데드라인 보류 (삭제 금지·싱크 집계) ----------
  {
    const longTitle = `긴제목${"가".repeat(50)}`;
    const mk = async (url: string) => {
      await insertItem({
        title: longTitle,
        takeaway: "사실 한 줄이다. 도입 검토 필요.",
        summary: "요약 본문입니다.",
        source: "Example",
        sourceUrl: url,
        originalTitle: longTitle,
        grade: "note",
        tip: false,
        topics: [],
        publishedAt: Date.now(),
      });
      const item = (await listNews()).find((i) => i.sourceUrl === url);
      if (!item) throw new Error("seed item missing");
      return item;
    };
    // LLM 실패 → 건너뜀 + llmFail 싱크 + 기존 글 유지
    resetLlmContext();
    const failItem = await mk("https://example.com/rw-fail");
    stubFetch(() => httpFail());
    const sinkA: RewriteHoldSink = { deadline: 0, llmFail: 0 };
    const ra = await rewriteStale([failItem], { left: 12 }, undefined, sinkA);
    check("재작성 LLM 실패 시 처리 0", ra, 0);
    check("재작성 LLM 실패 싱크", sinkA.llmFail, 1);
    check(
      "재작성 LLM 실패 시 기존 글 유지",
      (await listNews()).some((i) => i.sourceUrl === "https://example.com/rw-fail"),
      true,
    );
    // 데드라인 게이트 → 건너뜀 + deadline 싱크
    resetLlmContext();
    const dlItem = await mk("https://example.com/rw-deadline");
    setLlmDeadline(createLlmDeadline(Date.now() + 5000));
    let fetchCalls = 0;
    stubFetch(() => {
      fetchCalls += 1;
      return jsonOk(FACT_JSON);
    });
    const sinkB: RewriteHoldSink = { deadline: 0, llmFail: 0 };
    const rb = await rewriteStale([dlItem], { left: 12 }, undefined, sinkB);
    check("재작성 데드라인 시 처리 0", rb, 0);
    check("재작성 데드라인 싱크", sinkB.deadline, 1);
    check("재작성 데드라인 시 호출 없음", fetchCalls, 0);
    resetLlmContext();
    // 정상 경로 회귀 → 재작성 적용
    const okItem = await mk("https://example.com/rw-ok");
    let n = 0;
    stubFetch(() => {
      n += 1;
      return n === 1 ? jsonOk(FACT_JSON) : jsonOk(WRITE_JSON);
    });
    const sinkC: RewriteHoldSink = { deadline: 0, llmFail: 0 };
    const rc = await rewriteStale([okItem], { left: 12 }, undefined, sinkC);
    check("재작성 정상 처리 1", rc, 1);
    check(
      "재작성 정상 시 제목 교체",
      (await listNews()).find((i) => i.sourceUrl === "https://example.com/rw-ok")?.title,
      WRITE_JSON.title,
    );
    resetLlmContext();
  }

  globalThis.fetch = realFetch;
  resetLlmContext();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
