import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findCoveredCalamity, findEligibleCrop, isFallbackLocation } from '../lib/pmfbyRules'

const mocks = vi.hoisted(() => ({ generate: vi.fn<() => Promise<{ text?: string }>>() }))
vi.mock('@google/genai', async importOriginal => {
  const actual = await importOriginal<typeof import('@google/genai')>()
  return { ...actual, GoogleGenAI: class { models = { generateContent: mocks.generate } } }
})
import { POST } from '../app/api/cline-audit/route'

const claim = (overrides: Record<string, unknown> = {}) => ({
  transcript_en: 'Heavy rain flooded my paddy field, almost all of the crop is under water.',
  crop_type: 'Rice', damage_cause: 'Flood', damage_pct: 85, hours_elapsed: 16, warnings: [],
  gps: { lat: 21.14612, lng: 79.08821, source: 'exif', label: 'Photo EXIF' },
  ...overrides,
})
const audit = async (body: unknown) => {
  const response = await POST(new Request('http://localhost/api/cline-audit', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))
  return { status: response.status, data: await response.json() }
}

describe('PMFBY rules', () => {
  it.each([['Rice', 'Paddy', 'Kharif'], ['DHAN', 'Paddy', 'Kharif'], ['gehu', 'Wheat', 'Rabi'], ['Green Gram', 'Moong', 'Kharif'], ['gram', 'Gram', 'Rabi']])(
    'crop %s -> %s (%s)', (input, name, season) => expect(findEligibleCrop(input)).toMatchObject({ name, season }))
  it('rejects non-notified crops', () => expect(findEligibleCrop('Tomato')).toBeNull())
  it.each([['Flood / Waterlogging', 'Flood'], ['Waterlogging due to flood', 'Inundation'], ['hail', 'Hailstorm']])(
    'calamity %s -> %s', (input, name) => expect(findCoveredCalamity(input)?.name).toBe(name))
  it('rejects uncovered calamities', () => expect(findCoveredCalamity('Pest attack')).toBeNull())
  it('detects the demo fallback location', () => {
    expect(isFallbackLocation(20.7453, 78.6022)).toBe(true)
    expect(isFallbackLocation(21.1, 79.0)).toBe(false)
  })
})

describe('cline-audit route', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'test-only-not-a-real-key')
    mocks.generate.mockReset().mockResolvedValue({ text: '{"consistent":true,"reason":"Matches."}' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.unstubAllEnvs())

  it('passes a compliant ClaimAnalysis with every field derived from input', async () => {
    const { status, data } = await audit(claim())
    expect(status).toBe(200)
    expect(data).toMatchObject({ audit_passed: true, compliance_score: '100%', agent_stamp: 'Verified by Autonomous Cline Auditor' })
    expect(data.checks.map((c: { name: string }) => c.name)).toEqual(['WINDOW', 'CROP', 'CALAMITY', 'GPS', 'CONSISTENCY'])
    expect(data.checks[0].detail).toContain('16 hrs')
    expect(data.checks[1].detail).toContain('Kharif')
    expect(Number.isFinite(Date.parse(data.audited_at))).toBe(true)
  })
  it('flags failures and switches the stamp', async () => {
    const { data } = await audit(claim({ hours_elapsed: 96, crop_type: 'Tomato', damage_cause: 'Pest attack', gps: { lat: null, lng: null, source: 'fallback', label: 'n/a' } }))
    expect(data.audit_passed).toBe(false)
    expect(data.agent_stamp).toBe('Flagged by Autonomous Cline Auditor - manual review required')
    expect(data.checks.filter((c: { status: string }) => c.status === 'fail')).toHaveLength(4)
    expect(data.compliance_score).toBe('20%')
  })
  it('treats fallback GPS as a warning, not a failure', async () => {
    const { data } = await audit(claim({ gps: { lat: 20, lng: 78, source: 'fallback', label: 'Approximate' } }))
    expect(data.audit_passed).toBe(true)
    expect(data.checks[3]).toMatchObject({ name: 'GPS', status: 'warn' })
    expect(data.compliance_score).toBe('95%')
  })
  it('fails CONSISTENCY when Gemini says the severity does not match', async () => {
    mocks.generate.mockResolvedValue({ text: '{"consistent":false,"reason":"Minor damage described."}' })
    const { data } = await audit(claim())
    expect(data.checks[4]).toMatchObject({ name: 'CONSISTENCY', status: 'fail' })
    expect(data.audit_passed).toBe(false)
  })
  it('keeps rule-based checks and warns when Gemini fails', async () => {
    mocks.generate.mockRejectedValue(new Error('network down'))
    const { status, data } = await audit(claim())
    expect(status).toBe(200)
    expect(data.checks[4]).toMatchObject({ name: 'CONSISTENCY', status: 'warn' })
    expect(data.audit_passed).toBe(true)
    expect(data.compliance_score).toBe('90%')
  })
  it('warns instead of failing when the analysis marked hours/damage as unknown placeholders', async () => {
    const { data } = await audit(claim({ hours_elapsed: 0, damage_pct: 0, warnings: ['hours_elapsed: unknown; 0 is a placeholder, not a verified estimate.', 'damage_pct: unknown; 0 is a placeholder, not a verified estimate.'] }))
    expect(data.checks[0]).toMatchObject({ name: 'WINDOW', status: 'warn' })
    expect(data.checks[4]).toMatchObject({ name: 'CONSISTENCY', status: 'warn' })
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('still accepts the legacy field names', async () => {
    const { data } = await audit({ translation: 'Flooded.', crop: 'gehu', calamity: 'hailstorm', damage_pct: 70, hours_ago: 10, gps: { lat: 22, lng: 77 } })
    expect(data.audit_passed).toBe(true)
    expect(data.checks[1].detail).toContain('Rabi')
  })
  it.each(['{not json', '[1,2]'])('rejects bad body %s with 400', async body => expect((await audit(body)).status).toBe(400))
})
