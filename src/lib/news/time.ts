const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstDateKey(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

export function formatClock(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatKstLong(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ap = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${y}. ${mo}. ${day}. ${ap} ${h12}:${m} KST`;
}

export function formatRelative(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}

export function todayLabel(ms: number, now = Date.now()): "오늘" | "어제" | string {
  const today = kstDateKey(now);
  const key = kstDateKey(ms);
  if (key === today) return "오늘";
  const yest = kstDateKey(now - 24 * 60 * 60 * 1000);
  if (key === yest) return "어제";
  return key;
}
