import { ingestMarkdownBatch, ingestPayloads } from "@/lib/news/collect";
import { INGEST_MAX_BATCH } from "@/lib/news/sources";
import type { IngestPayload } from "@/lib/news/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    items?: IngestPayload[];
    markdown?: string;
    files?: string[];
  };
  if (Array.isArray(body.files) && body.files.length) {
    const result = await ingestMarkdownBatch(body.files.slice(0, INGEST_MAX_BATCH));
    return Response.json(result);
  }
  if (typeof body.markdown === "string") {
    const result = await ingestMarkdownBatch([body.markdown]);
    return Response.json(result);
  }
  if (Array.isArray(body.items) && body.items.length) {
    const result = await ingestPayloads(body.items.slice(0, INGEST_MAX_BATCH));
    return Response.json(result);
  }
  return Response.json(
    { error: "Send { items: [...] } or { markdown } or { files: ['---\\n...'] }" },
    { status: 400 },
  );
}
