export function chooseVoice(voices: SpeechSynthesisVoice[], lang: 'hi' | 'en') {
  const locale = (voice: SpeechSynthesisVoice) => voice.lang.toLowerCase().replace(/_/g, '-')
  return (lang === 'hi' ? voices.find(v => locale(v) === 'hi-in') ?? voices.find(v => locale(v).startsWith('hi')) : undefined)
    ?? voices.find(v => locale(v) === 'en-in') ?? voices.find(v => v.default)
}

/** Short sentence/word chunks avoid long-utterance stalls on Android Chrome. */
export function speechChunks(text: string): string[] {
  const sentences = text.match(/[^।.!?]+[।.!?]*/g) ?? []
  return sentences.flatMap(sentence => {
    const chunks: string[] = []
    let rest = sentence.trim()
    while (rest.length > 120) {
      const space = rest.lastIndexOf(' ', 120)
      const end = space > 30 ? space : 120
      chunks.push(rest.slice(0, end)); rest = rest.slice(end).trim()
    }
    if (rest) chunks.push(rest)
    return chunks
  })
}