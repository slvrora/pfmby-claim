"use client"

import { useEffect, useRef, useState } from 'react'
import { Wheat, Waves, MapPin, Sparkles, Volume2, Download, Info, FileCheck2, Square, Loader2 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { generateClaimSlip } from '@/lib/generateClaimSlip'
import { useSpeech } from '@/lib/useSpeech'
import { isRecord, normalizeAnalysis, validCoordinates } from '@/lib/claimAnalysis'
import { DRAFT_STATUS_EN, DRAFT_STATUS_HI, FILING_CONTACT_TODO, FILING_NEXT_STEP, MAX_MEDIA_BYTES, type ClaimAnalysis } from '@/lib/types'
import { AuditBadge } from '@/components/audit-badge'
import type { AuditState, AuditVerdict } from '@/lib/auditTypes'

/** Run the Cline PMFBY Compliance Auditor on a finished draft analysis. */
async function runAudit(analysis: ClaimAnalysis, signal: AbortSignal): Promise<AuditVerdict> {
  const response = await fetch('/api/cline-audit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(analysis), signal,
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok || !isRecord(data) || typeof data.audit_passed !== 'boolean' || !Array.isArray(data.checks)) {
    throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : `Audit unavailable (${response.status})`)
  }
  return data as unknown as AuditVerdict
}

async function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Photo could not be read.'))
    reader.onerror = () => reject(new Error('Photo could not be read.'))
    reader.onabort = () => reject(new Error('Photo reading was interrupted.'))
    reader.readAsDataURL(file)
  })
}

interface Props {
  coords: { lat: number; lng: number } | null
  photos: { name: string; url: string; file: File }[]
  audio: Blob | null
  language: string
  incident: string
}

