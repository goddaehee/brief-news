import type { Topic } from "./types";

export const TOPICS: Topic[] = [
  { slug: "agent", label: "AI 에이전트" },
  { slug: "research", label: "연구" },
  { slug: "open-source", label: "오픈소스" },
  { slug: "openai", label: "OpenAI" },
  { slug: "anthropic", label: "Anthropic" },
  { slug: "claude", label: "Claude" },
  { slug: "hardware", label: "하드웨어" },
  { slug: "benchmark", label: "벤치마크" },
  { slug: "prompt", label: "프롬프트" },
  { slug: "korea-ai", label: "한국 AI" },
  { slug: "security", label: "보안" },
  { slug: "claude-code", label: "Claude Code" },
  { slug: "local-llm", label: "로컬 LLM" },
  { slug: "regulation", label: "규제·정책" },
  { slug: "google", label: "Google" },
  { slug: "xai", label: "xAI" },
];

export const TOPIC_MAP = Object.fromEntries(TOPICS.map((t) => [t.slug, t]));
