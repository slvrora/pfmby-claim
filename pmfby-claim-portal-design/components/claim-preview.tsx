"use client"

import { useEffect, useRef, useState } from 'react'
import { Wheat, Waves, MapPin, Sparkles, Volume2, Download, Info, FileCheck2, Square, Loader2, Clock3 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AuditBadge } from '@/components/audit-badge'
import type { AuditState } from '@/components/claim-portal'
import { generateClaimSlip, type AuditResult, type ProcessClaimResponse } from '@/lib/generateClaimSlip'
import { useSpeech } from '@/lib/useSpeech'

const LANG_LABELS: [RegExp, string][] = [
  [/[\u0C00-\u0C7F]/, 'TELUGU'],
  [/[\u0B80-\u0BFF]/, 'TAMIL'],
  [/[\u0980-\u09FF]/, 'BENGALI'],
  [/[\u0C80-\u0CFF]/, 'KANNADA'],
  [/[\u0900-\u097F]/, 'HINDI / MARATHI'],
]
/** Label the transcript's script so the farmer sees which language was heard. */
function scriptLabel(text: string): string {
  return LANG_LABELS.find(([re]) => re.test(text))?.[1] ?? 'AS SPOKEN'
}

function severity(pct: number): string {
  if (pct >= 75) return 'Severe loss'
  if (pct >= 50) return 'Major loss'
  if (pct >= 25) return 'Moderate loss'
  return pct > 0 ? 'Minor loss' : 'No visible loss'
}

const Skeleton = ({ className = '' }: { className?: string }) => <div className={`animate-pulse rounded-md bg-[#ebeee5] ${className}`} />

function PreviewSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Analysing your claim">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />Listening to your statement and checking your photo…</div>
      <div className="grid grid-cols-2 gap-4"><Skeleton className="h-[74px]" /><Skeleton className="h-[74px]" /></div>
      <Skeleton className="h-16" />
      <Skeleton className="h-[118px]" />
      <div className="flex flex-col gap-2"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-24" /></div>
      <Skeleton className="h-11" />
    </div>
  )
}

// Convert a blob/object URL into a base64 data URL so jsPDF can embed it.
async function toDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}


interface PreviewProps {
  location: string
  photos: { name: string; url: string; file: File }[]
  result: ProcessClaimResponse | null
  audit: AuditState
  processing: boolean
}

