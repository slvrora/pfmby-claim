import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateContentParameters } from '@google/genai'

const mocks = vi.hoisted(() => ({
  generate: vi.fn<(params: GenerateContentParameters) => Promise<{ text?: string; promptFeedback?: { blockReason: string }; candidates?: { finishReason: string }[] }>>(),
  gps: vi.fn<() => Promise<unknown>>(), parse: vi.fn<() => Promise<unknown>>(),
}))
vi.mock('@google/genai', async importOriginal => {
  const actual = await importOriginal<typeof import('@google/genai')>()
  return { ...actual, GoogleGenAI: class { models = { generateContent: mocks.generate } } }
})
vi.mock('exifr', () => ({ gps: mocks.gps, parse: mocks.parse }))
import { POST } from '../app/api/process-claim/route'

function upload(options: { missingAudio?: boolean; audioMime?: string; imageSize?: number; device?: boolean } = {}) {
  const form = new FormData()
  if (!options.missingAudio) form.append('audio', new File(['audio'], 'recording', { type: options.audioMime ?? 'audio/webm;codecs=opus' }))
  form.append('image', new File([new Uint8Array(options.imageSize ?? 10)], 'field.png', { type: 'image/png' }))
  if (options.device) { form.append('deviceLat', '19'); form.append('deviceLng', '73') }
  return new Request('http://localhost/api/process-claim', { method: 'POST', body: form })
}

describe('process-claim route', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'test-only-not-a-real-key')
    vi.stubEnv('GEMINI_MODEL', '')
    vi.stubEnv('FALLBACK_LAT', '')
    vi.stubEnv('FALLBACK_LNG', '')
    mocks.generate.mockReset().mockResolvedValue({ text: '{"damage_pct":"65%"}' })
    mocks.gps.mockReset().mockResolvedValue(undefined)
    mocks.parse.mockReset().mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })
  it('missing audio -> 400 without calling Gemini', async () => {
    expect((await POST(upload({ missingAudio: true }))).status).toBe(400)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('oversized combined media -> 413', async () => expect((await POST(upload({ imageSize: 4_000_001 }))).status).toBe(413))
  it('rejects oversized content length before parsing', async () => {
    const request = new Request('http://localhost/api/process-claim', { method: 'POST', headers: { 'content-length': '5000000' } })
    expect((await POST(request)).status).toBe(413)
  })
  it('unsupported audio -> 400', async () => expect((await POST(upload({ audioMime: 'text/plain' }))).status).toBe(400))
  it('rejects oversized chunked request before multipart parsing', async () => {
    const request = new Request('http://localhost/api/process-claim', { method: 'POST', body: new Uint8Array(4_200_001) })
    expect((await POST(request)).status).toBe(413)
  })
  it('does not use blocked partial candidate text', async () => {
    mocks.generate.mockResolvedValue({ text: '{}', candidates: [{ finishReason: 'SAFETY' }] })
    expect((await POST(upload())).status).toBe(422)
  })
  it('malformed Gemini JSON -> 200 with explicit placeholder warnings', async () => {
    mocks.generate.mockResolvedValue({ text: '{broken' })
    const response = await POST(upload())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.warnings.join(' ')).toContain('placeholders')
    expect(data.summary_hi).toBeTruthy()
    expect(data.gps.lat).toBeNull()
    expect(data.photo_timestamp).toBeNull()
  })
  it('Gemini failure -> clean JSON without provider details', async () => {
    mocks.generate.mockRejectedValue(new Error('PRIVATE_PROVIDER_DETAIL'))
    const response = await POST(upload())
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('PRIVATE_PROVIDER_DETAIL')
    expect(console.error).toHaveBeenCalledWith('claim_analysis_failed', { code: 'UPSTREAM_ERROR' })
  })
  it('missing API key -> clean 500', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const response = await POST(upload())
    expect(response.status).toBe(500)
    expect(await response.json()).toHaveProperty('error')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it.each(['audio/mp4', 'audio/webm;codecs=opus'])('passes real audio format %s', async audioMime => {
    const response = await POST(upload({ audioMime }))
    expect(response.status).toBe(200)
    const params = mocks.generate.mock.calls[0][0]
    expect(JSON.stringify(params.contents)).toContain(`"mimeType":"${audioMime.split(';')[0]}"`)
    expect(params.config?.responseMimeType).toBe('application/json')
    expect(params.config?.responseSchema).toBeTruthy()
    expect(params.config?.abortSignal).toBeInstanceOf(AbortSignal)
  })
  it('EXIF failure falls through to device coordinates', async () => {
    mocks.gps.mockRejectedValue(new Error('corrupt tags')); mocks.parse.mockRejectedValue(new Error('bad EXIF'))
    const response = await POST(upload({ device: true }))
    expect(response.status).toBe(200)
    expect((await response.json()).gps).toMatchObject({ lat: 19, lng: 73, source: 'device' })
  })
  it('EXIF wins over device and stale photo is flagged', async () => {
    mocks.gps.mockResolvedValue({ latitude: 20, longitude: 78 })
    mocks.parse.mockResolvedValue({ DateTimeOriginal: '2020:01:01 12:00:00' })
    const data = await (await POST(upload({ device: true }))).json()
    expect(data.gps.source).toBe('exif')
    expect(data.warnings.join(' ')).toContain('72 hours old')
  })
  it('configured fallback is explicitly approximate', async () => {
    vi.stubEnv('FALLBACK_LAT', '20'); vi.stubEnv('FALLBACK_LNG', '78')
    const data = await (await POST(upload())).json()
    expect(data.gps).toMatchObject({ source: 'fallback', label: 'Approximate location (not verified)' })
  })
  it.each([{}, { text: '', promptFeedback: { blockReason: 'SAFETY' } }])('empty/blocked output -> 422', async result => {
    mocks.generate.mockResolvedValue(result)
    expect((await POST(upload())).status).toBe(422)
  })
  it.each([429, 503])('retries %s exactly once', async status => {
    mocks.generate.mockRejectedValueOnce({ status }).mockResolvedValueOnce({ text: '{}' })
    expect((await POST(upload())).status).toBe(200)
    expect(mocks.generate).toHaveBeenCalledTimes(2)
  })
  it('stops after a failed retry', async () => {
    mocks.generate.mockRejectedValue({ status: 503 })
    expect((await POST(upload())).status).toBe(503)
    expect(mocks.generate).toHaveBeenCalledTimes(2)
  })
  it('bounds a transport that never settles', async () => {
    vi.useFakeTimers()
    mocks.generate.mockImplementation(() => new Promise(() => {}))
    const response = POST(upload())
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(25_001)
    expect((await response).status).toBe(504)
  })
})