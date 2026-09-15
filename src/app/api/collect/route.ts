import { collectOnce } from "@/lib/news/collect";
import { lastRunAt } from "@/lib/news/repo";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.COLLECT_SECRET?.trim();
  if (!secret) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, status: "error", note: "unauthorized" }, { status: 401 });
  }
  const last = await lastRunAt();
  return Response.json({
    ok: true,
    status: "idle",
    fetched: 0,
    inserted: 0,
    skipped: 0,
    note: "수집은 POST /api/collect 만 실행합니다. GET은 마지막 수집 시각만 돌려 줍니다.",
    lastRunAt: last,
  });
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, status: "error", note: "unauthorized" }, { status: 401 });
  }
  const result = await collectOnce();
  const status = result.status === "error" ? 500 : 200;
  return Response.json(result, { status });
}
