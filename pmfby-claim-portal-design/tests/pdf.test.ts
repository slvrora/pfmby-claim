import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { jsPDF } from 'jspdf'
import { normalizeAnalysis } from '../lib/claimAnalysis'
import { buildQrPayload, generateClaimSlip } from '../lib/generateClaimSlip'
import { BODY_BOTTOM, computeSlipLayout, MEDIA_TOP } from '../lib/claimSlipLayout'
import type { ClaimAnalysis } from '../lib/types'

const full = (): ClaimAnalysis => ({
  ...normalizeAnalysis({ transcript_original: 'मेरी धान की फसल को बारिश से नुकसान हुआ है।', transcript_en: 'Rain damaged my rice crop.',
    crop_type: 'Rice', damage_cause: 'Flood', damage_pct: 65, hours_elapsed: 16,
    summary_hi: 'फसल को नुकसान हुआ है। कृपया जाँच करें।', summary_en: 'Flood damage is estimated at 65 percent.' }),
  gps: { lat: 19, lng: 73, source: 'exif', label: 'Photo EXIF' }, photo_timestamp: '2026-10-10T00:00:00.000Z',
})
const fontLoader = async (file: string) => (await readFile(new URL(`../public/fonts/${file}`, import.meta.url))).toString('base64')

describe('pure single-page layout', () => {
  it('truncates and reserves media/footer space', () => {
    const blocks = Array.from({ length: 8 }, (_, i) => ({ key: String(i), lines: Array(200).fill('long Hindi text') as string[], maxLines: 4, lineHeight: 4.5 }))
    const result = computeSlipLayout(blocks)
    expect(result.every(block => block.y + block.height <= BODY_BOTTOM)).toBe(true)
    expect(result.every(block => block.y + block.height < MEDIA_TOP)).toBe(true)
    expect(result.some(block => block.truncated && block.lines.at(-1)?.endsWith('...'))).toBe(true)
    for (let i = 1; i < result.length; i++) expect(result[i].y).toBeGreaterThanOrEqual(result[i - 1].y + result[i - 1].height)
  })
})

describe('real jsPDF generation', () => {
  let calls: unknown[][] = []
  let event: [string, (this: jsPDF) => void]
  beforeEach(() => {
    calls = []
    event = ['initialized', function (this: jsPDF) {
      const original = this.text.bind(this)
      this.text = (text, x, y, options, transform) => {
        calls.push([text, x, y])
        return original(text, x, y, options, transform)
      }
    }]
    jsPDF.API.events.push(event)
  })
  afterEach(() => { const index = jsPDF.API.events.indexOf(event); if (index >= 0) jsPDF.API.events.splice(index, 1); vi.unstubAllGlobals() })

  it.each(['full', 'missing optional', 'long Hindi', 'font fetch failure', 'QR failure', 'invalid QR image', 'approximate GPS', 'invalid photo'] as const)('%s', async scenario => {
    const claim = scenario === 'missing optional' ? normalizeAnalysis({}) : full()
    if (scenario === 'long Hindi') { claim.summary_hi = 'फसल को भारी नुकसान हुआ है। '.repeat(60); claim.transcript_original = claim.summary_hi.repeat(3) }
    if (scenario === 'approximate GPS') claim.gps = { lat: 20, lng: 78, source: 'fallback', label: 'Approximate' }
    if (scenario === 'font fetch failure') vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const result = await generateClaimSlip({ claim, ...(scenario === 'invalid photo' ? { imageDataUrl: 'data:image/heic;base64,broken' } : {}) }, {
      ...(scenario === 'font fetch failure' ? {} : { fontLoader }),
      ...(scenario === 'QR failure' ? { QRCode: { toDataURL: async () => { throw new Error('QR failed') } } } : {}),
      ...(scenario === 'invalid QR image' ? { QRCode: { toDataURL: async () => 'not-an-image' } } : {}),
    })
    expect(result.doc.getNumberOfPages()).toBe(1)
    expect(result.doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0)
    expect(result.doc.internal.pageSize.getHeight()).toBeCloseTo(297, 0)
    expect(result.blob.size).toBeGreaterThan(100)
    expect(calls.length).toBeGreaterThan(10)
    expect(calls.every(([text]) => text !== undefined && text !== null && !JSON.stringify(text).includes('undefined'))).toBe(true)
    expect(calls.every(([, , y]) => typeof y === 'number' && y > 0 && y < 297)).toBe(true)
    expect(result.qrPayload).toContain(`ID:${result.claimId}`)
    expect(calls.some(([text]) => text === result.claimId)).toBe(true)
    expect(result.qrPayload.length).toBeLessThan(300)
    expect(result.qrPayload).toMatch(/^[\x00-\x7f]+$/)
    if (scenario === 'font fetch failure') expect(result.warnings.join(' ')).toContain('English-only')
    else expect(result.warnings.join(' ')).not.toContain('Hindi font unavailable')
    if (scenario === 'QR failure') expect(result.warnings.join(' ')).toContain('QR unavailable')
    if (scenario === 'long Hindi') expect(result.warnings.join(' ')).toContain('shortened')
    if (scenario === 'invalid QR image') expect(calls.some(([text]) => text === 'QR unavailable - use printed reference')).toBe(true)
    if (scenario === 'invalid photo') expect(result.warnings.join(' ')).toContain('Photo could not be embedded')
    if (scenario === 'approximate GPS') expect(JSON.stringify(calls)).toContain('Approximate location (not verified)')
    if (scenario === 'missing optional') expect(JSON.stringify(calls)).toContain('Location: Not available')
  })
  it('never encodes approximate fallback GPS in QR', () => {
    expect(buildQrPayload('DRAFT-1', { lat: 20, lng: 78, source: 'fallback', label: 'Approximate' }, '2026-10-10')).not.toContain('GPS:')
  })
})