import { TOPIC_MAP } from "./topics";
import type { Grade, IngestPayload } from "./types";

const GRADES = new Set<Grade>(["breaking", "important", "note"]);

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseYamlish(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = unquote(line.slice(i + 1));
  }
  return out;
}

function asGrade(v: string | undefined): Grade {
  const g = (v ?? "note").trim() as Grade;
  return GRADES.has(g) ? g : "note";
}

function asTopics(v: string | undefined): string[] {
  if (!v) return [];
  const inner = v.replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(/[,\s]+/)
    .map((s) => s.replace(/^#/, "").trim())
    .filter((s) => s && TOPIC_MAP[s]);
}

function asBool(v: string | undefined): boolean {
  return v === "true" || v === "yes" || v === "1";
}

/**
 * Markdown ingest contract:
 *
 * ---
 * title: 한국어 헤드라인
 * grade: breaking | important | note
 * tip: false
 * source: TechCrunch
 * source_url: https://...
 * original_title: Original headline
 * topics: openai, agent
 * published: 2026-09-15T14:00:00+09:00
 * ---
 *
 * 한 줄 시사점
 *
 * ## 요약
 *
 * 본문 요약
 */
export function parseNewsMarkdown(raw: string): IngestPayload {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  let fm: Record<string, string> = {};
  let body = trimmed;
  if (trimmed.startsWith("---")) {
    const end = trimmed.indexOf("\n---", 3);
    if (end > 0) {
      fm = parseYamlish(trimmed.slice(3, end));
      body = trimmed.slice(end + 4).trim();
    }
  }

  const parts = body.split(/^##\s*요약\s*$/m);
  const takeaway = (parts[0] ?? "").replace(/^#\s+.+\n*/, "").trim();
  const summary = (parts[1] ?? takeaway).trim();
  const published = fm.published || fm.published_at || fm.date;
  const publishedAt = published ? Date.parse(published) : undefined;

  const title = (fm.title || "").trim();
  const sourceUrl = (fm.source_url || fm.url || "").trim();
  if (!title) throw new Error("markdown: title required");
  if (!sourceUrl) throw new Error("markdown: source_url required");

  return {
    title,
    takeaway: takeaway || title,
    summary: summary || takeaway || title,
    source: (fm.source || "Web").trim(),
    sourceUrl,
    originalTitle: (fm.original_title || title).trim(),
    grade: asGrade(fm.grade),
    tip: asBool(fm.tip),
    topics: asTopics(fm.topics),
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined,
  };
}

/**
 * RSS/Atom 본문을 바이트에서 문자열로. 국내 매체 일부는 EUC-KR/CP949.
 * Content-Type charset과 XML declaration encoding을 본다.
 */
export function decodeFeedBytes(buf: Uint8Array, contentType = ""): string {
  const head = new TextDecoder("latin1").decode(buf.subarray(0, 512));
  const fromHeader = /charset\s*=\s*["']?([A-Za-z0-9._-]+)/i.exec(contentType)?.[1];
  const fromXml = /encoding\s*=\s*["']?\s*([A-Za-z0-9._-]+)/i.exec(head)?.[1];
  const raw = (fromHeader || fromXml || "utf-8").toLowerCase().replace(/_/g, "-");
  const label =
    raw === "euc-kr" ||
    raw === "ks-c-5601-1987" ||
    raw === "ksc5601" ||
    raw === "cp949" ||
    raw === "windows-949"
      ? "euc-kr"
      : "utf-8";
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

const AMP = "\u0026";
const LT = "\u003c";
const GT = "\u003e";
const QUOT = "\u0022";
const APOS = "\u0027";

export function decodeXml(s: string): string {
  const entLt = new RegExp("\u0026lt;", "g");
  const entGt = new RegExp("\u0026gt;", "g");
  const entQuot = new RegExp("\u0026quot;", "g");
  const entNumApos = new RegExp("\u0026#39;", "g");
  const entApos = new RegExp("\u0026apos;", "g");
  const entAmp = new RegExp("\u0026amp;", "g");
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(entLt, LT)
    .replace(entGt, GT)
    .replace(entQuot, QUOT)
    .replace(entNumApos, APOS)
    .replace(entApos, APOS)
    .replace(entAmp, AMP)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(chunk: string, name: string): string {
  const cdata = chunk.match(
    new RegExp(`<${name}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${name}>`, "i"),
  );
  if (cdata?.[1]) return decodeXml(cdata[1]);
  const plain = chunk.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return plain?.[1] ? decodeXml(plain[1]) : "";
}

export type RssEntry = {
  title: string;
  link: string;
  date: number;
  summary: string;
};

export function parseFeedXml(xml: string, fallbackSource: string): RssEntry[] {
  const entries: RssEntry[] = [];
  const itemChunks = xml.split(/<item[\s>]/i).slice(1);
  const atomChunks = itemChunks.length ? [] : xml.split(/<entry[\s>]/i).slice(1);
  const chunks = itemChunks.length ? itemChunks : atomChunks;

  for (const chunk of chunks) {
    const title = tag(chunk, "title");
    let link = tag(chunk, "link");
    if (!link) {
      const href = chunk.match(/<link[^>]+href=["']([^"']+)["']/i);
      link = href?.[1] ?? "";
    }
    if (!link) link = tag(chunk, "guid");
    if (!title || !link) continue;
    const dateRaw =
      tag(chunk, "pubDate") || tag(chunk, "published") || tag(chunk, "updated") || "";
    const parsed = Date.parse(dateRaw);
    const summary =
      tag(chunk, "description") || tag(chunk, "summary") || tag(chunk, "content") || title;
    entries.push({
      title,
      link: link.trim(),
      date: Number.isFinite(parsed) ? parsed : Date.now(),
      summary: summary.slice(0, 800),
    });
    if (entries.length >= 20) break;
  }
  void fallbackSource;
  return entries;
}
