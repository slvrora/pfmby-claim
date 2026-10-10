"use client"

import { useEffect, useRef, useState } from 'react'
import { Wheat, Waves, MapPin, Sparkles, Volume2, Download, Info, FileCheck2, Square, Loader2 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { generateClaimSlip, type ClaimSlipInput } from '@/lib/generateClaimSlip'
import { useSpeech } from '@/lib/useSpeech'

const hindi = 'मेरे खेत में लगातार बारिश की वजह से पानी भर गया है। मेरी धान की फसल का बहुत नुकसान हुआ है। लगभग पूरा खेत पानी में डूबा हुआ है।'
const english = 'My field is waterlogged due to continuous rain. My paddy crop has been badly damaged. Almost the entire field is submerged in water.'
// Short, farmer-friendly confirmations spoken back to the farmer (matches the
// `summary` / `summary_hi` fields produced by /api/process-claim).
const summaryHi = 'आपका दावा दर्ज हो गया है। फसल: धान (Paddy)। नुकसान: 85 प्रतिशत। बाढ़ के कारण हुआ नुकसान 72 घंटे के भीतर दर्ज किया गया है।'
const summaryEn = 'Your claim has been recorded. Crop: Paddy. Damage: 85 percent. The flood damage has been filed within the 72-hour window.'

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

export function ClaimPreview({ location, coords, photos, hasAudio, photoCount }: { location: string; coords: { lat: number; lng: number } | null; photos: { name: string; url: string }[]; hasAudio: boolean; photoCount: number }) {
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(false)
  const { speaking, lang, hindiAvailable, usedFallback, speak, setLang } = useSpeech()
  const autoPlayed = useRef(false)

  // Auto-play the readback once after results load — only if the browser allows
  // it (i.e. a usable voice is actually available). Otherwise just show buttons.
  useEffect(() => {
    if (autoPlayed.current) return
    if (!('speechSynthesis' in window)) return
    // Wait until the voice list has populated before deciding.
    if (window.speechSynthesis.getVoices().length === 0) return
    autoPlayed.current = true
    speak({ hi: summaryHi, en: summaryEn }, 'hi')
  }, [speak])

  async function download() {
    setGenerating(true); setMessage('Preparing your claim slip…')
    try {
      // Embed the first uploaded field photo (if any) as a data URL.
      let imageDataUrl: string | null = null
      if (photos.length > 0) {
        try { imageDataUrl = await toDataUrl(photos[0].url) } catch { imageDataUrl = null }
      }
      // Sample claim payload matching the /api/process-claim schema (Phase 2).
      const input: ClaimSlipInput = {
        claim: {
          transcript: hindi,
          translation: english,
          crop: 'Paddy (Rice)',
          calamity: 'Flood / Waterlogging',
          damage_pct: 85,
          hours_ago: 16,
          summary: summaryEn,
          summary_hi: summaryHi,
        },
        gps: coords,
        imageDataUrl,
      }
      const doc = await generateClaimSlip(input)
      doc.save('Kisan-Claim-Slip-72A.pdf')
      setMessage('Your Kisan Claim Slip (Form 72A) has been downloaded as a PDF.')
    } catch (err) {
      console.error(err)
      setMessage('Sorry, the claim slip could not be generated. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  return <Card className="preview-card [--card-spacing:--spacing(6)]">
    <CardHeader><div className="mb-3 flex items-center justify-between"><span className="step-label">STEP 03</span><Badge variant="secondary"><Sparkles data-icon="inline-start" />Sample preview</Badge></div><CardTitle><h2>Your claim, made clear.</h2></CardTitle><CardDescription>A simple summary to help you take the next step.</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-5">
      <div className="preview-status"><FileCheck2 className="size-4" /><span>Your voice. Your field. One claim slip.</span></div>
      <div className="grid grid-cols-2 gap-4"><div className="detail-tile"><Wheat className="size-5" /><span>Detected crop</span><strong>Paddy (Rice)</strong></div><div className="detail-tile"><Waves className="size-5" /><span>Calamity type</span><strong>Flood / Waterlogging</strong></div></div>
      <div className="flex items-start gap-3 rounded-lg border p-3"><MapPin className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="text-xs text-muted-foreground">Field location</p><p className="mt-1 text-sm font-medium">{location || 'Add your location in Step 2'}</p><p className="mt-1 text-[11px] text-muted-foreground">{location ? 'Device GPS · confirm this is your field' : 'GPS is shared only with your permission'}</p></div></div>
      <div className="damage-box"><div className="flex items-center justify-between"><span className="text-sm font-medium">Estimated crop damage</span><Badge variant="outline">Severe loss</Badge></div><div className="my-3 flex items-baseline gap-1"><strong className="text-4xl font-semibold tracking-tight">85<span className="text-2xl">%</span></strong><span className="ml-2 text-xs text-muted-foreground">of the field affected</span></div><div role="meter" aria-label="Illustrative damage percentage" aria-valuenow={85} aria-valuemin={0} aria-valuemax={100} className="damage-track"><div /></div><div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>0% · No damage</span><span>100% · Total loss</span></div></div>
      <div><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Your words, understood.</h3><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Example transcript</span></div><div className="transcript"><span className="transcript-label">ORIGINAL · HINDI</span><p lang="hi" className="mt-2 text-sm leading-7">“{hindi}”</p><div className="my-3 border-t border-dashed" /><span className="transcript-label">ENGLISH TRANSLATION</span><p className="mt-2 text-xs leading-6 text-muted-foreground">“{english}”</p></div></div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1 rounded-lg border p-1" role="group" aria-label="Readback language">
          <button type="button" onClick={() => setLang('hi')} disabled={!hindiAvailable} aria-pressed={lang === 'hi'} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${lang === 'hi' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'} ${!hindiAvailable ? 'cursor-not-allowed opacity-50' : ''}`} lang="hi">हिंदी</button>
          <button type="button" onClick={() => setLang('en')} aria-pressed={lang === 'en'} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${lang === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>English</button>
        </div>
        <Button variant="outline" className="h-11 w-full" onClick={() => speak({ hi: summaryHi, en: summaryEn }, lang)}>{speaking ? <Square data-icon="inline-start" /> : <Volume2 data-icon="inline-start" />}{speaking ? 'Stop' : lang === 'hi' ? 'Listen in Hindi' : 'Listen in English'}<span lang="hi">{lang === 'hi' && !speaking ? '· हिंदी में सुनें' : ''}</span></Button>
        {!hindiAvailable && <p className="text-center text-[11px] leading-5 text-muted-foreground">Hindi voice not installed on this device — English readback is available.</p>}
        {usedFallback && <p role="status" className="rounded-lg border border-border bg-muted/40 p-2 text-center text-[11px] leading-5 text-muted-foreground">No Hindi voice found — playing the English summary instead.</p>}
      </div>
      <div className="flex gap-2 text-[11px] leading-5 text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" /><p>Illustrative assessment only. Uploaded media is not automatically analysed. Your insurer must verify the actual loss.</p></div>
      <Button className="h-12 w-full" onClick={download} disabled={generating}>{generating ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Download data-icon="inline-start" />}{generating ? 'Generating PDF…' : 'Download Kisan Claim Slip'}</Button>
      <p className="-mt-2 text-center text-[11px] text-muted-foreground">Free to download · No claim has been submitted</p>
      {message && <p role="status" className="text-xs leading-5 text-primary">{message}</p>}
    </CardContent>
  </Card>
}
