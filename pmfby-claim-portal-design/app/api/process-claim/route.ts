/**
 * POST /api/process-claim
 * -----------------------
 * Multimodal claim processing. Accepts multipart/form-data with:
 *   audio     (required) the farmer's voice recording (webm / ogg / mp4 / wav ...)
 *   image     (required) a field photo (jpeg / png / webp)
 *   language  (optional) BCP-47 hint for the spoken language, e.g. "hi-IN"
 *
 * 1. exifr extracts GPS + capture time from the photo's EXIF. With no GPS it
 *    falls back to the demo village (Wardha, Maharashtra).
 * 2. Audio + image go to Gemini in ONE request, which returns strict JSON:
 *    { transcript, translation, crop, calamity, damage_pct, hours_ago, summary, summary_hi }
 * The response adds { gps, gps_source, photo_taken_at, model }.
 */

import exifr from 'exifr'
import { GoogleGenAI, Type } from '@google/genai'
import { generateWithFallback, getGeminiApiKey } from '@/lib/gemini'
import { DEMO_FALLBACK_GPS } from '@/lib/pmfbyRules'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_AUDIO_BYTES = 15 * 1024 * 1024
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const GEMINI_TIMEOUT_MS = 45_000
const FIELDS = ['transcript', 'translation', 'crop', 'calamity', 'damage_pct', 'hours_ago', 'summary', 'summary_hi'] as const

const LANGUAGE_NAMES: Record<string, string> = {
  'hi-IN': 'Hindi',
  'mr-IN': 'Marathi',
  'bn-IN': 'Bengali',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
  'kn-IN': 'Kannada',
  'en-IN': 'English',
}

const CLAIM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    transcript: { type: Type.STRING },
    translation: { type: Type.STRING },
    crop: { type: Type.STRING },
    calamity: { type: Type.STRING },
    damage_pct: { type: Type.NUMBER },
    hours_ago: { type: Type.NUMBER },
    summary: { type: Type.STRING },
    summary_hi: { type: Type.STRING },
  },
  required: [...FIELDS],
  propertyOrdering: [...FIELDS],
}

interface ClaimJson {
  transcript: string
  translation: string
  crop: string
  calamity: string
  damage_pct: number
  hours_ago: number
  summary: string
  summary_hi: string
}

interface ExifInfo {
  gps: { lat: number; lng: number } | null
  takenAt: Date | null
}

const errorResponse = (status: number, error: string) => Response.json({ error }, { status })

/** Normalise the audio MIME type for Gemini (strip codec params, map aliases). */
function audioMimeType(file: File): string {
  const base = (file.type || '').split(';')[0].trim().toLowerCase()
  if (base === 'audio/x-wav' || base === 'audio/wave') return 'audio/wav'
  if (base === 'audio/x-m4a' || base === 'audio/m4a') return 'audio/mp4'
  if (base.startsWith('audio/') || base === 'video/webm') return base === 'video/webm' ? 'audio/webm' : base
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'mp3') return 'audio/mp3'
  if (ext === 'ogg') return 'audio/ogg'
  if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4'
  return 'audio/webm'
}

/** Read GPS + capture time from the photo's EXIF. Never throws. */
async function readExif(image: Buffer): Promise<ExifInfo> {
  try {
    const data = (await exifr.parse(image, { gps: true })) as
      | { latitude?: number; longitude?: number; DateTimeOriginal?: Date; CreateDate?: Date }
      | undefined
    const rawDate = data?.DateTimeOriginal ?? data?.CreateDate
    const takenAt = rawDate instanceof Date && !Number.isNaN(rawDate.getTime()) ? rawDate : null
    const lat = data?.latitude
    const lng = data?.longitude
    const hasGps = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
    return { gps: hasGps ? { lat, lng } : null, takenAt }
  } catch {
    return { gps: null, takenAt: null }
  }
}

/** Check Gemini's JSON against the schema and clamp numbers to sane ranges. */
function validateClaim(value: unknown): ClaimJson {
  if (!value || typeof value !== 'object') throw new Error('Gemini did not return a JSON object')
  const v = value as Record<string, unknown>
  const str = (k: string) => {
    if (typeof v[k] !== 'string') throw new Error(`Gemini response missing string field "${k}"`)
    return (v[k] as string).trim()
  }
  const num = (k: string) => {
    const n = typeof v[k] === 'string' ? Number(v[k]) : v[k]
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`Gemini response missing numeric field "${k}"`)
    return n
  }
  return {
    transcript: str('transcript'),
    translation: str('translation'),
    crop: str('crop'),
    calamity: str('calamity'),
    damage_pct: Math.min(100, Math.max(0, Math.round(num('damage_pct')))),
    hours_ago: Math.max(0, Math.round(num('hours_ago') * 10) / 10),
    summary: str('summary'),
    summary_hi: str('summary_hi'),
  }
}

