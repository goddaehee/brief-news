// X ingest 개선안 단기(D-1 데드라인 + D-2 응답 계약·한글 우선 순서) 단위 테스트.
// 메모리 모드(DATABASE_URL 없음) + fetch 스텁으로 검증한다.
import {
  INGEST_FINISH_STOP_MS,
  ingestPayloads,
} from "../src/lib/news/collect";
import {
  createLlmDeadline,
  getLlmDeadline,
  setLlmDeadline,
  setLlmMetricsSink,
  setLlmCallLabel,
} from "../src/lib/news/llm";
import type { IngestPayload } from "../src/lib/news/types";

delete process.env.DATABASE_URL;
delete process.env.LLM_API_KEY;
delete process.env.XAI_API_KEY;
process.env.GLM_API_KEY = "test-key-ingest";

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

let seq = 0;
const koItem = (title: string, takeaway: string): IngestPayload => {
  seq += 1;
  return {
    title,
    takeaway,
    summary: takeaway,
    source: "X @tester",
    sourceUrl: `https://x.com/tester/status/${100000 + seq}`,
    originalTitle: title,
    grade: "note",
    tip: false,
    topics: [],
    publishedAt: Date.now(),
  };
};
const enItem = (title: string, takeaway: string): IngestPayload => {
  seq += 1;
  return {
    title,
    takeaway,
    summary: takeaway,
    source: "X @tester",
    sourceUrl: `https://x.com/tester/status/${200000 + seq}`,
    originalTitle: title,
    grade: "note",
    tip: false,
    topics: [],
    publishedAt: Date.now(),
  };
};

