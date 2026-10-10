import type { ClaimAnalysis, ClaimGps } from './types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function safeParseGeminiJson(raw: string): unknown | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(text) as unknown } catch {
    const start = text.indexOf('{'), end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try { return JSON.parse(text.slice(start, end + 1)) as unknown } catch { return null }
  }
}

export function validCoordinates(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
}

export const unavailableGps: ClaimGps = {
  lat: null, lng: null, source: 'fallback', label: 'Location not available / not verified',
}

export function normalizeAnalysis(parsed: unknown): ClaimAnalysis {
  const data = isRecord(parsed) ? parsed : {}
  const warnings: string[] = []
  const text = (key: string, fallback = 'N/A', max = 6000): string => {
    const value = data[key]
    if (typeof value !== 'string' || !value.trim()) {
      warnings.push(`${key}: unavailable; default used.`)
      return fallback
    }
    if (value.length > max) warnings.push(`${key}: shortened for this draft.`)
    return value.trim().slice(0, max)
  }
  const numeric = (key: string, max: number): number => {
    const raw = data[key]
    const value = typeof raw === 'number' ? raw :
      typeof raw === 'string' && raw.trim() ? Number(raw.trim().replace(/%$/, '')) : NaN
    if (!Number.isFinite(value)) {
      warnings.push(`${key}: unknown; 0 is a placeholder, not a verified estimate.`)
      return 0
    }
    const bounded = Math.min(max, Math.max(0, value))
    if (bounded !== value) warnings.push(`${key}: adjusted to the allowed range.`)
    return bounded
  }
  const damage_pct = numeric('damage_pct', 100)
  const hours_elapsed = numeric('hours_elapsed', Number.MAX_SAFE_INTEGER)
  const transcript_original = text('transcript_original')
  const transcript_en = text('transcript_en')
  const crop_type = text('crop_type', 'N/A', 120)
  const damage_cause = text('damage_cause', 'N/A', 160)
  let summary_hi = text('summary_hi', `फसल को लगभग ${damage_pct}% नुकसान हुआ है। यह अनुमान है, कृपया जाँच करें।`)
  let summary_en = text('summary_en', `Estimated crop damage is approximately ${damage_pct}%. Please verify this estimate.`)
  // Model output must never claim that preparing a draft files an insurance claim.
  const statusClaim = /\b(filed|submitted|registered|recorded|approved)\b|दर्ज|जमा|स्वीकृत|पंजीकृत/i
  if (/[a-z]/i.test(summary_hi) || !/[\u0900-\u097f]/.test(summary_hi) || statusClaim.test(summary_hi)) {
    summary_hi = `फसल को लगभग ${damage_pct}% नुकसान हुआ है। यह अनुमान है, कृपया जाँच करें।`
    warnings.push('summary_hi: replaced with a safe Hindi estimate.')
  }
  if (statusClaim.test(summary_en)) {
    summary_en = `Estimated crop damage is approximately ${damage_pct}%. Please verify this estimate.`
    warnings.push('summary_en: replaced with a draft-only estimate.')
  }
  return { transcript_original, transcript_en, crop_type, damage_pct, damage_cause,
    hours_elapsed, summary_hi, summary_en, warnings, gps: { ...unavailableGps }, photo_timestamp: null }
}

/** EXIF wall-clock dates without an offset are interpreted as India time, not server time. */
export function photoTimestamp(value: unknown, offset: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return null
  const [, y, m, d, h, min, s] = match
  const wall = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s)))
  if (wall.getUTCFullYear() !== Number(y) || wall.getUTCMonth() + 1 !== Number(m) ||
      wall.getUTCDate() !== Number(d) || Number(h) > 23 || Number(min) > 59 || Number(s) > 59) return null
  const zone = typeof offset === 'string' && /^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset) ? offset : '+05:30'
  const date = new Date(`${y}-${m}-${d}T${h}:${min}:${s}${zone}`)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}