"use client"

import { useState } from 'react'
import { Wheat, Waves, MapPin, Sparkles, Volume2, Download, Info, FileCheck2, Square } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const hindi = 'मेरे खेत में लगातार बारिश की वजह से पानी भर गया है। मेरी धान की फसल का बहुत नुकसान हुआ है। लगभग पूरा खेत पानी में डूबा हुआ है।'
const english = 'My field is waterlogged due to continuous rain. My paddy crop has been badly damaged. Almost the entire field is submerged in water.'
export function ClaimPreview({ location, hasAudio, photoCount }: { location: string; hasAudio: boolean; photoCount: number }) {
  const [speaking, setSpeaking] = useState(false)
  const [message, setMessage] = useState('')
  function listen() {
    if (!('speechSynthesis' in window)) { setMessage('Hindi readback is not supported by this browser.'); return }
    if (speaking) { speechSynthesis.cancel(); setSpeaking(false); return }
    const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith('hi'))
    if (!voice) { setMessage('A Hindi voice is not available on this device. Please use a device with Hindi text-to-speech installed.'); return }
    const utterance = new SpeechSynthesisUtterance('यह एक उदाहरण है। ' + hindi)
    utterance.lang = 'hi-IN'; utterance.voice = voice
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => { setSpeaking(false); setMessage('Audio playback could not complete.') }
    speechSynthesis.cancel(); speechSynthesis.speak(utterance); setSpeaking(true); setMessage('')
  }
  function download() {
    const slip = `KISAN CLAIM SLIP — SAMPLE / NOT SUBMITTED\n\nThis is an illustrative draft, not an insurance claim or proof of reporting.\n\nExample crop: Paddy (rice)\nExample calamity: Flood / waterlogging\nIllustrative damage: 85% (not an assessment)\nDevice location: ${location || 'Not provided'}\nAudio attached in this session: ${hasAudio ? 'Yes' : 'No'}\nPhotos in this session: ${photoCount}\n\nEXAMPLE HINDI TRANSCRIPT (not transcribed from your recording):\n${hindi}\n\nEXAMPLE ENGLISH TRANSLATION:\n${english}\n\nReport your loss through your insurer or the official PMFBY channels. Eligibility and loss must be verified. Your uploaded media is not included in this text slip.`
    const url = URL.createObjectURL(new Blob([slip], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'kisan-claim-slip-draft.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('Your sample claim slip has been downloaded. It has not been submitted to an insurer.')
  }
  return <Card className="preview-card [--card-spacing:--spacing(6)]">
    <CardHeader><div className="mb-3 flex items-center justify-between"><span className="step-label">STEP 03</span><Badge variant="secondary"><Sparkles data-icon="inline-start" />Sample preview</Badge></div><CardTitle><h2>Your claim, made clear.</h2></CardTitle><CardDescription>A simple summary to help you take the next step.</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-5">
      <div className="preview-status"><FileCheck2 className="size-4" /><span>Your voice. Your field. One claim slip.</span></div>
      <div className="grid grid-cols-2 gap-4"><div className="detail-tile"><Wheat className="size-5" /><span>Detected crop</span><strong>Paddy (Rice)</strong></div><div className="detail-tile"><Waves className="size-5" /><span>Calamity type</span><strong>Flood / Waterlogging</strong></div></div>
      <div className="flex items-start gap-3 rounded-lg border p-3"><MapPin className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="text-xs text-muted-foreground">Field location</p><p className="mt-1 text-sm font-medium">{location || 'Add your location in Step 2'}</p><p className="mt-1 text-[11px] text-muted-foreground">{location ? 'Device GPS · confirm this is your field' : 'GPS is shared only with your permission'}</p></div></div>
      <div className="damage-box"><div className="flex items-center justify-between"><span className="text-sm font-medium">Estimated crop damage</span><Badge variant="outline">Severe loss</Badge></div><div className="my-3 flex items-baseline gap-1"><strong className="text-4xl font-semibold tracking-tight">85<span className="text-2xl">%</span></strong><span className="ml-2 text-xs text-muted-foreground">of the field affected</span></div><div role="meter" aria-label="Illustrative damage percentage" aria-valuenow={85} aria-valuemin={0} aria-valuemax={100} className="damage-track"><div /></div><div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>0% · No damage</span><span>100% · Total loss</span></div></div>
      <div><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Your words, understood.</h3><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Example transcript</span></div><div className="transcript"><span className="transcript-label">ORIGINAL · HINDI</span><p lang="hi" className="mt-2 text-sm leading-7">“{hindi}”</p><div className="my-3 border-t border-dashed" /><span className="transcript-label">ENGLISH TRANSLATION</span><p className="mt-2 text-xs leading-6 text-muted-foreground">“{english}”</p></div></div>
      <Button variant="outline" className="h-11 w-full" onClick={listen}>{speaking ? <Square data-icon="inline-start" /> : <Volume2 data-icon="inline-start" />}{speaking ? 'Stop listening' : 'Listen in Hindi'}<span lang="hi">· हिंदी में सुनें</span></Button>
      <div className="flex gap-2 text-[11px] leading-5 text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" /><p>Illustrative assessment only. Uploaded media is not automatically analysed. Your insurer must verify the actual loss.</p></div>
      <Button className="h-12 w-full" onClick={download}><Download data-icon="inline-start" />Download Kisan Claim Slip</Button>
      <p className="-mt-2 text-center text-[11px] text-muted-foreground">Free to download · No claim has been submitted</p>
      {message && <p role="status" className="text-xs leading-5 text-primary">{message}</p>}
    </CardContent>
  </Card>
}
