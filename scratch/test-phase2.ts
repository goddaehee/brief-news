// Phase 2 과제 1 (신규 삽입 정지 해소) 단위 테스트.
// 메모리 모드(DATABASE_URL 없음)에서 검증한다:
//  (a) 250건 삽입 시 listNews()는 200건 창, listAllSourceUrls()는 전체 250건
//  (b) insertItem 중복 URL 시 false
//  (c) listAllSourceUrls는 삭제된 항목의 URL을 포함하지 않음
// DATABASE_URL이 ambient 환경에 있어도 메모리 모드를 강제하기 위해
// repo를 동적 import 하기 전에 환경변수를 지운다.
import type { IngestPayload } from "../src/lib/news/types";

delete process.env.DATABASE_URL;

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} => ${JSON.stringify(actual)}${ok ? "" : ` (기대 ${JSON.stringify(expected)})`}`);
}

const BASE = 1_700_000_000_000;
const urlOf = (i: number) => `https://example.com/phase2/${i}`;
const payload = (i: number): IngestPayload => ({
  title: `Phase2 기사 ${i}`,
  takeaway: `Phase2 시사점 ${i}. 확인 필요.`,
  summary: `Phase2 요약 ${i}`,
  source: "Phase2Test",
  sourceUrl: urlOf(i),
  originalTitle: `Phase2 기사 ${i}`,
  grade: "note",
  tip: false,
  topics: [],
  publishedAt: BASE + i * 1000,
});

async function main() {
  const { deleteItem, insertItem, listAllSourceUrls, listNews } = await import(
    "../src/lib/news/repo"
  );

  // ---------- (a) 250건 삽입: listNews 200건 창 vs listAllSourceUrls 전체 ----------
  let insertedCount = 0;
  for (let i = 0; i < 250; i++) {
    if (await insertItem(payload(i))) insertedCount++;
  }
  check("250건 삽입 전부 성공", insertedCount, 250);

  const news = await listNews();
  check("listNews()는 200건 창", news.length, 200);

  const allUrls = await listAllSourceUrls();
  check("listAllSourceUrls()는 전체 250건", allUrls.length, 250);
  check(
    "listAllSourceUrls()가 삽입한 URL 전체와 일치",
    [...allUrls].sort(),
    Array.from({ length: 250 }, (_, i) => urlOf(i)).sort(),
  );
  // 200건 창 밖(가장 오래된 50건)의 URL도 전체 조회에는 포함된다 — 이번 수정의 핵심.
  check(
    "창 밖(최고령) URL도 전체 조회에 포함",
    allUrls.includes(urlOf(0)) && allUrls.includes(urlOf(49)),
    true,
  );

  // ---------- (b) insertItem 중복 URL 시 false ----------
  check("중복 URL insertItem → false", await insertItem(payload(123)), false);
  check("중복 삽입 후 전체 URL 수 불변", (await listAllSourceUrls()).length, 250);

  // ---------- (c) 삭제된 항목의 URL은 전체 조회에서 제외 ----------
  const target = news.find((i) => i.sourceUrl === urlOf(249));
  check("삭제 대상(최신 건)이 200건 창 안에 있음", Boolean(target), true);
  check("deleteItem 성공", target ? await deleteItem(target.id) : false, true);
  const afterDelete = await listAllSourceUrls();
  check("삭제 후 전체 URL 수 249건", afterDelete.length, 249);
  check("삭제된 URL은 전체 조회에 없음", afterDelete.includes(urlOf(249)), false);
  check("다른 URL은 삭제 후에도 유지", afterDelete.includes(urlOf(248)), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
