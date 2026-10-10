import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { jsPDF } from 'jspdf'
import { normalizeAnalysis } from '../lib/claimAnalysis'
import { generateClaimSlip } from '../lib/generateClaimSlip'
import { FOOTER_TOP } from '../lib/claimSlipLayout'
import { auditTone, checkCounts, type AuditVerdict } from '../lib/auditTypes'
import type { ClaimAnalysis } from '../lib/types'

const claim = (): ClaimAnalysis => ({
  ...normalizeAnalysis({ transcript_original: 'मेरी धान की फसल डूब गई।', transcript_en: 'My paddy crop is submerged.',
    crop_type: 'Rice', damage_cause: 'Flood', damage_pct: 80, hours_elapsed: 16,
    summary_hi: 'फसल को नुकसान हुआ है।', summary_en: 'Flood damage estimated at 80 percent.' }),
  gps: { lat: 20.3888, lng: 78.1204, source: 'exif', label: 'Photo EXIF' }, photo_timestamp: null,
})
const verdict = (overrides: Partial<AuditVerdict> = {}): AuditVerdict => ({
  audit_passed: true, compliance_score: '100%', agent_stamp: 'Verified by Autonomous Cline Auditor',
  audit_log: 'All checks passed.', audited_at: '2026-10-10T07:00:00.000Z',
  checks: [
    { name: 'WINDOW', status: 'pass', detail: 'Incident reported 16 hrs ago (within the 72-hr intimation window).' },
    { name: 'CROP', status: 'pass', detail: '"Rice" matched eligible Kharif crop: Paddy.' },
    { name: 'CALAMITY', status: 'pass', detail: '"Flood" is a covered calamity (Flood).' },
    { name: 'GPS', status: 'pass', detail: 'Field geotagged at 20.38880, 78.12040 (photo EXIF).' },
    { name: 'CONSISTENCY', status: 'pass', detail: 'Verbal severity matches 80% photo damage. ' + 'Long reason. '.repeat(30) },
  ],
  ...overrides,
})
const fontLoader = async (file: string) => (await readFile(new URL(`../public/fonts/${file}`, import.meta.url))).toString('base64')

describe('audit tone', () => {
  it('green when passed, red on a hard-rule fail, amber on soft-only fails', () => {
    expect(auditTone(verdict())).toBe('green')
    const hard = verdict({ audit_passed: false, checks: [{ name: 'WINDOW', status: 'fail', detail: '96 hrs' }, { name: 'GPS', status: 'fail', detail: 'none' }] })
    expect(auditTone(hard)).toBe('red')
    const soft = verdict({ audit_passed: false, checks: [{ name: 'WINDOW', status: 'pass', detail: '' }, { name: 'CONSISTENCY', status: 'fail', detail: 'mismatch' }] })
    expect(auditTone(soft)).toBe('amber')
    expect(checkCounts(verdict().checks)).toBe('5 passed · 0 warnings · 0 failed')
  })
})

describe('PDF Audit Verification box', () => {
  let texts: { text: string; y: number }[] = []
  let colors: string[] = []
  let event: [string, (this: jsPDF) => void]
  beforeEach(() => {
    texts = []; colors = []
    event = ['initialized', function (this: jsPDF) {
      const text = this.text.bind(this)
      this.text = (t, x, y, options, transform) => {
        for (const line of [t].flat()) texts.push({ text: String(line), y })
        return text(t, x, y, options, transform)
      }
      const fill = this.setFillColor.bind(this) as (...args: number[]) => jsPDF
      this.setFillColor = ((...args: number[]) => { colors.push(args.join(',')); return fill(...args) }) as jsPDF['setFillColor']
    }]
    jsPDF.API.events.push(event)
  })
  afterEach(() => { const i = jsPDF.API.events.indexOf(event); if (i >= 0) jsPDF.API.events.splice(i, 1) })

  const has = (s: string) => texts.some(t => t.text.includes(s))
  const assertOnePageNoFooterOverlap = (doc: jsPDF) => {
    expect(doc.getNumberOfPages()).toBe(1)
    const footer = new Set(['Submit through your insurer or the official PMFBY portal: https://pmfby.gov.in', 'AI-assisted draft only. Check all estimates; 0 may mean unknown. Not an official receipt.'])
    expect(texts.filter(t => !footer.has(t.text)).every(t => t.y < FOOTER_TOP)).toBe(true)
  }

  it('passed: stamp, score, timestamp, every check, green styling', async () => {
    const { doc } = await generateClaimSlip({ claim: claim(), audit: verdict() }, { fontLoader })
    assertOnePageNoFooterOverlap(doc)
    expect(has('AUDIT VERIFICATION - PASSED')).toBe(true)
    expect(has('Verified by Autonomous Cline Auditor')).toBe(true)
    expect(has('Compliance score 100%')).toBe(true)
    expect(has('Audited 10 Oct 2026')).toBe(true)
    for (const name of ['WINDOW', 'CROP', 'CALAMITY', 'GPS', 'CONSISTENCY']) expect(has(name)).toBe(true)
    expect(texts.some(t => t.text.startsWith('Verbal severity') && t.text.endsWith('...'))).toBe(true)
    expect(colors).toContain('41,75,53')
  })

  it('failed hard rule: manual review title and red styling', async () => {
    const audit = verdict({ audit_passed: false, compliance_score: '20%', agent_stamp: 'Flagged by Autonomous Cline Auditor - manual review required',
      checks: [{ name: 'WINDOW', status: 'fail', detail: 'Incident reported 96 hrs ago (exceeds the 72-hr intimation window).' }, ...verdict().checks.slice(1)] })
    const { doc } = await generateClaimSlip({ claim: claim(), audit }, { fontLoader })
    assertOnePageNoFooterOverlap(doc)
    expect(has('AUDIT VERIFICATION - MANUAL REVIEW REQUIRED')).toBe(true)
    expect(has('Flagged by Autonomous Cline Auditor - manual review required')).toBe(true)
    expect(has('FAIL')).toBe(true)
    expect(colors).toContain('176,58,46')
  })

  it('failed soft rule only: amber styling', async () => {
    const audit = verdict({ audit_passed: false, compliance_score: '80%', checks: [...verdict().checks.slice(0, 4), { name: 'CONSISTENCY', status: 'fail', detail: 'mismatch' }] })
    await generateClaimSlip({ claim: claim(), audit }, { fontLoader })
    expect(colors).toContain('166,117,31')
    expect(colors).not.toContain('176,58,46')
  })

  it('audit endpoint error: PDF still generates and says "Audit unavailable"', async () => {
    const { doc } = await generateClaimSlip({ claim: claim(), audit: null, auditError: 'Audit unavailable (500)' }, { fontLoader })
    assertOnePageNoFooterOverlap(doc)
    expect(has('AUDIT VERIFICATION - AUDIT UNAVAILABLE')).toBe(true)
    expect(has('Audit unavailable: the compliance auditor could not be reached (Audit unavailable (500)). Manual review required.')).toBe(true)
  })

  it('no audit at all: no box (legacy callers unchanged)', async () => {
    await generateClaimSlip({ claim: claim() }, { fontLoader })
    expect(has('AUDIT VERIFICATION')).toBe(false)
  })
})
