/**
 * generateClaimSlip.ts
 * ---------------------
 * Client-side generator for the "PMFBY Fast-Track Emergency Claim - Form 72A"
 * Kisan Claim Slip, produced with jsPDF.
 *
 * IMPORTANT - Indic scripts: jsPDF's built-in fonts (Helvetica/Times/Courier)
 * cannot render Devanagari / Telugu. We ship real Noto Sans TrueType fonts in
 * /public/fonts, load them at runtime, register them with jsPDF
 * (addFileToVFS + addFont) and use them for the vernacular transcript.
 */

import type { jsPDF } from 'jspdf'

/* ------------------------------------------------------------------ types */

export interface ClaimResult {
  transcript: string
  translation: string
  crop: string
  calamity: string
  damage_pct: number
  hours_ago: number
  summary: string
  /** Short, farmer-friendly Hindi confirmation (spoken back to the farmer). */
  summary_hi: string
}

export interface AuditResult {
  audit_passed: boolean
  compliance_score: string
  agent_stamp: string
  audit_log: string
}

export interface Gps {
  lat: number
  lng: number
}

export interface ClaimSlipInput {
  claim: ClaimResult
  gps: Gps | null
  imageDataUrl: string | null
  audit?: AuditResult | null
  claimId?: string
}

export type FontLoader = (fileName: string) => Promise<string>

/* --------------------------------------------------------------- constants */

const FONT_DEVANAGARI = 'NotoSansDevanagari-Regular.ttf'
const FONT_TELUGU = 'NotoSansTelugu-Regular.ttf'
const FALLBACK_GPS: Gps = { lat: 20.7453, lng: 78.6022 }

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 16
const CONTENT_W = PAGE_W - MARGIN * 2

const PRIMARY: [number, number, number] = [41, 75, 53]
const PRIMARY_SOFT: [number, number, number] = [233, 240, 234]
const INK: [number, number, number] = [32, 38, 33]
const MUTED: [number, number, number] = [120, 128, 122]
const LINE: [number, number, number] = [210, 216, 211]

/* ----------------------------------------------------------------- helpers */

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk)
    binary += String.fromCharCode.apply(null, Array.from(slice))
  }
  return btoa(binary)
}

const browserFontLoader: FontLoader = async (fileName) => {
  const res = await fetch(`/fonts/${fileName}`)
  if (!res.ok) throw new Error(`Could not load font ${fileName} (${res.status})`)
  return uint8ToBase64(new Uint8Array(await res.arrayBuffer()))
}

async function registerFonts(doc: jsPDF, loader: FontLoader): Promise<void> {
  const devanagari = await loader(FONT_DEVANAGARI)
  doc.addFileToVFS(FONT_DEVANAGARI, devanagari)
  doc.addFont(FONT_DEVANAGARI, 'NotoDevanagari', 'normal')

  const telugu = await loader(FONT_TELUGU)
  doc.addFileToVFS(FONT_TELUGU, telugu)
  doc.addFont(FONT_TELUGU, 'NotoTelugu', 'normal')
}

function pickFont(text: string): string {
  if (/[\u0900-\u097F]/.test(text)) return 'NotoDevanagari'
  if (/[\u0C00-\u0C7F]/.test(text)) return 'NotoTelugu'
  return 'helvetica'
}

