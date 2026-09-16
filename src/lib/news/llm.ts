/**
 * OpenAI-compatible chat. One key is enough.
 *
 * Priority:
 *   1. LLM_API_KEY  (+ optional LLM_BASE_URL / LLM_MODEL)
 *   2. XAI_API_KEY  → https://api.x.ai/v1  grok-4.5
 *   3. GLM_API_KEY or ZAI_API_KEY → https://api.z.ai/api/paas/v4  glm-4.5-flash
 *
 * GLM 중국 엔드포인트는 LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
 * OpenRouter 등은 LLM_BASE_URL + LLM_MODEL 만 맞추면 된다.
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
  if (provider === "glm") return "glm-4.5-flash";
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
      model: modelOverride || "glm-4.5-flash",
      provider: "glm",
    };
  }

  return null;
}

export async function chatJson(args: {
  system: string;
  user: string;
}): Promise<Record<string, unknown> | null> {
  const cfg = resolveLlm();
  if (!cfg) return null;

  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: 420,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  };
  if (cfg.provider === "glm") {
    body.thinking = { type: "disabled" };
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
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
