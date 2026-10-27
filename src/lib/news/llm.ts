/**
 * OpenAI-compatible chat. One key is enough.
 *
 * Priority:
 *   1. LLM_API_KEY  (+ optional LLM_BASE_URL / LLM_MODEL)
 *   2. XAI_API_KEY  → https://api.x.ai/v1  grok-4.5
 *   3. GLM_API_KEY or ZAI_API_KEY → https://api.z.ai/api/paas/v4  glm-5.3
 *
 * GLM 중국 엔드포인트는 LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
 * OpenRouter 등은 LLM_BASE_URL + LLM_MODEL 만 맞추면 된다.
 *
 * glm-5.x 는 thinking 을 끌 수 없다. reasoning_effort=low 로 수집 지연을 막는다.
 */

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: "xai" | "glm" | "openai-compat";
};

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function providerFromBase(base: string): LlmConfig["provider"] {
  if (/z\.ai|bigmodel\.cn/i.test(base)) return "glm";
  if (/x\.ai/i.test(base)) return "xai";
  return "openai-compat";
}

function defaultModel(provider: LlmConfig["provider"]): string {
  if (provider === "glm") return "glm-5.3";
  if (provider === "xai") return "grok-4.5";
  return "gpt-4.1-mini";
}

export function resolveLlm(): LlmConfig | null {
  const llmKey = process.env.LLM_API_KEY?.trim();
  const xaiKey = process.env.XAI_API_KEY?.trim();
  const glmKey = process.env.GLM_API_KEY?.trim() || process.env.ZAI_API_KEY?.trim();
  const baseOverride = process.env.LLM_BASE_URL?.trim();
  const modelOverride = process.env.LLM_MODEL?.trim();

  if (llmKey) {
    const looksGlm = /glm/i.test(modelOverride || "") || (baseOverride ? providerFromBase(baseOverride) === "glm" : false);
    const base = trimSlash(baseOverride || (looksGlm ? "https://api.z.ai/api/paas/v4" : "https://api.x.ai/v1"));
    const provider = providerFromBase(base);
    return {
      apiKey: llmKey,
      baseUrl: base,
      model: modelOverride || defaultModel(provider),
      provider,
    };
  }

  if (xaiKey) {
    const base = trimSlash(baseOverride || "https://api.x.ai/v1");
    return {
      apiKey: xaiKey,
      baseUrl: base,
      model: modelOverride || "grok-4.5",
      provider: providerFromBase(base),
    };
  }

  if (glmKey) {
    const base = trimSlash(baseOverride || "https://api.z.ai/api/paas/v4");
    return {
      apiKey: glmKey,
      baseUrl: base,
      model: modelOverride || "glm-5.3",
      provider: "glm",
    };
  }

  return null;
}

function isGlm5(model: string): boolean {
  return /^glm-5/i.test(model);
}

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * S2 계측 (관찰 전용): 수집 회차의 LLM 호출 계측 문맥.
 * chatJson은 호출 횟수·최장 단일 호출 시간을 여기에 누적만 한다 (동작 불변).
 * AsyncLocalStorage로 실행 문맥에 묶는다 — 동시 실행되는 /api/ingest 경로의
 * 호출이 수집 회차 계측에 섞이지 않는다 (Codex 리뷰 반영).
 * 문맥이 없으면 아무것도 하지 않는다.
 */
export type LlmCallMetrics = { calls: number; maxMs: number };
const llmMetricsStorage = new AsyncLocalStorage<LlmCallMetrics | null>();
export function setLlmMetricsSink(sink: LlmCallMetrics | null): void {
  llmMetricsStorage.enterWith(sink);
}

export async function chatJson(args: {
  system: string;
  user: string;
}): Promise<Record<string, unknown> | null> {
  const cfg = resolveLlm();
  if (!cfg) return null;

  const startedAt = Date.now();
  try {
    return await chatJsonWithConfig(cfg, args);
  } finally {
    const sink = llmMetricsStorage.getStore();
    if (sink) {
      sink.calls += 1;
      const ms = Date.now() - startedAt;
      if (ms > sink.maxMs) sink.maxMs = ms;
    }
  }
}

async function chatJsonWithConfig(
  cfg: LlmConfig,
  args: { system: string; user: string },
): Promise<Record<string, unknown> | null> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: 700,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  };
  if (cfg.provider === "glm") {
    if (isGlm5(cfg.model)) {
      body.thinking = { type: "enabled" };
      body.reasoning_effort = "low";
    } else {
      body.thinking = { type: "disabled" };
    }
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    return extractJson(text);
  } catch {
    return null;
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