export function ClaimPreview({ coords, photos, audio, language, incident }: Props) {
  const [analysis, setAnalysis] = useState<ClaimAnalysis | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const pending = useRef(false)
  const downloading = useRef(false)
  const request = useRef<AbortController | null>(null)
  const revision = useRef(0)
  const { speaking, lang, hindiAvailable, usedFallback, supported, voicesReady, notice, needsTap, speak, setLang, cancel } = useSpeech()
  const [audit, setAudit] = useState<AuditState>(null)
  const auditRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    revision.current++
    request.current?.abort()
    auditRequest.current?.abort()
    setAnalysis(null); setMessage(''); setError(''); setAudit(null); cancel()
    return () => { revision.current++; request.current?.abort(); auditRequest.current?.abort(); cancel() }
  }, [audio, photos, coords, language, incident, cancel])

  // Once a draft analysis is ready, run the Cline compliance audit on it.
  useEffect(() => {
    if (!analysis) return
    const controller = new AbortController()
    auditRequest.current = controller
    setAudit('loading')
    runAudit(analysis, controller.signal)
      .then(verdict => { if (!controller.signal.aborted) setAudit(verdict) })
      .catch(cause => { if (!controller.signal.aborted) setAudit({ error: cause instanceof Error ? cause.message : 'Audit failed' }) })
    return () => controller.abort()
  }, [analysis])

  async function prepare() {
    if (pending.current) return
    if (!audio || !photos[0]) { setError('Record your story and add a field photo first.'); return }
    if (audio.size + photos[0].file.size > MAX_MEDIA_BYTES) {
      setError('The recording and first photo must total under 4 MB. Please use a smaller photo or shorter recording. Your inputs have been kept.'); return
    }
    pending.current = true
    setLoading(true); setError(''); setAnalysis(null); setMessage(''); cancel()
    const controller = new AbortController()
    request.current = controller
    const timer = setTimeout(() => controller.abort('timeout'), 35_000)
    try {
      const form = new FormData()
      form.append('audio', audio, 'recording')
      form.append('image', photos[0].file)
      if (coords) { form.append('deviceLat', String(coords.lat)); form.append('deviceLng', String(coords.lng)) }
      form.append('language', language)
      if (incident) form.append('incident', incident)
      const response = await fetch('/api/process-claim', { method: 'POST', body: form, signal: controller.signal })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : `Analysis unavailable (${response.status}). Please retry.`)
      if (!isRecord(data) || !Array.isArray(data.warnings) || !isRecord(data.gps)) throw new Error('The server response could not be read. Please retry.')
      const result = normalizeAnalysis(data)
      result.warnings = [...new Set([...result.warnings, ...data.warnings.filter((item): item is string => typeof item === 'string')])]
      const gps = data.gps
      if (validCoordinates(gps.lat, gps.lng) && typeof gps.lng === 'number' && ['exif', 'device', 'fallback'].includes(String(gps.source))) {
        result.gps = { lat: gps.lat, lng: gps.lng, source: gps.source === 'exif' ? 'exif' : gps.source === 'device' ? 'device' : 'fallback', label: typeof gps.label === 'string' ? gps.label : 'Location not verified' }
      }
      result.photo_timestamp = typeof data.photo_timestamp === 'string' && Number.isFinite(Date.parse(data.photo_timestamp)) ? data.photo_timestamp : null
      if (!controller.signal.aborted) setAnalysis(result)
    } catch (cause) {
      if (!controller.signal.aborted || controller.signal.reason === 'timeout') {
        setError(controller.signal.aborted ? 'Analysis timed out. Please retry; your inputs are kept.' : cause instanceof Error ? cause.message : 'Network unavailable. Please retry; your inputs are kept.')
      }
    } finally { clearTimeout(timer); pending.current = false; setLoading(false) }
  }

  async function download() {
    if (!analysis || downloading.current) return
    const currentRevision = revision.current
    downloading.current = true; setGenerating(true); setMessage('Preparing your draft slip…')
    try {
      let imageDataUrl: string | null = null
      let photoWarning = ''
      if (photos[0]) {
        try { imageDataUrl = await toDataUrl(photos[0].file) } catch { photoWarning = 'The photo could not be attached. Keep the original as evidence. ' }
      }
      const verdict = audit && audit !== 'loading' && !('error' in audit) ? audit : null
      const result = await generateClaimSlip({ claim: analysis, imageDataUrl, audit: verdict })
      if (revision.current !== currentRevision) return
      result.doc.save('Kisan-Claim-Slip-72A.pdf')
      setMessage(photoWarning + 'Draft PDF download requested. ' + DRAFT_STATUS_EN + ' ' + result.warnings.join(' '))
    } catch { setMessage('The draft PDF could not be generated. Please try again.') }
    finally { downloading.current = false; setGenerating(false) }
  }

  return <Card className="preview-card [--card-spacing:--spacing(6)]">
    <CardHeader><div className="mb-3 flex items-center justify-between"><span className="step-label">STEP 03</span><Badge variant="secondary"><Sparkles data-icon="inline-start" />Draft preview</Badge></div><CardTitle><h2>Your claim, made clear.</h2></CardTitle><CardDescription>A draft to review before contacting your insurer.</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-5">
      <p className="text-xs text-muted-foreground">Preparing a draft sends your recording and the first photo to Google Gemini for analysis. Audio + photo: under 4 MB combined. Additional photos stay in this session; keep them for your insurer.</p>
      <Button className="h-11 w-full" onClick={prepare} disabled={loading || !audio || !photos.length}>{loading ? <Loader2 className="animate-spin" /> : <Sparkles />}{loading ? 'Preparing draft…' : error ? 'Retry draft analysis' : 'Prepare draft intimation'}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {analysis && <>
        <div className="preview-status"><FileCheck2 className="size-4" /><span>{DRAFT_STATUS_EN}<br /><span lang="hi">{DRAFT_STATUS_HI}</span></span></div>
        <div className="grid grid-cols-2 gap-4"><div className="detail-tile"><Wheat className="size-5" /><span>Detected crop</span><strong>{analysis.crop_type}</strong></div><div className="detail-tile"><Waves className="size-5" /><span>Calamity type</span><strong>{analysis.damage_cause}</strong></div></div>
        <div className="flex items-start gap-3 rounded-lg border p-3"><MapPin className="size-4 shrink-0" /><div><p className="text-xs">{analysis.gps.label}</p><p className="text-xs text-muted-foreground">{analysis.gps.lat !== null && analysis.gps.lng !== null ? `${analysis.gps.lat.toFixed(5)}, ${analysis.gps.lng.toFixed(5)}` : 'Not available'}</p></div></div>
        <div className="damage-box"><span className="text-sm font-medium">Estimated crop damage · verify before filing</span><div className="my-3 text-4xl font-semibold">{analysis.damage_pct}%</div><div role="meter" aria-label="Estimated damage percentage" aria-valuenow={analysis.damage_pct} aria-valuemin={0} aria-valuemax={100} className="damage-track"><div style={{ width: `${analysis.damage_pct}%` }} /></div></div>
        <div className="transcript"><span className="transcript-label">ORIGINAL</span><p lang={language} className="mt-2 text-sm leading-7 break-words">{analysis.transcript_original}</p><div className="my-3 border-t border-dashed" /><span className="transcript-label">ENGLISH TRANSLATION</span><p className="mt-2 text-xs leading-6 break-words">{analysis.transcript_en}</p></div>
        <p lang="hi" className="text-sm leading-7">{analysis.summary_hi}</p><p className="text-xs leading-6">{analysis.summary_en}</p>
        {analysis.warnings.length > 0 && <div role="status" className="rounded-lg border p-3 text-xs leading-6"><strong>Please review these details</strong><ul className="list-disc pl-4">{analysis.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2" role="group" aria-label="Readback language"><Button variant="outline" onClick={() => { cancel(); setLang('hi') }} aria-pressed={lang === 'hi'}>हिंदी</Button><Button variant="outline" onClick={() => { cancel(); setLang('en') }} aria-pressed={lang === 'en'}>English</Button></div>
          <Button variant="outline" className="h-11 w-full" disabled={!supported} onClick={() => speak({ hi: `${DRAFT_STATUS_HI} ${analysis.summary_hi}`, en: `${DRAFT_STATUS_EN} ${analysis.summary_en}` }, lang)}>{speaking ? <Square /> : <Volume2 />}{speaking ? 'Stop' : needsTap ? 'Tap to listen' : lang === 'hi' ? 'Listen in Hindi · हिंदी में सुनें' : 'Listen in English'}</Button>
          {supported && voicesReady && !hindiAvailable && <p className="text-xs text-muted-foreground">Hindi voice not installed on this device — English readback is available.</p>}
          {!supported && <p className="text-xs text-muted-foreground">Speech playback is not supported on this device.</p>}
          {notice && <p role="status" className="text-xs">{notice}</p>}
          {usedFallback && <p role="status" className="text-xs">Playing the English summary instead.</p>}
        </div>
        <AuditBadge audit={audit} />
        <div className="flex gap-2 text-xs leading-5"><Info className="size-4 shrink-0" /><p>AI-assisted draft only. Your insurer must verify the actual loss. {FILING_NEXT_STEP} {FILING_CONTACT_TODO && `Verified contact: ${FILING_CONTACT_TODO}`}</p></div>
        <p lang="hi" className="text-xs">यह मसौदा अपनी बीमा कंपनी या आधिकारिक PMFBY पोर्टल पर जमा करें।</p>
        <Button className="h-12 w-full" onClick={download} disabled={generating || audit === 'loading'}>{generating || audit === 'loading' ? <Loader2 className="animate-spin" /> : <Download />}{generating ? 'Generating PDF…' : audit === 'loading' ? 'Waiting for compliance audit…' : 'Download draft claim slip'}</Button>
      </>}
      {message && <p role="status" className="text-xs leading-5 text-primary">{message}</p>}
    </CardContent>
  </Card>
}