// Phase 2 후속 (p2f-1) 단위 테스트 — 계측·드레인·슬롯·섀도.
// 메모리 모드(DATABASE_URL 없음)에서 검증한다. repo는 환경변수를 지운 뒤
// 동적 import 하며, desk/collect의 순수 함수는 정적 import 한다
// (모듈 평가 시점에는 DB를 건드리지 않으므로 순서가 안전하다).
import {
  assessShadow,
  decideGrade,
  factUser,
  parseFactCard,
} from "../src/lib/news/desk";
import {
  admissionCapDecision,
  byDeskPriority,
  drainRemainingAllowance,
  lowFreqCapReached,
  LOW_FREQ_SOURCE_IDS,
  newCollectStats,
} from "../src/lib/news/collect";
import type { FactCard } from "../src/lib/news/types";

delete process.env.DATABASE_URL;

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} => ${JSON.stringify(actual)}${ok ? "" : ` (기대 ${JSON.stringify(expected)})`}`);
}

const card = (partial: Partial<FactCard>): FactCard => ({
  status: "confirmed",
  entities: [],
  hangulForms: [],
  change: "",
  numbers: [],
  evidence: "원문 근거 구절",
  importance: 50,
  promotionReason: "",
  hardGate: null,
  immediate: false,
  tip: false,
  topics: [],
  ...partial,
});
const entry = () => ({
  title: "Example story",
  source: "TechCrunch",
  sourceUrl: "https://example.com/a",
  summary: "",
});

// ---------- newCollectStats: 신규 필드 0 초기화 ----------
{
  const s = newCollectStats();
  check("stats keptNew 0", s.keptNew, 0);
  check("stats drainBatch 0", s.drainBatch, 0);
  check("stats drainInserted 0", s.drainInserted, 0);
  check("stats tipSlotBatch 0", s.tipSlotBatch, 0);
  check("stats lowFreqBatch 0", s.lowFreqBatch, 0);
  check("stats generalWaitlist 0", s.generalWaitlist, 0);
  check("stats dropBatchMax 0", s.dropBatchMax, 0);
  check("stats dropBatchFull 0", s.dropBatchFull, 0);
}

// ---------- lowFreqCapReached: 전 레인 공유 상한 (Codex 재리뷰 P1-2) ----------
check("저빈도 상한 0/0 → false", lowFreqCapReached(0, 0), false);
check("저빈도 상한 1/0 → false", lowFreqCapReached(1, 0), false);
check("저빈도 상한 소스당 1 → true", lowFreqCapReached(1, 1), true);
check("저빈도 상한 합계 2 → true", lowFreqCapReached(2, 0), true);

// ---------- admissionCapDecision: 캡 우선순위 (Codex 3차 리뷰) ----------
// 저빈도 상한이 소스캡보다 앞선다 — 두 캡 동시 충족 시 batchCap 종결.
{
  const base = {
    inDb: false, sourceCount: 0, sourceCap: 6, batchCount: 0, batchSourceCap: 4,
    isLowFreq: false, lowFreqTotal: 0, lowFreqPerSource: 0,
  };
  check("입장캡 전부 통과 → pass", admissionCapDecision(base), "pass");
  check("입장캡 inDb 우선", admissionCapDecision({ ...base, inDb: true, sourceCount: 6 }), "inDb");
  check("입장캡 저빈도+소스캡 동시 → batchCap (핵심)",
    admissionCapDecision({ ...base, isLowFreq: true, lowFreqTotal: 1, lowFreqPerSource: 1, sourceCount: 6 }), "batchCap");
  check("입장캡 저빈도 상한 단독 → batchCap",
    admissionCapDecision({ ...base, isLowFreq: true, lowFreqTotal: 1, lowFreqPerSource: 1, sourceCount: 5 }), "batchCap");
  check("입장캡 저빈도 미도달+소스캡 → cap (풀행)",
    admissionCapDecision({ ...base, isLowFreq: true, lowFreqTotal: 0, lowFreqPerSource: 0, sourceCount: 6 }), "cap");
  check("입장캡 일반 소스캡 → cap",
    admissionCapDecision({ ...base, sourceCount: 6 }), "cap");
  check("입장캡 배치 소스캡 → batchCap",
    admissionCapDecision({ ...base, batchCount: 4 }), "batchCap");
}

// ---------- drainRemainingAllowance ----------
// 기본 캡 6 유지, 드레인으로 24h 합계 최대 8건 (추가 2건).
check("drain 허용량 0건 삽입 → 2", drainRemainingAllowance(0), 2);
check("drain 허용량 5건 삽입 → 2", drainRemainingAllowance(5), 2);
check("drain 허용량 6건 삽입 → 2", drainRemainingAllowance(6), 2);
check("drain 허용량 7건 삽입 → 1", drainRemainingAllowance(7), 1);
check("drain 허용량 8건 삽입 → 0", drainRemainingAllowance(8), 0);
check("drain 허용량 10건 삽입 → 0", drainRemainingAllowance(10), 0);

// ---------- 저빈도 소스 집합 ----------
check("저빈도 METR 포함", LOW_FREQ_SOURCE_IDS.has("metr"), true);
check("저빈도 Alignment Forum 포함", LOW_FREQ_SOURCE_IDS.has("alignmentforum"), true);
check("저빈도 일반 소스 제외", LOW_FREQ_SOURCE_IDS.has("geeknews"), false);

// ---------- byDeskPriority: 저빈도 신선도 6→48h ----------
{
  const now = Date.now();
  const h = 3600 * 1000;
  const raw = (sourceId: string, ageH: number, source: string) => ({
    title: "t", sourceUrl: `https://example.com/${sourceId}-${ageH}`,
    source, date: now - ageH * h, summary: "", sourceId,
  });
  // METR 30시간 전 기사 > 일반 30시간 전 기사 (일반은 6h 창 밖, METR은 48h 창 안)
  check(
    "METR 30h > 일반 30h",
    byDeskPriority(raw("metr", 30, "METR"), raw("geeknews", 30, "GeekNews")) < 0,
    true,
  );
  // METR 50시간 전 기사 < 일반 1시간 전 기사 (METR도 48h 창 밖)
  check(
    "METR 50h < 일반 1h",
    byDeskPriority(raw("metr", 50, "METR"), raw("geeknews", 1, "GeekNews")) > 0,
    true,
  );
  // sourceId 없는 구 페이로드도 기존 동작 유지 (6h 창)
  const legacy = (ageH: number) => ({
    title: "t", sourceUrl: `https://example.com/legacy-${ageH}`,
    source: "GeekNews", date: now - ageH * h, summary: "",
  });
  check("구 페이로드 1h > 30h", byDeskPriority(legacy(1), legacy(30)) < 0, true);
}

