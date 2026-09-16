import type { MetadataRoute } from "next";
import { ensureSeeded, listNews } from "@/lib/news/repo";
import { realFeedItems } from "@/lib/news/data";
import { TOPICS } from "@/lib/news/topics";

export const dynamic = "force-dynamic";

function origin(): string {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:8080";
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await ensureSeeded();
  const items = realFeedItems(await listNews());
  const base = origin();
  const staticPaths = ["", "/about", "/terms", "/privacy", "/advertise", "/rss.xml"];
  const now = new Date();
  return [
    ...staticPaths.map((path) => ({
      url: `${base}${path || "/"}`,
      lastModified: now,
      changeFrequency: "hourly" as const,
      priority: path === "" ? 1 : 0.4,
    })),
    ...TOPICS.map((t) => ({
      url: `${base}/topic/${t.slug}`,
      lastModified: now,
      changeFrequency: "hourly" as const,
      priority: 0.5,
    })),
    ...items.slice(0, 200).map((item) => ({
      url: `${base}/item/${item.id}`,
      lastModified: new Date(item.publishedAt),
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ];
}
