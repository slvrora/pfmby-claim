import type { jsPDF } from 'jspdf'
import { normalizeAnalysis, validCoordinates } from './claimAnalysis'
import { DRAFT_STATUS_EN, DRAFT_STATUS_HI, type ClaimAnalysis, type ClaimGps } from './types'
import { computeSlipLayout, CONTENT_WIDTH, FOOTER_TOP, MARGIN, MEDIA_TOP, PAGE_WIDTH } from './claimSlipLayout'

export interface AuditResult {
  audit_passed: boolean
  compliance_score: string
  agent_stamp: string
  audit_log: string
}
export interface ClaimSlipInput {
  claim: ClaimAnalysis
  imageDataUrl?: string | null
  audit?: AuditResult | null
  claimId?: string
}
export type FontLoader = (fileName: string) => Promise<string>
const FONT_DEVANAGARI = 'NotoSansDevanagari-Regular.ttf'
const FONT_TELUGU = 'NotoSansTelugu-Regular.ttf'
const PRIMARY: [number, number, number] = [41, 75, 53]
const ascii = (text: string) => text.replace(/[^\x20-\x7e\n]/g, '').trim()
const safeText = (value: unknown, fallback = 'N/A') => typeof value === 'string' && value.trim() ? value.trim() : fallback

const browserFontLoader: FontLoader = async fileName => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`/fonts/${fileName}`, { signal: controller.signal })
    if (!res.ok) throw new Error('Font unavailable')
    const bytes = new Uint8Array(await res.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
  } finally { clearTimeout(timer) }
}

async function registerFont(doc: jsPDF, file: string, name: string, loader: FontLoader): Promise<void> {
  const base64 = (await loader(file)).replace(/^data:[^,]*,/, '').replace(/\s/g, '')
  if (!base64 || !/^[A-Za-z0-9+/]+=*$/.test(base64)) throw new Error('Invalid font')
  const signature = atob(base64.slice(0, 8)).slice(0, 4)
  if (signature !== '\x00\x01\x00\x00' && signature !== 'true') throw new Error('Not a TrueType font')
  doc.addFileToVFS(file, base64)
  doc.addFont(file, name, 'normal')
  doc.setFont(name, 'normal')
  // jsPDF can swallow font parser errors; verify usable parsed metrics too.
  if (!('Unicode' in doc.getFont().metadata)) throw new Error('Font metrics unavailable')
}

function makeClaimId(): string {
  return `DRAFT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${globalThis.crypto.randomUUID().slice(0, 8).toUpperCase()}`
}

export function buildQrPayload(claimId: string, gps: ClaimGps, timestamp: string): string {
  const location = gps.source !== 'fallback' && validCoordinates(gps.lat, gps.lng) && typeof gps.lng === 'number'
    ? `\nGPS:${gps.lat.toFixed(5)},${gps.lng.toFixed(5)} (${gps.source})` : ''
  return `DRAFT-NOT-SUBMITTED\nID:${ascii(claimId).slice(0, 48)}\nCreated:${ascii(timestamp).slice(0, 30)}${location}`.slice(0, 299)
}

interface FontState { devanagari: boolean; telugu: boolean }

