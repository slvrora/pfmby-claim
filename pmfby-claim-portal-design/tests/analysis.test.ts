import { describe, expect, it } from 'vitest'
import { normalizeAnalysis, photoTimestamp, safeParseGeminiJson, validCoordinates } from '../lib/claimAnalysis'
import { chooseVoice, speechChunks } from '../lib/speechUtils'

describe('safeParseGeminiJson', () => {
  it.each(['{"crop_type":"Rice"}', '```json\n{"crop_type":"Rice"}\n```', 'Here is the result: {"crop_type":"Rice"} Thank you.'])('parses %s', raw => {
    expect(safeParseGeminiJson(raw)).toEqual({ crop_type: 'Rice' })
  })
  it.each(['{"crop_type":', 'invalid', ''])('returns null for invalid input %s', raw => expect(safeParseGeminiJson(raw)).toBeNull())
})

describe('normalizeAnalysis', () => {
  it.each([['65%', 65], ['65', 65], [150, 100], [-5, 0], [null, 0], [undefined, 0]])('normalizes damage %s', (input, expected) => {
    const result = normalizeAnalysis({ damage_pct: input })
    expect(result.damage_pct).toBe(expected)
    expect(result.summary_hi).toContain(`${expected}%`)
    expect(result.warnings.some(w => w.startsWith('summary_hi:'))).toBe(true)
    if (input == null) expect(result.warnings.some(w => w.startsWith('damage_pct:'))).toBe(true)
  })
  it('defaults every missing model field and coerces hours', () => {
    const result = normalizeAnalysis(null)
    for (const field of ['transcript_original', 'transcript_en', 'crop_type', 'damage_cause', 'damage_pct', 'hours_elapsed', 'summary_hi', 'summary_en']) {
      expect(result.warnings.some(w => w.startsWith(field + ':'))).toBe(true)
    }
    expect(normalizeAnalysis({ hours_elapsed: '-12' }).hours_elapsed).toBe(0)
    expect(normalizeAnalysis({ hours_elapsed: '16' }).hours_elapsed).toBe(16)
  })
  it('rejects unsafe filing assurances and Roman-script Hindi', () => {
    const result = normalizeAnalysis({ summary_hi: 'आपका दावा दर्ज हो गया।', summary_en: 'Your claim has been filed.' })
    expect(result.summary_en).not.toContain('filed')
    expect(result.summary_hi).not.toContain('दर्ज')
    expect(normalizeAnalysis({ summary_hi: 'Paddy damage' }).summary_hi).toMatch(/[\u0900-\u097f]/)
  })
})

describe('GPS validation', () => {
  it.each([
    [19, 73, true], [0, 73, true], [90, -180, true], [NaN, 73, false], [0, 0, false],
    [91, 73, false], [19, 181, false], [undefined, undefined, false], ['19', '73', false], [Infinity, 0, false],
  ])('validates (%s, %s)', (lat, lng, expected) => expect(validCoordinates(lat, lng)).toBe(expected))
})

describe('photo timestamps', () => {
  it('assumes IST rather than server timezone for EXIF without an offset', () => {
    expect(photoTimestamp('2026:10:10 12:00:00', undefined)).toBe('2026-10-10T06:30:00.000Z')
  })
  it('honors explicit offsets', () => expect(photoTimestamp('2026:10:10 12:00:00', '+00:00')).toBe('2026-10-10T12:00:00.000Z'))
  it.each([undefined, 'invalid', '2026:02:30 12:00:00', '2026:10:10 29:00:00'])('rejects %s', value => expect(photoTimestamp(value, null)).toBeNull())
})

describe('speech helpers', () => {
  const voice = (lang: string, isDefault = false): SpeechSynthesisVoice => ({ lang, default: isDefault, name: lang, localService: true, voiceURI: lang })
  it('prioritizes exact Hindi, Hindi family, Indian English, then default', () => {
    const voices = [voice('en-US', true), voice('en-IN'), voice('hi'), voice('HI_IN')]
    expect(chooseVoice(voices, 'hi')?.lang).toBe('HI_IN')
    expect(chooseVoice(voices.slice(0, 3), 'hi')?.lang).toBe('hi')
    expect(chooseVoice(voices.slice(0, 2), 'hi')?.lang).toBe('en-IN')
    expect(chooseVoice(voices.slice(0, 1), 'hi')?.lang).toBe('en-US')
  })
  it('bounds long utterances and splits Hindi/English sentences', () => {
    const chunks = speechChunks('फसल खराब है। Please check. Why? ' + 'नुकसान '.repeat(200))
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.every(chunk => chunk.length <= 120 && chunk.length > 0)).toBe(true)
    expect(speechChunks('')).toEqual([])
  })
})