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
import type { LlmCallLogEntry } from "./types";

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

/** B1: 단일 호출 타임아웃 캡 (25초 — 확정안. 최적값 재결정은 표본 200건 이후). */
export const LLM_CALL_CAP_MS = 25000;

/**
 * B1: 2단계 데드라인의 LLM 문맥. 수집 회차가 진입 시점에 만들어 ALS로 건다.
 * - deadlineAt: 이 시각이 지나면 LLM 작업을 시작하지 않고, 진행 중 호출은
 *   controller.abort()로 fetch까지 실제로 취소한다 (Promise.race만으로는
 *   소켓이 남는다 — 확정안 합의).
 * - calls: 호출별 지연·적용 타임아웃·결과 사유 기록 (체크포인트에 동봉).
 * 문맥이 없으면(ingest 경로 등) chatJson은 기존 동작 그대로다.
 */
export type LlmDeadlineContext = {
  deadlineAt: number;
  controller: AbortController;
  calls: LlmCallLogEntry[];
};
const llmDeadlineStorage = new AsyncLocalStorage<LlmDeadlineContext | null>();
export function createLlmDeadline(deadlineAt: number): LlmDeadlineContext {
  return { deadlineAt, controller: new AbortController(), calls: [] };
}
export function setLlmDeadline(ctx: LlmDeadlineContext | null): void {
  llmDeadlineStorage.enterWith(ctx);
}
export function getLlmDeadline(): LlmDeadlineContext | null {
  return llmDeadlineStorage.getStore() ?? null;
}
/** 데드라인 문맥 상태 스냅샷. 문맥이 없으면 null (게이트·실패 분류용). */
export function llmDeadlineState(): { remainingMs: number; aborted: boolean } | null {
  const dl = llmDeadlineStorage.getStore();
  if (!dl) return null;
  return { remainingMs: dl.deadlineAt - Date.now(), aborted: dl.controller.signal.aborted };
}

/** B1: 호출 라벨 (기사 해시·패스). 체인이 자기 비동기 문맥 안에서만 갱신한다. */
const llmLabelStorage = new AsyncLocalStorage<{ key?: string; pass?: string } | null>();
export function setLlmCallLabel(label: { key?: string; pass?: string } | null): void {
  llmLabelStorage.enterWith(label);
}
export function updateLlmCallPass(pass: string): void {
  const label = llmLabelStorage.getStore();
  if (label) label.pass = pass;
}

/** B1: 호출별 유효 타임아웃 = min(캡 25초, 데드라인 잔여). 순수 함수 (테스트용). */
export function effectiveCallTimeoutMs(now: number, deadlineAt: number | null): number {
  if (deadlineAt == null) return LLM_CALL_CAP_MS;
  return Math.max(0, Math.min(LLM_CALL_CAP_MS, deadlineAt - now));
}

/** B1: 호출 결과 분류 (순수 함수 — 테스트용). */
export function classifyCallOutcome(args: {
  hasData: boolean;
  deadlineAborted: boolean;
  timedOut: boolean;
}): LlmCallLogEntry["outcome"] {
  if (args.hasData) return "ok";
  if (args.deadlineAborted) return "aborted";
  if (args.timedOut) return "timeout";
  return "empty";
}

export async function chatJson(args: {
  system: string;
  user: string;
}): Promise<Record<string, unknown> | null> {
  const cfg = resolveLlm();
  if (!cfg) return null;

  const dl = llmDeadlineStorage.getStore() ?? null;
  const label = llmLabelStorage.getStore() ?? null;
  const startedAt = Date.now();
  const timeoutMs = effectiveCallTimeoutMs(startedAt, dl ? dl.deadlineAt : null);
  let outcome: LlmCallLogEntry["outcome"] = "empty";
  try {
    if (dl && timeoutMs <= 0) {
      // 마감 경과 — 호출 자체를 시작하지 않는다.
      outcome = "deadline";
      return null;
    }
    const r = await chatJsonWithConfig(cfg, args, dl, timeoutMs);
    outcome = r.outcome;
    return r.data;
  } finally {
    const ms = Date.now() - startedAt;
    const sink = llmMetricsStorage.getStore();
    if (sink) {
      sink.calls += 1;
      if (ms > sink.maxMs) sink.maxMs = ms;
    }
    if (dl) {
      dl.calls.push({
        key: label?.key,
        pass: label?.pass,
        ms: outcome === "deadline" ? 0 : ms,
        timeoutMs,
        outcome,
      });
    }
  }
}

async function chatJsonWithConfig(
  cfg: LlmConfig,
  args: { system: string; user: string },
  dl: LlmDeadlineContext | null,
  timeoutMs: number,
): Promise<{ data: Record<string, unknown> | null; outcome: LlmCallLogEntry["outcome"] }> {
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

  // 유효 타임아웃 타이머 + 데드라인 abort를 한 신호로 합친다. 데드라인
  // abort가 오면 진행 중 fetch가 실제로 취소된다 (B1 확정안).
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, timeoutMs);
  const onDeadlineAbort = () => ctl.abort();
  if (dl) {
    if (dl.controller.signal.aborted) ctl.abort();
    else dl.controller.signal.addEventListener("abort", onDeadlineAbort, { once: true });
  }
  const outcomeOf = (data: Record<string, unknown> | null) =>
    classifyCallOutcome({
      hasData: data != null,
      deadlineAborted: Boolean(dl?.controller.signal.aborted),
      timedOut,
    });
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) return { data: null, outcome: outcomeOf(null) };
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    const data = extractJson(text);
    return { data, outcome: outcomeOf(data) };
  } catch {
    return { data: null, outcome: outcomeOf(null) };
  } finally {
    clearTimeout(timer);
    if (dl) dl.controller.signal.removeEventListener("abort", onDeadlineAbort);
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
