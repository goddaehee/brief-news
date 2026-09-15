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

function buildRss(origin: string, items: NewsItem[]): string {
  const latest = items[0]?.publishedAt ?? Date.now();
  const entries = items
    .map((item) => {
      const link = `${origin}/item/${item.id}`;
      return `    <item>
      <title>${xml(item.title)}</title>
      <link>${xml(link)}</link>
      <guid isPermaLink="false">${xml(item.id)}</guid>
      <pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>
      <source url="${xml(item.sourceUrl)}">${xml(item.source)}</source>
      <description>${xml(item.takeaway)}</description>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>brief_ — 실시간 AI 뉴스</title>
    <link>${xml(origin)}</link>
    <description>한국 AI 실무자를 위한 속보·중요·참고 피드</description>
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
  const origin = new URL(request.url).origin;
  return new Response(buildRss(origin, items.slice(0, 40)), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=180",
    },
  });
}
