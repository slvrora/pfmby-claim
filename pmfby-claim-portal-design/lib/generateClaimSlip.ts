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

export interface AuditCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

/** Verdict returned by /api/cline-audit. */
export interface AuditResult {
  audit_passed: boolean
  compliance_score: string
  agent_stamp: string
  audit_log: string
  checks?: AuditCheck[]
  audited_at?: string
}

/** Full response of /api/process-claim. */
export interface ProcessClaimResponse extends ClaimResult {
  gps: Gps
  gps_source: 'exif' | 'fallback'
  photo_taken_at: string | null
  model: string
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

/* ---------------------------------------------- Indic shaping via <canvas> */
/*
 * jsPDF writes glyphs one by one and does NOT apply OpenType shaping, so
 * Devanagari comes out wrong ("किसान" renders as "कसिान", conjuncts show a halant).
 * In the browser we draw Indic text onto a canvas (the browser shapes it
 * correctly) and embed it as a high-resolution PNG. In non-browser
 * environments we fall back to doc.text().
 */

const CANVAS_FONT_STACK = '"PMFBY Noto Devanagari", "PMFBY Noto Telugu", sans-serif'
const PX_PER_MM = 12 // ~300 dpi
let canvasFontsReady: Promise<boolean> | null = null

/** Any Indic script that needs complex shaping (Devanagari ... Malayalam). */
function needsShaping(text: string): boolean {
  return /[\u0900-\u0DFF]/.test(text)
}

/** Load the Noto fonts into the page so canvas text uses them. */
function ensureCanvasFonts(): Promise<boolean> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return Promise.resolve(false)
  canvasFontsReady ??= (async () => {
    try {
      const faces = [
        new FontFace('PMFBY Noto Devanagari', `url(/fonts/${FONT_DEVANAGARI})`),
        new FontFace('PMFBY Noto Telugu', `url(/fonts/${FONT_TELUGU})`),
      ]
      await Promise.all(faces.map((f) => f.load()))
      faces.forEach((f) => document.fonts.add(f))
      return true
    } catch {
      return false
    }
  })()
  return canvasFontsReady
}

