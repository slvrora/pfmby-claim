"use client"

import { useEffect, useRef, useState } from 'react'
import { Sprout, Phone, ArrowUpRight, Clock3, Check, Mic, Camera, FileText, Languages, Upload, MapPin, ShieldCheck, HeartHandshake, X, ChevronRight, Info, Send, Loader2 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { VoiceRecorder } from '@/components/voice-recorder'
import { ClaimPreview } from '@/components/claim-preview'
import type { AuditResult, ProcessClaimResponse } from '@/lib/generateClaimSlip'

export type AuditState = AuditResult | 'loading' | { error: string } | null

/** POST JSON/FormData and surface the server's { error } message on failure. */
async function postForJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { method: 'POST', ...init })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error((data && typeof data.error === 'string' && data.error) || `Request failed (${res.status})`)
  return data as T
}

export function ClaimPortal() {
  const [language, setLanguage] = useState('hi-IN')
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const hasAudio = audioBlob !== null
  const [photos, setPhotos] = useState<{ name: string; url: string; file: File }[]>([])
  const [result, setResult] = useState<ProcessClaimResponse | null>(null)
  const [audit, setAudit] = useState<AuditState>(null)
  const [processing, setProcessing] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const runId = useRef(0)
  const [location, setLocation] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const [incident, setIncident] = useState('')
  const [remaining, setRemaining] = useState(72 * 3600)
  const input = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const photoUrls = useRef<string[]>([])
  useEffect(() => () => photoUrls.current.forEach(url => URL.revokeObjectURL(url)), [])
  useEffect(() => {
    if (!incident) return
    const update = () => setRemaining(Math.max(0, Math.floor((new Date(incident).getTime() + 72 * 3600000 - Date.now()) / 1000)))
    update(); const timer = setInterval(update, 1000); return () => clearInterval(timer)
  }, [incident])
  function addPhotos(files: FileList | null) {
    if (!files) return
    const selected = Array.from(files)
    if (selected.some(f => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 10 * 1024 * 1024)) { setError('Please choose JPG, PNG or WebP images smaller than 10 MB.'); return }
    if (photos.length + selected.length > 4) { setError('You can add up to 4 field photos.'); return }
    setError('')
    const added = selected.map(f => ({ name: f.name, url: URL.createObjectURL(f), file: f }))
    photoUrls.current.push(...added.map(p => p.url)); setPhotos(p => [...p, ...added])
  }
  function locate() {
    if (!navigator.geolocation) { setError('Location is unavailable on this device.'); return }
    setLocating(true); setError('')
    navigator.geolocation.getCurrentPosition(p => { const lat = p.coords.latitude, lng = p.coords.longitude; setCoords({ lat, lng }); setLocation(`${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E`); setLocating(false) }, () => { setError('Location could not be accessed. Allow location permission and try again while at your field.'); setLocating(false) }, { timeout: 15000, enableHighAccuracy: true })
  }
  // Changing the recording or photos makes previous results stale, so clear them.
  useEffect(() => {
    runId.current++
    setResult(null); setAudit(null); setProcessing(false); setSubmitError('')
  }, [audioBlob, photos])

  // Submit: process the claim with Gemini, then run the Cline compliance audit on the result.
  async function submitClaim() {
    if (!audioBlob || photos.length === 0 || processing) return
    const id = ++runId.current
    setProcessing(true); setSubmitError(''); setResult(null); setAudit(null)
    try {
      const ext = (audioBlob.type.split(';')[0].split('/')[1] || 'webm').replace('x-', '')
      const form = new FormData()
      form.append('audio', audioBlob, `statement.${ext}`)
      form.append('image', photos[0].file, photos[0].file.name)
      form.append('language', language)
      const claim = await postForJson<ProcessClaimResponse>('/api/process-claim', { body: form })
      if (id !== runId.current) return
      // Prefer the device GPS the farmer shared at the field over photo EXIF / fallback.
      const claimWithGps = coords ? { ...claim, gps: coords } : claim
      setResult(claimWithGps)
      setProcessing(false)

      setAudit('loading')
      try {
        const verdict = await postForJson<AuditResult>('/api/cline-audit', {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(claimWithGps),
        })
        if (id === runId.current) setAudit(verdict)
      } catch (err) {
        if (id === runId.current) setAudit({ error: err instanceof Error ? err.message : 'Audit failed' })
      }
    } catch (err) {
      if (id !== runId.current) return
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setProcessing(false)
    }
  }
  const time = [Math.floor(remaining / 3600), Math.floor(remaining / 60) % 60, remaining % 60]
  return <>
    <div className="top-strip"><span>A little support. A stronger tomorrow.</span><span className="hidden sm:inline">Built for our farmers. In your own language.</span></div>
    <header className="site-header"><a href="/" className="brand" aria-label="Kisan Sahay home"><span className="brand-icon"><Sprout className="size-7" /></span><span>Kisan<span className="font-normal">Sahay</span><small>किसान की आवाज़, किसान का अधिकार</small></span></a><div className="flex items-center gap-5"><a href="https://pmfby.gov.in" target="_blank" rel="noopener noreferrer" className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">About PMFBY <ArrowUpRight className="size-3.5" /></a><a href="tel:14447" className="help-link"><Phone className="size-4" /><span>Need help?<strong>14447</strong></span></a></div></header>
    <main className="page-shell">
      <section className="hero"><div className="hero-content"><span className="eyebrow"><span /> STANDING WITH FARMERS</span><h1>PMFBY 72-Hour<br />Fast-Track Claim Portal<span>.</span></h1><p>Your hard work matters. Let&apos;s protect it.</p><div className="hero-caption">Report flood damage in 3 simple steps —<br className="sm:hidden" /> speak, capture, and prepare your claim.</div><div className="hero-pills"><span><Check />No complicated forms</span><span><Check />Your own language</span></div></div><div className="hero-image"><img src="/images/farmland.png" alt="Green rice fields and reflective monsoon water in rural India" /><div className="image-note"><Sprout className="size-4" /> Every field. Every farmer. Every season.</div></div></section>
      <section className="deadline-banner" aria-label="Claim reporting deadline"><div className="flex items-center gap-3"><span className="clock-icon"><Clock3 className="size-5" /></span><div><h2>Don&apos;t wait. Report within 72 hours.</h2><p>Report crop loss promptly to your insurer through official channels.</p></div></div><div className="countdown"><div className="flex items-center gap-1.5">{time.map((t, i) => <div key={i} className="flex items-start gap-1.5"><div className="time-unit"><strong>{String(t).padStart(2, '0')}</strong><span>{['HOURS', 'MINS', 'SECS'][i]}</span></div>{i < 2 && <span className="pt-1 text-lg">:</span>}</div>)}</div><span className="countdown-note">{incident ? 'Reporting window remaining' : 'Set loss date to start timer ↓'}</span></div></section>
      <details className="incident-details"><summary>When did the crop loss occur? <span>Set your reporting reminder</span></summary><label className="mt-3 flex flex-wrap items-center gap-3 text-xs">Date and time of loss<input aria-label="Date and time of loss" type="datetime-local" value={incident} onChange={e => { if (new Date(e.target.value).getTime() > Date.now()) { setError('Please choose a loss date in the past.'); return } setIncident(e.target.value) }} className="rounded-md border bg-card p-2" /></label><p className="mt-2 text-xs text-muted-foreground">Reminder only, not an official deadline determination. Contact your insurer even if time has elapsed.</p></details>
      <nav className="stepper" aria-label="Claim preparation steps">{[{ icon: Mic, label: 'Tell your story', done: hasAudio }, { icon: Camera, label: 'Show your field', done: photos.length > 0 }, { icon: FileText, label: 'Get your claim slip', done: result !== null }].map((step, i) => <div className="stepper-item" key={step.label}><span className={i === 0 || step.done ? 'step-circle active' : 'step-circle'}>{step.done ? <Check /> : <step.icon />}</span><span><small>STEP 0{i + 1}</small><strong>{step.label}</strong></span>{i < 2 && <ChevronRight className="step-chevron" />}</div>)}</nav>
      <div className="claim-grid"><div className="flex min-w-0 flex-col gap-5">
        <Card className="[--card-spacing:--spacing(6)]"><CardHeader><div className="mb-3 flex items-center justify-between"><span className="step-label">STEP 01</span><span className="optional-label">Your voice is enough</span></div><CardTitle><h2>Tell us what happened.</h2></CardTitle><CardDescription>Speak freely in the language you&apos;re comfortable with.</CardDescription></CardHeader><CardContent><div className="language-picker"><Languages className="size-4" /><label htmlFor="recording-language">I speak</label><select id="recording-language" value={language} onChange={e => setLanguage(e.target.value)}><option value="hi-IN">हिंदी (Hindi)</option><option value="mr-IN">मराठी (Marathi)</option><option value="bn-IN">বাংলা (Bengali)</option><option value="ta-IN">தமிழ் (Tamil)</option><option value="te-IN">తెలుగు (Telugu)</option><option value="kn-IN">ಕನ್ನಡ (Kannada)</option><option value="en-IN">English</option></select></div><div className="recording-surface"><VoiceRecorder onRecorded={setAudioBlob} /></div><div className="recording-tip"><Info className="size-4 shrink-0" /><p><strong>Not sure what to say?</strong> Tell us your crop, when the flooding happened, and how much of your field is affected.</p></div></CardContent></Card>
        <Card className="[--card-spacing:--spacing(6)]"><CardHeader><div className="mb-3 flex items-center justify-between"><span className="step-label">STEP 02</span><span className="optional-label">A picture tells your story</span></div><CardTitle><h2>Show us your field.</h2></CardTitle><CardDescription>Add clear photos of your flooded crop and field.</CardDescription></CardHeader><CardContent><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={e => { addPhotos(e.target.files); e.target.value = '' }} /><input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { addPhotos(e.target.files); e.target.value = '' }} /><div className="upload-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addPhotos(e.dataTransfer.files) }}><span className="camera-icon"><Camera className="size-7" strokeWidth={1.5} /></span><h3>Let your field speak for itself.</h3><p>A wide view and a close-up work best.</p><div className="mt-4 flex flex-wrap justify-center gap-2"><Button variant="outline" className="h-10" onClick={() => camera.current?.click()}><Camera data-icon="inline-start" />Take a photo</Button><Button variant="outline" className="h-10" onClick={() => input.current?.click()}><Upload data-icon="inline-start" />Upload photos</Button></div><small>JPG, PNG or WebP · Up to 10 MB each · Max. 4 photos</small></div>{photos.length > 0 && <div className="mt-3 grid grid-cols-2 gap-3">{photos.map(photo => <div key={photo.url} className="relative overflow-hidden rounded-lg"><img src={photo.url} alt={photo.name} className="h-28 w-full object-cover" /><button className="absolute right-1 top-1 rounded-full bg-card p-1.5" aria-label={`Remove ${photo.name}`} onClick={() => { setPhotos(p => p.filter(x => x.url !== photo.url)); URL.revokeObjectURL(photo.url) }}><X className="size-4" /></button></div>)}</div>}<button onClick={locate} disabled={locating} className="location-button"><MapPin className="size-4" /><span>{locating ? 'Finding your location…' : location || 'Add my field’s GPS location'}</span>{location && <Check className="ml-auto size-4" />}</button><p className="mt-2 text-[11px] text-muted-foreground">Be at your field when sharing your location.</p></CardContent></Card>
        <div className="flex flex-col gap-2">
          <Button className="h-12 w-full" onClick={submitClaim} disabled={!hasAudio || photos.length === 0 || processing}>{processing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}{processing ? 'Analysing your claim…' : 'Submit Claim'}</Button>
          <p className="text-center text-[11px] text-muted-foreground">{!hasAudio && photos.length === 0 ? 'Record your statement and add a field photo to continue.' : !hasAudio ? 'Record your statement in Step 1 to continue.' : photos.length === 0 ? 'Add a field photo in Step 2 to continue.' : photos.length > 1 ? 'Your first photo will be analysed.' : 'Your recording and photo will be analysed by AI.'}</p>
          {submitError && <p role="alert" className="rounded-lg border border-destructive/30 bg-card p-3 text-xs leading-5 text-destructive">{submitError}</p>}
        </div>
      </div><ClaimPreview location={location} photos={photos} result={result} audit={audit} processing={processing} /></div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive">{error}</p>}
      <section className="reassurance"><div><ShieldCheck /><span><strong>Your story stays yours</strong><small>Session-only media. Nothing submitted.</small></span></div><div><Languages /><span><strong>Speak your language</strong><small>Made for the way you communicate.</small></span></div><div><HeartHandshake /><span><strong>For every farmer</strong><small>Tenant farmers deserve support, too.</small></span></div></section>
    </main><footer><div className="footer-inner"><div className="flex items-center gap-2"><Sprout className="size-4" /><strong>KisanSahay</strong><span> · With you, from seed to security.</span></div><p>Independent claim-preparation demo. Not a government portal.</p><a href="https://pmfby.gov.in" target="_blank" rel="noopener noreferrer">Visit official PMFBY <ArrowUpRight className="size-3" /></a></div></footer>
  </>
}
