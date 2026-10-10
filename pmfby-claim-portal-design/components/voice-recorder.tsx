"use client"

import { useEffect, useRef, useState } from 'react'
import { Mic, Square, RotateCcw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function VoiceRecorder({ onRecorded }: { onRecorded: (audio: Blob | null) => void }) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [audio, setAudio] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const url = useRef('')
  const permissionPending = useRef(false)
  const alive = useRef(false)
  const generation = useRef(0)
  const cap = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callback = useRef(onRecorded)
  callback.current = onRecorded
  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(timer)
  }, [recording])
  useEffect(() => {
    alive.current = true
    const stop = () => {
      generation.current++
      permissionPending.current = false
      if (cap.current) clearTimeout(cap.current)
      const current = recorder.current
      if (current) {
        current.onstop = null; current.ondataavailable = null; current.onerror = null
        if (current.state !== 'inactive') current.stop()
      }
      stream.current?.getTracks().forEach(t => t.stop())
      stream.current = null; recorder.current = null
      if (alive.current) { setRecording(false); setPending(false) }
    }
    window.addEventListener('pagehide', stop)
    return () => { alive.current = false; stop(); window.removeEventListener('pagehide', stop); if (url.current) URL.revokeObjectURL(url.current) }
  }, [])
  async function toggle() {
    if (permissionPending.current) return
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return }
    if (recorder.current) return // Wait for the previous recording's final data/stop event.
    permissionPending.current = true; setPending(true)
    const id = ++generation.current
    setError('')
    let acquired: MediaStream | null = null
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('unsupported')
      acquired = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!alive.current || generation.current !== id) { acquired.getTracks().forEach(t => t.stop()); return }
      stream.current = acquired
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw new Error('format')
      const next = new MediaRecorder(acquired, { mimeType, audioBitsPerSecond: 64000 })
      recorder.current = next
      const localStream = acquired
      const chunks: Blob[] = []
      let failed = false
      const release = () => { if (generation.current === id && cap.current) clearTimeout(cap.current); localStream.getTracks().forEach(t => t.stop()) }
      next.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      next.onerror = () => {
        failed = true; release()
        if (next.state !== 'inactive') next.stop()
        recorder.current = null
        if (alive.current && generation.current === id) { setRecording(false); setError('Recording was interrupted. Please record again.'); callback.current(null) }
      }
      next.onstop = () => {
        release()
        if (!alive.current || generation.current !== id || failed) return
        setRecording(false)
        recorder.current = null
        const blob = new Blob(chunks, { type: next.mimeType || chunks[0]?.type || mimeType })
        if (!blob.size) { setError('No audio was captured. Please record again.'); callback.current(null); return }
        if (url.current) URL.revokeObjectURL(url.current)
        url.current = URL.createObjectURL(blob)
        setAudio(url.current); callback.current(blob)
      }
      callback.current(null)
      next.start(1000); setSeconds(0); setRecording(true)
      cap.current = setTimeout(() => { if (next.state === 'recording') next.stop() }, 60_000)
    } catch {
      acquired?.getTracks().forEach(t => t.stop())
      recorder.current = null
      if (cap.current) clearTimeout(cap.current)
      if (alive.current && generation.current === id) { setRecording(false); setError('Microphone unavailable or recording format unsupported. Allow microphone access and try again.'); callback.current(null) }
    } finally {
      if (generation.current === id) { permissionPending.current = false; if (alive.current) setPending(false) }
    }
  }
  return <div className="flex flex-col items-center">
    <div className="mic-halo"><button type="button" className="mic-button focus-visible:outline-2 focus-visible:outline-offset-4" onClick={toggle} disabled={pending} aria-label={recording ? 'Stop recording' : 'Start recording'}>{recording ? <Square className="size-9" fill="currentColor" /> : <Mic className="size-10" strokeWidth={1.6} />}</button></div>
    <h3 className="mt-4 text-lg font-semibold">{pending ? 'Waiting for microphone permission…' : recording ? 'We’re listening. Up to 60 seconds.' : audio ? 'Your voice has been recorded' : 'Tap the mic. Tell us what happened.'}</h3>
    <p className="mt-1 text-sm text-muted-foreground" lang="hi">{recording ? 'रोकने के लिए फिर से दबाएँ' : 'माइक दबाएँ और अपनी फसल के नुकसान के बारे में बताएँ'}</p>
    <div className="mt-5 flex h-9 items-center gap-1" aria-hidden="true">{Array.from({ length: 39 }, (_, i) => <span key={i} className={recording ? 'wave-bar is-recording' : 'wave-bar'} style={{ height: `${6 + ((i * 17 + 9) % 29)}px`, animationDelay: `${i * .055}s` }} />)}</div>
    <p className="mt-2 font-mono text-xs text-muted-foreground">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')} <span className="mx-2">•</span> {recording ? `${Math.max(0, 60 - seconds)} seconds remaining` : audio ? 'Recording complete' : 'Ready to record'}</p>
    {audio && !recording && <div className="mt-4 flex w-full flex-col items-center gap-2"><audio controls src={audio} className="h-10 w-full" /><Button variant="ghost" onClick={() => { setAudio(''); setSeconds(0); onRecorded(null); URL.revokeObjectURL(url.current); url.current = '' }}><RotateCcw data-icon="inline-start" />Record again</Button></div>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" /> Recording is sent for analysis only when you prepare a draft.</p>
  </div>
}
