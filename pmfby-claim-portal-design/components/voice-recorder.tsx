"use client"

import { useEffect, useRef, useState } from 'react'
import { Mic, Square, RotateCcw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function VoiceRecorder({ onRecorded }: { onRecorded: (ready: boolean) => void }) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [audio, setAudio] = useState('')
  const [error, setError] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const url = useRef('')
  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(timer)
  }, [recording])
  useEffect(() => () => { stream.current?.getTracks().forEach(t => t.stop()); if (url.current) URL.revokeObjectURL(url.current) }, [])
  async function toggle() {
    if (recording) { recorder.current?.stop(); setRecording(false); return }
    setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('unsupported')
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      const next = new MediaRecorder(stream.current)
      recorder.current = next
      const chunks: BlobPart[] = []
      next.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      next.onstop = () => {
        if (url.current) URL.revokeObjectURL(url.current)
        url.current = URL.createObjectURL(new Blob(chunks, { type: next.mimeType }))
        setAudio(url.current); onRecorded(true)
        stream.current?.getTracks().forEach(t => t.stop())
      }
      next.start(); setSeconds(0); setRecording(true)
    } catch { setError('Microphone unavailable. Please allow microphone access in your browser and try again.') }
  }
  return <div className="flex flex-col items-center">
    <div className="mic-halo"><button type="button" className="mic-button" onClick={toggle} aria-label={recording ? 'Stop recording' : 'Start recording'}>{recording ? <Square className="size-9" fill="currentColor" /> : <Mic className="size-10" strokeWidth={1.6} />}</button></div>
    <h3 className="mt-4 text-lg font-semibold">{recording ? 'We’re listening. Take your time.' : audio ? 'Your voice has been recorded' : 'Tap the mic. Tell us what happened.'}</h3>
    <p className="mt-1 text-sm text-muted-foreground" lang="hi">{recording ? 'रोकने के लिए फिर से दबाएँ' : 'माइक दबाएँ और अपनी फसल के नुकसान के बारे में बताएँ'}</p>
    <div className="mt-5 flex h-9 items-center gap-1" aria-hidden="true">{Array.from({ length: 39 }, (_, i) => <span key={i} className={recording ? 'wave-bar is-recording' : 'wave-bar'} style={{ height: `${6 + ((i * 17 + 9) % 29)}px`, animationDelay: `${i * .055}s` }} />)}</div>
    <p className="mt-2 font-mono text-xs text-muted-foreground">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')} <span className="mx-2">•</span> {recording ? 'Recording' : audio ? 'Recording complete' : 'Ready to record'}</p>
    {audio && !recording && <div className="mt-4 flex w-full flex-col items-center gap-2"><audio controls src={audio} className="h-10 w-full" /><Button variant="ghost" onClick={() => { setAudio(''); setSeconds(0); onRecorded(false); URL.revokeObjectURL(url.current); url.current = '' }}><RotateCcw data-icon="inline-start" />Record again</Button></div>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" /> Your recording stays in this session. No typing needed.</p>
  </div>
}
