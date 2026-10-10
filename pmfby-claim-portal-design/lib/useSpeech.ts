"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { chooseVoice, speechChunks } from './speechUtils'

export type SpeechLang = 'hi' | 'en'

function synthesis(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
}

export function useSpeech() {
  const [supported, setSupported] = useState(false)
  const [voicesReady, setVoicesReady] = useState(false)
  const [hindiAvailable, setHindiAvailable] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [lang, setLang] = useState<SpeechLang>('hi')
  const [usedFallback, setUsedFallback] = useState(false)
  const [notice, setNotice] = useState('')
  const [needsTap, setNeedsTap] = useState(false)
  const voices = useRef<SpeechSynthesisVoice[]>([])
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)
  const run = useRef(0)
  const active = useRef(false)

  const cancel = useCallback(() => {
    run.current++
    active.current = false
    utterance.current = null
    synthesis()?.cancel()
    setIsSpeaking(false)
  }, [])

  useEffect(() => {
    const synth = synthesis()
    setSupported(Boolean(synth) && typeof SpeechSynthesisUtterance !== 'undefined')
    if (!synth) return
    const loadVoices = () => {
      voices.current = synth.getVoices()
      setHindiAvailable(voices.current.some(v => v.lang.toLowerCase().replace(/_/g, '-').startsWith('hi')))
      if (voices.current.length) setVoicesReady(true)
    }
    loadVoices()
    synth.addEventListener('voiceschanged', loadVoices)
    const timer = setTimeout(() => { loadVoices(); setVoicesReady(true) }, 1800)
    window.addEventListener('pagehide', cancel)
    window.addEventListener('beforeunload', cancel)
    return () => {
      clearTimeout(timer)
      synth.removeEventListener('voiceschanged', loadVoices)
      window.removeEventListener('pagehide', cancel)
      window.removeEventListener('beforeunload', cancel)
      run.current++; active.current = false; utterance.current = null; synth.cancel()
    }
  }, [cancel])

  const speak = useCallback((text: { hi: string; en: string }, target: SpeechLang) => {
    const synth = synthesis()
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return
    if (active.current) { cancel(); return }
    cancel()
    // No pending speech is scheduled while voices load: a user gesture starts immediately.
    voices.current = synth.getVoices()
    const hasHindi = voices.current.some(v => v.lang.toLowerCase().replace(/_/g, '-').startsWith('hi'))
    const effective = target === 'hi' && !hasHindi ? 'en' : target
    setUsedFallback(target === 'hi' && !hasHindi)
    setHindiAvailable(hasHindi)
    setNotice(''); setNeedsTap(false)
    const chunks = speechChunks(effective === 'hi' ? text.hi : text.en)
    if (!chunks.length) return
    const voice = chooseVoice(voices.current, target)
    const id = run.current
    active.current = true
    const next = (index: number) => {
      if (run.current !== id || !active.current) return
      if (index >= chunks.length) { active.current = false; utterance.current = null; setIsSpeaking(false); return }
      const current = new SpeechSynthesisUtterance(chunks[index])
      utterance.current = current
      current.lang = effective === 'hi' ? 'hi-IN' : 'en-IN'
      current.rate = 0.9
      if (voice) current.voice = voice
      current.onstart = () => { if (run.current === id && utterance.current === current) setIsSpeaking(true) }
      current.onend = () => { if (run.current === id && utterance.current === current) next(index + 1) }
      current.onerror = event => {
        if (run.current !== id || utterance.current !== current) return
        active.current = false; utterance.current = null; setIsSpeaking(false)
        if (event.error === 'not-allowed') { setNeedsTap(true); setNotice('Playback was blocked. Tap to listen.') }
        else if (!['interrupted', 'canceled'].includes(event.error)) setNotice('Audio playback is unavailable. You can read the summary or try again.')
      }
      try { synth.cancel(); synth.speak(current) }
      catch { active.current = false; utterance.current = null; setIsSpeaking(false); setNotice('Audio playback is unavailable on this device.') }
    }
    next(0)
  }, [cancel])

  return { speaking: isSpeaking, supported, voicesReady, lang, hindiAvailable, usedFallback, notice, needsTap, speak, setLang, cancel }
}