/**
 * gemini.ts
 * ---------
 * Shared Gemini settings for the server routes (/api/process-claim and
 * /api/cline-audit). Server-only: reads secrets from process.env.
 */

import type { ContentListUnion, GenerateContentConfig, GenerateContentResponse, GoogleGenAI } from '@google/genai'

// Same default as /api/process-claim (slvrora verified gemini-3.6-flash); override via GEMINI_MODEL.
export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash'

/**
 * Models tried, in order, when the primary model is overloaded (503) or
 * rate-limited (429). Override with a comma-separated GEMINI_FALLBACK_MODELS.
 */
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.5-flash,gemini-flash-latest')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean)

/** Returns the configured API key, or null when it is missing or still the placeholder. */
export function getGeminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY
  return key && key !== 'your-api-key-here' ? key : null
}

/** Transient errors worth retrying: overloaded, rate-limited, or internal errors. */
function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /"code":\s*(429|500|503)|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded/i.test(msg)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * generateContent with resilience: each model gets up to 2 attempts with a
 * short backoff on transient errors, then the next fallback model is tried.
 * Non-transient errors (bad request, invalid key) fail immediately.
 * `timeoutMs` applies per attempt.
 */
export async function generateWithFallback(
  ai: GoogleGenAI,
  contents: ContentListUnion,
  config: GenerateContentConfig,
  timeoutMs: number,
): Promise<{ response: GenerateContentResponse; model: string }> {
  const models = [GEMINI_MODEL, ...FALLBACK_MODELS.filter((m) => m !== GEMINI_MODEL)]
  let lastError: unknown
  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: { ...config, abortSignal: AbortSignal.timeout(timeoutMs) },
        })
        return { response, model }
      } catch (err) {
        lastError = err
        if (!isTransient(err)) throw err
        console.warn(`[gemini] ${model} attempt ${attempt} failed (transient): ${String((err as Error)?.message ?? err).slice(0, 120)}`)
        if (attempt === 1) await sleep(800)
      }
    }
  }
  throw lastError
}