function makeClaimId(): string {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let suffix = ''
  for (let i = 0; i < 5; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `PMFBY-${ymd}-${suffix}`
}

function formatDateTime(d: Date): string {
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date}, ${time}`
}

function detectImageFormat(dataUrl: string): 'JPEG' | 'PNG' | 'WEBP' {
  if (dataUrl.startsWith('data:image/png')) return 'PNG'
  if (dataUrl.startsWith('data:image/webp')) return 'WEBP'
  return 'JPEG'
}

function sectionBar(doc: jsPDF, y: number, title: string): number {
  doc.setFillColor(...PRIMARY_SOFT)
  doc.rect(MARGIN, y, CONTENT_W, 7.5, 'F')
  doc.setFillColor(...PRIMARY)
  doc.rect(MARGIN, y, 1.6, 7.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...PRIMARY)
  doc.text(title.toUpperCase(), MARGIN + 4.5, y + 5.1)
  return y + 12
}

function fieldLabel(doc: jsPDF, y: number, label: string): void {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text(label.toUpperCase(), MARGIN, y)
}

function drawWrapped(
  doc: jsPDF,
  y: number,
  text: string,
  opts: {
    font?: string
    size?: number
    lineHeight?: number
    color?: [number, number, number]
    width?: number
    x?: number
  } = {},
): number {
  const { font = 'helvetica', size = 9, lineHeight = 4.2, color = INK, width = CONTENT_W, x = MARGIN } = opts
  const lines = doc.splitTextToSize(text, width)
  doc.setFont(font, 'normal')
  doc.setFontSize(size)
  doc.setTextColor(...color)
  for (const line of lines) {
    doc.text(line, x, y)
    y += lineHeight
  }
  return y
}


/**
 * Draw the full slip onto an already-created jsPDF document whose fonts have
 * been registered. Exported so it can be tested without a browser.
 */
export function drawClaimSlip(doc: jsPDF, input: ClaimSlipInput, qrDataUrl: string): void {
  const { claim } = input
  const gps = input.gps ?? FALLBACK_GPS
  const claimId = input.claimId || makeClaimId()
  const now = new Date()

  /* ---- Header band ---- */
  doc.setFillColor(...PRIMARY)
  doc.rect(0, 0, PAGE_W, 27, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('PMFBY Fast-Track Emergency Claim - Form 72A', PAGE_W / 2, 12, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(
    'Government of India  ·  Pradhan Mantri Fasal Bima Yojana  ·  Emergency Calamity Claim',
    PAGE_W / 2,
    18.5,
    { align: 'center' },
  )
  // Devanagari tagline rendered with the registered Noto font.
  doc.setFont('NotoDevanagari', 'normal')
  doc.setFontSize(8)
  doc.text('किसान आपत्ति दावा पत्र', PAGE_W / 2, 23.5, { align: 'center' })

  let y = 36

  /* ---- Reference id + date/time ---- */
  const colRightX = MARGIN + CONTENT_W
  fieldLabel(doc, y, 'Claim reference id')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...INK)
  doc.text(claimId, MARGIN, y + 6)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text('DATE & TIME', colRightX, y, { align: 'right' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...INK)
  doc.text(formatDateTime(now), colRightX, y + 6, { align: 'right' })
  y += 12

  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, y, colRightX, y)
  y += 8

  /* ---- GPS pin ---- */
  const mapsUrl = `https://maps.google.com/?q=${gps.lat.toFixed(5)},${gps.lng.toFixed(5)}`
  fieldLabel(doc, y, 'GPS location (field pin)')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...INK)
  doc.text(`${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`, MARGIN, y + 5.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text(`Google Maps: ${mapsUrl}`, MARGIN, y + 10)
  y += 16

  /* ---- Farmer statement ---- */
  y = sectionBar(doc, y, 'Farmer statement')

  fieldLabel(doc, y, 'Original (vernacular)')
  y += 4
  y = drawWrapped(doc, y, `“${claim.transcript}”`, {
    font: pickFont(claim.transcript),
    size: 9,
    lineHeight: 4.3,
  })
  y += 2

  doc.setDrawColor(...LINE)
  doc.setLineDashPattern([1, 1], 0)
  doc.line(MARGIN, y, colRightX, y)
  doc.setLineDashPattern([], 0)
  y += 6

  fieldLabel(doc, y, 'English translation')
  y += 4
  y = drawWrapped(doc, y, `“${claim.translation}”`, {
    size: 9,
    lineHeight: 4.2,
    color: [70, 76, 72],
  })
  y += 4


  /* ---- AI damage assessment ---- */
  y = sectionBar(doc, y, 'AI damage assessment')
  const tileGap = 4
  const tileW = (CONTENT_W - tileGap) / 2
  const tileH = 15
  const drawTile = (tx: number, ty: number, label: string, value: string) => {
    doc.setFillColor(250, 251, 250)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.2)
    doc.rect(tx, ty, tileW, tileH, 'FD')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text(label.toUpperCase(), tx + 4, ty + 5.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...INK)
    doc.text(value, tx + 4, ty + 12)
  }
  drawTile(MARGIN, y, 'Detected crop', claim.crop || '—')
  drawTile(MARGIN + tileW + tileGap, y, 'Calamity type', claim.calamity || '—')
  drawTile(MARGIN, y + tileH + tileGap, 'Estimated damage', `${Math.round(claim.damage_pct)}%`)
  drawTile(MARGIN + tileW + tileGap, y + tileH + tileGap, 'Hours since incident', `${claim.hours_ago} hrs`)
  y += tileH * 2 + tileGap + 6

  /* ---- Field photo + QR verification ---- */
  y = sectionBar(doc, y, 'Field photo & verification')

  const photoW = 60
  let photoH = 45
  let photoDrawn = false
  if (input.imageDataUrl) {
    try {
      const props = doc.getImageProperties(input.imageDataUrl)
      photoH = photoW * (props.height / props.width)
      const maxH = 58
      let drawW = photoW
      if (photoH > maxH) {
        photoH = maxH
        drawW = maxH * (props.width / props.height)
      }
      doc.addImage(input.imageDataUrl, detectImageFormat(input.imageDataUrl), MARGIN, y, drawW, photoH)
      doc.setDrawColor(...LINE)
      doc.setLineWidth(0.2)
      doc.rect(MARGIN, y, drawW, photoH)
      photoDrawn = true
    } catch {
      photoDrawn = false
    }
  }
  if (!photoDrawn) {
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.2)
    doc.rect(MARGIN, y, photoW, photoH)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text('No field photo attached', MARGIN + photoW / 2, y + photoH / 2, { align: 'center' })
  }

  // QR code (right column).
  const qrSize = 34
  const qrX = colRightX - qrSize
  const qrY = y
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize)
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.2)
  doc.rect(qrX, qrY, qrSize, qrSize)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...INK)
  doc.text('Scan to verify', qrX + qrSize / 2, qrY + qrSize + 5, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...MUTED)
  const qrCaption = doc.splitTextToSize('(Panchayat / Agriculture Extension Officer)', qrSize + 26)
  let qrCapY = qrY + qrSize + 9
  for (const line of qrCaption) {
    doc.text(line, qrX + qrSize / 2, qrCapY, { align: 'center' })
    qrCapY += 3
  }

  y += Math.max(photoH, qrSize + 14) + 6


  /* ---- Compliance audit stamp (optional, Phase 4) ---- */
  if (input.audit) {
    const a = input.audit
    const boxH = 16
    doc.setDrawColor(...PRIMARY)
    doc.setLineWidth(0.4)
    doc.setFillColor(245, 249, 246)
    doc.rect(MARGIN, y, CONTENT_W, boxH, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...PRIMARY)
    doc.text(
      `${a.audit_passed ? '✓ VERIFIED' : '✗ NOT VERIFIED'}  ·  Compliance ${a.compliance_score}`,
      MARGIN + 4,
      y + 6,
    )
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...INK)
    doc.text(a.agent_stamp, MARGIN + 4, y + 11.5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    const auditLines = doc.splitTextToSize(a.audit_log, CONTENT_W - 8)
    // Show only the first line to preserve the single-page layout.
    doc.text(auditLines[0] || '', MARGIN + 4, y + 15)
    y += boxH + 6
  }

  /* ---- Footer ---- */
  const footY = PAGE_H - 14
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, footY - 4, colRightX, footY - 4)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text(
    'Generated by AI-assisted pre-assessment. Subject to official verification.',
    PAGE_W / 2,
    footY,
    { align: 'center' },
  )
}