/** Greedy word wrap using a measuring function. */
function wrapWords(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word
    if (current && measure(candidate) > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

/** Trim a list of lines to `maxLines`, adding an ellipsis when cut. */
function clampLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s.,;:]+$/, '')} ...`
  return kept
}

/**
 * Draw shaped text as an image. `y` is the first baseline (same contract as
 * doc.text). Returns the y after the last line.
 */
function drawShapedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  o: { width: number; size: number; lineHeight: number; color: [number, number, number]; align?: 'left' | 'center'; maxLines?: number },
): number {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  const fontPx = o.size * 0.3528 * PX_PER_MM // pt -> mm -> px
  const font = `${fontPx}px ${CANVAS_FONT_STACK}`
  ctx.font = font
  const maxW = o.width * PX_PER_MM
  const lines = clampLines(wrapWords(text, maxW, (s) => ctx.measureText(s).width), o.maxLines ?? Infinity)
  const lineH = o.lineHeight * PX_PER_MM
  const top = fontPx * 1.15 // room for matras above the headline
  canvas.width = Math.ceil(maxW)
  canvas.height = Math.ceil(top + (lines.length - 1) * lineH + fontPx * 0.5)
  ctx.font = font // resizing resets the context
  ctx.fillStyle = `rgb(${o.color.join(',')})`
  ctx.textAlign = o.align === 'center' ? 'center' : 'left'
  ctx.textBaseline = 'alphabetic'
  lines.forEach((line, i) => ctx.fillText(line, o.align === 'center' ? maxW / 2 : 0, top + i * lineH))
  const left = o.align === 'center' ? x - o.width / 2 : x
  doc.addImage(canvas.toDataURL('image/png'), 'PNG', left, y - top / PX_PER_MM, canvas.width / PX_PER_MM, canvas.height / PX_PER_MM)
  return y + lines.length * o.lineHeight
}

/** Whether the current generation run can shape Indic text on a canvas. */
let shapingEnabled = false

/**
 * jsPDF's built-in Helvetica only covers WinAnsi, so anything outside it
 * (e.g. ✓ or emoji) breaks the string. Map common punctuation, drop the rest.
 */
function pdfSafe(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '')
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
    maxLines?: number
  } = {},
): number {
  const { font = 'helvetica', size = 9, lineHeight = 4.2, color = INK, width = CONTENT_W, x = MARGIN, maxLines = Infinity } = opts
  if (shapingEnabled && needsShaping(text)) {
    return drawShapedText(doc, text, x, y, { width, size, lineHeight, color, maxLines })
  }
  const safe = font === 'helvetica' ? pdfSafe(text) : text
  doc.setFont(font, 'normal')
  doc.setFontSize(size)
  const lines = clampLines(doc.splitTextToSize(safe, width) as string[], maxLines)
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
    'Pradhan Mantri Fasal Bima Yojana  ·  Emergency Calamity Claim  ·  AI-assisted pre-assessment',
    PAGE_W / 2,
    18.5,
    { align: 'center' },
  )
  // Devanagari tagline ("Farmer calamity claim form"), shaped when possible.
  const tagline = 'किसान आपदा दावा पत्र'
  if (shapingEnabled) {
    drawShapedText(doc, tagline, PAGE_W / 2, 23.5, { width: 80, size: 8, lineHeight: 4, color: [255, 255, 255], align: 'center' })
  } else {
    doc.setFont('NotoDevanagari', 'normal')
    doc.setFontSize(8)
    doc.text(tagline, PAGE_W / 2, 23.5, { align: 'center' })
  }

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
  y = drawWrapped(doc, y, claim.transcript ? `“${claim.transcript}”` : '(No speech detected in the recording)', {
    font: pickFont(claim.transcript),
    size: 9,
    lineHeight: 4.3,
    maxLines: 4,
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
    maxLines: 4,
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
    const fitted = clampLines(doc.splitTextToSize(pdfSafe(value), tileW - 8) as string[], 1)[0] ?? ''
    doc.text(fitted, tx + 4, ty + 12)
  }
  drawTile(MARGIN, y, 'Detected crop', claim.crop || '-')
  drawTile(MARGIN + tileW + tileGap, y, 'Calamity type', claim.calamity || '-')
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
      const maxH = 48
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


  /* ---- Compliance audit stamp (Cline PMFBY Compliance Auditor) ---- */
  if (input.audit) {
    const a = input.audit
    const checks = a.checks ?? []
    const ok = a.audit_passed
    const accent: [number, number, number] = ok ? PRIMARY : [176, 58, 46]
    const tint: [number, number, number] = ok ? [243, 248, 244] : [252, 241, 239]
    const headerH = 15
    const rowH = 4.1
    // Keep the stamp above the footer: drop check rows that would not fit.
    const space = PAGE_H - 22 - y
    const maxRows = Math.max(0, Math.floor((space - headerH - 4) / rowH))
    const rows = checks.slice(0, maxRows)
    const boxH = headerH + (rows.length ? rows.length * rowH + 2 : 1)

    doc.setFillColor(...tint)
    doc.setDrawColor(...accent)
    doc.setLineWidth(0.5)
    doc.rect(MARGIN, y, CONTENT_W, boxH, 'FD')
    doc.setFillColor(...accent)
    doc.rect(MARGIN, y, 2.2, boxH, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...accent)
    doc.text(ok ? 'AUDIT PASSED' : 'AUDIT FLAGGED', MARGIN + 6, y + 6)
    doc.setFontSize(9)
    doc.text(`Compliance score ${pdfSafe(a.compliance_score)}`, colRightX - 4, y + 6, { align: 'right' })
    doc.setFontSize(8)
    doc.setTextColor(...INK)
    doc.text(pdfSafe(a.agent_stamp), MARGIN + 6, y + 11)
    if (a.audited_at) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...MUTED)
      doc.text(`Audited ${formatDateTime(new Date(a.audited_at))}`, colRightX - 4, y + 11, { align: 'right' })
    }

    let ry = y + headerH + 1.5
    for (const c of rows) {
      const statusColor: [number, number, number] =
        c.status === 'pass' ? PRIMARY : c.status === 'warn' ? [166, 117, 31] : [176, 58, 46]
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.8)
      doc.setTextColor(...statusColor)
      doc.text(c.status.toUpperCase(), MARGIN + 6, ry)
      doc.setTextColor(...INK)
      doc.text(pdfSafe(c.name), MARGIN + 16, ry)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...MUTED)
      const detail = clampLines(doc.splitTextToSize(pdfSafe(c.detail), CONTENT_W - 44) as string[], 1)[0] ?? ''
      doc.text(detail, MARGIN + 38, ry)
      ry += rowH
    }
    y += boxH + 4
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
  // In the browser, shape Indic text on a canvas; elsewhere use doc.text().
  shapingEnabled = !opts.fontLoader && (await ensureCanvasFonts())

  const gps = input.gps ?? FALLBACK_GPS
  const claimId = input.claimId || makeClaimId()
  const qrDataUrl = await QRCode.toDataURL(buildQrPayload(claimId, gps, input.claim), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 340,
    color: { dark: '#1b2a20', light: '#ffffff' },
  })

  // Pass the same id through so the printed id matches the one in the QR code.
  drawClaimSlip(doc, { ...input, claimId }, qrDataUrl)
  return doc
}

