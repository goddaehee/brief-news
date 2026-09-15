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
    id: "openai",
    name: "OpenAI",
    rss: "https://openai.com/blog/rss.xml",
  },
  {
    id: "google-ai",
    name: "Google AI",
    rss: "https://blog.google/technology/ai/rss/",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    rss: "https://huggingface.co/blog/feed.xml",
  },
  {
    id: "bloter",
    name: "Bloter",
    rss: "https://www.bloter.net/feed",
  },
  {
    id: "localllama",
    name: "r/LocalLLaMA",
    rss: "https://www.reddit.com/r/LocalLLaMA/.rss",
  },
];

export const COLLECT_COOLDOWN_MS = 10 * 60 * 1000;
export const COLLECT_MAX_NEW = 6;
export const INGEST_MAX_BATCH = 10;