/* -------------------------------------------------------------- public API */

/** Build a QR payload string encoding the key claim fields. */
export function buildQrPayload(claimId: string, gps: Gps, claim: ClaimResult): string {
  return [
    `PMFBY Claim ${claimId}`,
    `Crop: ${claim.crop}`,
    `Damage: ${Math.round(claim.damage_pct)}%`,
    `GPS: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`,
  ].join('\n')
}

/**
 * Generate the claim slip and return the jsPDF document.
 * Call `doc.save('Kisan-Claim-Slip-72A.pdf')` in the browser to download it.
 */
export async function generateClaimSlip(
  input: ClaimSlipInput,
  opts: {
    fontLoader?: FontLoader
    QRCode?: { toDataURL: (text: string, options?: unknown) => Promise<string> }
  } = {},
): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf')
  const QRCode = opts.QRCode ?? (await import('qrcode')).default

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const loader = opts.fontLoader ?? browserFontLoader
  await registerFonts(doc, loader)

  const gps = input.gps ?? FALLBACK_GPS
  const claimId = input.claimId || makeClaimId()
  const qrDataUrl = await QRCode.toDataURL(buildQrPayload(claimId, gps, input.claim), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 340,
    color: { dark: '#1b2a20', light: '#ffffff' },
  })

  drawClaimSlip(doc, input, qrDataUrl)
  return doc
}

