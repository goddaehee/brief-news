import { NextRequest, NextResponse } from "next/server";
import { ensureSeeded, getNewsById } from "@/lib/news/repo";

export async function GET(req: NextRequest) {
  const ids = req.nextUrl.searchParams.get("ids");
  if (!ids) {
    return NextResponse.json({ items: [] });
  }
  const idList = ids.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 100);
  try {
    await ensureSeeded();
  } catch {
    /* ignore */
  }
  const results = await Promise.all(
    idList.map(async (id) => {
      try {
        return await getNewsById(id);
      } catch {
        return undefined;
      }
    }),
  );
  const items = results.filter((x): x is NonNullable<typeof x> => Boolean(x));
  // 요청 순서 유지 (북마크 저장 순서대로)
  const order = new Map(idList.map((id, i) => [id, i]));
  items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return NextResponse.json({ items });
}