// ---------- parseFactCard: 섀도 필드 ----------
{
  const parsed = parseFactCard({
    status: "confirmed", importance: 80, eventType: "product",
    impactBasis: ["usability", "bogus", "cost"], evidence: "인용",
  });
  check("카드 eventType", parsed?.eventType, "product");
  check("카드 impactBasis 허용값만", parsed?.impactBasis, ["usability", "cost"]);
  check("카드 eventType 무효 → null",
    parseFactCard({ status: "confirmed", importance: 80, eventType: "whatever" })?.eventType, null);
  check("카드 섀도 필드 누락 → null/[]",
    [parseFactCard({ status: "confirmed", importance: 80 })?.eventType,
     parseFactCard({ status: "confirmed", importance: 80 })?.impactBasis],
    [null, []]);
  check("factUser 스키마 eventType 포함", factUser(entry()).includes("eventType"), true);
  check("factUser 스키마 impactBasis 포함", factUser(entry()).includes("impactBasis"), true);
}

// ---------- assessShadow: 승격 요건 ----------
{
  const title = "오픈AI, 내부 연구 조직 개편";
  const takeaway = "조직을 개편했다. 도입 영향 확인 필요.";
  const base = card({ importance: 80, eventType: "research", impactBasis: ["usability"], entities: ["OpenAI"] });
  const s = assessShadow(base, title, takeaway, "OpenAI restructures research org");
  check("섀도 연구+프런티어 티어 A", s.tier, "A");
  check("섀도 연구+프런티어 승격", [s.promotesA, s.promotesAB, s.shadowGrade], [true, true, "important"]);

  // GM 탑재 사례 (진단 §3.1): 랩 밖 제품 출시 → 티어 B, A만으로는 승격 안 됨.
  const gm = card({
    importance: 80, eventType: "product", impactBasis: ["supply"],
    entities: ["GM"], evidence: "GM announced OnStar AI",
  });
  const g = assessShadow(gm, "GM, 차량 음성 제어 탑재", "차량에 탑재했다. 도입 검토 필요.", "GM OnStar AI");
  check("섀도 랩 밖 제품 티어 B", g.tier, "B");
  check("섀도 티어 B는 A 승격 아님", [g.promotesA, g.promotesAB, g.shadowGrade], [false, true, "note"]);

  // hardGate분은 미러링.
  const h = assessShadow(card({ importance: 40, hardGate: "cve" }), "t", "t", "");
  check("섀도 hardGate 미러링", [h.promotesA, h.shadowGrade], [true, "important"]);

  // 요건 미달 케이스.
  check("섀도 69점 미달",
    assessShadow(card({ importance: 69, eventType: "product", impactBasis: ["cost"], entities: ["OpenAI"] }), title, takeaway, "").promotesA, false);
  check("섀도 영향 근거 없음",
    assessShadow(card({ importance: 80, eventType: "product", impactBasis: [], entities: ["OpenAI"] }), title, takeaway, "").promotesA, false);
  check("섀도 원문 근거 없음",
    assessShadow(card({ importance: 80, eventType: "product", impactBasis: ["cost"], evidence: "", entities: ["OpenAI"] }), title, takeaway, "").promotesA, false);
  check("섀도 사건 유형 없음",
    assessShadow(card({ importance: 80, eventType: null, impactBasis: ["cost"] }), title, takeaway, "").tier, "none");
  // NOTE_FORCE 강등 대상 (일본 지역 출시)은 섀도에서도 승격 안 됨.
  check("섀도 NOTE_FORCE 제외",
    assessShadow(
      card({ importance: 85, eventType: "product", impactBasis: ["usability"], entities: ["Meta"] }),
      "메타 AI 에이전트 일본 출시", "일본에 출시했다. 확인 필요.", "Meta AI agent Japan launch",
    ).promotesA, false);
}