async function main() {
  // ---------- 확정 수치 ----------
  check("ingest 종료 중단 지점 50초", INGEST_FINISH_STOP_MS, 50000);

  // ---------- 한글 항목 삽입 + 계약 필드 ----------
  {
    resetLlmContext();
    stubFetch(() => httpFail()); // 한글 항목은 LLM을 부르지 않는다
    const a = koItem("국내 반도체 수출이 지난달 크게 늘었다", "수출이 증가했다. 물량 계획 점검 필요.");
    const b = koItem("전기차 배터리 가격 인하 소식이 전해졌다", "가격이 내렸다. 구매 시점 검토 권장.");
    const r = await ingestPayloads([a, b]);
    check("한글 2건 inserted", r.inserted, 2);
    check("한글 2건 skipped 0", r.skipped, 0);
    check("한글 2건 deferred 0", r.deferred, 0);
    check("항목별 결과 2건", r.items.length, 2);
    check("항목 상태 inserted", r.items.map((i) => i.status), ["inserted", "inserted"]);
    check("항목 gate=false", r.items.map((i) => i.gate), [false, false]);
    check("heapUsedMb 양수", r.heapUsedMb > 0, true);

    // ---------- 중복 재전송 → duplicate ----------
    const r2 = await ingestPayloads([a]);
    check("중복 inserted 0", r2.inserted, 0);
    check("중복 duplicate 1", r2.duplicate, 1);
    check("중복 skipped 하위호환 1", r2.skipped, 1);
    check("중복 상태", r2.items[0].status, "duplicate");
    resetLlmContext();
  }

  // ---------- 한글 우선 순서: [영문, 한글] → 한글이 먼저 처리된다 ----------
  {
    resetLlmContext();
    let n = 0;
    stubFetch(() => {
      n += 1;
      return n === 1 ? jsonOk(FACT_JSON) : jsonOk(WRITE_JSON);
    });
    const en = enItem("OpenAI launches a brand new model today", "A new model is out. Review pricing now.");
    const ko = koItem("국내 의료 인공지능 도입이 병원 곳곳으로 확산된다", "도입이 확산된다. 보안 점검 필요.");
    const r = await ingestPayloads([en, ko]);
    check("혼합 inserted 2", r.inserted, 2);
    check("첫 번째 처리 = 한글 항목", r.items[0].sourceUrl, ko.sourceUrl);
    check("한글 항목 gate=false", r.items[0].gate, false);
    check("두 번째 처리 = 영문 항목", r.items[1].sourceUrl, en.sourceUrl);
    check("영문 항목 gate=true", r.items[1].gate, true);
    check("영문 항목 상태 inserted", r.items[1].status, "inserted");
    resetLlmContext();
  }

  // ---------- 게이트 keep=false → rejected ----------
  {
    resetLlmContext();
    stubFetch(() => jsonOk({ ...FACT_JSON, keep: false }));
    const en = enItem("Some minor startup tidbit spreads online", "Minor news. Nothing to do.");
    const r = await ingestPayloads([en]);
    check("keep=false rejected", r.rejected, 1);
    check("keep=false inserted 0", r.inserted, 0);
    check("keep=false deferred 0", r.deferred, 0);
    check("keep=false skipped 하위호환 1", r.skipped, 1);
    resetLlmContext();
  }

  // ---------- 게이트 LLM 실패 → deferred (재시도 대상) ----------
  {
    resetLlmContext();
    stubFetch(() => httpFail());
    const en = enItem("Major cloud outage hits AI services globally", "Outage ongoing. Check status now.");
    const r = await ingestPayloads([en]);
    check("LLM 실패 deferred", r.deferred, 1);
    check("LLM 실패 inserted 0", r.inserted, 0);
    check("LLM 실패 skipped 0 (미처리는 탈락이 아님)", r.skipped, 0);
    check("LLM 실패 상태", r.items[0].status, "deferred");
    resetLlmContext();
  }

  // ---------- 게이트 품질 보류(원문 대조 위반) → rejected 종결 (P3-2) ----------
  // LLM 실패 보류(위 케이스, deferred)와 대조: 사실 카드·원문에 없는 수치를
  // 데스크가 지어낸 경우 — 재시도해도 판정이 안 바뀌는 확정적 품질 탈락이다.
  {
    resetLlmContext();
    let n = 0;
    const WRITE_FABRICATED = {
      title: "국내 연구진이 새로운 배터리 기술을 전기차에 적용했다",
      takeaway: "성능이 기존보다 3배 좋아졌다. 도입 검토 필요.",
      summary: "배터리 기술 요약 본문이다.",
      usedNames: [] as string[],
    };
    stubFetch(() => {
      n += 1;
      return n === 1 ? jsonOk(FACT_JSON) : jsonOk(WRITE_FABRICATED);
    });
    const en = enItem("Startup unveils new battery technology for EVs", "New battery tech was unveiled. Details inside.");
    const r = await ingestPayloads([en]);
    check("품질 보류 rejected", r.rejected, 1);
    check("품질 보류 deferred 0 (큐에 남기지 않음)", r.deferred, 0);
    check("품질 보류 inserted 0", r.inserted, 0);
    check("품질 보류 skipped 하위호환 1", r.skipped, 1);
    check("품질 보류 상태", r.items[0].status, "rejected");
    resetLlmContext();
  }

  // ---------- 데드라인: 느린 LLM 체인이 60초가 아니라 마감에서 끊긴다 ----------
  {
    resetLlmContext();
    stubFetch((_url, opts) => hangUntilAbort(opts));
    const en1 = enItem("First English story about AI chips", "Chips are coming. Watch supply closely.");
    const en2 = enItem("Second English story about AI robots", "Robots advance. Review roadmap today.");
    const ko = koItem("국내 우주 발사체 시험 발사가 성공적으로 끝났다", "시험이 성공했다. 후속 일정 주시.");
    const t0 = Date.now();
    const r = await ingestPayloads([en1, en2, ko], { llmDeadlineMs: 2500, finishStopMs: 4500 });
    const elapsed = Date.now() - t0;
    const byUrl = new Map(r.items.map((i) => [i.sourceUrl, i.status]));
    check("데드라인: 한글은 삽입", byUrl.get(ko.sourceUrl), "inserted");
    check("데드라인: 영문1 deferred", byUrl.get(en1.sourceUrl), "deferred");
    check("데드라인: 영문2 deferred", byUrl.get(en2.sourceUrl), "deferred");
    check("데드라인: 전체 15초 미만 종료", elapsed < 15000, true);
    check("데드라인: deferred 집계 2", r.deferred, 2);
    resetLlmContext();
  }

  // ---------- 종료 중단 지점 경과 → 전부 deferred ----------
  {
    resetLlmContext();
    stubFetch(() => httpFail());
    const a = koItem("국내 교육 현장에 인공지능 보조교사 도입이 논의된다", "논의가 진행된다. 의견 수렴 필요.");
    const b = koItem("인기 영화 속편의 개봉 일정이 공식 확정됐다", "일정이 확정됐다. 예매 일정 확인 권장.");
    const r = await ingestPayloads([a, b], { llmDeadlineMs: 47000, finishStopMs: 0 });
    check("종료 중단: inserted 0", r.inserted, 0);
    check("종료 중단: 전부 deferred", r.deferred, 2);
    resetLlmContext();
  }

  // ---------- 상한 초과분은 deferred로 알린다 ----------
  {
    resetLlmContext();
    stubFetch(() => httpFail());
    const titles: [string, string][] = [
      ["양자컴퓨터 상용화 로드맵이 새롭게 발표됐다", "로드맵이 나왔다. 기술 동향 주시."],
      ["도심 항공 모빌리티 시범 운행이 다음 달 시작된다", "시범 운행이 시작된다. 노선 확인 필요."],
      ["해상 풍력 단지 추가 건설 계획이 확정됐다", "계획이 확정됐다. 일정 점검 권장."],
      ["국산 백신 임상 3상 결과가 국제 학술지에 실렸다", "결과가 발표됐다. 효능 데이터 검토 필요."],
      ["프로축구 겨울 이적시장 주요 계약이 잇달아 발표됐다", "계약이 발표됐다. 전력 변화 주시."],
      ["지역 축제 일정과 프로그램이 공식 공개됐다", "일정이 공개됐다. 방문 계획 검토 권장."],
      ["심해 탐사 로봇이 새로운 해저 지형 촬영에 성공했다", "촬영에 성공했다. 연구 결과 주시."],
      ["초등학교 코딩 교육 의무화 방안이 발표됐다", "방안이 발표됐다. 교육과정 확인 필요."],
      ["전통시장 디지털 결제 도입률이 절반을 넘었다", "도입률이 올랐다. 가맹 현황 점검 권장."],
      ["국립공원 탐방 예약 방식이 전면 개편된다", "방식이 바뀐다. 예약 절차 확인 필요."],
      ["인공위성 군집 운용 기술 검증이 완료됐다", "검증이 끝났다. 후속 발사 일정 주시."],
    ];
    const items = titles.map(([t, tk]) => koItem(t, tk));
    const r = await ingestPayloads(items);
    check("상한: inserted 10", r.inserted, 10);
    check("상한: 초과 1건 deferred", r.deferred, 1);
    check("상한: 항목 결과 11건", r.items.length, 11);
    resetLlmContext();
  }

  // ---------- 잘못된 항목(제목 없음) → rejected ----------
  {
    resetLlmContext();
    stubFetch(() => httpFail());
    const bad = koItem("", "제목이 없는 항목이다. 확인 필요.");
    const r = await ingestPayloads([bad]);
    check("무효 항목 rejected", r.rejected, 1);
    resetLlmContext();
  }

  // ---------- 제목 필드 자체가 없는/null인 항목 → 배치 500이 아니라 rejected (리뷰 P2-1) ----------
  {
    resetLlmContext();
    stubFetch(() => httpFail());
    const missing = koItem("정상 한글 제목의 기사입니다", "정상이다. 확인 필요.");
    delete (missing as Partial<IngestPayload>).title;
    const nulled = koItem("다른 정상 한글 제목의 기사", "정상이다. 확인 필요.");
    nulled.title = null as unknown as string;
    const okItem = koItem("세 번째 정상 한글 제목의 기사", "정상이다. 확인 필요.");
    const r = await ingestPayloads([missing, nulled, okItem]);
    check("제목 결손: 배치 전체가 죽지 않음", r.items.length, 3);
    check("제목 결손 2건 rejected", r.rejected, 2);
    check("제목 결손: 정상 항목은 삽입", r.inserted, 1);
    resetLlmContext();
  }

  // ---------- 문맥 격리 (리뷰 P1-1 회귀 방지): ingest의 데드라인 문맥이
  // 바깥(collect 등)의 문맥을 덮거나 새지 않는다 ----------
  {
    resetLlmContext();
    stubFetch(() => httpFail());
    const outer = createLlmDeadline(Date.now() + 600000);
    setLlmDeadline(outer);
    const ko = koItem("국내 철도 신규 노선 개통 일정이 최종 확정됐다", "일정이 확정됐다. 운행 시간 확인 필요.");
    const r = await ingestPayloads([ko]);
    check("격리: ingest 자체는 정상 삽입", r.inserted, 1);
    check("격리: 바깥 문맥이 그대로 보존됨", getLlmDeadline() === outer, true);
    resetLlmContext();
    check("격리: 정리 후 문맥 없음", getLlmDeadline() === null, true);
  }

  // ---------- 동시 실행 격리: 짧은 마감의 ingest가 옆 ingest에 영향을 주지 않는다 ----------
  {
    resetLlmContext();
    stubFetch((_url, opts) => hangUntilAbort(opts));
    const en = enItem("Concurrent English story about AI safety", "Safety work grows. Track updates closely.");
    const ko = koItem("국내 항만 자동화 설비 도입이 단계적으로 추진된다", "도입이 추진된다. 운영 일정 점검 권장.");
    const [rEn, rKo] = await Promise.all([
      ingestPayloads([en], { llmDeadlineMs: 300, finishStopMs: 5000 }),
      ingestPayloads([ko], { llmDeadlineMs: 60000, finishStopMs: 5000 }),
    ]);
    check("동시: 짧은 마감 쪽 영문 deferred", rEn.items[0].status, "deferred");
    check("동시: 옆 회차 한글 inserted", rKo.items[0].status, "inserted");
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
