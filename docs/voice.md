# Voice input

Press **⌃⌥Space** on a Mac (**Ctrl+Shift+A** on Windows) to open Quick Capture,
then click the mic or press **⌘L** (**Ctrl+L**). Speak a task; it stops on its
own after 2.5 seconds of silence, or press ⌘L again. AmbientMind transcribes
locally and submits.

On a Mac with the helper running, you can also **hold** the shortcut: the mic starts as soon as the
hold is recognised (300 ms), keeps listening through pauses, and stops when you let go. A short tap
still opens Quick Capture, or toggles the mic if it is already open.

In Quick Capture, **Enter** adds the task and closes the window; **⌘Enter**
(**Ctrl+Enter**) adds it and keeps the window open for the next one. Tasks
added by voice show "Voice" as their source in the panel.

## Two routes from one utterance

| You say | What happens |
| --- | --- |
| "buy milk tomorrow" | Quick-add + LLM enrichment (deadline, priority) |
| "add what's on my screen" / "add this to my tasks" | Same pipeline as **⌃⌥S** on a Mac (**Ctrl+Shift+S** on Windows) |

Intent detection lives in `shared/voiceIntent.ts` and applies to typed text
too, so the same phrasing works without the mic. Reading the screen is off
until you turn on Settings → Capture → **Read the screen**.

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

Settings → Capture → **Voice model** (**Fallback voice model** when Apple's
is installed) picks the Whisper size; `Xenova/whisper-base.en` is the default.
The model downloads once, on first use, into `whisper/` in the app data folder
(`.local/data/whisper/` when run from the repo).

## Audio path

Apple live speech:

1. The helper captures the mic with AVAudioEngine, converts to the analyzer's
   format and streams it to SpeechAnalyzer.
2. It pushes `speech.partial` (shown in the field) and `speech.level` (the
   meter, and pause detection in toggle mode) to Quick Capture through main.
3. Stopping finalizes and returns the full text.

Whisper:

1. Quick Capture requests the mic (`getUserMedia`).
2. `PcmRecorder` captures mono float32 and resamples to 16 kHz in the renderer.
3. Main process runs Whisper and returns a transcript.

Either way, submit follows the intent table above. Pause detection is
`shared/silence.ts` (2.5 s of quiet after speech); the tap-versus-hold rule is
`electron/holdGesture.ts`. Audio is never written to disk.

The Quick Capture window does not dismiss on blur while recording, because granting
the mic can briefly steal focus. While you're recording, quiet mode doesn't
count AmbientMind's own mic use as "in a call".

## Not in v1

- Always-on wake word ("hey AmbientMind") — custom wake-word engines are paid
  or unreliable; push-to-talk covers the same intent for free.
- Continuous dictation into the overlay.
