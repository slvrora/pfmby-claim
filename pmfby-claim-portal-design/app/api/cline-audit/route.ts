/**
 * POST /api/cline-audit
 * ---------------------
 * "Cline PMFBY Compliance Auditor": an autonomous compliance agent. It receives
 * a claim JSON (the /api/process-claim output plus GPS) and returns an audit
 * verdict. Every field comes from the input; nothing is hardcoded.
 *
 * Body (flat, or nested under `claim`):
 *   { transcript, translation, crop, calamity, damage_pct, hours_ago, summary,
 *     gps: { lat, lng } | null }
 */

import { GoogleGenAI, Type } from '@google/genai'
import { generateWithFallback, getGeminiApiKey } from '@/lib/gemini'
import {
  INTIMATION_WINDOW_HOURS,
  findCoveredCalamity,
  findEligibleCrop,
  isFallbackLocation,
} from '@/lib/pmfbyRules'

export const runtime = 'nodejs'

type CheckStatus = 'pass' | 'warn' | 'fail'
type CheckName = 'WINDOW' | 'CROP' | 'CALAMITY' | 'GPS' | 'CONSISTENCY'

interface AuditCheck {
  name: CheckName
  status: CheckStatus
  detail: string
}

/**
 * Accepts the ClaimAnalysis shape from /api/process-claim (lib/types.ts):
 * crop_type, damage_cause, hours_elapsed, transcript_en, damage_pct,
 * gps { lat, lng, source, label }, warnings. The older names (crop, calamity,
 * hours_ago, translation) are still accepted as aliases.
 */
interface ClaimInput {
  transcript_en?: unknown
  crop_type?: unknown
  damage_cause?: unknown
  hours_elapsed?: unknown
  translation?: unknown
  crop?: unknown
  calamity?: unknown
  hours_ago?: unknown
  damage_pct?: unknown
  gps?: unknown
  warnings?: unknown
}

/** True when normalizeAnalysis() flagged this field as unknown (0 is a placeholder). */
function flaggedUnknown(warnings: unknown, field: string): boolean {
  return Array.isArray(warnings) && warnings.some((w) => typeof w === 'string' && w.startsWith(`${field}:`) && /unknown|unavailable/i.test(w))
}

/**
 * Check weights for compliance_score (sum = 100). Hard eligibility rules weigh
 * the most. A "warn" earns half its weight, a "fail" earns none.
 */
const WEIGHTS: Record<CheckName, number> = {
  WINDOW: 30,
  CROP: 20,
  CALAMITY: 20,
  CONSISTENCY: 20,
  GPS: 10,
}
const STATUS_CREDIT: Record<CheckStatus, number> = { pass: 1, warn: 0.5, fail: 0 }

const STAMP_OK = 'Verified by Autonomous Cline Auditor'
const STAMP_FLAGGED = 'Flagged by Autonomous Cline Auditor - manual review required'
const GEMINI_TIMEOUT_MS = 20_000

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/* ------------------------------------------------------- rule-based checks */

function checkWindow(hoursAgo: unknown): AuditCheck {
  if (!isNum(hoursAgo) || hoursAgo < 0) {
    return { name: 'WINDOW', status: 'fail', detail: 'hours_ago missing or invalid, so the 72-hour window cannot be verified.' }
  }
  const hrs = Math.round(hoursAgo * 10) / 10
  return hoursAgo <= INTIMATION_WINDOW_HOURS
    ? { name: 'WINDOW', status: 'pass', detail: `Incident reported ${hrs} hrs ago (within the ${INTIMATION_WINDOW_HOURS}-hr intimation window).` }
    : { name: 'WINDOW', status: 'fail', detail: `Incident reported ${hrs} hrs ago (exceeds the ${INTIMATION_WINDOW_HOURS}-hr intimation window).` }
}

function checkCrop(crop: unknown): AuditCheck {
  if (!isText(crop)) return { name: 'CROP', status: 'fail', detail: 'Crop not provided.' }
  const rule = findEligibleCrop(crop)
  return rule
    ? { name: 'CROP', status: 'pass', detail: `"${crop}" matched eligible ${rule.season} crop: ${rule.name}.` }
    : { name: 'CROP', status: 'fail', detail: `"${crop}" is not on the notified Kharif/Rabi crop list.` }
}

function checkCalamity(calamity: unknown): AuditCheck {
  if (!isText(calamity)) return { name: 'CALAMITY', status: 'fail', detail: 'Calamity type not provided.' }
  const rule = findCoveredCalamity(calamity)
  return rule
    ? { name: 'CALAMITY', status: 'pass', detail: `"${calamity}" is a covered calamity (${rule.name}).` }
    : { name: 'CALAMITY', status: 'fail', detail: `"${calamity}" is not a covered calamity.` }
}

function checkGps(gps: unknown): AuditCheck {
  const g = gps as { lat?: unknown; lng?: unknown; source?: unknown } | null | undefined
  const lat = g?.lat
  const lng = g?.lng
  if (!isNum(lat) || !isNum(lng)) {
    return { name: 'GPS', status: 'fail', detail: 'GPS coordinates not available. Share your field location in Step 2.' }
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { name: 'GPS', status: 'fail', detail: `GPS coordinates out of range (${lat}, ${lng}).` }
  }
  const pin = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  if (g?.source === 'fallback' || isFallbackLocation(lat, lng)) {
    return { name: 'GPS', status: 'warn', detail: `Fallback location used (${pin}, approximate). The field location must be confirmed on site.` }
  }
  const from = g?.source === 'exif' ? 'photo EXIF' : g?.source === 'device' ? 'device location' : 'coordinates'
  return { name: 'GPS', status: 'pass', detail: `Field geotagged at ${pin} (${from}).` }
}

