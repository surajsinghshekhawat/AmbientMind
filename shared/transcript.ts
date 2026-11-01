/** Whisper names sounds it can't transcribe: "(dog barking)", "[Music]", "[BLANK_AUDIO]". */
const SOUND_LABEL = /[[(][^\])]*[\])]/g

/** What Whisper heard, without its sound labels: noise alone comes back empty. */
export function cleanTranscript(text: string): string {
  return text.replace(SOUND_LABEL, ' ').replace(/\s+/g, ' ').trim()
}