export function drawClaimSlip(doc: jsPDF, input: ClaimSlipInput, claimId: string, timestamp: string, qrDataUrl: string | null, fonts: FontState, warnings: string[]): void {
  const claim = normalizeAnalysis(input.claim)
  const gps = input.claim?.gps
  const hasGps = gps && validCoordinates(gps.lat, gps.lng) && typeof gps.lng === 'number'
  const location = hasGps ? `${gps.source === 'exif' ? 'Photo EXIF (not independently verified)' : gps.source === 'device' ? 'Device location (confirm field)' : 'Approximate location (not verified)'}: ${gps.lat?.toFixed(5)}, ${gps.lng?.toFixed(5)}` : 'Location: Not available'
  const pickFont = (text: string) => /[\u0900-\u097f]/.test(text) && fonts.devanagari ? 'NotoDevanagari' : /[\u0c00-\u0c7f]/.test(text) && fonts.telugu ? 'NotoTelugu' : 'helvetica'
  const printable = (text: string) => {
    const font = pickFont(text)
    if (font === 'helvetica' && /[^\x20-\x7e\n]/.test(text)) return ascii(text) || 'See English translation'
    return text
  }
  const unsupportedOriginal = /[\u0980-\u0bff\u0c80-\u0dff]/.test(claim.transcript_original) ||
    (/[\u0900-\u097f]/.test(claim.transcript_original) && !fonts.devanagari) ||
    (/[\u0c00-\u0c7f]/.test(claim.transcript_original) && !fonts.telugu)
  if (unsupportedOriginal) warnings.push('Original-script font unavailable; the statement uses the English translation.')

  doc.setFillColor(...PRIMARY); doc.rect(0, 0, PAGE_WIDTH, 27, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
  doc.text('PMFBY Crop-Loss Draft Intimation', PAGE_WIDTH / 2, 11, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(DRAFT_STATUS_EN, PAGE_WIDTH / 2, 18, { align: 'center' })
  if (fonts.devanagari) {
    doc.setFont('NotoDevanagari', 'normal'); doc.setFontSize(8)
    doc.text(DRAFT_STATUS_HI, PAGE_WIDTH / 2, 24, { align: 'center' })
  }
  doc.setTextColor(32, 38, 33); doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text(claimId, MARGIN, 35)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text(`Created: ${timestamp}`, MARGIN, 40)

  const blocks = [
    { key: 'location', text: location, maxLines: 2 },
    { key: 'assessment', text: `Crop: ${claim.crop_type} | Cause: ${claim.damage_cause}\nEstimated damage: ${claim.damage_pct}% | Reported hours: ${claim.hours_elapsed} (unverified)`, maxLines: 3 },
    { key: 'summary_hi', text: fonts.devanagari ? claim.summary_hi : 'Hindi font unavailable. English-only draft.', maxLines: 4 },
    { key: 'summary_en', text: claim.summary_en, maxLines: 3 },
    { key: 'transcript', text: `Farmer statement: ${unsupportedOriginal ? claim.transcript_en : claim.transcript_original}`, maxLines: 4 },
    { key: 'translation', text: `English: ${claim.transcript_en}`, maxLines: 3 },
    { key: 'photo_time', text: `Photo time: ${safeText(input.claim?.photo_timestamp, 'Not available')} (not proof of incident time)`, maxLines: 2 },
    { key: 'warnings', text: `Review: ${[...(input.claim?.warnings ?? []).filter(item => typeof item === 'string'), ...warnings, ...claim.warnings].join(' ') || 'AI estimates require verification by the farmer and insurer.'}`, maxLines: 3 },
  ]
  const measured = blocks.map(block => {
    const text = printable(block.text)
    const font = pickFont(text)
    doc.setFont(font, 'normal'); doc.setFontSize(9)
    const lines: string[] = doc.splitTextToSize(text, CONTENT_WIDTH - 5)
    return { ...block, font, lines, lineHeight: 4.5 }
  })
  const layout = computeSlipLayout(measured)
  for (const block of layout) {
    const style = measured.find(item => item.key === block.key)
    doc.setFont(style?.font ?? 'helvetica', 'normal'); doc.setFontSize(9)
    block.lines.forEach((line, i) => doc.text(line, MARGIN, block.y + i * block.lineHeight))
    if (block.truncated) warnings.push(`${block.key}: shortened to keep the PDF on one page.`)
  }

  doc.setDrawColor(210, 216, 211); doc.rect(MARGIN, MEDIA_TOP, 60, 36)
  let photoDrawn = false
  if (input.imageDataUrl) {
    try {
      const props = doc.getImageProperties(input.imageDataUrl)
      const scale = Math.min(60 / props.width, 36 / props.height)
      if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid photo dimensions')
      doc.addImage(input.imageDataUrl, props.fileType, MARGIN, MEDIA_TOP, props.width * scale, props.height * scale)
      photoDrawn = true
    } catch { warnings.push('Photo could not be embedded; keep the original photo as evidence.') }
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  if (!photoDrawn) doc.text('Photo not attached; keep original.', MARGIN + 2, MEDIA_TOP + 18)
  let qrDrawn = false
  if (qrDataUrl) {
    try { doc.addImage(qrDataUrl, 'PNG', PAGE_WIDTH - MARGIN - 34, MEDIA_TOP, 34, 34); qrDrawn = true }
    catch { warnings.push('QR could not be embedded. Use the printed reference.') }
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text(qrDrawn ? 'Draft reference only - not proof of filing' : 'QR unavailable - use printed reference', PAGE_WIDTH - MARGIN, MEDIA_TOP + 40, { align: 'right' })
  if (input.audit) {
    const a = input.audit
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    const lines: string[] = doc.splitTextToSize(ascii(`Internal review: ${a.audit_passed ? 'passed' : 'not passed'}; ${safeText(a.compliance_score)}; ${safeText(a.agent_stamp)}; ${safeText(a.audit_log)}. Not insurer approval.`), CONTENT_WIDTH - 5)
    doc.text(lines.slice(0, 2), MARGIN, 263)
  }
  doc.line(MARGIN, FOOTER_TOP, PAGE_WIDTH - MARGIN, FOOTER_TOP)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text('Submit through your insurer or the official PMFBY portal: https://pmfby.gov.in', MARGIN, 280)
  doc.text('AI-assisted draft only. Check all estimates; 0 may mean unknown. Not an official receipt.', MARGIN, 285)
}

export async function generateClaimSlip(input: ClaimSlipInput, opts: {
  fontLoader?: FontLoader
  QRCode?: { toDataURL: (text: string) => Promise<string> }
} = {}): Promise<{ doc: jsPDF; blob: Blob; warnings: string[]; claimId: string; qrPayload: string }> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const warnings: string[] = normalizeAnalysis(input.claim).warnings
  const claimId = ascii(safeText(input.claimId, '')).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || makeClaimId()
  const timestamp = new Date().toISOString()
  const loader = opts.fontLoader ?? browserFontLoader
  const fonts: FontState = { devanagari: false, telugu: false }
  try { await registerFont(doc, FONT_DEVANAGARI, 'NotoDevanagari', loader); fonts.devanagari = true }
  catch { warnings.push('Hindi font unavailable; an English-only draft was generated.') }
  if (fonts.devanagari && /[\u0c00-\u0c7f]/.test(input.claim?.transcript_original ?? '')) {
    try { await registerFont(doc, FONT_TELUGU, 'NotoTelugu', loader); fonts.telugu = true }
    catch { warnings.push('Telugu font unavailable; use the English translation.') }
  }
  const claim = normalizeAnalysis(input.claim)
  const qrPayload = buildQrPayload(claimId, input.claim?.gps ?? claim.gps, timestamp)
  let qrDataUrl: string | null = null
  try {
    const QRCode = opts.QRCode ?? (await import('qrcode')).default
    qrDataUrl = await QRCode.toDataURL(qrPayload)
  } catch { warnings.push('QR unavailable; use the printed draft reference.') }
  drawClaimSlip(doc, input, claimId, timestamp, qrDataUrl, fonts, warnings)
  return { doc, blob: doc.output('blob'), warnings: [...new Set(warnings)], claimId, qrPayload }
}