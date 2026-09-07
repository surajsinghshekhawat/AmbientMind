# Capturing the screen as a task

Press **Ctrl+Shift+S** and AmbientMind reads whatever is on screen, works out
what you need to do about it, and files it as a task with a short write-up.

Everything runs on this machine. The screenshot is held in memory, converted to
text, and discarded; only the resulting task is stored.

## How it works

1. `desktopCapturer` grabs the primary display at native resolution.
2. Tesseract reads the text off it.
3. Lines that are too short, or more punctuation than letters, are dropped —
   toolbars and icon rows otherwise dominate the input.
4. `qwen2.5:3b` turns the remaining text into one task: title, one-sentence
   summary, deadline, priority, and the people involved.
5. The deadline string is normalised in code (see below) and the task is saved.

## Why OCR and not a vision model

A vision-language model reads a screenshot more faithfully than OCR, and
`qwen2.5vl:3b` would be the obvious candidate. It needs roughly 3.2GB of VRAM.
This machine has 4GB, which is enough for that model *or* the extraction model
but not both, so every capture would evict `qwen2.5:3b` and reload it
afterwards — several seconds of stall on each side, on top of a 3.2GB download.

Screens are overwhelmingly text, and OCR recovers that text for about 15MB and
no VRAM at all. The tradeoff would change on a larger card, so the swap point is
kept narrow: `readScreenText` in `electron/services/screenContext.ts` is the
only thing that would need replacing.

## Two things that had to be fixed by measurement

**The model has to be told who you are.** Without a name it cannot tell which
person on screen is the one being asked to do something, and it returned an
empty task every time. This is the same failure that halved recall in the email
extractor. The name comes from your connected mailbox, falling back to your OS
account name.

**Deadlines come back inconsistently.** The JSON schema can only require that
the deadline is a string, so the model returns `"2026-09-10"` sometimes and
`"Thursday"` other times. Prompting did not make this reliable, so
`shared/deadline.ts` resolves weekday names, `today`, `tomorrow` and `EOD`
in code instead. A day named without a time means 17:00, not midnight.

Naming the weekday for the *current* time helped the model resolve "Thursday"
to the right date. Doing the same to the date header of an incoming email did
not: recall on the eval corpus fell from 71% to 29%, because the added
boilerplate crowds out the message. The email extractor therefore still gets a
raw date header. Both variants are kept in `eval/results/` as the record.

## Known limits

- The whole screen is captured, so a second window with a lot of text can win
  over the one you were reading. Maximise what you want captured.
- The model sometimes invents a deadline the screen never stated. Check the
  date on anything that matters.
- Content inside an image, video, or a heavily styled page reads poorly. OCR
  only recovers rendered text.

## Voice

The spoken form — "hey AmbientMind, add what's on my screen" — routes into the
same function, which already accepts a free-text instruction to steer what it
focuses on. Wiring the microphone to it is Phase 6; the hotkey is the same
pipeline without the speech step.