export function ClaimPreview({ location, photos, result, audit, processing }: PreviewProps) {
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(false)
  const { speaking, lang, hindiAvailable, usedFallback, speak, setLang, cancel } = useSpeech()
  const autoPlayedFor = useRef<ProcessClaimResponse | null>(null)

  const readback = result ? { hi: result.summary_hi, en: result.summary } : null

  // Auto-play the readback once per new result, only if the browser allows it
  // (a voice is loaded). Otherwise the farmer just uses the Listen button.
  useEffect(() => {
    if (!result || autoPlayedFor.current === result) return
    if (!('speechSynthesis' in window) || window.speechSynthesis.getVoices().length === 0) return
    autoPlayedFor.current = result
    speak({ hi: result.summary_hi, en: result.summary }, hindiAvailable ? 'hi' : 'en')
  }, [result, speak, hindiAvailable])

  // Stop any readback and clear old messages when a new claim starts processing.
  useEffect(() => {
    if (processing) { cancel(); setMessage('') }
  }, [processing, cancel])

  async function download() {
    if (!result) return
    setGenerating(true); setMessage('Preparing your claim slip…')
    try {
      let imageDataUrl: string | null = null
      if (photos.length > 0) {
        try { imageDataUrl = await toDataUrl(photos[0].url) } catch { imageDataUrl = null }
      }
      const verdict: AuditResult | null = audit && audit !== 'loading' && !('error' in audit) ? audit : null
      const doc = await generateClaimSlip({ claim: result, gps: result.gps, imageDataUrl, audit: verdict })
      doc.save('Kisan-Claim-Slip-72A.pdf')
      setMessage(verdict
        ? 'Your Kisan Claim Slip (Form 72A) has been downloaded with the compliance stamp.'
        : 'Your Kisan Claim Slip (Form 72A) has been downloaded.')
    } catch (err) {
      console.error(err)
      setMessage('Sorry, the claim slip could not be generated. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const status = processing ? 'Analysing' : result ? 'AI assessment' : 'Awaiting submission'
  const auditPending = audit === 'loading'

  return <Card className="preview-card [--card-spacing:--spacing(6)]">
    <CardHeader><div className="mb-3 flex items-center justify-between"><span className="step-label">STEP 03</span><Badge variant="secondary"><Sparkles data-icon="inline-start" />{status}</Badge></div><CardTitle><h2>Your claim, made clear.</h2></CardTitle><CardDescription>A simple summary to help you take the next step.</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-5">
      {processing ? <PreviewSkeleton /> : !result ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
          <FileCheck2 className="size-7 text-[#879c73]" strokeWidth={1.5} />
          <p className="text-sm font-medium">Your claim summary will appear here.</p>
          <p className="max-w-[260px] text-xs leading-5 text-muted-foreground">Record your statement, add a field photo, then press <strong>Submit Claim</strong>. AI will detect the crop, calamity and damage for you.</p>
        </div>
      ) : <>
        <div className="preview-status"><FileCheck2 className="size-4" /><span>Your voice. Your field. One claim slip.</span></div>
        <div className="grid grid-cols-2 gap-4"><div className="detail-tile"><Wheat className="size-5" /><span>Detected crop</span><strong>{result.crop}</strong></div><div className="detail-tile"><Waves className="size-5" /><span>Calamity type</span><strong>{result.calamity}</strong></div></div>
        <div className="flex items-start gap-3 rounded-lg border p-3"><MapPin className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="text-xs text-muted-foreground">Field location</p><p className="mt-1 text-sm font-medium">{`${result.gps.lat.toFixed(5)}° N, ${result.gps.lng.toFixed(5)}° E`}</p><p className="mt-1 text-[11px] text-muted-foreground">{location ? 'Device GPS shared at the field' : result.gps_source === 'exif' ? 'From the photo’s GPS tag' : 'No GPS in photo, so the demo location (Wardha) is used. Add your field’s GPS in Step 2.'}</p></div></div>
        <div className="damage-box"><div className="flex items-center justify-between"><span className="text-sm font-medium">Estimated crop damage</span><Badge variant="outline">{severity(result.damage_pct)}</Badge></div><div className="my-3 flex items-baseline gap-1"><strong className="text-4xl font-semibold tracking-tight">{result.damage_pct}<span className="text-2xl">%</span></strong><span className="ml-2 text-xs text-muted-foreground">of the field affected (from photo)</span></div><div role="meter" aria-label="AI-assessed damage percentage" aria-valuenow={result.damage_pct} aria-valuemin={0} aria-valuemax={100} className="damage-track"><div style={{ width: `${result.damage_pct}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>0% · No damage</span><span>100% · Total loss</span></div><p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Clock3 className="size-3.5" />Incident about {result.hours_ago} hrs ago</p></div>
        <div><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Your words, understood.</h3><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">AI transcript</span></div><div className="transcript"><span className="transcript-label">ORIGINAL · {scriptLabel(result.transcript)}</span><p className="mt-2 text-sm leading-7">{result.transcript ? `“${result.transcript}”` : 'No speech was detected in the recording.'}</p><div className="my-3 border-t border-dashed" /><span className="transcript-label">ENGLISH TRANSLATION</span><p className="mt-2 text-xs leading-6 text-muted-foreground">“{result.translation}”</p></div></div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1 rounded-lg border p-1" role="group" aria-label="Readback language">
            <button type="button" onClick={() => setLang('hi')} disabled={!hindiAvailable} aria-pressed={lang === 'hi'} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${lang === 'hi' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'} ${!hindiAvailable ? 'cursor-not-allowed opacity-50' : ''}`} lang="hi">हिंदी</button>
            <button type="button" onClick={() => setLang('en')} aria-pressed={lang === 'en'} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${lang === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>English</button>
          </div>
          <Button variant="outline" className="h-11 w-full" onClick={() => readback && speak(readback, lang)}>{speaking ? <Square data-icon="inline-start" /> : <Volume2 data-icon="inline-start" />}{speaking ? 'Stop' : lang === 'hi' ? 'Listen in Hindi' : 'Listen in English'}<span lang="hi">{lang === 'hi' && !speaking ? '· हिंदी में सुनें' : ''}</span></Button>
          {!hindiAvailable && <p className="text-center text-[11px] leading-5 text-muted-foreground">Hindi voice not installed on this device. English readback is available.</p>}
          {usedFallback && <p role="status" className="rounded-lg border border-border bg-muted/40 p-2 text-center text-[11px] leading-5 text-muted-foreground">No Hindi voice found, so the English summary is playing instead.</p>}
        </div>
        <AuditBadge audit={audit} />
        <div className="flex gap-2 text-[11px] leading-5 text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" /><p>AI-assisted pre-assessment. Your insurer must verify the actual loss.</p></div>
        <Button className="h-12 w-full" onClick={download} disabled={generating || auditPending}>{generating || auditPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Download data-icon="inline-start" />}{generating ? 'Generating PDF…' : auditPending ? 'Waiting for compliance audit…' : 'Download Kisan Claim Slip'}</Button>
        <p className="-mt-2 text-center text-[11px] text-muted-foreground">Free to download · Includes the compliance audit stamp</p>
        {message && <p role="status" className="text-xs leading-5 text-primary">{message}</p>}
      </>}
    </CardContent>
  </Card>
}
