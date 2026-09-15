export type NewsSource = {
  id: string;
  name: string;
  rss: string;
};

/** Public RSS endpoints the collector pulls. The same list is what a cron hits. */
export const NEWS_SOURCES: NewsSource[] = [
  {
    id: "hn",
    name: "Hacker News",
    rss: "https://hnrss.org/newest?q=AI+OR+LLM+OR+GPT",
  },
  {
    id: "geeknews",
    name: "GeekNews",
    rss: "https://news.hada.io/rss",
  },
  {
    id: "aitimes",
    name: "AI타임스",
    rss: "https://www.aitimes.com/rss/allArticle.xml",
  },
  {
    id: "zdnet",
    name: "ZDNet Korea",
    rss: "https://www.zdnet.co.kr/feed",
  },
  {
    id: "etnews",
    name: "전자신문",
    rss: "https://rss.etnews.com/Section901.xml",
  },
  {
    id: "digitaltoday",
    name: "디지털투데이",
    rss: "https://www.digitaltoday.co.kr/rss/allArticle.xml",
  },
  {
    id: "techcrunch",
    name: "TechCrunch",
    rss: "https://techcrunch.com/category/artificial-intelligence/feed/",
  },
  {
    id: "verge",
    name: "The Verge",
    rss: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
  },
  {
    id: "ars",
    name: "Ars Technica",
    rss: "https://feeds.arstechnica.com/arstechnica/technology-lab",
  },
  {
    id: "wired",
    name: "WIRED",
    rss: "https://www.wired.com/feed/tag/ai/latest/rss",
  },
  {
    id: "openai",
    name: "OpenAI",
    rss: "https://openai.com/news/rss.xml",
  },
  {
    id: "google-ai",
    name: "Google AI",
    rss: "https://blog.google/technology/ai/rss/",
  },
  {
    id: "deepmind",
    name: "Google DeepMind",
    rss: "https://deepmind.google/blog/rss.xml",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    rss: "https://huggingface.co/blog/feed.xml",
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    rss: "https://blogs.nvidia.com/blog/category/generative-ai/feed/",
  },
  {
    id: "mittr",
    name: "MIT Tech Review",
    rss: "https://www.technologyreview.com/topic/artificial-intelligence/feed/",
  },
  {
    id: "simonw",
    name: "Simon Willison",
    rss: "https://simonwillison.net/atom.xml",
  },
  {
    id: "localllama",
    name: "r/LocalLLaMA",
    rss: "https://www.reddit.com/r/LocalLLaMA/.rss",
  },
  {
    id: "claudeai",
    name: "r/ClaudeAI",
    rss: "https://www.reddit.com/r/ClaudeAI/.rss",
  },
  {
    id: "mlreddit",
    name: "r/MachineLearning",
    rss: "https://www.reddit.com/r/MachineLearning/.rss",
  },
];

export const COLLECT_COOLDOWN_MS = 10 * 60 * 1000;
export const COLLECT_MAX_NEW = 6;
export const INGEST_MAX_BATCH = 10;
