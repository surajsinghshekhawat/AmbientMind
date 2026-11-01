# AmbientMind — System document

The long-form record of the project: what the system is, every part it is built
from, how each part works, why it was chosen, what was rejected, what it costs,
what has been measured, and what is planned. Short how-tos for Google, voice
and screen capture live alongside this file under `docs/`.

Version 0.2.0. Last updated: 16 September 2026.

---

## Table of contents

1. [What this product is](#1-what-this-product-is)
2. [Hardware, and what it forced](#2-hardware-and-what-it-forced)
3. [The machine-learning stack, in detail](#3-the-machine-learning-stack-in-detail)
4. [Architecture](#4-architecture)
5. [Data model](#5-data-model)
6. [The pipelines](#6-the-pipelines)
7. [Complete feature inventory](#7-complete-feature-inventory)
8. [Design decisions: why, alternatives, drawbacks](#8-design-decisions-why-alternatives-drawbacks)
9. [Failure modes that were real](#9-failure-modes-that-were-real)
10. [Known limitations](#10-known-limitations)
11. [What is planned](#11-what-is-planned)
12. [Fine-tuning: the case for, against, and the recipe](#12-fine-tuning-the-case-for-the-case-against-and-the-recipe)
13. [Building, running, packaging](#13-building-running-packaging)
14. [Repository map](#14-repository-map)
15. [Explicitly out of scope](#15-explicitly-out-of-scope)
16. [Related documents](#16-related-documents)
17. [Appendix: the neural networks, in full detail](#17-appendix-the-neural-networks-in-full-detail)

---

## 1. What this product is

AmbientMind is a **desktop overlay for macOS and Windows** that keeps a short,
urgency-sorted todo list on screen at all times. The Mac is the primary
platform: a menu-bar app with a Swift helper for Apple's on-device model,
speech, Calendar, Reminders and screen reading. Windows runs the same app
without the helper. The list is meant to fill *itself*: a local
language model reads Gmail and Google Calendar, extracts only the things the
user personally has to do, and writes them into a local SQLite database. Tasks
can also arrive by typing, by speaking, by asking the app to read whatever is
on screen, or from recurring rules.

It sits collapsed as a small circle in a corner of the screen and expands into
the full list when clicked.

### 1.1 Design goals

- **Zero extra destination.** The list lives on the desktop. You should not
  have to open another productivity app to know what is due.
- **Local by default.** Extraction, embeddings, speech-to-text and OCR all run
  on this machine. Mail and calendar come from Google because that is where the
  data already is, but message bodies are never sent to a cloud language model.
- **Ambient, not demanding.** A small orb that never takes focus until you
  open it, no taskbar presence, tray resident. It must not steal focus from
  whatever is being typed.
- **Never lie.** An empty list should say *why* it is empty. A wrong action is
  worse than no action. Anything the app learns should be inspectable and
  reversible.

### 1.2 The one goal that could not be met literally

The original brief asked for the list to sit *above the wallpaper and below
applications*, and also to be clickable. On Windows those two things cannot
both be true — see §8.1. The implemented compromise is an always-on-top
window that is only ever as big as the orb or the open panel.

---

## 2. Hardware, and what it forced

The development machine is the binding constraint on nearly every technical
decision in this document, so it belongs near the front rather than in a
footnote:

| Component | Spec |
| --- | --- |
| System RAM | ~8 GB |
| GPU | NVIDIA GTX 1650, **4 GB VRAM** |
| CPU | Intel i7-10750H (6 cores, 12 threads) |
| OS | Windows 11 |

Three consequences follow, and each one is a substitution rather than a
preference:

1. **Llama 3.1 8B**, the model in the original spec, does not fit in 4 GB of
   VRAM at any usable quantisation. It would spill into system RAM that is
   already shared with Windows and Electron, which is a full Chromium. The live
   model is **Qwen2.5 3B**.
2. **Speech-to-text runs on the CPU**, not the GPU, so it never competes with
   the language model for VRAM.
3. **Screen understanding uses OCR, not a vision-language model.** A capable
   VLM needs roughly 3.2 GB of VRAM, which would evict the extraction model on
   every single capture.

All three are reversible if the machine changes, and the swap points are named
in the code: the model id in `config.json`, the Whisper model id in
`electron/services/speech.ts`, and `readScreenText` in
`electron/services/screenContext.ts`.

---

## 3. The machine-learning stack, in detail

Four separate models run in this app, none of them in the cloud. This section
covers what each one is, how it is invoked, and — just as importantly — where
a model is deliberately *not* used.

**§17 is the deep version of this section**: architectures, tensor dimensions,
the memory arithmetic behind every VRAM claim made here, and why several
choices that look arbitrary are forced by the internals.

### 3.1 The language model: Qwen2.5 3B

**What it is.** Qwen2.5 3B Instruct, a decoder-only transformer in the same
architectural family as GPT and Llama: stacked self-attention and feed-forward
blocks, rotary position embeddings, grouped-query attention, trained for
instruction following. "3B" is the parameter count, roughly three billion
weights.

**How it is served.** Through [Ollama](https://ollama.com) on
`http://localhost:11434`, as the tag `qwen2.5:3b`. Ollama applies a 4-bit
quantisation by default, which brings the weights down to roughly 2 GB — the
number that actually matters on a 4 GB card, since the KV cache and the
context window need room too. Quantisation means the weights are stored at
reduced numeric precision rather than 16-bit floats; it costs a little accuracy
and buys the ability to run at all.

**Why Ollama rather than embedding a runtime.** Ollama is a separate process
with its own lifecycle, model cache and GPU management. The alternative —
linking llama.cpp into Electron directly — means compiling a native addon
against Electron's Node ABI, which this project already fought over
`better-sqlite3`. Ollama also lets the model be swapped from a text field in
Settings without rebuilding anything. The cost is a hard dependency on an
external service, which is precisely why the health check in §7.3 exists.

**Inference settings**, identical everywhere the model is called:

| Setting | Value | Reason |
| --- | --- | --- |
| `temperature` | `0` | Extraction is a parsing task, not a creative one. The same email must produce the same tasks on every run, or the eval harness measures noise. |
| `top_p` | `0.9` | Belt and braces; at temperature 0 it barely matters. |
| `num_ctx` | `8192` | Context window. Large enough for a long email plus five few-shot examples plus the system prompt. |
| `num_predict` | `800` | Output cap. A runaway generation is bounded rather than hoped against. |
| `stream` | `false` | Nothing here renders token-by-token, and a non-streamed call is simpler to time out. |
| timeout | 60 s for mail, 120 s otherwise | A stalled model must not wedge the sync loop. One message takes seconds; past a minute the server is stuck and the pass stops, leaving the rest for the next one. |

### 3.1a Apple's on-device model and the router (Mac)

On a Mac with Apple Intelligence turned on, the same calls can go to Apple's
on-device Foundation Model instead of Ollama. The Swift helper exposes it as
`llm.status` and `llm.generate` (`native/mac-helper/Sources/Helper/Language.swift`).
FoundationModels is weak-linked, so the helper still starts on macOS releases
without it and simply reports the model as unavailable, with a reason
(`device_not_eligible`, `not_enabled`, `model_not_ready`, `os_too_old`).

**Same schema, both engines.** `llm.generate` takes the JSON Schema we already
send Ollama and translates it into a `DynamicGenerationSchema`: properties in
the order of `required`, `anyOf` with null as an optional property, enums as
string choices. Apple's decoder is schema-constrained too, so the rest of the
pipeline cannot tell which engine answered. Each call gets a fresh session
with greedy sampling; errors come back typed (`guardrail`, `refusal`,
`context_overflow`, `unsupported_language`, `busy`, `generation_failed`).

**The router** (`electron/services/ai.ts`) is the only way the app talks to a
model. The `aiEngine` setting is `auto`, `apple` or `ollama`:

- `auto` uses Apple when it is ready, otherwise Ollama. Chat is the
  exception: it goes to Ollama while Ollama is running (§7.4). A prompt that would not
  fit Apple's 4,096-token window (estimated at 3.2 characters a token plus the
  schema and output budget) goes to Ollama, so a long message is read whole
  rather than cut down. When Apple fails with a refusal, guardrail, overflow
  or timeout, the call is retried on Ollama.
- `apple` or `ollama` uses only that engine and reports it as unavailable
  otherwise.

When Apple does answer an extraction, few-shot examples are left out and the
message is clipped to what fits; that is the price of the 4K window, and the
reason `auto` prefers Ollama for long mail.

**Every call is logged** to `ai-calls.jsonl` in the data folder (purpose,
engine, model, milliseconds, prompt size, success, whether it fell back),
trimmed at 1 MB. `./dev npm run ai:budget` summarises it per purpose and
engine: calls, failures, fallbacks, p50, p95 and the longest call.

### 3.2 Grammar-constrained decoding

This is the single most important technique in the app, and it is worth
explaining properly.

**The problem.** A 3B model asked to "reply with JSON" will usually comply and
occasionally not: a trailing comma, a missing brace, a stray sentence before
the opening `{`, an enum value that was not on the list. At that size the
failure rate is high enough to matter on every pass.

**The mechanism.** Every call passes a JSON Schema in Ollama's `format`
parameter. Ollama compiles that schema into a *grammar* and applies it during
decoding: at each step, tokens that could not continue a valid document are
masked out before sampling. The model is not asked to produce valid JSON and
checked afterwards — it is made structurally incapable of producing anything
else. A field declared `enum: ['low','medium','high','urgent']` cannot come
back as `"Medium-High"`.

**What it does not fix.** The grammar constrains *shape*, never *truth*. A
schema-valid task can still be a hallucination, a wrong deadline, or a
misreading of who is being asked to do what. Everything in §3.7 exists because
of that gap.

**The four schemas:**

| Prompt | Schema shape | Purpose |
| --- | --- | --- |
| `taskExtraction` | `{ asksUser, tasks: [{ evidence, title, deadline, priority, people, confidence }] }` | Mail → zero or more tasks, each with a quote |
| `taskEnrichment` | `{ title, deadline, priority, people }` | One typed or spoken line → a structured task |
| `screenTask` | single task object | One screenshot → at most one task |
| `chat` | `{ kind, actions: [{ type, task, title, when, priority }], reply }` | One message → question, change or other; the changes; a reply (§7.4) |

`deadline` is declared as `anyOf: [string, null]`, which is what lets the model
say "there is no deadline here" rather than inventing one to satisfy the type.

**Order is a technique, too.** Decoding runs left to right, so a field written
first conditions everything after it. The extraction schema opens with
`asksUser`: does this message ask the user for anything, or record their own
promise? A "no" discards whatever tasks the model writes anyway. Each task
then starts with its `evidence` quote, so the title is written from the words
it cites. The gate took Apple's model from 25% to 100% on task-free mail and
made `qwen2.5:3b` usable again under Ollama 0.40, where it had begun returning
nothing for the old prompt.

Every response is parsed with zod after decoding (`electron/services/extract.ts`):
the grammar holds the shape, zod holds the code to it, and a field that slips
through malformed drops one task rather than the whole message.

### 3.2a Evidence, confidence and suggestions

A schema-valid task can still be invented. Every extracted task therefore
carries a quote, and `shared/evidence.ts` checks it against the message
(case, whitespace and curly quotes ignored):

- **Found**: the quote is shown as the message wrote it, and marked verified.
  A quote that wraps a real sentence in a greeting ("Sally, I'll review…")
  counts as found.
- **Not found**: models paraphrase even when told to copy. The quote is
  replaced by the message's own sentence that best supports the task, and the
  task's confidence is capped at 0.84, just under "high".
- **Nothing supports it**: the task is dropped.

So evidence shown to the user is always text that really is in the message.
Confidence falls into buckets: **high** at 0.85 and above with a verified
quote, **medium** from 0.7, **low** below that.

**Deadlines come from the quote.** When the model gives a deadline and the
quote contains timing words ("by EOD tomorrow", "Friday morning", "end of
week"), the deadline is re-derived from those words by the Quick Add parser,
anchored to the message's sent date. Code does date arithmetic more reliably
than a 3B model: this took deadline accuracy on the seed corpus from 43% to
71% for `qwen2.5:3b`. A model deadline with no timing words in the quote is
kept, moved into the message's year if the model got the year wrong.
"ASAP", "immediately", "right away" and "urgently" make a task **urgent**
rather than giving it a deadline, and a deadline at the very minute the
message was sent (the model echoing the date) is dropped: either would show
the task overdue the moment it arrived.

**Mail tasks arrive as suggestions** (`status = 'suggested'`), with a link to
the message in Gmail and the quote. With `autoAcceptAbove` set (Settings → AI
& Models → "Add confident tasks straight away", 0.9), a task at or above it
*with a verified quote* goes straight to the list; a quote that had to be
found for the model is never auto-accepted.

### 3.3 Prompt architecture

Prompts are TypeScript modules under `prompts/`, not text files. One source is
shared by the bundled app and by the `tsx` eval harness, so what is measured is
exactly what ships.

Each prompt is assembled from named blocks:

- **Identity.** Who the user is. This turned out to be load-bearing: the model
  needs to know it is reading *Suraj's* mail to decide whether "can you send
  this over?" is addressed to him. Identity uses an explicit display name from
  Settings, falling back to the OS username — never the Gmail local part.
  Extracting as `firstnamelastname08` made the model miss messages opening
  "Hi Suraj".
- **About-me block.** Optional free text describing the user's life, injected
  into the **system** prompt beside the identity. Labelled as background that
  must never itself become a task. When the field is empty it contributes
  exactly zero characters, which `eval/aboutMe.test.ts` pins.
- **Current time.** Formatted locally, so relative deadlines have an anchor.
- **Few-shot block.** Up to five retrieved prior extractions (§3.4). Empty
  store means zero-shot.
- **The message.**

**A measured negative result worth preserving.** Extra context in the *message*
block, rather than the system prompt, actively hurts. Including weekday names
from email `Date:` headers dropped recall from 71% to 29% on the seed corpus —
the boilerplate crowded out the actual body. This is why the about-me profile
goes in the system prompt and why quoted reply chains are stripped before the
model sees anything.

### 3.4 Embeddings and retrieval (RAG)

**The model.** `nomic-embed-text` via Ollama, producing **768-dimensional**
vectors. An embedding model is not generative: it maps a passage of text to a
fixed-length vector positioned so that semantically similar passages land near
each other.

**The store.** `sqlite-vec`, a SQLite extension that adds a `vec0` virtual
table, living in the *same database file* as everything else. Migration 002
declares `example_vectors` with a 768-wide float column, which must match
`EMBEDDING_DIM` in `vectorStore.ts` or inserts are rejected.

**The query.** Nearest-neighbour search is expressed in plain SQL:

```sql
SELECT e.id, e.message, e.tasks, v.distance
  FROM example_vectors v
  JOIN examples e ON e.id = v.rowid
 WHERE v.embedding MATCH ? AND k = ?
 ORDER BY v.distance
```

`sqlite-vec` scans every stored vector rather than building an approximate
index. At the scale this app will ever reach — hundreds to low thousands of
examples — a brute-force scan is faster than maintaining an ANN index, and it
is exact.

**The loop.** On each Gmail message: embed it, retrieve up to five nearest past
extractions, render them as few-shot examples, extract, then store *this*
message and its extraction as a new example. The corpus grows into the shape of
the user's own mail.

**The feedback loop.** Acting on a task rates the example it came from:
completing sets `+1`, deleting sets `-1`, and `renderFewShot` replays
thumbs-down examples as *empty* extractions, so a rating teaches the user's
boundary for "not a task" rather than merely hiding a mistake. A completion is
sticky and a later deletion cannot overturn it — the same asymmetry decision
memory uses, because a wrongly negative example quietly teaches the model to
extract less and the user cannot see that happening from the list. Tasks are
matched to examples through `examples.source_id` (migration 010).

**Retention.** `electron/services/maintenance.ts` caps the corpus at 2000
unrated examples, expires `processed_messages` after 90 days and bounds
`decisions` at 5000. This is not housekeeping for disk: `sqlite-vec` scans
every stored vector on every query, so an uncapped store makes each sync
slower than the last, forever, with no symptom but gradual sluggishness.
Rated examples are never evicted — they are the only supervision the system
has.

**Embedding versions.** `examples.embed_version` records which convention
produced a row's vector, and stale rows are re-embedded in bounded batches in
the background. Mixing conventions is worse than consistently using the older
one, since neighbours then rank across two slightly different spaces, so this
is a repair that has to finish rather than an optimisation. Measured on the
live store: adding the task prefix moves a vector by a cosine of 0.903, which
is the margin that made the backfill necessary rather than cosmetic.

**A sharp edge worth recording.** Vector rowids must be bound as JavaScript
`BigInt`. `better-sqlite3` passes plain numbers as doubles and `vec0` rejects a
non-integer primary key, with an error that does not obviously say so.

**A measured decision.** Seeding the store with non-representative examples
trades precision for recall, and on this task that is the wrong direction.
Retrieval-augmented few-shots took recall from 5/7 to 7/7 but dropped precision
from 100% to 87.5% and empty-specificity by the same margin: the model started
finding tasks in control messages that contain none. Since a hallucinated task
is the failure that makes the overlay untrustworthy, production ships with an
**empty** store — zero-shot until the user's own mail has been read. The cost
is that the first weeks have no few-shots at all. This result matters again in
§12.4, because it is the cheap version of the fine-tuning experiment.

### 3.5 Speech recognition: Whisper

**What it is.** OpenAI's Whisper, an encoder-decoder transformer trained on
audio paired with transcripts. The encoder consumes a log-Mel spectrogram; the
decoder emits text tokens. The `.en` variants are English-only and are more
accurate than the multilingual models of the same size for English speech.

**How it runs.** Through `@xenova/transformers` (Transformers.js), executing an
ONNX export on the **CPU** via `onnxruntime-node`. No Python, no CUDA, no
native compilation step.

**The size is a user setting**, defaulting to base:

| Model | Parameters | Download | Character |
| --- | --- | --- | --- |
| `whisper-tiny.en` | 39 M | ~75 MB | Fastest, visibly weak on accented English |
| `whisper-base.en` | 74 M | ~145 MB | **Default.** The right balance on this machine |
| `whisper-small.en` | 244 M | ~480 MB | Most accurate, noticeably slower |

Because all three run on the CPU, the choice trades seconds of transcription
latency against accuracy and **does not compete with the 3B model for VRAM**.
That is the reason tiny was the wrong default: it was chosen as if it were
saving a scarce resource that it was not actually using.

**Audio path.** The renderer captures microphone audio, downmixes to mono and
resamples to **16 kHz float32 PCM** — Whisper's expected input — and passes an
`ArrayBuffer` over IPC. The main process never touches the microphone.

**Silence gating.** Before transcription, a cheap mean-amplitude check rejects
near-silent buffers. Whisper hallucinates confidently on silence, typically
producing "Thank you." or a YouTube sign-off, and an energy gate is a more
reliable filter than any prompt.

**Why not whisper.cpp.** A native addon compiled against Electron's ABI, which
is the same class of pain as `better-sqlite3`. Transformers.js downloads a
model once and runs in-process with no build step. The cost is a slow first
load, which is hidden by warming the model when Quick Capture opens: the
second or so before the first word is usually enough. It is not loaded at
launch, because with the ONNX runtime it holds about half a gigabyte that a
user who never talks would pay for.

### 3.6 OCR: Tesseract

**What it is.** Tesseract 5 via `tesseract.js`, a WebAssembly build. Modern
Tesseract is itself a neural recogniser — an LSTM over image line strips — not
the older pattern-matching engine, though it is a text recogniser and not a
scene-understanding model.

**The pipeline.** `desktopCapturer` grabs the display at native resolution
(thumbnails are downscaled by default and unreadable to OCR), Tesseract returns
raw text, a denoise pass drops lines shorter than three characters or with
fewer than half their characters being letters — toolbars and icon rows OCR
into punctuation soup — and the surviving text, capped at 6000 characters, goes
to the language model with the one-task schema.

The worker is created once per session and cached under `userData/tesseract`;
without an explicit `cachePath`, `tesseract.js` writes into the process working
directory.

### 3.7 Where a neural network is deliberately not used

This is a design position, not an omission. Four subsystems that could
plausibly have been handed to the model are written as ordinary code instead,
and each has the same justification: **a small model's mistakes are
unpredictable, and in these particular places a mistake is expensive or
invisible.**

**Recurrence parsing** (`shared/recurrence.ts`). "Tuition Tue, Thu, Sat at 5pm"
is turned into a rule by regular expressions. A one-off task extracted wrongly
is a nuisance you delete; a *recurrence* extracted wrongly repeats forever
until you hunt it down. Regexes are also faster and byte-identical between
runs. The cost is coverage — phrasings outside the grammar fall through to
being a normal one-off task, which is the safe direction to fail.

**Recurrence detection** (`shared/recurrenceDetect.ts`). Deciding that
something is a habit is a threshold, not a learner: the same fuzzy-matched
title on the same weekday across three distinct weeks, with the time of day
varying by at most 90 minutes. With a handful of rows, predictability beats
sophistication, and every detection is raised as a *question* rather than
applied.

**Clash resolution** (`shared/clash.ts`). When two tasks collide, the app says
which to do first using a fixed ladder: a clearly earlier deadline wins; inside
15 minutes priority decides; on a genuine tie a standing commitment beats an
ad-hoc task, because other people have arranged themselves around it;
otherwise, whatever was committed to first. Advice that changes its wording or
flips its verdict between identical runs is not advice.

**Calendar events** (`integrations/gcalendar.ts`). Calendar entries are already
structured, so they are converted to tasks arithmetically. Spending a
generation call to turn "Call with Sarah at 3pm" into a prep task would be
slower *and* less reliable than the rule.

**Decision matching** (`shared/decisions.ts`) also avoids embeddings, using the
same fuzzy title rule as recurrence detection, for two reasons: it must keep
working when the embedding model is unavailable, and it is testable without a
running Ollama.

The boundary is consistent: **the model is used for understanding unstructured
human prose. Everything downstream of that is arithmetic.**

### 3.8 How quality is measured

- `npm test` — 85 unit tests over the deterministic logic (recurrence parsing
  and detection, clash resolution, deduplication, deadline normalisation,
  snooze arithmetic, decision memory, retry policy, calendar event shaping,
  voice intent, scoring).
- `npm run eval` — the extraction harness. Reports precision, recall, F1,
  empty-specificity (does it correctly return *nothing* for mail with no task),
  deadline accuracy, and how many quotes the model copied exactly, against a
  labelled corpus. `--model <tag>` picks the Ollama model; `--engine apple`
  runs Apple's model through the locally built helper.
- `ai:budget` — latency and failure summary from the call log (§3.1a).
- `npm run eval:chat` — runs the chat planner against the **real** model
  with 18 scripted messages and checks what would happen: no change for a
  question, the right task, the resolved time. `--model` and `--engine apple`
  as above. This exists because the risk in chat is not the wiring but the
  model's judgement.
- `npm run check:migration` — applies pending migrations to a **copy** of the
  live database and reports whether the data survived.

**The corpus, stated precisely.** `eval/corpus/seed.jsonl` holds **14
hand-written messages in Enron house style** — real Enron names and addresses
used as set dressing, with Sally Beck as the user under evaluation. It is *not*
real Enron mail. Six messages carry seven gold tasks between them and the other
eight are deliberate controls, because false positives on newsletters and FYI
threads are the dominant failure mode for this task. The file exists to
validate the harness and demonstrate the labelling format. The real benchmark
it refers to, `eval/corpus/enron-200.jsonl`, **has never been built** (§12.3).

**Measured results so far:**

| Measurement | Result | Caveat |
| --- | --- | --- |
| Extraction F1 | 83.3% | 14 hand-written messages, 7 gold tasks |
| Extraction precision | 100% | One error moves any metric ~12 points |
| Extraction recall | 71.4% | 5 of 7 |
| Empty-specificity | 100% | No invented tasks on the 8 controls |
| Deadline accuracy | 60% | Only 5 matched pairs; mostly noise |
| Chat action selection | 10/10 | Was 6/10 before worked examples were added; superseded by `eval:chat` (18/18 on `qwen3:4b-instruct-2507`, see the rebuild plan's Phase 6) |
| Real-mail precision | No false positives on 13 messages | See §10.2 |

Those were measured on the original Windows machine. After the Phase 6
changes (the `asksUser` gate, evidence, deadlines from the quote), on an
M-series Mac (`eval/results/*-v7-final.json`):

| Engine | F1 | Empty-specificity | Deadline | Median latency |
| --- | --- | --- | --- | --- |
| `qwen2.5:3b` | 100% | 100% | 71% | 0.2 s |
| `qwen3:4b-instruct-2507-q4_K_M` | 100% | 100% | 57% | 0.2 s |
| `gemma3n:e4b` | 100% | 100% | 57% | 0.5 s |
| Apple on-device | 86% | 100% | 67% | 0.8 s |

The latencies are for the short hand-written messages of that corpus. On the
longer, realistic mail of the November 2026 QA run, `qwen3:4b-instruct-2507`
took 0.51 s median and 1.7 s at the 95th percentile (n = 20).

Every one of those numbers comes from a corpus small enough that a single
message changes the second digit. They are useful for catching regressions —
which they did, twice — and useless as an absolute claim of quality.

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Renderers (Chromium, context-isolated, no Node)                 │
│  overlay   │   quickadd   │   settings   │   chat                │
│  React 19 + Tailwind 4. Talk only through the preload bridge.    │
└───────────────┬──────────────────────────────────────────────────┘
                │  contextBridge: window.ambient
┌───────────────▼──────────────────────────────────────────────────┐
│  Electron main process (Node)                                    │
│  windows · tray · global shortcuts · OAuth loopback server       │
│  sync scheduler · task store · rule engine · decision memory     │
│  Ollama client · Whisper · Tesseract · power & display events    │
└───┬──────────────┬───────────────┬──────────────┬────────────────┘
    │              │               │              │
    ▼              ▼               ▼              ▼
SQLite +        Ollama         Google APIs     OS APIs
sqlite-vec      127.0.0.1      Gmail,          safeStorage (Keychain/DPAPI),
userData        :11434         Calendar        Swift helper (Mac), mic
```

### 4.1 Windows

| Surface | Trigger | Behaviour |
| --- | --- | --- |
| **Overlay** | Always present | A 64 px glass orb (`ThinkingOrb` inside) in the configured corner that never takes focus. Click expands it into a 380 px panel sized to its content, which takes focus so the keyboard works; Esc collapses it. |
| **QuickAdd** | `Ctrl+Shift+A` (Mac `⌃⌥Space`) | A composer card: type, or press the shortcut again (or ⌘L, or the mic) to talk. Live chips show what was understood. Enter saves, ⌘Enter saves and stays open, Esc cancels. |
| **Settings** | `Ctrl+Shift+,` (Mac `⌃⌥,`), tray, or the gear | A sidebar window: General, Sources, AI & Models, Capture, Shortcuts (with a recorder), Recurring, Learned, Privacy, Your data, Permissions, About. Follows the system theme unless set to Light or Dark. |
| **Chat** | `Ctrl+Shift+C` (Mac `⌃⌥C`), tray, or the overlay header | A frameless glass card that answers about the list and changes it, showing each change as a step. Stop cancels a running answer. |
| **Onboarding** | First launch, or Settings → About | Welcome, privacy, sources, permissions, model check and shortcuts. Finishing sets `onboarded` in the config. |
| **Tray** | Always | Show/hide, sync now, chat, settings, quit. There is no main window, so closing the overlay must never quit the process. |

### 4.2 Overlay sizing and focus

The overlay window is always exactly the size of what it shows, so there is no
transparent area to swallow clicks meant for the desktop. Collapsed, it is the
64 px orb and is not focusable, so clicking it never takes focus from the app
you are in. Expanded, it is 380 px wide and as tall as the panel: the renderer
measures the panel and sends `SetPanelHeight`, and main grows the window away
from its corner, capped at the work area. The expanded window is focusable and
focused, so keyboard shortcuts and inline edits work.

### 4.3 Windows 11 transparency

A transparent frameless window on Windows 11 draws a grey DWM plate and
sometimes caption buttons behind custom-shaped content. Suppressing that took
a combination of measures, all of which are load-bearing:

- `thickFrame: false`, `roundedCorners: false`, `backgroundMaterial: 'none'`,
  `backgroundColor: '#00000000'`, `titleBarStyle: 'hidden'`, `type: 'toolbar'`
- command-line switches `enable-transparent-visuals` and
  `disable-features=EnableTransparentHwndEnlargement`
- `BrowserWindow.setShape()` clipping the window to the circle while collapsed
- an `overlay-window` class on `<html>` forcing a truly transparent document

### 4.4 The IPC contract

Every channel name lives in `shared/ipc.ts`, imported by both sides, so main
and renderer cannot drift apart. Renderers have `nodeIntegration: false` and
`contextIsolation: true`; the only surface they can reach is the `window.ambient`
object built in `electron/preload.ts`.

Channel groups: tasks (get/add/complete/delete/update/snooze, plus a pushed
`TasksChanged`), overlay (expand state, panel height), config, accounts,
sync, rules, suggestions, chat (send, stop, close), health, learned
suppressions, corpus export, quick-add (including hold start/end), speech
(Whisper transcription, plus Apple live speech: engine, install, start,
stop, cancel and pushed partials and levels), shortcuts
(suspended while Settings records one), permissions (status, open System
Settings, and request where macOS still shows a prompt), and onboarding.

A production-only Content Security Policy is applied as a response header
rather than a meta tag, so the dev server's HMR websocket is not blocked during
development.

### 4.5 The Mac helper

`native/mac-helper` is a small Swift executable for what Electron cannot do
on the Mac: read the window in front through Accessibility, capture one
window with ScreenCaptureKit, OCR with Vision, check and request every
privacy permission, report idle time, mic use and full-screen apps, stream
speech with SpeechAnalyzer, and hold a global hotkey that sees the key being
let go. Next it will read Calendar and Reminders.

- **Process.** Main starts it at launch (`electron/native/helper.ts`) and
  talks newline-delimited JSON over stdin/stdout (`shared/helperProtocol.ts`).
  It exits when stdin closes or its parent dies, so it cannot outlive the
  app.
- **Resilience.** `electron/native/helperClient.ts` handshakes with `hello`,
  times out every request, and restarts a crashed helper with backoff (1 s
  doubling to 30 s). A missing binary or another protocol version makes it
  `unavailable`, and every caller has a fallback, so the app works the same
  without it.
- **Attribution.** Packaged, it lives in `Contents/MacOS` and is signed with
  the app. Launched through LaunchServices, macOS holds AmbientMind
  responsible for it, so prompts name AmbientMind and one grant in System
  Settings covers both. `test:packaged` checks this on every build with
  `--helper-check`. Run from a terminal, the terminal is responsible
  instead, which is why dev runs see the terminal's permissions and why
  `./dev packaged` launches through `open` rather than the binary.
- **Events.** Besides replies, the helper pushes `speech.partial`,
  `speech.level`, `speech.error`, `speech.install` and `hotkey` (down/up).
  It runs an `NSApplication` loop with the `.prohibited` activation policy
  (no Dock icon, menu or focus) because Carbon hotkey events only arrive
  through one. On stdin EOF it waits up to 3 s for replies still in flight.
- **EventKit.** `calendar.events`, `reminders.ensureList`, `reminders.list`,
  `reminders.upsert` (only the fields sent are written; `expectedModifiedAt`
  refuses a stale write with `conflict`) and `reminders.delete`, all on one
  serial queue, plus a debounced `eventstore.changed` event. See §6.2a and
  §6.3a.
- **Live speech.** `electron/services/liveSpeech.ts` picks the engine:
  Apple's SpeechAnalyzer when the helper is up and the language's model is
  installed, Whisper otherwise (and on Windows). The model is a macOS asset
  stored with Dictation's, outside the app, so it is only downloaded from
  the button in Settings → Capture. Whisper is then not loaded at all.
- **Build.** `./dev npm run helper` (SwiftPM, caches in `.local/`);
  `dist:mac` builds it first. `ambientmind-helper --selftest` reports
  permissions and proves Vision OCR works.

---

## 5. Data model

Everything lives in Electron's `userData` folder: `~/Library/Application
Support/AmbientMind/` on an installed Mac, `%APPDATA%\AmbientMind\` on
Windows, and `.local/data/` in the repo for any run through `./dev`
(`electron/isolation.ts`), so development never touches the real folders:

| File | Contents |
| --- | --- |
| `ambientmind.db` | Tasks, RAG examples and vectors, processed message ids, sync cursors, rules, suggestions, decisions. WAL mode. |
| `config.json` | All user preferences (§5.3). |
| `secrets.json` | OAuth tokens, encrypted with Electron `safeStorage` (Keychain on macOS, DPAPI on Windows; a mock keychain under `./dev`). |
| `google-credentials.json` | Desktop OAuth client JSON from Google Cloud Console. |
| `corpus-*.jsonl` | Optional export of the user's own mail for accuracy measurement. |
| `whisper/` | Cached ONNX weights and tokenizer for the selected Whisper size. |
| `tesseract/` | Cached OCR language data. |

### 5.1 Migrations

Schema version is SQLite's `user_version`. Migrations are append-only SQL files
imported as **raw strings** so they exist inside a packaged asar, where reading
them from a path would fail.

| # | File | Change |
| --- | --- | --- |
| 1 | `001_init.sql` | `tasks` |
| 2 | `002_rag.sql` | `examples`, `example_vectors` (`vec0`, 768-d) |
| 3 | `003_sync.sql` | `processed_messages`, `sync_state` |
| 4 | `004_snooze.sql` | `tasks.snoozed_until` |
| 5 | `005_rules.sql` | `recurrence_rules`, plus a **full rebuild of `tasks`** so `source` admits `'rule'` |
| 6 | `006_suggestions.sql` | `recurrence_suggestions` |
| 7 | `007_retry.sql` | `processed_messages.attempts` |
| 8 | `008_rule_calendar.sql` | `recurrence_rules.gcal_event_id` |
| 9 | `009_decisions.sql` | `decisions` |
| 10 | `010_example_feedback.sql` | `examples.source_id`, `examples.embed_version`, retention index |
| 11 | `011_task_lifecycle.sql` | Rebuild of `tasks`: tombstones (`deleted_at`), `suggested` status, `user_edited_at`, `source_url`, `evidence` |
| 12 | `012_example_dedupe.sql` | Unique `examples (source, source_id)` |
| 13 | `013_apple_sources.sql` | Rebuild of `tasks` so `source` admits `acalendar` and `reminders`; `updated_at` kept by triggers; `task_links` |
| 14 | `014_screen_chat_sources.sql` | Rebuild of `tasks` so `source` admits `screen` and `chat`, which were saved as `manual` before |
| 15 | `015_due_alerts.sql` | `tasks.reminded_at` (the due-soon notification went out) and `tasks.remind_at` (snoozed from that notification); both reset when the deadline changes |

Migration 005 is the interesting one. SQLite cannot alter a `CHECK`
constraint, so adding `'rule'` to the allowed task sources required copying the
table, dropping the original and renaming — inside a single transaction.
`npm run check:migration` rehearses exactly that against a copy of the live
database and reports whether the row count survived. That rehearsal has since
caught a real problem (§9.1), which is the argument for keeping it.

### 5.2 Tables

**`tasks`** — the only object the overlay understands.

- `title`, `deadline` (ISO-8601 or null), `priority` (low/medium/high/urgent)
- `source` — `gmail` | `gcalendar` | `acalendar` (Apple Calendar) |
  `reminders` (made in Apple Reminders) | `manual` (typed) | `voice` (spoken
  in Quick Capture) | `screen` | `chat` | `rule`, with `outlook`/`teams`
  reserved
- `updated_at` — set by triggers on any change to title, deadline, priority
  or status, so no writer can forget it; Reminders sync uses it to let the
  later edit win
- `sourceId` — unique per source. A partial unique index stops the same Gmail
  message inserting the same title twice, and makes materialising a rule
  occurrence (`ruleId:YYYY-MM-DD`) idempotent.
- `people`, `rawContext`, `confidence`
- `status` — pending / done / archived / snoozed
- `snoozedUntil` — set only while snoozed

Urgency is **derived, never stored**: overdue, inside 24 h, inside 72 h, or
none; then sorted by imminence, deadline, priority (`shared/urgency.ts`).
Storing it would mean a task's colour could go stale relative to the clock.

**`examples` / `example_vectors`** — RAG corpus and its 768-d vectors.

**`processed_messages`** — `(source, source_id)` with an outcome
(`extracted` | `skipped` | `failed`), a task count, a timestamp and an
**attempts** counter. The attempts column is what makes a failure retryable
rather than permanent (§9.1).

**`sync_state`** — per-source cursor, last run and last error. Google
Calendar's cursor holds the iCalendar UIDs of the events it last listed (so
Apple Calendar can skip Google's copies); Reminders' holds the list it owns.

**`task_links`** — a task's copy in Reminders: the reminder id, its
modification stamp at the last sync, and what both sides' synced fields
(title, deadline, priority, done) looked like then. No foreign key, because a
calendar prep task is removed outright when its meeting goes, and the link has
to outlive it so the reminder goes too.

**`recurrence_rules`** — title, weekdays as a JSON array (0 = Sunday), local
`HH:MM`, priority, lead minutes, enabled flag, origin (`explicit` |
`suggested`), and the mirrored Google Calendar event id.

**`recurrence_suggestions`** — detected patterns with a status of pending,
accepted or dismissed. Dismissals **persist**, because an assistant that asks
the same question every week is worse than one that never asks.

**`decisions`** — every complete, delete, snooze and dismissed suggestion, with
a normalised subject for fuzzy matching, the original title, the source and a
timestamp. Outlives the task itself.

### 5.3 Configuration reference

| Key | Default | Meaning |
| --- | --- | --- |
| `overlayCorner` | `top-right` | Which corner the orb and panel occupy |
| `overlayOpacity` | `0.92` | Panel opacity |
| `overlayWidth` | `380` | Expanded panel width in px |
| `workHoursStart` / `End` | `9` / `18` | Used when resolving vague deadlines |
| `syncIntervalMinutes` | `15` | Background sync cadence |
| `maxTasksVisible` | `7` | Before "+N more · show all" |
| `aiEngine` | `auto` | `auto`, `apple` or `ollama` (§3.1a) |
| `ollamaModel` | `qwen3:4b-instruct-2507-q4_K_M` | Ollama's extraction and chat model |
| `autoAcceptAbove` | `null` | Off, or 0.7–1: confident mail tasks with a verified quote skip Suggested (§3.2a) |
| `embeddingModel` | `nomic-embed-text` | RAG embeddings |
| `whisperModel` | `Xenova/whisper-base.en` | Speech-to-text size |
| `launchAtLogin` | `false` | Start at sign-in (opt-in) |
| `calendarWriteBack` | `false` | Mirror rules to Google Calendar (opt-in) |
| `appleCalendar` | `false` | Prep tasks from Apple Calendar (Mac, opt-in, asks for Calendar access) |
| `remindersSync` | `false` | Two-way sync with an "AmbientMind" list in Reminders (Mac, opt-in) |
| `displayName` | `''` | What your mail calls you; beats the OS guess |
| `aboutMe` | `''` | Free-text profile, max 1200 characters |
| `pauseAiUntil` | `null` | ISO time AI stays off until; `9999-12-31` means until resumed |
| `screenReading` | `false` | The capture shortcut and screen intent may read the front window (opt-in) |
| `excludedApps` | `[]` | App names or bundle ids never read, on top of the built-in password managers |
| `contentProtection` | `false` | Windows are blank in screenshots, recordings and screen sharing |
| `quietMode` | `true` | On a call or in a full-screen app, the orb hides and notifications wait (Mac) |
| `remindBeforeMinutes` | `15` | Due-soon notification lead: `null` (off), 0, 5, 15, 30 or 60 minutes |

### 5.4 Background timers

| Sweep | Interval | Work |
| --- | --- | --- |
| Snooze | 30 s | Wake due tasks, top up rule occurrences, send due-soon notifications |
| Archive | 15 min | Archive stale completed tasks, refresh habit suggestions |
| Sync | 15 min (configurable) | Gmail and Calendar, first run delayed 60 s after launch |
| Resume | on wake | Everything above, immediately |
| Apple sources | 5 min, and on every EventKit change | Apple Calendar prep tasks and Reminders sync, when switched on |
| Reminders push | 1.5 s after a local change | The changed tasks reach Reminders |

The 60-second delay after launch is deliberate: login is the worst possible
moment to pull a 2 GB model into memory, because the user is still waiting for
the desktop to settle.

---

## 6. The pipelines

### 6.1 Gmail

1. **Retry first.** Message ids that previously failed and still have attempts
   remaining are fetched by id, ahead of everything else. Without this they
   would age out of the recent listing and never be retried at all (§9.1).
2. **List** `newer_than:2d -in:chats`, 100 ids per page and at most 5 pages
   (500 messages) per pass.
   Promotions are deliberately *included* — excluding that tab hid real
   first-time senders.
3. **Skip** ids already processed, unless this is a forced sync.
4. **Fetch** the full message, strip quoted reply chains.
5. **Pre-filter** on headers, before the model costs anything:
   `List-Unsubscribe`, `Precedence: bulk|list|junk|auto_reply`,
   `Auto-Submitted`, no-reply sender patterns, bodies under 40 characters or
   over 20,000.
6. **Retrieve** up to five nearest past examples from sqlite-vec.
7. **Extract** through the router (§3.1a) under the extraction schema, then
   check every quote against the message (§3.2a).
8. **Record** the outcome, store the example and its embedding.
9. **Deduplicate** against existing tasks — Dice similarity ≥ 0.72 with
   deadlines within 24 hours catches mail and calendar describing the same
   work.
10. **Suppress** anything the user has repeatedly deleted (§7.5).
11. **Insert** as a suggestion with a Gmail link and the quote, or straight
    into the list when auto-accept is on and the task clears it.

The pass is capped at **15 extractions**, so one busy morning cannot peg the
GPU. Extraction is strictly serialised: the model holds around 2 GB on a 4 GB
card, so concurrent generations would thrash rather than parallelise.

### 6.2 Calendar (read)

Events in the next seven days become tasks with **no model call at all**.
Meetings with other attendees become "Prepare for {title}" one hour before the
start; solo blocks keep their title; all-day events become low-priority context
at 09:00. Declined events and working-location entries are dropped. Sync is
incremental via `syncToken`, and an HTTP 410 — Google's documented signal that
the token is too old — triggers a full resync rather than surfacing as an
error.

### 6.2a Apple Calendar (read, Mac)

The helper's `calendar.events` lists the next 48 hours from every calendar in
macOS Internet Accounts. Each event is mapped onto the Google event shape and
goes through the same rule (`prepTaskFor`): one-off, timed meetings with
other people that you haven't declined become "Prepare for …" an hour before.
They are reconciled like Google's, as source `acalendar`, so a moved or
cancelled meeting moves or removes its task. When Google is connected too,
events whose iCalendar UID Google already listed, or with the same title at
the same minute as a Google prep task, are skipped: the same meeting seen
through both must not become two tasks. Turning the source off removes its
open prep tasks.

### 6.3 Calendar (write)

Recurring rules are mirrored to Google Calendar so they appear on a phone
without any mobile app. The details that matter:

- Events go to a **separate calendar the app creates**, named "AmbientMind",
  never the user's own.
- The OAuth scope is `calendar.app.created`, which grants access *only* to
  calendars this app made. A bug in this code physically cannot damage a real
  appointment.
- Times are sent as **local wall-clock plus an IANA zone**, not UTC instants,
  which is what keeps "tuition at five" at five across travel and daylight
  saving.
- The rule becomes an `RRULE:FREQ=WEEKLY;BYDAY=...`, anchored on a real
  occurrence so the first instance never lands on a day the rule does not fall
  on.
- Pausing a rule **deletes** its event; an event deleted on the phone is
  recreated rather than lost.
- Off by default, and calendar pushes are never awaited by the UI.

### 6.3a Reminders (two-way, Mac)

AmbientMind owns one list, "AmbientMind", in the account where new reminders
go by default (iCloud when signed in, so iPhone and Watch see it). The pure
planner in `shared/remindersSync.ts` compares each linked pair with the
snapshot stored at the last sync:

- A field changed on one side is copied to the other. The same field changed
  on both goes to the later edit (`tasks.updated_at` against the reminder's
  modification date).
- Open tasks without a reminder are created there, with the task's evidence
  and link as notes. Incomplete reminders without a task become tasks
  (source `reminders`); completed history is not imported.
- Deleted here: the reminder is removed, unless it was edited after the
  delete, in which case the task comes back. Deleted there: the open task is
  tombstoned; a finished one just lets go.
- Every write names the version it was planned against
  (`expectedModifiedAt`); the helper refuses a stale write, and the next pass
  starts from the new state instead of overwriting it.
- If more than half the links (and at least five) vanish at once, it looks
  like a deleted list or a signed-out account, so nothing is deleted here and
  the tasks are offered to Reminders again. A list deleted outright is made
  again the same way.

Priorities map to Reminders' three marks (urgent and high → high, low → low,
medium → none); a date-only reminder is due at 17:00 that day, the same as a
typed "Friday". Recurring reminders get no special case: completing one on
the iPhone should arrive either as a changed due date or as a new reminder,
and both are ordinary changes. Not yet tried against a real device.

Passes run on EventKit's change notification (iPhone edits arrive through
iCloud), 1.5 s after any change here, and every five minutes as a backstop.
Both Apple sources are opt-in from Settings → Sources, which asks macOS for
access first.

### 6.4 Voice and QuickAdd

Typed text is inserted **immediately**, then `enrichTask` upgrades the title,
deadline and priority in place. The insert never waits on the model, so the
palette stays instant and keeps working with no model running.

The model is only asked when it could add something (`needsEnrichment` in
`shared/capture.ts`): timing words the parser didn't understand are still in
the title, or the line is long enough to need tidying. "Call mum tomorrow
morning" is fully parsed (tomorrow at 09:00) and never reaches a model. The
parser knows today, tonight, tomorrow, EOD, end of day/week/month, weekdays,
morning/afternoon/evening, noon and clock times.

Spoken audio follows §3.5. Phrases meaning "look at my screen"
(`shared/voiceIntent.ts`) route to the screen capture path instead of creating
a task with those words as its title.

### 6.5 Screen capture

`Ctrl+Shift+S` (Mac `⌃⌥S`) or a spoken screen intent, once **Read the
screen** is on in Settings → Capture (off by default; the shortcut otherwise
says how to turn it on). Apps listed under "Never read" are refused by bundle
id in the helper, or by name before anything reaches the model. On the Mac the helper
reads the window you were looking at: its Accessibility text when there is
enough, otherwise that one window by ScreenCaptureKit and Vision. Password
managers are refused outright. Failing both, and always on Windows, it
captures the display **the cursor is on** — on a two-monitor desk, capturing
the primary screen silently produces a task about whatever was idle on the
other one. OCR, denoise, then a one-task extraction; the prompt is told
whether its text is exact or OCR. Details in `docs/screen-capture.md`. Deadlines like `"Thursday"` are normalised in
`shared/deadline.ts` (weekday → next occurrence at 17:00), because the schema
can require a string but cannot require a *real datetime*.

### 6.6 Recurrence

Parsing is deterministic (§3.7). A single weekday only counts as recurring when
the text says so — "every", "daily", "weekdays" — so "meeting Tuesday at 5pm"
stays one meeting. Named times resolve to the same hours the enrichment prompt
uses (morning 09:00, afternoon 14:00, evening 19:00, night 21:00), and imply a
daily schedule **only when no weekday was named**, so "every Tuesday evening"
remains a single Tuesday.

Occurrences are materialised two weeks out, keyed `ruleId:date` so re-running
is idempotent. Pending occurrences that no longer match their rule are dropped
when the rule is edited, paused or deleted.

Detection groups fuzzily: Dice similarity, plus a word-subset rule so "Tuition"
and "Tuition class" are one habit rather than two halves that each fall short
of the threshold. Rows are sorted before clustering so the signature does not
depend on arrival order — otherwise a dismissal would stop matching and the
same question would return.

### 6.7 Chat

One grammar-constrained action per turn, from a fixed enum: `answer`,
`add_task`, `complete_task`, `snooze_task`, `delete_task`, `add_rule`. The
panel sees the real task list, the real rules, and the decisions relevant to
whatever was just asked.

Rails that do not depend on the model behaving:

- at most **four** actions per message, so a loop is impossible rather than
  unlikely
- loose task names resolved against real rows by similarity, and **refused**
  below a threshold rather than guessed
- snoozes without a future timestamp rejected
- past decisions marked as history, not instructions, so it cannot undo one on
  its own

### 6.8 Authentication

Google **Desktop OAuth client** with PKCE, opened in the system browser,
redirecting to an ephemeral `127.0.0.1` loopback listener. Non-callback GETs
are ignored — an early bug treated `/favicon.ico` as a CSRF failure and closed
the listener, producing `ERR_CONNECTION_REFUSED` on the real redirect.

Scopes: `gmail.readonly`, `calendar.readonly`, `calendar.app.created`,
`openid`, `email`. Access tokens refresh with a 60-second skew, concurrent
refreshes share one in-flight promise, and a 401 forces one retry with a fresh
token.

---

## 7. Complete feature inventory

### 7.1 Capture

| Feature | Detail |
| --- | --- |
| Gmail extraction | Local model, RAG few-shots, header pre-filter, 15 calls per pass |
| Calendar import | Deterministic, 7-day lookahead, prep tasks for meetings |
| Typed quick-add | Instant insert, model enrichment in place |
| Voice quick-add | Local Whisper, selectable size, 3 s silence to submit |
| Screen capture | OCR plus model, follows the cursor's display |
| Recurring rules | Deterministic parsing, materialised two weeks out |
| Habit suggestions | Three weeks, same weekday, ±90 min, always asked |

### 7.2 The list

Inline editing, snooze (1 h / 3 h / this evening / tomorrow 9am / next week),
delete, complete, derived urgency colours, hover for full title and context,
"+N more · show all" for the complete scrollable list, clash warnings naming
which task to do first, and cross-source deduplication.

**Due-soon notifications** (`shared/dueAlerts.ts`). A task with a deadline
raises one system notification `remindBeforeMinutes` before it (Settings →
General → Remind me), with **Done** and **Snooze 1 hour** buttons on both
platforms. A deadline already more than an hour gone is not announced after
the fact, at most three go out at once, and moving the deadline re-arms it.
Snoozing from the notification hides the task and alerts again when it comes
back. They are not AI, so Pause AI doesn't hold them; quiet mode does. The
banner style is macOS's default; switching AmbientMind to *Alerts* in System
Settings → Notifications keeps them on screen until answered.

The sync notification only reports news: tasks added, or an error it hasn't
already shown. A pass that found nothing says so in the panel, not on screen.

### 7.3 Trust

- **Health check** — which engine would answer right now, and if none, why
  (Apple Intelligence off and with what reason, Ollama stopped); are the
  models that engine needs actually pulled (matching Ollama's implicit
  `:latest`; the extraction model isn't required while Apple answers); is
  Google connected; does the calendar scope need a reconnect. The overlay names the reason the list is
  empty instead of showing a blank panel. Re-runs on a timer, because Ollama
  gets stopped on an 8 GB machine all the time.
- **Sync summary** — last run, counts and errors, surviving long after the
  toast has gone.
- **Learned suppressions panel** — everything the app has decided to hide, with
  counts and an undo.
- **Network log** — the main process's `fetch` is wrapped and the windows'
  session watched; every request that leaves the Mac is a line in
  `network.jsonl` (time, method, host, path without query or long ids,
  status). Requests to this Mac are only counted. Settings → Privacy groups
  them by destination (Google, model downloads, this Mac, anywhere else).
- **Your data** — counts by source and of everything else kept; forget a
  source (tasks become content-free tombstones so a sync doesn't re-add them;
  Gmail also drops its learned examples), forget everything older than 30
  days / 3 months / a year (the open list and rules stay), clear chat history
  and the AI log, export JSON without tokens, and encrypted backup with
  restore (checked, swapped in, the old file kept as
  `ambientmind.before-restore.db`, then a relaunch). **Erase everything**
  revokes Google and relaunches with `--erase-data`; the new process empties
  the data folder and the crash log before anything opens them, keeping only
  `google-credentials.json` (`electron/services/eraseData.ts`).
- **Policy and notices** — `PRIVACY.md`, `TERMS.md`, `LICENSE` and
  `THIRD_PARTY_NOTICES.md` ship in `Resources/legal` and open from Settings →
  About. The privacy policy's retention table and destination list describe
  this section and `shared/retention.ts`; change them together.
  `scripts/notices.cjs` lists every package that ships (production
  dependencies plus what Vite bundles into the windows) with its licence text,
  and `npm run dist` fails if the file is stale or a licence is copyleft or
  unknown and not reviewed.
- **Privacy switches** — Pause AI for an hour, until tomorrow or until
  resumed (Settings and the menu bar); screen reading off by default;
  content protection; quiet mode from the helper's `system.busy` (mic in use
  by another app, or a full-screen app), polled every 15 s.
- **Crash log** — `logs/crash.log`, opened from Settings → Privacy.
- **Corpus export** — dump recent mail to JSONL, pre-filled with the model's
  current extractions, so labelling is correcting a draft rather than authoring
  one. Pre-filtered mail is written to a *separate* audit file with its skip
  reason.

### 7.3a Accessibility and idle cost

- Every text colour in `src/ui/tokens.css` meets WCAG AA (4.5:1) on the
  window, sidebar and panel glass in both themes; placeholders meet 3:1.
  `eval/contrast.test.ts` computes this from the tokens, so a colour change
  that breaks it fails the build. Filled buttons use `--accent-fill`, a darker
  blue than the accent used for text.
- `src/test/a11y.test.tsx` runs axe on every Settings section, every
  onboarding step, the task panel, Quick Capture and Chat.
- The task panel is a labelled region of real lists; the keyboard cursor is
  `aria-current` on the row and spoken through a polite live region. Chat is
  a `log`, onboarding moves focus to each new step's heading, and a toast
  stays up while the pointer or focus is on it.
- At rest the orb draws one frame and stops after 8 s of calm; hovering wakes
  it. The collapsed overlay polls the clock every minute and health every five.
  Measured idle (`./dev npm run measure:idle`): 0.06% CPU across all
  processes, down from 2.96%, with a budget of 2%.

### 7.4 Brain

About-me profile, chat panel with real actions, deterministic clash advice, and
decision memory.

**Chat** (`electron/services/chatPlan.ts`, `chat.ts`) makes one model call per
message. The model sees open tasks (most urgent first, with due times in
words), tasks done in the last week, repeating rules and any matching past
decisions, and returns a `kind` (question, change or other), a list of
changes, and a reply. Changes name a task by copying its title and a time by
copying the user's words ("in an hour"); code finds the task (exact title,
else similarity of at least 0.6) and resolves the time with the Quick Add
parser. Guards around the model:

- Only `kind: "change"` acts, and a message phrased as a question with no
  command word never changes anything.
- The same task added twice in one message is added once; added again within
  15 minutes of the first, it moves the first.
- "Move X" where X isn't on the list adds X; "done" on a finished task with
  "not" in the message reopens it.
- A reply that claims a change it didn't list is asked once more, then
  replaced by "I didn't change anything".
- The confirmation shown is written by code from what really changed.

In Automatic, chat goes to Ollama while it is running and to Apple's model
otherwise (§3.1a).

### 7.5 Decision memory and learning

Every complete, delete, snooze and dismissed suggestion is recorded, from the
overlay and from chat alike, and outlives the task. Two uses:

1. **Chat recall.** Only decisions matching what was just asked are injected —
   a 3B model shown the entire log starts treating it as a to-do list.
2. **Suppression.** Deleting the same thing three times without ever completing
   it keeps *new* ones off the list.

The thresholds are cautious on purpose. Three rather than two, because people
delete things by mistake. A single completion outweighs any number of
deletions, because a suppressed task is **invisible** — the user has no way to
discover the mistake from the list. Suppression never applies retroactively,
and everything learned is listed in Settings with an undo.

### 7.6 Platform

A `.app` signed with a local identity on the Mac (Developer ID comes with a public release) (menu-bar resident, no Dock icon
except while Settings or Chat is open) and a per-user NSIS installer on
Windows. Launch at login, tray icon rendered from code, global shortcuts, and
two headless CLI modes:

```powershell
npm run corpus:export -- --days=30 --limit=120
npm run sync:now
```

---

## 8. Design decisions: why, alternatives, drawbacks

### 8.1 Overlay layering

"Above wallpaper, below apps" requires the WorkerW/Progman hack on Windows, and
that window **cannot receive normal input**. An interactive list that vanishes
under every maximised browser is equally not ambient. An always-on-top window
sized exactly to the orb or the open panel stays both visible and clickable,
and covers nothing else.

*Drawback.* It is a HUD floating over applications, not wallpaper.

*History.* The full-height list came first; a collapsed orb was added, reverted
on request, then reinstated as the default when minimising became a
requirement. The current design is orb-by-default, expanding on click.

### 8.2 SQLite, not a server

One file, no daemon, survives restarts, gives unique indexes for source
deduplication, and hosts the vector store in the same transaction domain.

*Drawback.* `better-sqlite3` is a native module that must be rebuilt for
Electron's ABI via `electron-builder install-app-deps`. Paths containing spaces
broke node-gyp once, which is why the project lives in `ambientmind`.

### 8.3 `safeStorage`, not keytar

keytar is archived and is another native module. `safeStorage` ships with
Electron and uses DPAPI.

*Drawback.* Ciphertext is bound to the OS user; copying `secrets.json` to
another machine is useless and the app must reconnect.

### 8.4 sqlite-vec, not ChromaDB

ChromaDB is a sidecar process. sqlite-vec is an extension loaded into the
database already open.

*Drawback.* First weeks have no few-shots, and bad extractions, once stored,
can poison later prompts — there is still no thumbs-down on an example.

### 8.5 A 3B model

Fits VRAM. See §3.1 for the alternatives: a cloud API (better quality, kills
the privacy premise), an 8B model (needs a bigger GPU), and fine-tuning, which
has its own full treatment in §12.

*Drawbacks.* Weak on messy relative dates unless code post-processes them, and
still capable of inventing a deadline on screen capture.

### 8.6 A fixed action enum, not tool calling

Ollama's tool-calling API was the obvious choice and was rejected for a 3B
model. Free-form tool arguments are exactly where small models emit
nearly-right JSON, and **a malformed call that silently does nothing is worse
than having no assistant at all**.

The measurement that justified the extra prompt work is worth keeping: the
first version scored 6/10, and the failures were instructive. Asked "what's
most urgent?", it produced a *correct English answer* attached to an
`add_task` action — which would have quietly created junk. Checking only the
reply would have missed it entirely. Worked examples took it to 10/10.

### 8.7 A separate calendar, not `primary`

Fewer lines would have written into the user's own calendar with the full
`calendar` scope. The separate calendar plus `calendar.app.created` means a bug
here *cannot* reach a real appointment, the entries can never be mistaken for
ones the user made, and the whole thing can be hidden or deleted in one tap.

*Drawback.* The scope postdates existing sign-ins and Google will not upgrade a
grant silently, so the user must reconnect once. The health check says so
rather than letting the feature look broken.

### 8.8 One decisions table for two features

"Memory of decisions" and "learn from accepts and rejects" were planned
separately. They need identical rows, so building both would have meant
recording every action twice and then reconciling two half-truths about the
same history.

---

## 9. Failure modes that were real

Found by auditing the error paths rather than the happy one. Each was
**silent**, and the silence is what made them expensive.

### 9.1 Mail that failed was never read again

`isProcessed()` could not distinguish "handled" from "failed", so any transient
cause — no network, an expired token, Ollama restarting — retired that message
permanently, with no error the user would ever see.

Migration 007 counts attempts: three tries, then the message is left alone so a
genuinely unparseable one stops costing a model call. Rehearsing the migration
against a copy of the live database found **two messages already lost this
way**.

The first fix was incomplete, and only running it revealed why. Sync lists mail
with `newer_than:2d`, so a message that failed during a longer outage had
already aged out of the listing: it had attempts remaining that would never be
used. Retryable ids are now fetched directly, ahead of the window. When that
landed, the two recovered messages turned out to be **"projct" and
"Re: projct"** — ordinary personal mail from a human, which is exactly the
category this app exists to catch.

### 9.2 Ollama dying mid-pass burned the whole retry budget

Every remaining message in the pass was marked failed, which would have spent a
dozen messages' worth of retries on a single restart. That case now stops the
pass, because the model going away says nothing about the mail behind it.

### 9.3 Sleeping overnight left the list showing yesterday

Timers do not run while a machine is suspended, so snoozed tasks stayed hidden
past their time and overnight mail went unread until the next tick.
`powerMonitor`'s `resume` event now wakes snoozed tasks, tops up rule
occurrences and syncs.

### 9.4 Scheduled syncs were invisible

Background passes wrote tasks to the database that the overlay was never told
about, so new mail only appeared after the next manual action.

### 9.5 The migration rehearsal was testing a stale snapshot

`check-migration.cjs` copied `ambientmind.db` and nothing else. The database
runs in **WAL mode**, so recent commits live in `ambientmind.db-wal` until a
checkpoint — 1.7 MB of them at the time this was found. The rehearsal was
therefore blind to the newest rows, which are precisely the ones most likely to
be unusual and most likely to break a migration.

Measured: 34 examples visible to the rehearsal against 54 actually committed.
The tool built to catch data problems before they reached real data had a
20-row hole in it. It now copies `-wal` and `-shm` alongside the main file.

The same run caught a duplicate index name in a draft of migration 010, which
is the rehearsal doing its job.

### 9.6 Two suspicions that were already handled

Checked and deliberately left alone: Ollama calls already carry a bounded
timeout, and the overlay already repositions on `display-metrics-changed`,
`display-added` and `display-removed`.

---

## 10. Known limitations

### 10.1 Structural

- The overlay floats over applications rather than living in the wallpaper
  layer (§8.1).
- A 3B ceiling on nuance and on messy relative dates.
- RAG starts empty. There is now a feedback loop on the stored examples as well
  as on tasks (§3.4), but it only learns from mail the user actually acts on.
- The chat panel keeps no transcript between windows. It sees past *decisions*,
  but closing the panel forgets the conversation.
- No mobile client. Recurring rules reach a phone via Calendar; one-off tasks
  and completing from the phone do not.
- No Outlook or Teams, no OS notification ingestion, no wake word, no macOS
  build.
- The installer is unsigned, so SmartScreen warns on first run, and there is no
  auto-update.

### 10.2 The accuracy situation, stated honestly

Extraction quality on the user's own mail is **unmeasured, because there is
nothing to measure it on.** The export was run against 30 days of real mail:
50 messages, 37 rejected by the header pre-filter (30 `List-Unsubscribe`, 7
bulk senders, every one correct on inspection), 13 reaching the model, and
**zero tasks extracted**.

Reading all 13 confirms zero is the right answer for essentially every one:
recommendation and marketing mail, automated acknowledgements, an invoice, and
a mass mail that only looks personal because a human sent it. The one arguable
miss is a service nudge asking the user to choose between two options.

- **This does establish precision.** Thirteen noisy messages and nothing
  invented. Hallucinated tasks are the failure that would make the overlay
  unusable, and it is not happening.
- **It does not establish recall**, and no amount of labelling will fix that
  while the inbox holds no "send me the numbers by Friday" mail. **The premise
  that mail carries this user's todos does not currently hold**, which is why
  effort moved to voice, screen capture, recurrence and trust.
- Gmail's 50-message cap meant the 30-day window came back truncated. Listing
  now pages up to 5 × 100 ids, so a repeat run would sample properly.

Every precision and recall figure elsewhere in this document is measured on the
14 hand-written stand-in messages described in §3.8 — not on real Enron mail,
and not on the user's. The Enron benchmark those numbers are often assumed to
come from was scoped and tooled but never built (§12.3).

### 10.3 Packaging hazards

- `dlopen` cannot read out of an asar archive, so `better-sqlite3`,
  `sqlite-vec`, `onnxruntime-node` and `tesseract.js` are listed under
  `asarUnpack`, and `sqlite-vec`'s `getLoadablePath()` is rewritten to the
  unpacked copy at runtime. **Any native dependency added later needs the same
  treatment.**
- `sharp` arrives transitively via `@xenova/transformers` and is rebuilt during
  packaging. If the app is running it holds `libgobject-2.0-0.dll` open and the
  rebuild fails with `EPERM`. **Close AmbientMind before `npm run dist`.**

---

## 11. What is planned

Constraints for every item: this PC, a local 3B model, Google already
connected, and the privacy story stays "the LLM never leaves localhost".

### 11.1 Next

1. **Code signing.** The last thing between "it installs" and "it installs
   without frightening the user". Needs a paid certificate.
2. **Auto-update**, or at minimum a documented update path. Today a new version
   means running the installer again.
3. **Gmail pagination** past the 50-message cap, which would also allow a real
   accuracy sample if the inbox ever contains one.

### 11.2 After that

- **A real sync bus (E0).** Calendar write-back covers recurring rules one-way.
  Completing on a phone and having the overlay clear needs either a private
  encrypted relay (a real product with real operational cost) or a LAN-only
  bridge (a demo that dies off home Wi-Fi). This decision gates the mobile app
  entirely.
- **Mobile, read-only first.** List, then complete and snooze, then chat — and
  only if the phone reaches the same backend rather than running a second model
  on the device.
- **Phase F hardening.** Done in rebuild Phase 7 (crash log, encrypted
  backup and restore, privacy copy, pause AI), except the reboot test for
  start-at-login, which needs a real reboot.
- **Feedback on RAG examples themselves**, closing the one learning loop that
  is still open.

### 11.3 Blocked, with reasons

| Item | Status |
| --- | --- |
| Foreground-window-only capture | **Blocked.** Electron cannot identify the foreground window; `desktopCapturer` returns window sources in no documented order. Needs a native Win32 call. |
| Labelling the corpus | **Moot.** There is no task mail to label (§10.2). |
| Outlook / Teams | **Deferred.** Graph admin consent. After Google is boringly reliable. |
| OS notification scraping | **Deferred, probably permanently.** No clean Windows API, and it looks like spyware. Mail, calendar and voice already cover the same ground. |
| Wake word | **Deferred.** Custom wake words are paid or limited; a shortcut is free and works. |
| macOS | **Deferred.** After Windows is solid. |

### 11.4 Build order, as it actually happened

```
A   trust, health, editing      done
B1  recurrence rules            done
B3  habit suggestions           done
C1  about-me profile            done
C2  chat panel                  done
C3  clash helper                done
A7  corpus export               done; labelling moot (§10.2)
    installer + launch at login done
B2  calendar write-back         done
B4+C4 decision memory           done
    retry + resume hardening    done
  → code signing                next
  → auto-update
  → Gmail pagination
  → E0 pick a real sync bus
  → E1 mobile, read-only
```

A7 was expected to gate everything, and it did — by answering a different
question than the one asked. Running the export showed the inbox contains no
task mail, so labelling would have measured nothing. That is why accuracy work
is no longer at the front of this list.

---

## 12. Fine-tuning: the case for, the case against, and the recipe

Fine-tuning has been considered seriously, has a half-built data pipeline in
the repository, and is **not being done**. This section records the whole
argument, because "we decided not to train a model" is worth more written down
than the decision to train one would have been.

### 12.1 What fine-tuning would and would not fix

It is worth being exact about the target, because most fine-tuning projects aim
at something this app has already solved by other means.

**It would not fix output format.** The usual reason small models get
fine-tuned is to make them emit reliable JSON. Grammar-constrained decoding
(§3.2) already makes malformed output *structurally impossible*, for zero
training cost and with no risk of regression. The most common payoff is
therefore unavailable here, which removes a large part of the usual case.

**It would not add knowledge.** The model does not lack facts about email. It
has read more email-shaped text in pre-training than this app will ever show
it.

**It would fix the decision boundary**, which is the one thing genuinely worth
training. The hard judgement in this app is not parsing, it is:

- Is this sentence a commitment *for the reader*, or for somebody else on the
  thread, or for nobody?
- Is this a task, or is it a status update phrased with a verb?
- Does a message with no task in it return an empty list, confidently?

That last one is the expensive failure. It is also the one a 3B model is
weakest at, and the one that few-shot prompting improves least reliably.

**It would probably fix deadline normalisation**, currently patched in code
(`shared/deadline.ts`) because the schema can require a string but cannot
require a *real* datetime. A model trained on well-formed deadlines would need
less post-processing — though the post-processing is deterministic, tested and
cheap, so this is a modest prize.

### 12.2 Why it has not been done: two independent blockers

Either one alone would be sufficient to stop it.

**Blocker 1: there is no labelled data.** LoRA on a 3B model needs something in
the range of 500 to 1000 in-domain examples before it reliably beats a
well-written prompt, and meaningfully more before it beats prompting *plus*
retrieval. The repository currently holds **14 hand-written examples carrying
7 gold tasks** (§3.8). That is three orders of magnitude short, and it is not a
labelling-effort problem: §10.2 established that the user's own inbox contains
essentially no task-bearing mail, so the obvious source of in-domain training
data does not exist to be labelled.

**Blocker 2: 4 GB of VRAM runs this model but cannot train it.** These are very
different requirements, and the gap is easy to underestimate:

| Phase | What must be in VRAM | Rough cost for 3B |
| --- | --- | --- |
| Inference | 4-bit weights + KV cache | ~2 GB — **fits** |
| QLoRA training | 4-bit frozen weights + LoRA adapters + adapter gradients + optimizer moments + activations retained for backprop | ~10–14 GB — **does not fit** |

The frozen base is the *cheap* part. What overflows the card is the activation
memory held for the backward pass, which scales with sequence length — and
these sequences are long, since a prompt carries a full email plus up to five
few-shot examples. Gradient checkpointing and a batch size of 1 would trade
compute for memory, but not by the factor of three-plus needed here. Training
must happen on rented hardware (§12.5).

### 12.3 The Enron path: what actually exists

`eval/prepare-enron.ts` is a complete, working sampler for the
[Kaggle Enron dataset](https://www.kaggle.com/datasets/wcukierski/enron-email-dataset)
— roughly 500,000 real corporate emails released into the public record by
FERC after the collapse. It is more carefully built than a throwaway script,
and the reasoning inside it survives whether or not Enron is ever used:

- **Streaming CSV reassembly.** The dump is a two-column CSV whose `message`
  field contains raw RFC-822 text with embedded newlines. Rows are rebuilt by
  tracking quote parity across lines, so the 1.4 GB file is never loaded into
  memory.
- **Reservoir sampling**, keeping the pass single and memory flat across half a
  million rows.
- **A seeded PRNG** (`mulberry32`, default seed 42), so a given seed always
  produces the same sample and two people can discuss "the same corpus".
- **Stratified sampling, 60/40.** Messages matching an action hint go in one
  bucket, everything else in the other, and the sample is deliberately padded
  with **40% obvious non-tasks**. The reasoning is recorded in the file header:
  a corpus drawn uniformly from 500k emails is mostly forwarded chaff, and
  would flatter the model's precision without ever testing it.
- **Length and noise filters:** bodies of 80–4000 characters, no `Fw:`
  subjects.

That 40% negative ratio is the detail that would carry directly into training.
A model trained only on emails that contain tasks learns that *every* email
contains a task, and the failure is invisible until it is in front of a user.

**What does not exist is the labelling.** The script emits records with
`goldTasks: []` and `notes: 'UNLABELLED'`, and the pipeline's final step —
"fill in goldTasks by hand, then rename to `eval/corpus/enron-200.jsonl`" — was
never carried out. The raw dump was never downloaded. Every number in this
document comes from the 14 hand-written stand-ins.

### 12.4 Why Enron would be a poor teacher for this app

The data is available, public, free of privacy constraints, and 500,000
messages deep. It is still probably the wrong training set, for one weak reason
and one strong one.

**The weak reason is domain shift**, which is nonetheless severe. Enron is 2001
corporate energy-trading correspondence between colleagues inside one company.
This app reads 2026 personal Gmail belonging to a student. The register,
threading conventions, signature blocks, and — most importantly — *what counts
as a commitment* all differ. "Can you get me the Q1 volumes by Thursday" from a
managing director is a task in a way that shares very little structure with
anything in the inbox measured in §10.2.

**The strong reason is that the experiment has already been run, cheaply, and
came back negative.** Conditioning the model on examples that did not resemble
the user's mail produced exactly the predicted pathology: recall rose to 7/7
while precision and empty-specificity both fell to 87.5% (§3.4). The model
started finding tasks in messages that contained none, because it had been
shown a world in which emails generally contain tasks.

That was retrieval, and retrieval is **per-message, reversible, and switched
off by deleting a row**. Fine-tuning is the same bias baked into the weights
permanently. Spending money and a rented GPU to make a measured regression
harder to undo is a poor trade, and this is the single most decisive argument
in this section.

**The one real advantage of Enron** is legal rather than technical: it is
public record, so it can be uploaded to rented hardware with no privacy cost.
The user's own mail cannot, which is the tension §12.7 has to resolve.

### 12.5 The recipe, if it were done anyway

Recorded concretely so the decision can be revisited without re-deriving it.

**Method: QLoRA.** Full fine-tuning of 3B parameters is out of reach on any
hardware worth renting for this. QLoRA freezes the base model at 4-bit NF4
precision and trains small low-rank adapter matrices injected into the
attention and MLP projections, computing in bf16. Trainable parameters drop
from 3 billion to roughly 20–30 million.

| Hyperparameter | Value | Reason |
| --- | --- | --- |
| Base | `Qwen2.5-3B-Instruct` (HF weights) | Must match the served model, not a different checkpoint |
| Quantisation | 4-bit NF4, bf16 compute, double quant | Standard QLoRA configuration |
| LoRA rank | 16 | 8 underfits a judgement task; 64 overfits at this data size |
| LoRA alpha | 32 | Conventional 2× rank |
| Dropout | 0.05 | Small dataset, real overfitting risk |
| Target modules | `q,k,v,o,gate,up,down_proj` | Attention alone is measurably weaker for format-plus-judgement tasks |
| Learning rate | 1e-4 to 2e-4, cosine, 3% warmup | Standard LoRA band |
| Epochs | 2–3 | Beyond that it memorises a 1000-row set |
| Batch | 1, with gradient accumulation to ~16 | Sequences are long |

**Three details that decide whether it works at all:**

1. **Mask the loss to the completion.** Compute loss only on the emitted JSON,
   never on the system prompt and message. Training on the prompt spends model
   capacity learning to reproduce instructions it will always be handed anyway,
   and is the most common way this kind of run quietly underperforms.
2. **The training prompt must be byte-identical to the production prompt**,
   rendered from `prompts/taskExtraction.ts` through the same code path, using
   Qwen's ChatML template exactly. Training against a paraphrase produces a
   model tuned for a prompt that is never shipped.
3. **Keep the negatives.** Roughly 40% of training rows must have
   `{"tasks": []}` as their correct output, matching `prepare-enron.ts`
   (§12.3).

**Where it would run.** A 16 GB T4 on Colab's free tier is sufficient; a rented
A10 or 4090 at roughly $0.30–0.50 per hour is more comfortable. A thousand
examples for three epochs on a 3B model is well under an hour of compute, so
the cash cost is negligible — the cost is entirely in labelling.

**How it would ship.** Merge the adapter into the base weights, convert to GGUF
with llama.cpp's conversion script, quantise to Q4_K_M, and register it with
`ollama create ambientmind-extract -f Modelfile`. It then drops into the
existing serving path **with no code change at all**, because the model id is
already a configuration field (§5.3). That the deployment story is this cheap
is a genuine point in favour of eventually doing it.

### 12.6 How it would be judged, and one architectural catch

**The bar.** It must beat the prompted baseline on the same harness, on a
**held-out split that was never trained on**. Given §3.8, the corpus would have
to grow substantially first, or the comparison is noise: at 14 messages a
single flipped judgement moves F1 by roughly 12 points.

**The catch, specific to this codebase.** The extraction model and the chat
model are *the same model* — `config.ollamaModel` serves both §6.1 and §6.7.
Fine-tuning hard on extraction risks degrading general conversational ability,
and the chat panel's action selection is already the most fragile measured
behaviour in the app, having needed deliberate prompt work to reach 10/10.

There is no room to sidestep this by running two models: 2 GB each on a 4 GB
card does not fit, and swapping models per call would mean paying a multi-second
load on every chat turn. So a fine-tune must either preserve chat ability — a
light touch, low rank, few epochs, and `eval/chatActions.ts` re-run as a
regression gate — or the app must first be restructured around model swapping.
Neither is free, and neither was obvious before writing this down.

### 12.7 Verdict, and the path that actually leads there

**Fine-tuning is the last lever, not the first**, and the cheaper levers are
not yet exhausted. Prompt engineering took chat action selection from 6/10 to
10/10 at zero training cost. Retrieval provides per-user adaptation online,
with no training step, and can be undone by deleting a row. The binding
constraint on quality today is labelled in-domain data, and fine-tuning does
not produce data — it consumes it.

**But the data problem is already being solved, quietly, by a feature built for
another purpose.** The `decisions` table (§7.5) is a label generator that has
been running since it shipped:

| User action | Implicit label |
| --- | --- |
| Completes a task | This *was* a real task for me |
| Deletes a task | This was **not** a task for me — a hard negative |
| Edits a title | The correct title, against the model's attempt |
| Dismisses a suggestion | This pattern is not a commitment |
| Snoozes repeatedly | Real, but the deadline was wrong |

This is in-domain, personally relevant, continuously accumulating supervision
of exactly the kind Enron cannot provide — and deletions are *hard negatives*,
which are the most valuable and most tedious rows to label by hand. Each one is
paired with the `rawContext` that produced it, so a training row can be
reconstructed without storing anything extra.

That points at a real sequence, in order:

1. Keep accumulating decisions. Nothing new is needed; this is already
   happening.
2. When a few hundred exist, build the exporter that turns them into training
   rows, and measure the **prompted** model against them first. That alone may
   close the gap and cost nothing.
3. Only if a genuine gap remains, run §12.5 — on the user's own distribution,
   not Enron's.

**The unresolved tension** is that step 3 requires uploading the user's mail to
a rented GPU, which contradicts the founding premise that the data never leaves
the machine. Enron is attractive precisely because it has no such cost, and
useless precisely because it is not this user's mail. The honest resolutions
are: train locally once hardware allows, ask for explicit informed consent for
a one-off upload, or never do it. **That question should be answered before any
training runs, not after.**

---

## 13. Building, running, packaging

### 13.1 Prerequisites

- Node 20+
- Ollama running, with `qwen2.5:3b` and `nomic-embed-text` pulled
- A Google Cloud OAuth desktop client — see `docs/google-setup.md`

### 13.2 Commands

```powershell
npm install          # postinstall rebuilds native modules for Electron
npm run dev          # electron-vite dev server with HMR
npm start            # preview the production bundle
npm run build        # typecheck, then bundle
npm test             # 85 unit tests
npm run eval         # extraction precision/recall against a corpus
npm run check:migration   # rehearse migrations on a copy of the live DB
npm run preflight    # refuse to package while the app is running
npm run dist         # preflight, build, then a per-user NSIS installer
```

`npx electron ./scripts/check-embeddings.cjs` reports how far the embedding
backfill has progressed and whether the feedback loop has any signal yet.

Headless modes, useful for scripting and for checking a change against real
data without waiting for the scheduler:

```powershell
npm run sync:now
npm run corpus:export -- --days=30 --limit=120
```

### 13.3 Shortcuts

Defaults live in `shared/shortcuts.ts`. Settings → Shortcuts records a new
one from the physical keys (so ⌥S is S, not ß), requires ⌃, ⌥ or ⌘ (or a
function key), and stores only the changed ones in `config.shortcuts`. Main
re-registers them at once and says when one conflicts or another app holds
the keys.

| Windows | Mac | Action |
| --- | --- | --- |
| `Ctrl+Shift+A` | `⌃⌥Space` | QuickAdd; press again to talk |
| `Ctrl+Shift+S` | `⌃⌥S` | Capture the screen as a task |
| `Ctrl+Shift+C` | `⌃⌥C` | Ask about your tasks |
| `Ctrl+Shift+,` | `⌃⌥,` | Settings |

### 13.4 Packaging configuration

`electron-builder.yml` produces a **per-user** NSIS installer: no UAC prompt,
and the app only ever writes to the profile it runs as. Uninstall deliberately
leaves `userData` alone, because the database is the user's task history rather
than the app's scratch space. See §10.3 for the two hazards.

---

## 14. Repository map

```
electron/             main, overlay, tray, quickAdd, settings, chat, preload
electron/native/      Swift helper process, client and attribution check
native/mac-helper/    the Swift helper (SwiftPM)
electron/services/    taskStore, ruleStore, suggestionStore, decisionStore,
                      sync, calendarSync, ai (router), aiLog, appleModel,
                      extract, ollama, chat, health, googleAuth,
                      vectorStore, speech, screenContext, corpusExport,
                      config, secrets, dedup, migrations
electron/services/integrations/   gmail, gcalendar, gcalendarWrite
src/overlay/          orb, task list, health banner, suggestion card
src/quickadd/         voice and type palette
src/settings/         preferences, status, rules, profile, learned
src/chat/             ask-about-your-tasks panel
shared/               types, ipc, urgency, similarity, deadline, voiceIntent,
                      recurrence, recurrenceDetect, snooze, clash, decisions,
                      calendarEvent, promptTime, capture, evidence, aiStatus
prompts/              taskExtraction, taskEnrichment, screenTask, chat
db/migrations/        9 append-only SQL files
eval/                 harness, corpus, unit tests, chat action eval
scripts/              icons, migration rehearsal, smoke tests, db inspection
docs/                 this file plus google / voice / screen how-tos
```

**Runtime stack:** Electron 37, React 19, Tailwind 4, TypeScript 5.8,
electron-vite 4, better-sqlite3 13, sqlite-vec 0.1, @xenova/transformers 2.17,
tesseract.js 7, electron-builder 26.

---

## 15. Explicitly out of scope

Unless the brief changes:

- **Fine-tuning Qwen on the user's life — for now.** No labelled volume, no
  VRAM headroom, and the cheap version of the experiment already regressed
  precision. This is the one item on this list with a written path back:
  §12 sets out the blockers, the full QLoRA recipe, and the conditions under
  which the decision should be revisited.
- **On-device neural reinforcement learning for prioritisation.** Wrong tool at
  this data scale; counting accepts and deletes is both sufficient and
  inspectable.
- **Scraping every Windows toast.** See §11.3.
- **A cloud LLM "for quality".** Contradicts the founding privacy premise.

---

## 16. Related documents

- `docs/BACKLOG.md` — audited list of current problems, remaining features,
  and the sequenced plan. This file explains the system; that one is the
  working list of what to do about it.
- `docs/google-setup.md` — OAuth client, scopes, consent screen
- `docs/voice.md` — the speech path and why Transformers.js
- `docs/screen-capture.md` — OCR versus a VLM, deadline normalisation
- `eval/results/` — measured prompt experiments, including the weekday-header
  regression that cost 42 points of recall

---

## 17. Appendix: the neural networks, in full detail

§3 covers what each model is *for* and how the app calls it. This appendix
covers what they *are*: architectures, tensor dimensions, how a forward pass
actually proceeds, where the memory goes, and why several apparently arbitrary
design choices in this codebase are forced by the internals.

Configuration figures are from each model's published config. Where a number
drives a decision elsewhere in this document, the arithmetic is shown rather
than asserted.

### 17.1 The four networks at a glance

| Model | Family | Params | Precision | Device | Runtime |
| --- | --- | --- | --- | --- | --- |
| Qwen2.5-3B-Instruct | Decoder-only transformer | 3.09 B | 4-bit (Q4_K_M) | GPU | Ollama / llama.cpp |
| nomic-embed-text v1.5 | Bidirectional encoder (BERT-style) | 137 M | F16 | GPU | Ollama |
| Whisper base.en | Encoder-decoder transformer | 74 M | INT8/F32 ONNX | **CPU** | Transformers.js / ORT |
| Tesseract 5 | Bidirectional LSTM | ~2–3 M | F32 | **CPU** | WebAssembly |

Roughly 3.3 billion parameters of neural computation run inside this app, and
about 94% of it is the one language model. Everything else is small,
specialised, and deliberately kept off the GPU.

### 17.2 Qwen2.5-3B: architecture

A decoder-only transformer — the same family as GPT and Llama. "Decoder-only"
means a single stack with causal masking: every token attends to itself and
everything before it, never forward.

| Property | Value |
| --- | --- |
| Layers | 36 |
| Hidden size (`d_model`) | 2048 |
| Query heads | 16 |
| Key/value heads | **2** (grouped-query attention) |
| Head dimension | 128 |
| MLP intermediate size | 11008 |
| Vocabulary | 151,936 |
| Max positions | 32,768 (the app uses 8,192) |
| Position encoding | RoPE, θ = 1,000,000 |
| Normalisation | RMSNorm, pre-norm |
| MLP activation | SwiGLU |
| Input/output embeddings | **Tied** |

**One forward pass.** Text is tokenised by byte-level BPE into ids in
`[0, 151936)`. Each id indexes a row of the embedding matrix, producing a
2048-dimensional vector per token. That sequence then passes through 36
identical blocks, each doing:

1. RMSNorm — rescale by root-mean-square, no mean subtraction and no bias.
   Cheaper than LayerNorm and empirically just as good at this scale.
2. Grouped-query attention, with RoPE applied to Q and K.
3. Residual add.
4. RMSNorm again.
5. SwiGLU MLP: project 2048 → 11008 twice, gate one projection by the SiLU of
   the other, multiply elementwise, project 11008 → 2048.
6. Residual add.

After the final block, one more RMSNorm, then a projection to 151,936 logits —
one score per vocabulary entry. Grammar masking (§17.4) is applied to those
logits, and the highest-scoring survivor is chosen.

**Grouped-query attention is the single most important number here.** Standard
attention gives every query head its own key and value head. Qwen2.5-3B has 16
query heads sharing just **2** key/value heads. Quality cost is small; the
memory cost collapses, and on a 4 GB card that is decisive.

The KV cache stores keys and values for every token generated so far, so
attention does not recompute the whole prefix each step. Its size is:

```
bytes/token = 2 (K and V) × layers × kv_heads × head_dim × bytes_per_element
            = 2 × 36 × 2 × 128 × 2          (fp16)
            = 36,864 bytes  ≈ 36 KB per token
```

At the app's 8192-token context that is **~302 MB**. Without GQA — 16 KV heads
instead of 2 — the same calculation gives 294 KB per token and **~2.4 GB** of
cache. Weights plus cache would exceed the card before a single token was
generated. GQA is why `num_ctx: 8192` is affordable at all.

**Tied embeddings** are the other memory saving: the 151,936 × 2048 embedding
matrix is reused as the output projection instead of storing a second copy.
That is 311 million parameters not duplicated — around 150 MB at 4-bit, and
about 5% of the model's total footprint.

**RoPE** encodes position by rotating pairs of dimensions within Q and K by an
angle proportional to absolute position. Because attention scores depend on the
*difference* of two rotations, the mechanism sees relative position for free.
The large θ of 1,000,000 stretches the lowest frequencies so that distant
positions stay distinguishable, which is what makes the 32k context usable.

**Quantisation: Q4_K_M.** Not a uniform 4 bits. The "K-quant" scheme splits
each tensor into small blocks with their own scale and minimum, and the "_M"
variant deliberately keeps certain tensors — notably the value projections and
the second MLP projection — at higher precision, because those are measurably
more sensitive to rounding. The effective average is around 4.5 bits per
weight, giving roughly **1.9 GB** of weights from a model that would occupy
6.2 GB at fp16.

**The resident VRAM budget**, which explains several rules elsewhere:

| Item | Size |
| --- | --- |
| Weights (Q4_K_M) | ~1.9 GB |
| KV cache at 8192 context | ~0.3 GB |
| Compute buffers and activations | ~0.3–0.5 GB |
| **Language model total** | **~2.5–2.7 GB** |
| nomic-embed-text at F16 | ~0.27 GB |
| Windows desktop compositing | ~0.3–0.8 GB |
| **Total against a 4 GB card** | **~3.1–3.8 GB** |

There is no headroom. That is the whole reason extraction is strictly
serialised (§6.1): a second concurrent generation would need its own KV cache
and activation buffers, and would spill into system RAM, where the model runs
roughly an order of magnitude slower. Two concurrent extractions would not be
twice as fast — they would both be far slower than running them in sequence.

### 17.3 Why generation has two phases, and what follows from it

Inference is not one uniform process. It has two phases with completely
different performance characteristics, and most of the app's tuning follows
from the difference.

**Prefill** processes the entire prompt at once. Every token is known upfront,
so all 36 layers run as large matrix-matrix multiplications across the whole
sequence in parallel. This phase is **compute-bound** and highly efficient.

**Decode** generates output one token at a time. Each new token depends on the
previous one, so no parallelism across the sequence is possible; every step
reads all 1.9 GB of weights to produce a single token. This phase is
**memory-bandwidth-bound**, and it is where essentially all the wall-clock time
goes.

Three practical consequences, all visible in the codebase:

- **`num_predict: 800` bounds latency far more than prompt length does.**
  Doubling the prompt costs a little more prefill; doubling the output roughly
  doubles total time. This is why the output cap is a hard number and the
  context is generous.
- **`temperature: 0` means pure greedy argmax** — take the highest logit, no
  sampling, no randomness. The same prompt yields byte-identical output every
  run. Without this the eval harness (§3.8) would be measuring sampling noise
  rather than prompt changes, and the weekday-header regression that cost 42
  points of recall could never have been attributed with confidence.
- **`top_p: 0.9` is inert at temperature 0** and is kept only as a guard
  against someone later raising the temperature without thinking about it.

### 17.4 Constrained decoding, at the tensor level

§3.2 describes the effect. The mechanism is worth stating precisely because it
is often misunderstood as validation.

At every decode step the model produces 151,936 logits. Ollama compiles the
supplied JSON Schema into a grammar and maintains a parser state alongside
generation. Before sampling, it computes the set of tokens that could legally
continue the document from the current state and sets every other logit to
negative infinity. Softmax then assigns those tokens probability exactly zero.

Two consequences follow, and they are the entire reason this technique is load
bearing here:

**It is structurally impossible to emit invalid output.** Not unlikely —
impossible. There is no retry loop, no repair pass, no JSON parse guarded by a
try/catch. If the schema says `priority` is one of four strings, no other
string can be produced, because the tokens spelling it were masked before
sampling.

**It constrains syntax, never semantics.** The mask does not change the weights
or what the model "believes"; it removes options. If the model's actual
preference was an illegal continuation, it is pushed onto its best *legal*
path, which may be one it assigned low probability. A confidently wrong,
perfectly schema-valid task is entirely possible. Every deterministic guard in
this app — deduplication, deadline normalisation, decision-based suppression,
the four-action cap and similarity floor in chat — exists in the gap between
"structurally valid" and "true".

This is also why fine-tuning has less to offer here than usual (§12.1): the
payoff most people seek from it is already guaranteed by construction.

### 17.5 nomic-embed-text: a different kind of network

The embedding model is **not** generative and is architecturally unlike Qwen.

| Property | Value |
| --- | --- |
| Architecture | BERT-style bidirectional encoder |
| Layers | 12 |
| Hidden size | 768 |
| Attention heads | 12 |
| Max sequence | 8192 (rotary positions) |
| Output | 768-d vector, mean-pooled, L2-normalised |
| Parameters | 137 M |

**Bidirectional, not causal.** There is no mask: every token attends to every
other token in both directions. That is legitimate here because the goal is not
to predict what comes next but to *represent the whole passage at once*.

**Pooling.** Twelve layers produce one 768-d vector per token. Mean pooling
averages them into a single passage vector, which is then L2-normalised to unit
length. Normalisation is what makes distance comparisons meaningful, and it
makes Euclidean distance and cosine similarity monotonically related — so
`sqlite-vec`'s default L2 ordering and cosine ranking agree.

**Contrastive training** is why the geometry means anything. The model was
trained to pull genuinely related text pairs together and push unrelated pairs
apart. Semantic similarity as spatial proximity is a *learned property*, not an
automatic one — this is precisely what a raw language model's hidden states do
not reliably give you.

**Task prefixes — fixed.** nomic-embed v1.5 was trained with task prefixes:
stored passages as `search_document: ...` and lookups as `search_query: ...`.
The app originally sent raw text for both, which was at least *symmetric* — so
retrieval still ranked — but used the model outside its trained distribution
and wasted the asymmetric geometry it learned.

`prefixFor()` now applies them, and only to nomic models, since any other
embedding model reads those tokens as ordinary words and would be worse for
the addition. Because the change alters every vector (measured cosine shift of
0.903 against the unprefixed vector), existing rows had to be re-embedded
rather than left alongside new ones; see the embedding-version mechanism in
§3.4.

**Matryoshka representations.** v1.5 was trained so that truncating the vector
to 512, 256 or 128 dimensions degrades quality gracefully, which would allow a
storage/quality trade. This app does not use it: migration 002 fixes the `vec0`
column at 768 dimensions, so changing it means a migration, not a config
change.

### 17.6 Whisper: sequence-to-sequence over audio

Whisper is an **encoder-decoder** transformer, the only model in the app with
that shape. The encoder reads audio; the decoder writes text while attending to
what the encoder saw.

| | tiny.en | base.en (default) | small.en |
| --- | --- | --- | --- |
| Parameters | 39 M | 74 M | 244 M |
| Encoder/decoder layers | 4 / 4 | 6 / 6 | 12 / 12 |
| Width (`d_model`) | 384 | 512 | 768 |
| Attention heads | 6 | 8 | 12 |

**The audio front end** is fixed and worth following precisely, because one of
its properties has a direct effect on latency:

1. Input is mono 16 kHz float32 PCM — resampled in the renderer (§3.5) because
   this is exactly what the model expects.
2. A short-time Fourier transform with a 25 ms window and a 10 ms hop gives
   100 frames per second.
3. Frequencies are mapped onto **80 mel bins**, a perceptually spaced scale,
   and log-compressed.
4. The result is padded or trimmed to exactly **30 seconds** — 3000 frames.
5. Two 1-D convolutions, the second with stride 2, halve the time axis to
   **1500 encoder positions**.

**Step 4 is the one with consequences.** Whisper always processes a 30-second
window. A two-second "remind me to call the bank tomorrow" is zero-padded to
thirty seconds and costs the *same* encoder pass as a full half-minute of
speech. Transcription latency is therefore essentially constant regardless of
how briefly the user spoke, which is why the QuickAdd flow can be designed
around a predictable delay rather than a variable one.

**The encoder** applies bidirectional self-attention over those 1500 positions
with sinusoidal position encodings. **The decoder** is autoregressive with both
causal self-attention and *cross-attention* into the encoder output — the
mechanism by which text generation is conditioned on sound. It is primed with
special tokens (`<|startoftranscript|>`, `<|en|>`, `<|transcribe|>`,
`<|notimestamps|>`) and emits BPE text tokens until `<|endoftext|>`.

**Why it hallucinates on silence, and why §3.5's energy gate is the right
fix.** The decoder is a language model conditioned on audio. Trained on 680,000
hours of weakly aligned web audio — much of it subtitled video — it learned
strong textual priors. When the audio carries no speech, cross-attention
supplies nothing to override those priors, and the language model prior wins,
producing whatever commonly fills silence in the training data: "Thank you.",
"Thanks for watching!", subtitle credits. The model is doing exactly what it
was trained to do. No prompt can reliably suppress it, because the failure is
upstream of any instruction. A mean-amplitude check before invoking the model
sidesteps the problem entirely, which is why a crude energy threshold beats a
sophisticated prompt here.

**Execution.** The ONNX export runs on the CPU through `onnxruntime-node`. This
is the deliberate choice from §2: it costs seconds of latency and **zero VRAM**,
leaving the whole card to the language model. Moving Whisper to the GPU would
make it faster and would make extraction worse.

### 17.7 Tesseract: the one recurrent network

Tesseract is the odd one out — not a transformer, and older in lineage, but
genuinely neural since version 4 replaced the classic pattern-matching engine
with an LSTM recogniser.

**LSTM** (Long Short-Term Memory) is a recurrent network: it processes a
sequence one step at a time while carrying a hidden state forward, with learned
gates controlling what to keep, forget and output. Before transformers, this
was the standard answer to sequence modelling.

**The pipeline:**

1. Layout analysis segments the page image into text lines.
2. Each line is normalised to a fixed height (~36 px) and treated as a sequence
   of thin vertical slices scanned left to right.
3. A **bidirectional** LSTM runs over those slices in both directions — forward
   and backward passes are concatenated, because character identity genuinely
   depends on both sides. An `l` versus a `1` is often only resolvable from
   surrounding letters.
4. Each time step emits a distribution over characters plus a blank symbol.
5. A CTC-style collapse merges repeats and drops blanks to produce final text,
   which is what allows the network to be trained without knowing in advance
   which slice corresponds to which character.

**What it fundamentally cannot do.** Tesseract recognises *glyphs*. It has no
concept of a button, a heading, a menu, or which part of the screen the user
cares about. It returns a flat stream of text with no notion of meaning or
salience.

That limitation is the direct cause of the heuristics in §3.6 — dropping lines
under three characters, and lines where fewer than half the characters are
letters. Toolbars, icon rows and window chrome OCR into punctuation soup that a
scene-understanding model would simply ignore. The network supplies characters;
structure has to be reconstructed downstream by ordinary code and then handed
to Qwen. A vision-language model would collapse steps 1–5 and the denoising
into a single pass, and needs roughly 3.2 GB of VRAM to do it (§2).

### 17.8 Where the neural networks stop

Worth restating in this context, because the boundary is a design position
rather than an accident (§3.7). These subsystems could plausibly have been
modelled and are deliberately plain code:

| Subsystem | Implementation | Why not a model |
| --- | --- | --- |
| Recurrence parsing | Regular expressions | A wrong recurrence repeats forever |
| Habit detection | Fixed threshold: 3 weeks, same weekday, ±90 min | Predictability beats sophistication at this data scale |
| Clash resolution | Fixed decision ladder | Advice that changes between identical runs is not advice |
| Calendar → task | Arithmetic | The input is already structured |
| Decision matching | Dice similarity on titles | Must work with the embedding model down; must be testable |
| Deduplication | Dice ≥ 0.72 plus a 24 h window | Same |
| Urgency ordering | Derived from the clock | Must never be stale or surprising |

The rule the whole system follows: **neural networks are used to understand
unstructured human input — prose, speech, pixels. Everything downstream of that
understanding is arithmetic.** Each of the four models sits at an input
boundary, converting something unstructured into something typed, after which
ordinary testable code takes over.

### 17.9 Total budget

| Model | Device | Memory | Resident |
| --- | --- | --- | --- |
| Qwen2.5-3B | GPU | ~2.5–2.7 GB | While Ollama keeps it loaded |
| nomic-embed-text | GPU | ~0.27 GB | During sync only |
| Whisper base.en | CPU RAM | ~150 MB weights, ~0.5 GB with the runtime | From the first Quick Capture, kept |
| Tesseract | CPU RAM | ~30 MB | One cached worker per session |

The GPU total is the binding constraint and the reason for nearly every
substitution in §2. Once loaded, the CPU models stay resident rather than
being loaded per use — for Whisper in particular, a cold load is several
seconds and would land squarely in the middle of the user trying to speak.
Whisper is warmed when Quick Capture opens rather than at launch; the QA run
of November 2026 measured the app at about 1 GB ten seconds after launch when
it was warmed there, settling to about 450 MB.
