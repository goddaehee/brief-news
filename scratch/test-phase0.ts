// Phase 0 계측 테스트 — 단계별 카운터(newCollectStats)와 keep 탈락 사유(keepDropReason)
// 판정 순서·기존 keepEntry 동작과의 동등성을 고정한다. collectOnce 자체는 DB가
// 필요해 단위 테스트 대상이 아니며, 카운터 항등식은 프로덕션 실측으로 검증한다.
import { keepDropReason, newCollectStats } from "../src/lib/news/collect";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} => ${JSON.stringify(actual)}${ok ? "" : ` (기대 ${JSON.stringify(expected)})`}`);
}

type E = Parameters<typeof keepDropReason>[0];
const entry = (partial: Partial<E>): E => ({
  title: "",
  sourceUrl: "https://example.com/a",
  source: "기타",
  date: Date.now(),
  summary: "",
  ...partial,
});

// --- newCollectStats: 전 필드 0 초기화 + JSON 왕복 ---
const stats = newCollectStats();
const KEYS = [
  "rawFetched", "dropSkipHint", "dropVendorStory", "dropSecHint", "dropNoAiSignal",
  "dropUrlDup", "kept", "dropAlreadyInDb", "dropSourceCap", "dropBatchSourceCap",
  "dropSimilar", "dropBatchMax", "batch", "dropKeepFalse", "dropNewCap", "dropInsertFail",
  // Phase 2 후속 (p2f-1): keptNew·드레인·슬롯 카운터 추가
  "keptNew", "drainCandidates", "drainBatch", "drainInserted",
  "tipSlotBatch", "tipSlotInserted", "lowFreqBatch", "lowFreqInserted", "generalWaitlist",
  // Codex 재리뷰 반영: 배치 상한 탈락 카운터
  "dropBatchFull",
];
check("카운터 키 26개", Object.keys(stats).sort(), [...KEYS].sort());
check("카운터 전부 0", KEYS.every((k) => (stats as unknown as Record<string, number>)[k] === 0), true);
check("카운터 JSON 왕복", JSON.parse(JSON.stringify(stats)), stats);
// 독립 인스턴스 (공유 참조 아님)
const stats2 = newCollectStats();
stats2.rawFetched = 5;
check("인스턴스 독립", newCollectStats().rawFetched, 0);

// --- keepDropReason: 사유별 판정 (판정 순서 고정) ---
// skipHint: SKIP_HINT(만찬)가 제목에 있으면 최우선 탈락
check("skipHint 만찬", keepDropReason(entry({ title: "대통령, AI 기업인 만찬 참석" })), "skipHint");
// skipHint: 요약에 공시가 있어도 탈락
check("skipHint 요약 공시", keepDropReason(entry({ title: "오픈AI 협력 발표", summary: "유상증자 공시 내용 포함" })), "skipHint");
// vendorStory: 벤더 소스 + "How [타사] ..." 고객 사례 제목
check("vendorStory How 패턴", keepDropReason(entry({ source: "OpenAI", title: "How Acme Corp uses AI to cut support costs" })), "vendorStory");
// vendorStory: 벤더 소스 + 파트너십 홍보
check("vendorStory 파트너십", keepDropReason(entry({ source: "NVIDIA", title: "노르딕, 엔비디아 손잡고 유럽 AI 컴퓨팅 허브 구축" })), "vendorStory");
// vendorStory는 벤더 소스일 때만 — 일반 소스의 How 제목은 통과 경로로
check("일반 소스 How 제목 통과", keepDropReason(entry({ source: "TechCrunch", title: "How AI startups are changing hiring" })), null);
// secHint: 보안 소스(secTitleHint)인데 제목에 AI 신호 없음
check("secHint Laravel", keepDropReason(entry({ secTitleHint: true, title: "Critical Laravel flaw enables remote code execution" })), "secHint");
// secHint 통과: MCP·Claude 신호가 있으면 keep 판정으로 진행해 통과
check("secHint 통과 MCP", keepDropReason(entry({ secTitleHint: true, title: "Malicious MCP server steals Claude tokens" })), null);
// noAiSignal: AI 신호가 제목+요약 어디에도 없음
check("noAiSignal 일반 기사", keepDropReason(entry({ title: "지역 축제 일정 안내와 주차 정보 정리", summary: "주말 행사 안내" })), "noAiSignal");
// titleMustMatch 소스는 제목만으로 판정 — 요약에만 AI가 있으면 탈락
check("titleMustMatch 요약 전용 신호 탈락", keepDropReason(entry({ titleMustMatch: true, title: "반도체 수출 통계 발표", summary: "AI 수요 증가가 견인" })), "noAiSignal");
check("titleMustMatch 제목 신호 통과", keepDropReason(entry({ titleMustMatch: true, title: "AI 반도체 수출 급증", summary: "통계 발표" })), null);
// 정상 통과: 한글 AI 기사
check("정상 통과", keepDropReason(entry({ title: "오픈AI, 신규 모델 정식 출시", summary: "새 모델 공개" })), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
