# Voice input

Press **Ctrl+Shift+A** (**⌃⌥Space** on a Mac) to open QuickAdd, then click the mic or press the
shortcut again. Speak a task; it stops on its own after a pause, or press the shortcut again.
AmbientMind transcribes locally and submits.

On a Mac with the helper running, you can also **hold** the shortcut: the mic starts as soon as the
hold is recognised (300 ms), keeps listening through pauses, and stops when you let go. A short tap
still opens QuickAdd, or toggles the mic if it is already open.

## Two routes from one utterance

| You say | What happens |
| --- | --- |
| "buy milk tomorrow" | Quick-add + LLM enrichment (deadline, priority) |
| "add what's on my screen" / "add this to my tasks" | Same pipeline as **Ctrl+Shift+S** (**⌃⌥S** on a Mac) |

Intent detection lives in `shared/voiceIntent.ts` and applies to typed text
too, so the same phrasing works without the mic.

## Two engines

**Apple live speech (Mac, macOS 26).** The Swift helper runs SpeechAnalyzer
with volatile results, so words appear in the field while you talk and the
final text lands within a moment of stopping. Hints (your name, people and
short task titles) are passed as contextual strings, so names are spelled the
way your tasks spell them. The language model is a system asset that macOS
keeps with Dictation's, outside the app, so it is downloaded only when you
press **Download** in Settings → Capture.

**Whisper (everywhere else, and the fallback).** Native whisper.cpp bindings
need rebuilding for Electron's Node ABI. This project already hit that cost
with `better-sqlite3`. `@xenova/transformers` runs Whisper as ONNX with no
compile step. It is warmed in the background after launch, but only when it
will be used: with Apple's model installed it is never loaded.

## Audio path

Apple live speech:

1. The helper captures the mic with AVAudioEngine, converts to the analyzer's
   format and streams it to SpeechAnalyzer.
2. It pushes `speech.partial` (shown in the field) and `speech.level` (the
   meter, and pause detection in toggle mode) to Quick Capture through main.
3. Stopping finalizes and returns the full text.

Whisper:

1. QuickAdd requests the mic (`getUserMedia`).
2. `PcmRecorder` captures mono float32 and resamples to 16 kHz in the renderer.
3. Main process runs Whisper and returns a transcript.

Either way, submit follows the intent table above. Pause detection is
`shared/silence.ts`; the tap-versus-hold rule is `electron/holdGesture.ts`.

The QuickAdd window does not dismiss on blur while recording, because granting
the mic can briefly steal focus.

## Not in v1

- Always-on wake word ("hey AmbientMind") — custom wake-word engines are paid
  or unreliable; push-to-talk covers the same intent for free.
- Continuous dictation into the overlay.
