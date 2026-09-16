import { ensureSeeded, listNews } from "@/lib/news/repo";
import type { NewsItem } from "@/lib/news/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AMP = "\u0026amp;";
const LT = "\u0026lt;";
const GT = "\u0026gt;";
const QUOT = "\u0026quot;";

function xml(value: string): string {
  return value.replace(/&/g, AMP).replace(/</g, LT).replace(/>/g, GT).replace(/"/g, QUOT);
}

function publicOrigin(request: Request): string {
  const xfHost = request.headers.get("x-forwarded-host");
  const host = (xfHost || request.headers.get("host") || "").split(",")[0].trim();
  const proto = request.headers.get("x-forwarded-proto") || "http";
  if (host && !host.startsWith("0.0.0.0") && !host.startsWith("[::]")) {
    const safe = host.replace(/^127\.0\.0\.1/, "localhost");
    return `${proto}://${safe}`;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:8080";
}

function buildRss(origin: string, items: NewsItem[]): string {
  const latest = items[0]?.publishedAt ?? Date.now();
  const entries = items
    .map((item) => {
      const link = `${origin}/item/${item.id}`;
      const grade = item.grade === "breaking" ? "속보" : item.grade === "important" ? "중요" : "참고";
      const title = `[${grade}]${item.tip ? "[팁]" : ""} ${item.title}`;
      const desc = `${item.takeaway} (출처: ${item.source})`;
      return `    <item>
      <title>${xml(title)}</title>
      <link>${xml(link)}</link>
      <guid isPermaLink="true">${xml(link)}</guid>
      <pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>
      <description>${xml(desc)}</description>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>brief_ — 실시간 AI 뉴스</title>
    <link>${xml(origin)}</link>
    <atom:link href="${xml(`${origin}/rss.xml`)}" rel="self" type="application/rss+xml"/>
    <description>한국 AI 실무자를 위한 실시간 AI 업계 뉴스. 15분마다 자동 수집, 중요도 분류·한국어 요약 제공.</description>
    <language>ko</language>
    <lastBuildDate>${new Date(latest).toUTCString()}</lastBuildDate>
${entries}
  </channel>
</rss>
`;
}

export async function GET(request: Request) {
  await ensureSeeded();
  const items = await listNews();
  const origin = publicOrigin(request);
  return new Response(buildRss(origin, items.slice(0, 40)), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=180",
    },
  });
}
