// 프로덕션 루프 1라운드 (2026-11-10) 단위 테스트 — C1 차등 소스캡 ·
// C2 이벤트 fast-track · C3 드레인 최신순 · C4 tooSimilar 날짜 가드 ·
// C6 팁 동적 태깅. collect.ts의 순수 함수만 정적 import 한다
// (모듈 평가 시점에는 DB를 건드리지 않으므로 순서가 안전하다).
import {
  byDrainRecency,
  capBypassDecision,
  drainRemainingAllowance,
  EVENT_HINT,
  isTipTitle,
  newCollectStats,
  sourceCapForRank,
  tooSimilar,
} from "../src/lib/news/collect";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} => ${JSON.stringify(actual)}${ok ? "" : ` (기대 ${JSON.stringify(expected)})`}`);
}

const H = 3600 * 1000;
const now = Date.now();

// ---------- C1: sourceCapForRank 경계값 ----------
check("캡 rank 12 → 12", sourceCapForRank(12), 12);
check("캡 rank 10 → 12 (경계)", sourceCapForRank(10), 12);
check("캡 rank 9 → 8 (경계)", sourceCapForRank(9), 8);
check("캡 rank 8 → 8 (경계)", sourceCapForRank(8), 8);
check("캡 rank 7 → 6 (경계)", sourceCapForRank(7), 6);
check("캡 rank 6 → 6 (경계)", sourceCapForRank(6), 6);
check("캡 rank 5 → 4 (경계)", sourceCapForRank(5), 4);
check("캡 rank 1 → 4", sourceCapForRank(1), 4);
check("캡 rank 0 → 4", sourceCapForRank(0), 4);
check("캡 rank 미상(undefined) → 6", sourceCapForRank(undefined), 6);
check("캡 rank 미상(null) → 6", sourceCapForRank(null), 6);

// ---------- C1: drainRemainingAllowance baseCap 일반화 ----------
// 기본값 6 하위호환은 test-phase2f가 고정한다. 여기서는 차등 캡 기준.
check("drain baseCap 12: 12건 → 2", drainRemainingAllowance(12, 12), 2);
check("drain baseCap 12: 13건 → 1", drainRemainingAllowance(13, 12), 1);
check("drain baseCap 12: 14건 → 0", drainRemainingAllowance(14, 12), 0);
check("drain baseCap 12: 20건 → 0", drainRemainingAllowance(20, 12), 0);
check("drain baseCap 8: 9건 → 1", drainRemainingAllowance(9, 8), 1);
check("drain baseCap 4: 4건 → 2", drainRemainingAllowance(4, 4), 2);
check("drain baseCap 4: 5건 → 1", drainRemainingAllowance(5, 4), 1);
check("drain 기본값 명시 6과 동일", drainRemainingAllowance(7), drainRemainingAllowance(7, 6));

// ---------- C2: EVENT_HINT + capBypassDecision ----------
check("힌트 출시", EVENT_HINT.test("오픈AI, 신규 모델 출시"), true);
check("힌트 IPO (대소문자 무관)", EVENT_HINT.test("OpenAI, ipo 추진 보도"), true);
check("힌트 서비스 종료 (공백 허용)", EVENT_HINT.test("구글, 해당 서비스 종료 안내"), true);
check("힌트 없음", EVENT_HINT.test("오픈AI, 연구 논문 발표"), false);

// 캡 도달 + 힌트 있음 → pass (배치캡 여유 있을 때)
check(
  "fast-track 캡+힌트 → pass",
  capBypassDecision("cap", "오픈AI, 신규 모델 출시", 0, 4),
  "pass",
);
check(
  "fast-track 캡+힌트+배치 3/4 → pass",
  capBypassDecision("cap", "엔비디아 주가 급락", 3, 4),
  "pass",
);
// 캡 도달 + 힌트 없음 → cap 유지
check(
  "fast-track 캡+힌트 없음 → cap",
  capBypassDecision("cap", "오픈AI, 연구 논문 발표", 0, 4),
  "cap",
);
// 캡 도달 + 힌트 있으나 배치캡 도달 → batchCap 유지
check(
  "fast-track 캡+힌트+배치캡 도달 → batchCap",
  capBypassDecision("cap", "오픈AI, 신규 모델 출시", 4, 4),
  "batchCap",
);
// cap이 아닌 판정은 힌트와 무관하게 그대로 (inDb·batchCap은 우회 대상 아님)
check(
  "fast-track inDb는 우회 안 함",
  capBypassDecision("inDb", "오픈AI, 신규 모델 출시", 0, 4),
  "inDb",
);
check(
  "fast-track batchCap은 우회 안 함",
  capBypassDecision("batchCap", "오픈AI, 신규 모델 출시", 0, 4),
  "batchCap",
);
check(
  "fast-track pass는 그대로",
  capBypassDecision("pass", "오픈AI, 연구 논문 발표", 0, 4),
  "pass",
);

// ---------- C2: fastTrackBatch 카운터 0 초기화 ----------
check("stats fastTrackBatch 0", newCollectStats().fastTrackBatch, 0);

// ---------- C3: 드레인 최신순 정렬 ----------
{
  const rows = [{ date: 100 }, { date: 300 }, { date: 200 }, { date: 300 }];
  const sorted = [...rows].sort(byDrainRecency).map((r) => r.date);
  check("drain 최신순 정렬", sorted, [300, 300, 200, 100]);
  check("drain 비교자 최신이 앞 (음수)", byDrainRecency({ date: 500 }, { date: 100 }) < 0, true);
  check("drain 비교자 동률은 0", byDrainRecency({ date: 100 }, { date: 100 }), 0);
}

// ---------- C4: tooSimilar 72h 날짜 가드 ----------
// 부분문자열로 잡히는 쌍 (fold 후 완전 일치는 아님 — 한쪽이 다른 쪽을 포함).
const SIM_A = "오픈AI, 신규 AI 모델 'GPT-5' 공개";
const SIM_B = "오픈AI, 신규 AI 모델 GPT-5 공개 발표";
check("유사 쌍 72h 이내 → true", tooSimilar(SIM_A, SIM_B, now, now + 1 * H), true);
check("유사 쌍 정확히 72h → true (초과만 차단)", tooSimilar(SIM_A, SIM_B, now, now + 72 * H), true);
check("유사 쌍 4일 차 → false (날짜 가드)", tooSimilar(SIM_A, SIM_B, now, now + 4 * 24 * H), false);
check("유사 쌍 과거 방향 4일 차 → false", tooSimilar(SIM_A, SIM_B, now + 4 * 24 * H, now), false);
check("유사 쌍 날짜 미상 → 기존 판정 유지 (true)", tooSimilar(SIM_A, SIM_B), true);
check("유사 쌍 한쪽 날짜만 미상 → 기존 판정 유지 (true)", tooSimilar(SIM_A, SIM_B, now, undefined), true);
// 명세 C4의 배치 고정: 날짜 가드는 정확 일치(fa===fb) "이후"에 적용되므로
// fold 후 완전 일치 제목은 날짜와 무관하게 true가 유지된다.
check(
  "완전 일치 제목 4일 차 → true (가드는 정확 일치 이후)",
  tooSimilar(SIM_A, SIM_A, now, now + 4 * 24 * H),
  true,
);
// 무관한 쌍은 날짜와 무관하게 false
check(
  "무관한 쌍 → false",
  tooSimilar("오픈AI, 신규 모델 공개", "삼성전자, 반도체 공장 증설", now, now),
  false,
);

// ---------- C6: isTipTitle 표본 ----------
check("팁 오픈소스+가이드", isTipTitle("오픈소스 LLM 로컬 실행 가이드"), true);
check("팁 프롬프트+치트시트", isTipTitle("챗GPT 프롬프트 치트시트 공개"), true);
check("팁 무료 모델", isTipTitle("메타, 무료 모델 라마 4 공개"), true);
check("팁 무료 공개", isTipTitle("미스트랄, 소형 모델 무료 공개"), true);
check("팁 사용법", isTipTitle("Claude Code 사용법 총정리"), true);
check("팁 설정법", isTipTitle("로컬 LLM 설정법 — Ollama 편"), true);
check("팁 how to (영문)", isTipTitle("How to fine-tune an LLM locally"), true);
check("팁 tutorial (영문)", isTipTitle("RAG Tutorial for Beginners"), true);
check("팁 cookbook (영문)", isTipTitle("LLM Cookbook: 레시피 모음"), true);
check("팁 아님 일반 출시", isTipTitle("오픈AI, 신규 모델 출시"), false);
check("팁 아님 가격 인하", isTipTitle("구글, 제미나이 가격 인하 단행"), false);
check("팁 아님 투자 발표", isTipTitle("메타, 대규모 데이터센터 투자 발표"), false);
check("팁 아님 논문", isTipTitle("앤트로픽, 정렬 연구 논문 발표"), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
