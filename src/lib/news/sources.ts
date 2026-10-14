export type NewsSource = {
  id: string;
  name: string;
  rss: string;
  /** General-news wires. Only keep items whose TITLE looks like AI. */
  titleMustMatch?: boolean;
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
    rank: 8,
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
  { id: "simonw", name: "Simon Willison", rss: "https://simonwillison.net/atom/everything/", rank: 6 },
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
