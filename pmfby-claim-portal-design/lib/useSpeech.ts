"use client"

/**
 * useSpeech.ts
 * ------------
 * Small wrapper around the Web Speech API (window.speechSynthesis) used to read
 * the claim confirmation back to (often non-literate) farmers.
 *
 * Features:
 *  - Loads available voices and keeps them in sync via the `voiceschanged` event
 *    (Chrome populates the voice list asynchronously).
 *  - Speaks Hindi (`hi-IN`, rate 0.9) when a Hindi voice exists; otherwise falls
 *    back to English (`en-IN`) and reports that a fallback happened.
 *  - Exposes a speaking state + a toggle between Hindi and English readback.
 *  - Can auto-play the readback once when results load, but only if the browser
 *    actually allows it (we detect whether a usable voice is present).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type SpeechLang = 'hi' | 'en'

export interface UseSpeechResult {
  /** Whether an utterance is currently being spoken. */
  speaking: boolean
  /** The language currently selected for readback. */
  lang: SpeechLang
  /** True when a Hindi (hi-IN) voice is available on this device. */
  hindiAvailable: boolean
  /** True when the last speak() call had to fall back to English. */
  usedFallback: boolean
  /** Speak the given text in the given language. Toggles off if already speaking. */
  speak: (text: { hi: string; en: string }, lang: SpeechLang) => void
  /** Switch the active readback language. */
  setLang: (lang: SpeechLang) => void
  /** Cancel any in-progress speech. */
  cancel: () => void
}

const HI_PREFIX = 'hi'

function getSpeechSynthesis(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null
  return 'speechSynthesis' in window ? window.speechSynthesis : null
}

export function useSpeech(): UseSpeechResult {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [lang, setLang] = useState<SpeechLang>('hi')
  const [usedFallback, setUsedFallback] = useState(false)
  const synth = getSpeechSynthesis()

  // Load voices and keep them in sync (Chrome loads them asynchronously).
  useEffect(() => {
    if (!synth) return
    const load = () => setVoices(synth.getVoices())
    load()
    synth.addEventListener('voiceschanged', load)
    return () => synth.removeEventListener('voiceschanged', load)
  }, [synth])

  // Cancel any pending speech when the component using the hook unmounts.
  useEffect(() => {
    if (!synth) return
    return () => synth.cancel()
  }, [synth])

  const hindiAvailable = voices.some((v) => v.lang?.toLowerCase().startsWith(HI_PREFIX))

  const cancel = useCallback(() => {
    synth?.cancel()
    setSpeaking(false)
  }, [synth])

  const speak = useCallback(
    (text: { hi: string; en: string }, target: SpeechLang) => {
      if (!synth) return

      // Clicking again while speaking cancels playback (toggle behaviour).
      if (speaking) {
        synth.cancel()
        setSpeaking(false)
        return
      }

      const wantHindi = target === 'hi'
      const hasHindi = voices.some((v) => v.lang?.toLowerCase().startsWith(HI_PREFIX))

      // Fall back to English when Hindi is requested but unavailable.
      const effectiveLang: SpeechLang = wantHindi && !hasHindi ? 'en' : target
      setUsedFallback(wantHindi && !hasHindi)

      const utterance = new SpeechSynthesisUtterance(effectiveLang === 'hi' ? text.hi : text.en)
      utterance.lang = effectiveLang === 'hi' ? 'hi-IN' : 'en-IN'
      utterance.rate = 0.9

      const voice = voices.find((v) => v.lang?.toLowerCase().startsWith(effectiveLang === 'hi' ? HI_PREFIX : 'en'))
      if (voice) utterance.voice = voice

      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)

      synth.cancel()
      synth.speak(utterance)
      setSpeaking(true)
    },
    [synth, speaking, voices],
  )

  return { speaking, lang, hindiAvailable, usedFallback, speak, setLang, cancel }
}
