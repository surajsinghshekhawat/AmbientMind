/** Whisper names sounds it can't transcribe: "(dog barking)", "[Music]", "[BLANK_AUDIO]". */
const SOUND_LABEL = /[[(][^\])]*[\])]/g

/**
 * "Buy milk" often comes back as "Bye milk" or "Bye, milk." Nobody dictates a
 * task that opens with a farewell, so a leading "bye" with words after it is
 * "buy". "By" is left alone: "By Friday, send the report" means by.
 */
const LEADING_BYE = /^bye[,.!]?\s+(?=\w)/i

/** What Whisper heard, without its sound labels: noise alone comes back empty. */
export function cleanTranscript(text: string): string {
  return text.replace(SOUND_LABEL, ' ').replace(/\s+/g, ' ').trim().replace(LEADING_BYE, 'Buy ')
}
