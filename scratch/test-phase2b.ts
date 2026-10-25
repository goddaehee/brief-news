// Phase 2 과제 3 (소스 추가 + 조건부 GET) 단위 테스트.
// 메모리 모드(DATABASE_URL 없음)에서 검증한다:
//  (a) feed_cache 라운드트립 (get 빈 값 → set → get)
//  (b) 신규 소스 등록·플래그 (METR/Alignment Forum/Socket/Aikido/GitHub Changelog)
//  (c) fetchSourceEntries 조건부 GET: 200+ETag → 다음 호출 If-None-Match → 304면 0건,
//      ETag가 바뀌면 새 본문 수신
import { createServer } from "node:http";
import type { NewsSource } from "../src/lib/news/sources";

delete process.env.DATABASE_URL;

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} => ${JSON.stringify(actual)}${ok ? "" : ` (기대 ${JSON.stringify(expected)})`}`);
}

const RSS_V1 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>t</title>
<item><title>Test AI model release one</title><link>https://example.com/etag/1</link><pubDate>Sat, 25 Oct 2026 01:00:00 GMT</pubDate><description>AI model release summary</description></item>
</channel></rss>`;
const RSS_V2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>t</title>
<item><title>Test AI model release two</title><link>https://example.com/etag/2</link><pubDate>Sat, 25 Oct 2026 02:00:00 GMT</pubDate><description>AI model release summary</description></item>
</channel></rss>`;

async function main() {
  const repo = await import("../src/lib/news/repo");
  const sources = await import("../src/lib/news/sources");
  const collect = await import("../src/lib/news/collect");

  // ---------- (a) feed_cache 라운드트립 ----------
  check("캐시 없는 소스는 빈 객체", await repo.getFeedCache("nope"), {});
  await repo.setFeedCache("unit-test", { etag: '"abc"', lastModified: "Sat, 25 Oct 2026 00:00:00 GMT" });
  const roundtrip = await repo.getFeedCache("unit-test");
  check(
    "set 후 get 라운드트립 (etag/lastModified)",
    [roundtrip.etag, roundtrip.lastModified],
    ['"abc"', "Sat, 25 Oct 2026 00:00:00 GMT"],
  );
  check("set 후 updatedAt 기록됨", typeof roundtrip.updatedAt, "number");

  // ---------- (b) 신규 소스 등록 ----------
  const byId = new Map(sources.NEWS_SOURCES.map((s) => [s.id, s]));
  check("METR 등록", byId.get("metr")?.rss, "https://metr.org/feed.xml");
  check("METR rank 8", sources.SOURCE_RANK["METR"], 8);
  check("Alignment Forum 등록", byId.get("alignmentforum")?.rss, "https://www.alignmentforum.org/feed.xml");
  check("Socket은 Atom + secTitleHint", [byId.get("socket")?.rss, byId.get("socket")?.secTitleHint], ["https://socket.dev/api/blog/feed.atom", true]);
  check("Aikido secTitleHint", byId.get("aikido")?.secTitleHint, true);
  check(
    "GitHub Changelog tipLane + secTitleHint",
    [byId.get("ghchangelog")?.tipLane, byId.get("ghchangelog")?.secTitleHint],
    [true, true],
  );
  check("Simon Willison tipLane", byId.get("simonw")?.tipLane, true);

  // ---------- (c) 조건부 GET 흐름 ----------
  let currentEtag = '"v1"';
  let currentBody = RSS_V1;
  let sawIfNoneMatch: string | undefined;
  const server = createServer((req, res) => {
    sawIfNoneMatch = req.headers["if-none-match"];
    if (sawIfNoneMatch && sawIfNoneMatch === currentEtag) {
      res.writeHead(304);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/rss+xml", ETag: currentEtag });
    res.end(currentBody);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const src: NewsSource = { id: "unit-etag", name: "UnitEtag", rss: `http://127.0.0.1:${port}/feed.xml`, rank: 1 };
  try {
    const first = await collect.fetchSourceEntries(src);
    check("1차 200 수신 → 1건 파싱", first.length, 1);
    check("1차 제목", first[0]?.title, "Test AI model release one");
    const second = await collect.fetchSourceEntries(src);
    check("2차는 If-None-Match 전송됨", sawIfNoneMatch, '"v1"');
    check("2차 304 → 저장본 재반환 1건", second.length, 1);
    check("2차 저장본 제목 유지", second[0]?.title, "Test AI model release one");
    currentEtag = '"v2"';
    currentBody = RSS_V2;
    const third = await collect.fetchSourceEntries(src);
    check("ETag 변경 후 200 → 새 본문 1건", third.length, 1);
    check("3차 제목은 새 본문", third[0]?.title, "Test AI model release two");
    const thirdB = await collect.fetchSourceEntries(src);
    check("교체 후 304 → 새 저장본 재반환", thirdB[0]?.title, "Test AI model release two");

    // ---------- (d) TTL 만료 시 조건부 헤더 미전송 (Codex P1 완화) ----------
    sawIfNoneMatch = undefined;
    await repo.setFeedCache("unit-etag", {
      etag: '"v2"',
      updatedAt: Date.now() - 7 * 3600 * 1000,
    });
    const fourth = await collect.fetchSourceEntries(src);
    check("TTL 만료 캐시는 If-None-Match 미전송", sawIfNoneMatch, undefined);
    check("TTL 만료 시 전량 수신 → 1건", fourth.length, 1);
  } finally {
    server.close();
  }

  // ---------- (e) 본문 전송 실패 시 캐시 미갱신 (Codex P1) ----------
  const broken = createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "application/rss+xml",
      ETag: '"b1"',
      "Content-Length": "100000",
    });
    res.write(RSS_V1.slice(0, 100));
    res.socket?.destroy();
  });
  await new Promise<void>((resolve) => broken.listen(0, "127.0.0.1", resolve));
  const bAddr = broken.address();
  const bPort = typeof bAddr === "object" && bAddr ? bAddr.port : 0;
  const bSrc: NewsSource = { id: "unit-broken", name: "UnitBroken", rss: `http://127.0.0.1:${bPort}/feed.xml`, rank: 1 };
  try {
    const got = await collect.fetchSourceEntries(bSrc);
    check("본문 절단 시 0건 (실패로 처리)", got.length, 0);
    const cacheAfter = await repo.getFeedCache("unit-broken");
    check("본문 절단 시 ETag 저장 안 됨", cacheAfter.etag, undefined);
  } finally {
    broken.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
