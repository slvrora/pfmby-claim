"use client"

import { useEffect, useRef, useState } from 'react'
import { Mic, Square, RotateCcw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Below this RMS level (0-1) for the whole recording we treat it as silence.
const SILENCE_RMS = 0.008
const MIN_SECONDS = 2

export function VoiceRecorder({ onRecorded }: { onRecorded: (audio: Blob | null) => void }) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [audio, setAudio] = useState('')
  const [error, setError] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const url = useRef('')
  // Loudness tracking, so a silent recording (muted mic) is never sent to the AI.
  const peakRms = useRef(0)
  const startedAt = useRef(0)
  const meter = useRef<{ ctx: AudioContext; timer: ReturnType<typeof setInterval> } | null>(null)

  function startMeter(s: MediaStream) {
    peakRms.current = 0
    try {
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      ctx.createMediaStreamSource(s).connect(analyser)
      const data = new Float32Array(analyser.fftSize)
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
        peakRms.current = Math.max(peakRms.current, Math.sqrt(sum / data.length))
      }, 100)
      meter.current = { ctx, timer }
    } catch {
      peakRms.current = Infinity // metering unavailable: skip the silence check
    }
  }

  function stopMeter() {
    if (!meter.current) return
    clearInterval(meter.current.timer)
    meter.current.ctx.close().catch(() => {})
    meter.current = null
  }
  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(timer)
  }, [recording])
  useEffect(() => () => { stopMeter(); stream.current?.getTracks().forEach(t => t.stop()); if (url.current) URL.revokeObjectURL(url.current) }, [])
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
        stopMeter()
        if (url.current) URL.revokeObjectURL(url.current)
        const blob = new Blob(chunks, { type: next.mimeType })
        url.current = URL.createObjectURL(blob)
        setAudio(url.current)
        stream.current?.getTracks().forEach(t => t.stop())
        const duration = (Date.now() - startedAt.current) / 1000
        if (duration < MIN_SECONDS) {
          setError('That recording was too short. Please hold on and describe what happened.')
          onRecorded(null)
        } else if (peakRms.current < SILENCE_RMS) {
          setError('We could not hear your voice. Check that your microphone is not muted, then tap Record again.')
          onRecorded(null)
        } else {
          onRecorded(blob)
        }
      }
      startMeter(stream.current)
      startedAt.current = Date.now()
      next.start(); setSeconds(0); setRecording(true)
    } catch { setError('Microphone unavailable. Please allow microphone access in your browser and try again.') }
  }
  return <div className="flex flex-col items-center">
    <div className="mic-halo"><button type="button" className="mic-button" onClick={toggle} aria-label={recording ? 'Stop recording' : 'Start recording'}>{recording ? <Square className="size-9" fill="currentColor" /> : <Mic className="size-10" strokeWidth={1.6} />}</button></div>
    <h3 className="mt-4 text-lg font-semibold">{recording ? 'We’re listening. Take your time.' : audio ? 'Your voice has been recorded' : 'Tap the mic. Tell us what happened.'}</h3>
    <p className="mt-1 text-sm text-muted-foreground" lang="hi">{recording ? 'रोकने के लिए फिर से दबाएँ' : 'माइक दबाएँ और अपनी फसल के नुकसान के बारे में बताएँ'}</p>
    <div className="mt-5 flex h-9 items-center gap-1" aria-hidden="true">{Array.from({ length: 39 }, (_, i) => <span key={i} className={recording ? 'wave-bar is-recording' : 'wave-bar'} style={{ height: `${6 + ((i * 17 + 9) % 29)}px`, animationDelay: `${i * .055}s` }} />)}</div>
    <p className="mt-2 font-mono text-xs text-muted-foreground">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')} <span className="mx-2">•</span> {recording ? 'Recording' : audio ? 'Recording complete' : 'Ready to record'}</p>
    {audio && !recording && <div className="mt-4 flex w-full flex-col items-center gap-2"><audio controls src={audio} className="h-10 w-full" /><Button variant="ghost" onClick={() => { setAudio(''); setSeconds(0); setError(''); onRecorded(null); URL.revokeObjectURL(url.current); url.current = '' }}><RotateCcw data-icon="inline-start" />Record again</Button></div>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" /> Your recording stays in this session. No typing needed.</p>
  </div>
}
