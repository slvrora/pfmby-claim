export interface ClaimGps {
  lat: number | null
  lng: number | null
  source: 'exif' | 'device' | 'fallback'
  label: string
}

export interface ClaimAnalysis {
  transcript_original: string
  transcript_en: string
  crop_type: string
  damage_pct: number
  damage_cause: string
  hours_elapsed: number
  summary_hi: string
  summary_en: string
  warnings: string[]
  gps: ClaimGps
  photo_timestamp: string | null
}

export const DRAFT_STATUS_EN = 'Draft prepared. Not yet submitted to the insurer.'
export const DRAFT_STATUS_HI = 'मसौदा तैयार है। अभी बीमा कंपनी को जमा नहीं किया गया है।'
// TODO: Set a verified insurer/helpline contact before deploying to farmers.
export const FILING_CONTACT_TODO = ''
export const FILING_NEXT_STEP = 'Submit this draft through your insurer or the official PMFBY portal: https://pmfby.gov.in'
// Leave headroom for multipart headers below Vercel's ~4.5 MB request limit.
export const MAX_MEDIA_BYTES = 4_000_000
export const MAX_REQUEST_BYTES = 4_200_000