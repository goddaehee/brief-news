export type NewsSource = {
  id: string;
  name: string;
  rss: string;
  /** General-news wires. Only keep items whose TITLE looks like AI. */
  titleMustMatch?: boolean;
  /** Security wires (34차). Only keep items whose TITLE carries an AI/LLM
   * signal — blocks generic PHP/CVE noise while letting "LiteLLM"-class
   * supply-chain stories through (the title contains "LLM"). */
  secTitleHint?: boolean;
  /** Phase 2: 팁 전용 레인 소속 표시. [팁] 판정은 기존 데스크(Pass 1 tip
   * 필드)가 그대로 담당하고, 이 플래그는 레인 식별·계측용이다. 배치 예약
   * (선택 레인)은 팁 후보가 배치 경쟁에서 밀린다는 실측이 쌓이면 그때
   * 도입한다 (Phase 2 패널 종합: C 먼저, A는 병목 증거 후). */
  tipLane?: boolean;
  /** Higher = preferred when picking the 6 new slots. */
  rank?: number;
};

/** Public RSS endpoints the collector pulls. The same list is what a cron hits. */
export const NEWS_SOURCES: NewsSource[] = [
  { id: "hn", name: "Hacker News", rss: "https://hnrss.org/newest?q=AI+OR+LLM+OR+GPT", rank: 7 },
  { id: "geeknews", name: "GeekNews", rss: "https://news.hada.io/rss", rank: 8 },
  { id: "aitimes", name: "AI타임스", rss: "https://www.aitimes.com/rss/allArticle.xml", rank: 10 },
  {
    id: "aitimeskr",
    name: "인공지능신문",
    rss: "https://www.aitimes.kr/rss/allArticle.xml",
    rank: 6,
  },
  {
    id: "zdnet",
    name: "ZDNet Korea",
    rss: "https://www.zdnet.co.kr/feed",
    titleMustMatch: true,
    rank: 6,
  },
  {
    id: "etnews",
    name: "전자신문",
    rss: "https://rss.etnews.com/Section901.xml",
    titleMustMatch: true,
    rank: 7,
  },
  { id: "byline", name: "바이라인네트워크", rss: "https://byline.network/feed/", rank: 8 },
  {
    id: "techm",
    name: "테크M",
    rss: "https://www.techm.kr/rss/allArticle.xml",
    titleMustMatch: true,
    rank: 7,
  },
  {
    id: "thelec",
    name: "디일렉",
    rss: "https://www.thelec.kr/rss/allArticle.xml",
    titleMustMatch: true,
    rank: 6,
  },
  {
    id: "techcrunch",
    name: "TechCrunch",
    rss: "https://techcrunch.com/category/artificial-intelligence/feed/",
    rank: 7,
  },
  {
    id: "verge",
    name: "The Verge",
    rss: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    rank: 7,
  },
  {
    id: "ars",
    name: "Ars Technica",
    rss: "https://feeds.arstechnica.com/arstechnica/technology-lab",
    rank: 6,
  },
  { id: "wired", name: "WIRED", rss: "https://www.wired.com/feed/tag/ai/latest/rss", rank: 7 },
  { id: "openai", name: "OpenAI", rss: "https://openai.com/news/rss.xml", rank: 8 },
  { id: "google-ai", name: "Google AI", rss: "https://blog.google/technology/ai/rss/", rank: 8 },
  {
    id: "deepmind",
    name: "Google DeepMind",
    rss: "https://deepmind.google/blog/rss.xml",
    rank: 8,
  },
  { id: "huggingface", name: "Hugging Face", rss: "https://huggingface.co/blog/feed.xml", rank: 6 },
  {
    id: "nvidia",
    name: "NVIDIA",
    rss: "https://blogs.nvidia.com/blog/category/generative-ai/feed/",
    rank: 7,
  },
  {
    id: "mittr",
    name: "MIT Tech Review",
    rss: "https://www.technologyreview.com/topic/artificial-intelligence/feed/",
    rank: 7,
  },
  { id: "simonw", name: "Simon Willison", rss: "https://simonwillison.net/atom/everything/", rank: 6, tipLane: true },
  // 32차: 보안·공급망 전문매체 (31차 패널: LiteLLM·DaisyUI-MCP 같은 공급망
  // 악성코드 [중요]를 통째로 놓침). Reddit RSS는 서버 IP 403이라 우회 불가,
  // 이 두 매체가 같은 사건군을 가장 빨리 다룬다. 둘 다 실측 200 확인.
  { id: "bleeping", name: "BleepingComputer", rss: "https://www.bleepingcomputer.com/feed/", rank: 6, secTitleHint: true },
  { id: "thn", name: "The Hacker News", rss: "https://feeds.feedburner.com/TheHackersNews", rank: 6, secTitleHint: true },
  // Phase 2 (2026-10-25 실측·패널 토론): 1차 출처 직접 수집 — 35차 리플레이에서
  // (e) 네이티브로 확정된 누락군(METR·Redwood 등 연구기관 발표)의 원출처.
  // Redwood는 RSS 부재(8개 경로 404)로 채택 불가, HF Papers는 JSON API 전용이라
  // 현 수집기 미지원 — 둘 다 종료. Snyk는 1,677건 아카이브 피드라 보류
  // (해제 조건: 날짜 제한·이력 필터 + 다운로드 비용 제한이 갖춰질 때).
  // METR 피드는 4.1MB 전문 피드라 조건부 GET(feed_cache)이 함께 들어갔다.
  { id: "metr", name: "METR", rss: "https://metr.org/feed.xml", rank: 8 },
  { id: "alignmentforum", name: "Alignment Forum", rss: "https://www.alignmentforum.org/feed.xml", rank: 7 },
  // 보안 리서치 블로그: 공급망·AI 인접 보안은 제목 AI 신호가 있을 때만 (secTitleHint).
  { id: "socket", name: "Socket", rss: "https://socket.dev/api/blog/feed.atom", rank: 6, secTitleHint: true },
  { id: "aikido", name: "Aikido", rss: "https://www.aikido.dev/blog/rss.xml", rank: 6, secTitleHint: true },
  // 팁 레인: GitHub 제품 변경 공지 (8.1건/일 중 AI 신호 제목만 통과 — secTitleHint).
  { id: "ghchangelog", name: "GitHub Changelog", rss: "https://github.blog/changelog/feed/", rank: 5, secTitleHint: true, tipLane: true },
  // X (Twitter) via Nitter: DISABLED 2026-10-13 — both tested instances
  // (nitter.meowing.monster, nitter.kareem.one) serve 4-6 day old cached
  // posts, not real-time. Not usable for a real-time terminal.
  // Path forward: xAI API x_search (needs XAI_API_KEY with credits).
  // See: POST https://api.x.ai/v1/responses with tools:[{"type":"x_search"}]
  // { id: "x-openai", name: "X @OpenAI", rss: "https://nitter.meowing.monster/OpenAI/rss", rank: 8 },
  // { id: "x-anthropic", name: "X @AnthropicAI", rss: "https://nitter.meowing.monster/AnthropicAI/rss", rank: 8 },
  // { id: "x-xai", name: "X @xai", rss: "https://nitter.meowing.monster/xai/rss", rank: 8 },
  // { id: "x-deepmind", name: "X @GoogleDeepMind", rss: "https://nitter.meowing.monster/GoogleDeepMind/rss", rank: 8 },
  // { id: "x-rundown", name: "X @rowancheung", rss: "https://nitter.meowing.monster/rowancheung/rss", rank: 7 },
  // Reddit (.rss) returns 403 for server IPs — disabled until a bridge is set up.
  // { id: "localllama", name: "r/LocalLLaMA", rss: "https://www.reddit.com/r/LocalLLaMA/.rss", rank: 3 },
  // { id: "claudeai", name: "r/ClaudeAI", rss: "https://www.reddit.com/r/ClaudeAI/.rss", rank: 3 },
  // { id: "mlreddit", name: "r/MachineLearning", rss: "https://www.reddit.com/r/MachineLearning/.rss", rank: 2 },
];

export const SOURCE_RANK: Record<string, number> = Object.fromEntries(
  NEWS_SOURCES.map((s) => [s.name, s.rank ?? 1]),
);

export const COLLECT_COOLDOWN_MS = 10 * 60 * 1000;
export const COLLECT_MAX_NEW = 6;
export const COLLECT_REWRITE_MAX = 10;
export const INGEST_MAX_BATCH = 10;
