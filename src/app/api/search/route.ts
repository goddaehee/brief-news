import { searchNews, type SearchSort } from "@/lib/news/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRADES = new Set(["all", "breaking", "important", "note", "tip"]);
const SORTS = new Set(["new", "relevant"]);

/**
 * GET /api/search?q=검색어&grade=all|breaking|important|note|tip&sort=new|relevant&limit=20
 *
 * title / takeaway / summary 에서 대소문자 무시(ILIKE) 검색.
 * 응답: { items: NewsItem[], total: number, q: string }
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) {
      return Response.json({ error: "q 파라미터가 필요합니다." }, { status: 400 });
    }

    const grade = url.searchParams.get("grade") ?? "all";
    if (!GRADES.has(grade)) {
      return Response.json(
        { error: "grade는 all|breaking|important|note|tip 중 하나여야 합니다." },
        { status: 400 },
      );
    }

    const sortParam = url.searchParams.get("sort") ?? "new";
    if (!SORTS.has(sortParam)) {
      return Response.json(
        { error: "sort는 new|relevant 중 하나여야 합니다." },
        { status: 400 },
      );
    }
    const sort = sortParam as SearchSort;

    const limitRaw = Number(url.searchParams.get("limit") ?? 20);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.floor(limitRaw), 1), 50)
      : 20;

    const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
    const offset = Number.isFinite(offsetRaw) ? Math.max(Math.floor(offsetRaw), 0) : 0;

    const { items, total } = await searchNews(q, { grade, sort, limit, offset });
    return Response.json({ items, total, q, offset });
  } catch (err) {
    console.error("[api/search] failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "검색 중 오류가 발생했습니다." }, { status: 500 });
  }
}