// ---------- decideGrade는 섀도에 영향받지 않음 (핵심 불변식) ----------
{
  // 강한 신호 없음 + 섀도 승격 조건 충족 → 현행 등급은 참고, 섀도는 중요.
  const c = card({
    importance: 80, eventType: "research", impactBasis: ["usability"], entities: ["OpenAI"],
  });
  const title = "오픈AI, 내부 연구 조직 개편";
  const takeaway = "조직을 개편했다. 도입 영향 확인 필요.";
  check("decideGrade는 섀도 무시 (참고 유지)", decideGrade(c, title, takeaway, "OpenAI restructures research org"), "note");
  check("assessShadow는 중요 후보", assessShadow(c, title, takeaway, "OpenAI restructures research org").shadowGrade, "important");
}

// ---------- repo 메모리 경로: run 상세 + 원장 ----------
async function main() {
  const {
    beginRun, finishRun, listRuns,
    recordDropLedger, listDropLedger, pruneDropLedger, pruneOldRuns,
  } = await import("../src/lib/news/repo");

  const runId = await beginRun();
  await finishRun(runId, {
    status: "ok", fetched: 10, inserted: 2, skipped: 8, note: "p2f test",
    detail: {
      stats: { ...newCollectStats(), rawFetched: 10, drainBatch: 1 },
      bySource: { GeekNews: { fetched: 10, kept: 8, inDb: 2, cap: 1, batchCap: 0, similar: 0, batch: 2, scored: 2, inserted: 2, drain: 1 } },
      scored: [],
      ruleVersion: "p2f-1",
      model: "glm-5.3",
    },
  });
  const runs = await listRuns(5);
  const found = runs.find((r) => r.id === runId);
  check("run 상세 stats 저장", found?.stats?.drainBatch, 1);
  check("run 상세 bySource 저장", found?.bySource?.["GeekNews"]?.drain, 1);
  check("run 상세 ruleVersion 저장", found?.ruleVersion, "p2f-1");
  check("run 상세 model 저장", found?.model, "glm-5.3");

  // 원장 upsert: 같은 URL은 1행, seen_count 증가·last_stage 갱신.
  const row = {
    urlHash: "aabbccddeeff", titleHash: "112233445566", source: "GeekNews",
    sourceId: "geeknews", publishedAt: Date.now(), lastStage: "sourceCap" as const, similarId: null,
  };
  await recordDropLedger([row]);
  await recordDropLedger([{ ...row, lastStage: "similar" as const, similarId: "deadbeefcafe" }]);
  const ledger = await listDropLedger(10);
  const hit = ledger.find((r) => r.urlHash === "aabbccddeeff");
  check("원장 upsert 1행", ledger.filter((r) => r.urlHash === "aabbccddeeff").length, 1);
  check("원장 seen_count 증가", hit?.seenCount, 2);
  check("원장 last_stage 갱신", hit?.lastStage, "similar");
  check("원장 similar_id 갱신", hit?.similarId, "deadbeefcafe");

  // 같은 호출 안 중복 키는 마지막 행만 남고 seen_count는 1 증가 (Codex 재리뷰 P2-1).
  const dup = {
    urlHash: "001122334455", titleHash: "667788990011", source: "GeekNews",
    sourceId: "geeknews", publishedAt: Date.now(), lastStage: "sourceCap" as const, similarId: null,
  };
  await recordDropLedger([dup, { ...dup, lastStage: "batchFull" as const }]);
  const dupHit = (await listDropLedger(10)).find((r) => r.urlHash === "001122334455");
  check("원장 동일 호출 중복 1행", dupHit?.seenCount, 1);
  check("원장 동일 호출 중복 마지막 단계", dupHit?.lastStage, "batchFull");

  // 보존: 오래된 원장·런 정리. 미완료 run도 started_at 기준으로 정리 (Codex 재리뷰 P1-4).
  const runningId = await beginRun();
  await pruneDropLedger(Date.now() + 1000);
  check("원장 prune", (await listDropLedger(10)).find((r) => r.urlHash === "aabbccddeeff"), undefined);
  await pruneOldRuns(Date.now() + 1000);
  check("런 prune", (await listRuns(50)).find((r) => r.id === runId), undefined);
  check("미완료 런 prune", (await listRuns(50)).find((r) => r.id === runningId), undefined);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