function buildPrompt(languageName: string | null, now: Date, photoTakenAt: Date | null): string {
  return [
    'You are an assistant for PMFBY (Pradhan Mantri Fasal Bima Yojana) emergency crop-loss claims in India.',
    'You receive (1) an audio recording of a farmer describing crop damage and (2) a photo of their field.',
    languageName
      ? `The farmer selected ${languageName}, but transcribe whatever language is actually spoken (Hindi, Marathi, Telugu, Tamil, Bengali, Kannada, English, etc.).`
      : 'Detect the spoken language (Hindi, Marathi, Telugu, Tamil, Bengali, Kannada, English, etc.).',
    '',
    'Return JSON with exactly these fields:',
    '- transcript: verbatim transcription of the audio in its ORIGINAL language and native script (Devanagari for Hindi/Marathi, Telugu script for Telugu, etc.). Do not translate here.',
    '- translation: faithful English translation of the transcript.',
    '- crop: crop name in English (e.g. "Paddy", "Wheat", "Cotton"). Use what the farmer says; if unclear, identify it from the photo; else "Unknown".',
    '- calamity: calamity type in English (e.g. "Flood", "Inundation", "Cyclone", "Hailstorm", "Landslide", "Unseasonal rain", "Drought"); else "Unknown".',
    '- damage_pct: your VISUAL estimate (0-100) of the share of the crop in the PHOTO that is damaged, lost or submerged. Judge from the photo itself, not from what the farmer claims.',
    `- hours_ago: estimated hours between the incident and now (${now.toISOString()}), from time references in the audio ("last night", "yesterday", "two days ago").` +
      (photoTakenAt ? ` The photo was taken at ${photoTakenAt.toISOString()} (EXIF), so the incident happened at or before then.` : '') +
      ' If there is no time reference at all, use 24.',
    '- summary: 2-3 sentence plain-English summary of the claim for an insurance officer.',
    '- summary_hi: a short, simple Hindi confirmation for the farmer in plain, farmer-friendly language, 2-3 sentences, in Devanagari. Style: "आपका दावा दर्ज हो गया है। फसल: धान, नुकसान: 80 प्रतिशत।"',
    '',
    'CRITICAL: transcribe ONLY words that are actually audible in the audio. Never invent, guess or reconstruct a statement from the photo, from the language hint, or from these instructions.',
    'If the audio is silent, too quiet, noise only or unintelligible, set transcript and translation to "" and say "No clear speech was heard in the recording" in summary. Still assess the photo, and base crop/calamity on the photo only.',
  ].join('\n')
}

export async function POST(req: Request) {
  const apiKey = getGeminiApiKey()
  if (!apiKey) return errorResponse(500, 'GEMINI_API_KEY is not configured on the server.')

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return errorResponse(400, 'Request must be multipart/form-data with "audio" and "image" files.')
  }

  const audio = form.get('audio')
  const image = form.get('image')
  const language = typeof form.get('language') === 'string' ? (form.get('language') as string) : ''

  if (!(audio instanceof File) || audio.size === 0) return errorResponse(400, 'Missing "audio" recording.')
  if (!(image instanceof File) || image.size === 0) return errorResponse(400, 'Missing "image" field photo.')
  if (audio.size > MAX_AUDIO_BYTES) return errorResponse(413, 'Audio recording is larger than 15 MB.')
  if (image.size > MAX_IMAGE_BYTES) return errorResponse(413, 'Field photo is larger than 10 MB.')
  const imageType = (image.type || '').toLowerCase()
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(imageType)) {
    return errorResponse(415, 'Field photo must be JPG, PNG or WebP.')
  }

  const audioBuf = Buffer.from(await audio.arrayBuffer())
  const imageBuf = Buffer.from(await image.arrayBuffer())

  // 1. EXIF GPS + timestamp (fallback: demo village Wardha).
  const exif = await readExif(imageBuf)
  const gps = exif.gps ?? { lat: DEMO_FALLBACK_GPS.lat, lng: DEMO_FALLBACK_GPS.lng }
  const gpsSource = exif.gps ? 'exif' : 'fallback'

  // 2. One multimodal Gemini call with both the audio and the image.
  const now = new Date()
  let claim: ClaimJson
  let usedModel: string
  try {
    const ai = new GoogleGenAI({ apiKey })
    const { response, model } = await generateWithFallback(
      ai,
      [
        {
          role: 'user',
          parts: [
            { text: buildPrompt(LANGUAGE_NAMES[language] ?? null, now, exif.takenAt) },
            { inlineData: { mimeType: audioMimeType(audio), data: audioBuf.toString('base64') } },
            { inlineData: { mimeType: imageType, data: imageBuf.toString('base64') } },
          ],
        },
      ],
      { temperature: 0.2, responseMimeType: 'application/json', responseSchema: CLAIM_SCHEMA },
      GEMINI_TIMEOUT_MS,
    )
    usedModel = model
    claim = validateClaim(JSON.parse(response.text ?? ''))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[process-claim] Gemini processing failed:', msg)
    const busy = /"code":\s*(429|503)|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(msg)
    return busy
      ? errorResponse(503, 'The AI service is busy right now. Please wait a minute and press Submit Claim again.')
      : errorResponse(502, `AI processing failed: ${msg.slice(0, 200)}`)
  }

  return Response.json({
    ...claim,
    gps,
    gps_source: gpsSource,
    photo_taken_at: exif.takenAt ? exif.takenAt.toISOString() : null,
    model: usedModel,
  })
}