/* ------------------------------------------- Gemini consistency (2nd call) */

async function checkConsistency(translation: unknown, damagePct: unknown): Promise<AuditCheck> {
  // Missing inputs are data problems, so the check fails rather than warns.
  if (!isText(translation)) {
    return { name: 'CONSISTENCY', status: 'fail', detail: 'No English translation of the farmer statement to compare.' }
  }
  if (!isNum(damagePct) || damagePct < 0 || damagePct > 100) {
    return { name: 'CONSISTENCY', status: 'fail', detail: 'damage_pct missing or outside 0-100.' }
  }

  try {
    const apiKey = getGeminiApiKey()
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')

    const ai = new GoogleGenAI({ apiKey })
    const { response } = await generateWithFallback(
      ai,
      [
        'You are an independent crop-insurance claim auditor.',
        'Does the verbal description severity match the photo-assessed damage_pct?',
        'Judge only whether the severity the farmer describes is broadly compatible with the percentage.',
        'Allow reasonable tolerance; do not penalise wording or language style.',
        `Farmer statement (English translation): """${translation}"""`,
        `Photo-assessed damage_pct: ${damagePct}`,
        'Return JSON { consistent: boolean, reason: string } with a one-sentence reason.',
      ].join('\n'),
      {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            consistent: { type: Type.BOOLEAN },
            reason: { type: Type.STRING },
          },
          required: ['consistent', 'reason'],
        },
      },
      GEMINI_TIMEOUT_MS,
    )

    const parsed = JSON.parse(response.text ?? '') as { consistent?: unknown; reason?: unknown }
    if (typeof parsed.consistent !== 'boolean') throw new Error('Gemini returned an unexpected shape')
    const reason = isText(parsed.reason) ? parsed.reason.trim() : 'No reason given.'

    return parsed.consistent
      ? { name: 'CONSISTENCY', status: 'pass', detail: `Verbal severity matches ${damagePct}% photo damage. ${reason}` }
      : { name: 'CONSISTENCY', status: 'fail', detail: `Verbal severity does not match ${damagePct}% photo damage. ${reason}` }
  } catch (err) {
    // Gemini failure must not block the rule-based verdict, so mark it "warn".
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cline-audit] Gemini consistency check failed:', msg)
    return {
      name: 'CONSISTENCY',
      status: 'warn',
      detail: `AI consistency check unavailable (${msg.slice(0, 120)}). Rule-based checks completed; manual cross-check advised.`,
    }
  }
}

/* --------------------------------------------------------- verdict helpers */

function computeScore(checks: AuditCheck[]): number {
  const total = checks.reduce((sum, c) => sum + WEIGHTS[c.name], 0)
  const earned = checks.reduce((sum, c) => sum + WEIGHTS[c.name] * STATUS_CREDIT[c.status], 0)
  return total === 0 ? 0 : Math.round((earned / total) * 100)
}

function buildAuditLog(checks: AuditCheck[], passed: boolean, score: number): string {
  const count = (s: CheckStatus) => checks.filter((c) => c.status === s).length
  const steps = checks.map((c, i) => `(${i + 1}) ${c.name} [${c.status.toUpperCase()}]: ${c.detail}`).join(' ')
  const verdict = passed
    ? count('warn') > 0
      ? `Claim is compliant with ${count('warn')} warning(s) to note.`
      : 'Claim is fully compliant.'
    : `Claim flagged: ${count('fail')} check(s) failed, so manual review is required.`
  return `The autonomous Cline Auditor ran ${checks.length} PMFBY compliance checks in sequence. ${steps} Result: ${count('pass')} passed, ${count('warn')} warning(s), ${count('fail')} failed. Weighted compliance score ${score}%. ${verdict}`
}

/* ------------------------------------------------------------------ route */

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'Request body must be a claim JSON object.' }, { status: 400 })
  }

  // Accept either a flat claim or { claim: {...}, gps }.
  const raw = body as ClaimInput & { claim?: ClaimInput }
  const claim: ClaimInput = { ...(raw.claim ?? {}), ...raw }
  const gps = raw.gps ?? raw.claim?.gps
  const hours = claim.hours_elapsed ?? claim.hours_ago
  const crop = claim.crop_type ?? claim.crop
  const calamity = claim.damage_cause ?? claim.calamity
  const translation = claim.transcript_en ?? claim.translation

  // Checks run in sequence, and each one becomes an audit_log step.
  const checks: AuditCheck[] = []
  checks.push(
    flaggedUnknown(claim.warnings, 'hours_elapsed')
      ? { name: 'WINDOW', status: 'warn', detail: 'Incident time was not stated in the recording, so the 72-hr window could not be checked.' }
      : checkWindow(hours),
  )
  checks.push(checkCrop(crop === 'N/A' ? undefined : crop))
  checks.push(checkCalamity(calamity === 'N/A' ? undefined : calamity))
  checks.push(checkGps(gps))
  checks.push(
    flaggedUnknown(claim.warnings, 'damage_pct')
      ? { name: 'CONSISTENCY', status: 'warn', detail: 'Damage percentage is unknown, so severity consistency could not be checked.' }
      : await checkConsistency(translation === 'N/A' ? undefined : translation, claim.damage_pct),
  )

  const auditPassed = checks.every((c) => c.status !== 'fail')
  const score = computeScore(checks)

  return Response.json({
    audit_passed: auditPassed,
    compliance_score: `${score}%`,
    checks,
    agent_stamp: auditPassed ? STAMP_OK : STAMP_FLAGGED,
    audit_log: buildAuditLog(checks, auditPassed, score),
    audited_at: new Date().toISOString(),
  })
}

