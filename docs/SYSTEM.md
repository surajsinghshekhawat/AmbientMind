# AmbientMind — System document

This file is the long-form record of the project: what the system is, what has
been built, how and why those choices were made, what was rejected, what still
hurts, and what is planned next. Short how-tos for Google, voice, and screen
capture live in the other files under `docs/`.

Last updated: 9 September 2026.

---

## 1. What this product is

AmbientMind is a **Windows desktop overlay** that keeps a short, urgency-sorted
todo list on screen at all times. The list is meant to fill itself: a local
language model reads Gmail and Google Calendar, extracts only the things *you*
have to do, and writes them into a local SQLite database. You can also add
tasks by typing, by speaking, or by asking the app to read whatever is on
screen.

Design goals that have not changed:

- **Zero extra destination.** The list sits on the desktop. You should not have
  to open another productivity app to know what is due.
- **Local by default.** Extraction, embeddings, speech-to-text, and OCR run on
  this machine. Mail and calendar still go to Google because that is where the
  data lives; bodies are not sent to a cloud LLM.
- **Ambient, not demanding.** Click-through overlay, no dock presence, tray
  resident. It should not steal focus from whatever you are typing.

The original write-up asked for the list to sit *above the wallpaper and below
apps*, and also to be clickable. On Windows those two things cannot both be
true. The implemented compromise is documented in §4.1.

---

## 2. Hardware and why it dictates the stack

The development machine is the binding constraint, not a footnote:

- ~8 GB system RAM
- GTX 1650, 4 GB VRAM
- i7-10750H

**Llama 3.1 8B** (the original spec) does not fit in 4 GB of VRAM at a usable
quantisation. It would spill into system RAM that is already shared with
Windows and Electron (a full Chromium). The live model is **Qwen2.5 3B** via
Ollama (`qwen2.5:3b`). Embeddings use **nomic-embed-text** (768 dimensions).

Speech uses **Whisper** through Transformers.js (ONNX), not a native
whisper.cpp build. The size is a setting — tiny (~75 MB), base (~145 MB,
default) or small (~480 MB). All three run on CPU, so this trades seconds of
latency against accuracy and does not compete with the 3B model for VRAM; tiny
was the old default and is visibly weak on accented English. Screen understanding uses **Tesseract**
(`tesseract.js`), not a vision-language model. Both of those substitutions are
VRAM decisions, not quality decisions. They are reversible if the machine
changes; the swap points are named in the code (`readScreenText`, the Whisper
model id in `electron/services/speech.ts`).

---

## 3. How the system is put together

```
┌─────────────────────────────────────────────────────────────────┐
│  Renderers (Chromium, isolated)                                 │
│  overlay  │  quickadd  │  settings                              │
│  React + Tailwind. No Node. Talks only through preload IPC.     │
└───────────────┬─────────────────────────────────────────────────┘
                │ contextBridge `window.ambient`
┌───────────────▼─────────────────────────────────────────────────┐
│  Electron main process                                          │
│  overlay window, tray, global shortcuts, OAuth loopback server  │
│  sync scheduler, task store, Ollama client, Whisper, Tesseract  │
└───────┬────────────┬─────────────┬──────────────┬───────────────┘
        │            │             │              │
        ▼            ▼             ▼              ▼
   SQLite +      Ollama        Google APIs    OS APIs
   sqlite-vec    localhost     Gmail +        safeStorage (DPAPI),
   %APPDATA%     11434         Calendar       desktopCapturer, mic
```

### 3.1 Processes and windows

| Surface | Role |
| --- | --- |
| **Overlay** | Always-on-top, transparent, click-through until the cursor is over a control. Full-height list on the configured corner. |
| **QuickAdd** | `Ctrl+Shift+A`. Palette for typed or spoken add. Mic starts on open; 3 s of silence after speech stops recording. |
| **Settings** | `Ctrl+Shift+,` or ⚙. Google connect, corner, sync interval, model name. |
| **Tray** | Hide/show overlay, Google, Sync now, start at login, quit. No main window, so closing overlay must not quit the app. |

The overlay uses `setIgnoreMouseEvents(true, { forward: true })` so the desktop
stays usable. The renderer hit-tests `data-ambient-interactive` on mousemove
and asks main to enable capture only while hovering a real control. That is
why empty transparent space does not eat clicks.

### 3.2 Data on disk

All under `%APPDATA%\ambientmind\` (not the generic Electron folder):

| File | Contents |
| --- | --- |
| `ambientmind.db` | Tasks, RAG examples + vectors, processed message ids, sync cursors. WAL mode. |
| `config.json` | Overlay corner, max visible, sync interval, model ids, display name, about-me profile. |
| `corpus-*.jsonl` | Optional export of your own mail for accuracy measurement (§4.10). |
| `secrets.json` | OAuth tokens, encrypted with Electron `safeStorage` (DPAPI). |
| `google-credentials.json` | Desktop OAuth client JSON from Google Cloud Console. |
| `whisper/` | Cached ONNX + tokenizer for the selected Whisper size. |
| `tesseract/` | Cached OCR language data. |

Schema version is SQLite `user_version`. Migrations are append-only SQL files
bundled as raw strings so they exist inside a packaged asar:

1. `001_init.sql` — `tasks`
2. `002_rag.sql` — `examples`, `example_vectors` (sqlite-vec `vec0`, 768-d)
3. `003_sync.sql` — `processed_messages`, `sync_state`
4. `004_snooze.sql` — `tasks.snoozed_until`
5. `005_rules.sql` — `recurrence_rules`, and a **rebuild of `tasks`** so
   `source` admits `'rule'`. SQLite cannot alter a CHECK constraint, so the
   table is copied, dropped and renamed inside one transaction.
   `npm run check:migration` rehearses this against a copy of the live database
   and reports whether the row count survived.
6. `006_suggestions.sql` — `recurrence_suggestions` (pending/accepted/dismissed)

### 3.3 Task model

A task is the only object the overlay understands.

- **title, deadline** (ISO-8601 or null), **priority** (low/medium/high/urgent)
- **source** (`gmail` | `gcalendar` | `manual` | `voice` | `rule` | reserved
  outlook/teams)
- **sourceId** — unique per source; partial unique index prevents the same
  Gmail message from inserting the same title twice, and makes materialising a
  recurrence rule (`ruleId:YYYY-MM-DD`) idempotent
- **people, rawContext, confidence, status** (pending/done/archived/snoozed)
- **snoozedUntil** — set only while snoozed; a 30-second sweep, plus a check at
  launch, returns the task to pending

Urgency on screen is **derived**, not stored: overdue / inside 24h / inside 72h /
none, then sort by imminent, then deadline, then priority
(`shared/urgency.ts`).

Cross-source duplicates (mail + calendar describing the same work) are rejected
in JS with Dice similarity ≥ 0.72 and deadlines within 24 h (`dedup.ts`).

### 3.4 Sync pipeline (Gmail + Calendar)

Triggered on a timer (default 15 minutes, delayed 60 s after launch so login is
not competing with a 2 GB model load), from Settings → Sync now, or after
connect. Manual sync **reopens Gmail ids from the last 48 hours** so a zero-task
extraction is not sticky forever.

**Gmail**

1. List `newer_than:2d -in:chats` (Promotions are included; excluding that tab
   hid real first-time senders).
2. Skip already-processed ids (unless force).
3. Fetch full message, strip quoted replies, drop bulk by headers
   (`List-Unsubscribe`, `Precedence`, no-reply senders, too short/long).
4. Embed the message, retrieve up to 5 prior examples from sqlite-vec, build
   few-shot block (empty store → zero-shot).
5. `extractTasks` against Qwen with JSON schema / grammar, `temperature: 0`.
6. User identity in the prompt is the **OS username** (e.g. Suraj), not the
   Gmail local-part. Using `firstnamelastname08` made the model miss
   “Hi Suraj…”.
7. Mark processed, store example embedding, dedup, insert.

Budget: 15 model calls per pass so one busy morning cannot peg the GPU.

**Calendar**

Events in the next 7 days are turned into tasks **without** an LLM call:
meetings with other people become “Prepare for {title}” one hour before start;
solo blocks use the title as-is. Incremental `syncToken`; HTTP 410 → full
resync. Manual sync clears the token so new events are not missed.

### 3.5 Other inputs

**QuickAdd / voice.** Typed text is inserted immediately, then `enrichTask`
upgrades title/deadline/priority in place. Spoken audio is mono PCM resampled
to 16 kHz in the renderer, transcribed in main. Phrases that mean “look at my
screen” (`shared/voiceIntent.ts`) call the same function as `Ctrl+Shift+S`.

**Screen.** `desktopCapturer` at native resolution → Tesseract → denoise
punctuation-heavy lines → Qwen one-task JSON. Deadlines like `"Thursday"` are
normalised in `shared/deadline.ts` (weekday → next occurrence at 17:00), because
the schema cannot force a real datetime.

### 3.6 Auth

Google **Desktop OAuth client**, PKCE, system browser, ephemeral
`127.0.0.1` loopback. Favicon and other non-callback GETs are ignored; an
earlier bug treated `/favicon.ico` as a CSRF failure and closed the listener,
which produced `ERR_CONNECTION_REFUSED` on the real redirect.

Scopes: `gmail.readonly`, `calendar.readonly`, `openid`, `email`. Sensitive but
not restricted; unverified app + test user is enough for personal use (100-user
cap).

---

## 4. What has been built, how, why, alternatives, drawbacks

### 4.1 Overlay layering

**Done.** Transparent always-on-top list, click-through, hover capture,
urgency colours, complete checkbox, hover to expand full title + from/people +
added + deadline + raw context snippet.

**Why this z-order.** “Above wallpaper, below apps” needs the WorkerW /
Progman hack on Windows. That window cannot receive normal input. An
interactive list that disappears under every maximised browser is also not
ambient. Always-on-top + click-through is the only pair that stays visible
*and* clickable.

**Tried and reverted.** Collapsed corner orb (user asked, then wanted the
original list back). Solid navy/teal restyle (rejected). Light-blue text
(rejected). Current look is the original glass cards and white type.

**Drawbacks.** The list floats over apps. It is a HUD, not wallpaper. Full
height on the right edge still occupies a strip of the desktop.

### 4.2 Storage: SQLite, not a server

**Done.** `better-sqlite3`, WAL, migrations, seed tasks in unpackaged runs.

**Why.** One file, no daemon, survives restarts, unique index for source
dedup. Electron’s userData path is the right home.

**Drawback.** Native module must be rebuilt for Electron’s Node ABI
(`postinstall`: `electron-builder install-app-deps`). Paths with spaces broke
node-gyp once; the project was copied to `ambientmind` for that reason.

### 4.3 Secrets: `safeStorage`, not keytar

**Done.** Tokens encrypted at rest.

**Why.** keytar is archived and is another native module. `safeStorage` ships
with Electron and uses DPAPI on Windows.

**Drawback.** Ciphertext is bound to the OS user. Copying `secrets.json` to
another machine or profile is unreadable; the app must reconnect Google.

### 4.4 RAG: sqlite-vec, not ChromaDB

**Done.** Vector table in the same DB. Live Gmail path retrieves neighbours and
stores observed extractions.

**Why.** ChromaDB is a sidecar process. sqlite-vec loads as an extension.
Embeddings are 768-d to match nomic-embed-text. Vector `rowid` must be bound
as `BigInt` or better-sqlite3 hands a double and vec0 rejects it.

**Alternatives.** A separate vector DB, or no RAG. Eval showed RAG-on-Enron
few-shots can *hurt* if the examples are not this user’s mail — so production
does **not** seed Enron into the live store. Empty store = zero-shot, which is
correct until *your* mail has been extracted.

**Drawback.** First weeks have no few-shots. Bad extractions, if stored, can
poison later prompts (no thumbs-down UI yet).

### 4.5 Model and prompts

**Done.** Grammar-constrained JSON via Ollama `format`. Extraction and
enrichment prompts as TypeScript modules (bundler + `tsx` eval share one
source). Eval harness with precision/recall/F1, empty-specificity, deadline
accuracy.

**Why 3B.** Fits VRAM. Iterated on a 14-message seed corpus: missing user
identity collapsed recall; naming weekdays *inside email Date headers* dropped
recall from 71% to 29% (boilerplate crowding the message). Those runs are kept
under `eval/results/`. Baseline after identity fix: **~83% F1, 100% precision,
60% deadline accuracy** on that tiny set. Deadline % is 5 matched pairs —
mostly noise until the corpus is larger.

**Alternatives.** Cloud API (better quality, kills local/privacy). 8B on a
bigger GPU. Fine-tuning (no labelled volume yet).

**Drawbacks.** Weak on messy relative dates unless code post-processes.
Invented deadlines still happen on screen capture. Eval is not yet your inbox.

### 4.6 Google integration

**Done.** PKCE loopback, Gmail + Calendar adapters, scheduler, force re-scan,
Windows notification with sync counts.

**Why PKCE.** Desktop clients are public; the “client secret” is not a secret.
PKCE is the actual protection.

**Drawbacks.** User must create a Cloud project and drop JSON in app data.
Unverified consent interstitial. `gmail.readonly` is sensitive. Gmail API
delay and Promotions/Spam still miss mail. Calendar incremental tokens can go
stale (410 handled). First extraction pass used the wrong display name (fixed).

### 4.7 Screen capture

**Done.** `Ctrl+Shift+S` and spoken screen-intent. OCR + Qwen. Docs:
`docs/screen-capture.md`.

**Why OCR not a VLM.** A capable VLM (~3.2 GB VRAM) would evict the extraction
model on a 4 GB card every capture.

**Drawbacks.** Whole-desktop OCR: a second text-heavy window can win.
Misreads. Occasional invented deadlines. Maximise the window you care about.

### 4.8 Voice

**Done.** Transformers.js Whisper (size selectable, base.en by default), warmed
after launch; switching size reloads in the background rather than mid-sentence. Shortcut opens
QuickAdd and starts the mic; after speech, **3 seconds of silence** ends
recording, transcribes, submits. Screen-intent routing. Docs: `docs/voice.md`.

**Why not whisper.cpp.** Native addon × Electron ABI, same class of pain as
sqlite. Why not Porcupine wake word: custom wake words are paid / limited; push
to talk is free.

**Drawbacks.** tiny.en mishears (“buy” → “by”). First load is slow. Room noise
can delay the silence stop. No “hey AmbientMind” while the overlay sits idle.

### 4.9 Settings and config

**Done.** Persist `config.json`, live-apply corner and interval (interval/model
changes restart the scheduler; corner does not). Google connect from settings
or overlay.

Settings now also holds the about-me profile (§4.10), recurring rules, the
health panel and the corpus export.

### 4.10 Trust, recurrence, profile and chat

Four things were added together because they answer the same complaint: the
app did things you could neither see nor steer.

**Health.** An empty list had several very different causes — Ollama down, a
model never pulled, Google not connected, or genuinely nothing to do. The
overlay now names the one that applies. Alternative considered: a first-run
wizard. Rejected because the failure is not limited to first run; Ollama gets
stopped on an 8 GB machine all the time, so the check re-runs on a timer.

**Recurrence.** Parsed in code, not by the model. A one-off task extracted
wrongly is a nuisance; a recurrence extracted wrongly repeats until you find
it. Regexes are also faster and identical run to run. The cost is coverage:
phrasings outside the grammar fall through to a normal task, which is the safe
direction to fail.

**Suggestions.** Detection is a threshold, not a learner — with a handful of
rows, predictability beats sophistication, and every suggestion is a question.
Dismissals persist, because an assistant that asks the same question weekly is
worse than one that never asks.

**Chat.** One grammar-constrained action per turn instead of Ollama's
tool-calling API; see §7 Phase C2 for why, and for the 6/10 → 10/10 measurement
that shaped the prompt. Worth noting the shape of the original failure: the
model produced a *correct English answer* attached to the *wrong action*. Only
checking the reply would have missed it.

**Corpus export.** Settings can dump your recent mail to JSONL pre-filled with
the model's current extractions, so labelling is correcting a draft. Messages
the cheap pre-filter rejects are left out: scoring them would measure the
filter, not the extractor.

---

## 5. Repository map

```
electron/          main, overlay, tray, quickAdd, settings, chat, preload
electron/services  taskStore, ruleStore, suggestionStore, sync, ollama, chat,
                   health, googleAuth, gmail, gcalendar, vectorStore, speech,
                   screenContext, corpusExport, config, secrets, dedup
src/overlay        orb + list, health banner, suggestion card
src/quickadd       voice + type palette
src/settings       preferences, status, recurring rules, about-me
src/chat           ask-about-your-tasks panel
shared/            types, IPC names, urgency, similarity, deadline,
                   voiceIntent, recurrence, recurrenceDetect, snooze, clash
prompts/           extraction, enrichment, screen-task, chat (TS modules)
db/migrations      SQL (006 migrations; 005 rebuilds tasks)
eval/              harness, seed corpus, unit tests, chat action eval
scripts/           icon generation, migration rehearsal, smoke tests
docs/              this file + google / voice / screen how-tos
```

**Runtime:** Electron 37, React 19, Tailwind 4, TypeScript, electron-vite,
Ollama, better-sqlite3, sqlite-vec, @xenova/transformers, tesseract.js.

IPC contract is `shared/ipc.ts` so main and renderers cannot drift.

---

## 6. Known limitations (current build)

- Overlay is on top of apps, not in the wallpaper layer.
- 3B ceiling on nuance and dates.
- RAG starts empty; no user feedback loop on examples.
- **Recall on your own mail is unmeasured, because there is nothing to measure
  it on.** The export has now been run against 30 days of real mail: 50
  messages, 37 rejected by the header pre-filter (30 `List-Unsubscribe`, 7 bulk
  senders, all correct on inspection), 13 reaching the model, and **zero tasks
  extracted**. Reading all 13 confirms zero is the right answer for essentially
  every one: recommendation and marketing mail, automated acknowledgements, an invoice, and a mass mail that only looks personal
  because a human sent it. The one arguable miss is a service nudge
  asking the user to pick "re-surface" or "wait".
  - What this *does* establish is precision: 13 noisy messages, nothing
    invented. Hallucinated tasks are the failure that would make the overlay
    unusable, and it is not happening.
  - What it does not establish is recall, and no amount of labelling will fix
    that while the inbox holds no "send me the numbers by Friday" mail. **The
    premise that mail carries this user's todos does not currently hold**, which
    is why Phase D work went to voice, screen and recurrence instead.
  - Gmail's fetch is capped at 50 messages per call, so the 30-day window came
    back truncated. A larger sample needs pagination.
- Precision/recall figures elsewhere in this document are still Enron's.
- **No installer.** Run via `npm start` / `electron .` from this repo. The app
  icon exists (`build/icon.png`) but `electron-builder` is not configured.
- No mobile client.
- No Outlook/Teams (Graph / admin consent).
- No OS notification ingestion.
- No calendar write-back, so recurring rules are invisible on the phone.
- Recurrence detection groups by exact normalised title. "Tuition" and "tuition
  class" are counted as different habits.
- The chat panel keeps no memory between windows: closing it forgets the
  conversation, and it has no record of past decisions (C4).
- Native modules and a space in the old folder path were operational hazards.

---

## 7. What is left — phased plan

Constraints for every phase: this PC, local 3B, Google already connected,
privacy story stays “LLM never leaves localhost.”

### Phase A — Make today’s app trustworthy — **done except the installer**

**Definition.** You can install it, connect Google, and believe the list.

- **A1. Done (health check).** `electron/services/health.ts` reports whether
  Ollama answers and whether the configured extraction and embedding models are
  pulled, matching Ollama's implicit `:latest`. The overlay shows the actual
  reason the list is empty instead of a blank panel; Settings lists every check.
  **The installer half is still open** — see §7 Phase F.
- **A2. Done.** `scripts/make-icons.cjs` renders the mark to anti-aliased PNGs
  with no image dependency and emits base64, so the tray icon loads identically
  from source, from `out/`, and inside an asar. Tooltip carries the pending
  count; left-click expands the overlay.
- **A3. Done.** `GetSyncSummary` surfaces last run, counts and errors, so the
  result outlives the toast. Fixed a real bug on the way: scheduled syncs were
  writing tasks the overlay was never told about.
- **A4. Done.** Edit inline, snooze (1h / 3h / this evening / tomorrow 9am /
  next week), delete. Migration 004 adds `tasks.snoozed_until`, because status
  alone could hide a task with nothing to bring it back.
- **A5. Done.** "+N more · show all" opens the full scrollable list.
- **A6. Done.** Working tree committed.
- **A7. Tooling done, labelling outstanding.** Settings → Model → *Export mail
  for labelling* writes your recent mail to JSONL pre-filled with what the
  model extracts today, so labelling is correcting a draft rather than
  authoring one. **You still have to correct it** and run
  `npm run eval -- --corpus <file>`. Until then the metrics are Enron's.

### Phase B — Recurring life

**Definition.** Repeating commitments are **rules**, not daily voice nags.

- **B1. Done.** Migration 005 adds `recurrence_rules` and rebuilds `tasks` so
  `source` admits `'rule'` (SQLite cannot alter a CHECK constraint;
  `npm run check:migration` rehearses the rebuild against a copy of the live
  database first). `shared/recurrence.ts` parses "remind me for tuition Tue,
  Thu, Sat at 5pm" **deterministically** — a regex, not the model, because a
  wrong recurrence repeats forever and a 3B model is neither faster nor more
  predictable here. A single weekday is only treated as recurring when the text
  says so ("every", "daily", "weekdays"); "meeting Tuesday at 5pm" is one
  meeting. Occurrences are materialised two weeks out, keyed `rule:date` so
  re-running is idempotent, and pending occurrences that no longer match a rule
  are dropped on edit, pause or delete.
- **B2. Still open.** Optional Calendar write-back, so a repeating Google event
  shows on the phone without a custom mobile app. This is the cheapest route to
  Phase E.
- **B3. Done.** `shared/recurrenceDetect.ts` requires the same normalised title
  on the same weekday across **three distinct weeks**, with the time of day
  varying by at most 90 minutes. Three hits in one busy week is not a routine;
  the same weekday at 9am, 2pm and 8pm is a coincidence. Migration 006 persists
  each suggestion with a status, because "not weekly" has to stick — re-asking
  hourly is worse than never asking. Nothing is ever created without a yes.
- **B4. Still open.** Accept/reject/never counts as weights. Deliberately not
  neural RL: not enough data, wrong tool on 8 GB.

**Acceptance.** Tuition appears for the next month without a daily reminder.
A false “weekly dentist” cannot appear without confirmation.

### Phase C — Brain: profile + chat + priority

**Definition.** A **written** model of you, plus a chat that may only use
tools over your store.

- **C1. Done.** Two settings: what your mail calls you (an explicit display
  name now beats the OS-account guess) and free text about your life. The
  profile goes into the **system** prompt beside the identity, never into the
  message block — extra context there was measured to crowd out the body and
  cost recall. It is labelled as background that must not become a task, and
  `eval/aboutMe.test.ts` pins the empty case to *zero* added prompt text.
- **C2. Done.** Ctrl+Shift+C, the tray, or the overlay header. It reads the
  real store and can complete, snooze, delete, add, or create a rule.
  Ollama's tool-calling API was rejected for a 3B model: free-form tool
  arguments are exactly where small models emit nearly-right JSON, and a
  malformed call that silently does nothing is worse than no assistant.
  Instead one action per turn from a fixed enum under a flat grammar.
  `eval/chatActions.ts` runs it against the real model — the first version
  scored 6/10 because questions like "what's most urgent?" came back as
  `add_task` with a correct reply attached, which would have quietly created
  junk. Worked examples in the prompt took it to 10/10. Rails that do not
  depend on the model: at most four actions per message, loose task names
  resolved against real rows by similarity and refused below a threshold, and
  snoozes without a future time rejected.
- **C3. Done.** `shared/clash.ts` names the collision and says which to do
  first, entirely in code — advice that changes wording or flips its verdict
  between identical runs is not advice. The ladder: a clearly earlier deadline
  wins; inside 15 minutes priority decides; on a genuine tie a standing
  commitment beats an ad-hoc task because other people are arranged around it;
  otherwise whatever was committed to first. Tests pin order-independence.
- **C4. Still open.** sqlite-vec snippets remembering decisions ("skipped gym
  when it clashed with tuition"), not a fine-tune.

**Acceptance.** “What should I do Thursday 5pm?” answers tuition if a rule
exists. Chat cannot invent a job you never had.

### Phase D — More desktop capture (optional / later)

| Item | Plan |
| --- | --- |
| Voice: larger Whisper if VRAM allows | Polish |
| Screen: capture foreground window only | Polish |
| **OS notification scraping** | **Defer.** No clean Windows API; looks like spyware. Mail/calendar/voice already cover appointments. |
| Wake word | **Defer.** Shortcut is v1. |
| Outlook / Teams | **Defer.** Graph permissions. After Google is boringly reliable. |
| Multi-monitor / DPI | **Done.** Capture follows the cursor's display, not the primary one. |
| Foreground-window capture | **Blocked.** Electron cannot identify the foreground window; `desktopCapturer` returns window sources in no documented order. Needs a native Win32 call. |
| macOS | After Windows installer |

### Phase E — Companion mobile app

**Definition.** Phone views and light-edits the **same** tasks. Desktop stays
the LLM engine.

**E0 must be decided first:**

1. **Calendar as the bus** — fastest; phone = Google Calendar.
2. **Private encrypted relay** — real product, real ops.
3. **LAN only** — demo; dies off home Wi‑Fi.

Then: read-only list → complete/snooze/toggle rule → chat only if C2 exists
and the phone hits the same backend (not a second Ollama on the phone).

**Acceptance.** Completing on the phone clears the desktop overlay. Two lists
never diverge silently.

### Phase F — Hardening

Auto-update or a documented update path; crash UX; encrypted export of the DB
without tokens; privacy copy (what is local vs Google); “pause AI for an
hour”; test start-at-login after reboot.

---

## 8. Suggested build order

```
A  trust            done, except the installer
B1 recurrences      done
B3 suggest-repeats  done
C1 about-me         done
C2 chat             done
C3 clash helper     done
  → A7 label your own mail, then re-run eval   ← next, and it gates everything
  → installer (electron-builder)
  → B2 calendar write-back
  → E0 pick a sync mechanism
  → E1 mobile read-only
  → B4 feedback weights / C4 decision memory
  → D5 Outlook only if still needed
  → D3 notifications almost certainly never
```

A7 comes first now because every accuracy claim here is still measured on
someone else's inbox, and B2 is the cheapest path into Phase E.

Do not start mobile or a “reinforcement learning brain” before A7.

---

## 9. Explicitly out of scope unless you override

- Fine-tuning Qwen on your life (no labelled volume, no VRAM headroom)
- On-device neural RL for prioritisation
- Always-on wake word in the next slice
- Scraping every Windows toast
- A cloud LLM “for quality” (contradicts the original privacy brief)

---

## 10. How to run what exists today

```powershell
cd C:\Users\Suraj\Downloads\ambientmind
npm install
npm start
```

Ollama must be running with `qwen2.5:3b` (and `nomic-embed-text` for RAG).
Google: `docs/google-setup.md`, then Settings → Connect / Sync now.

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+A` | QuickAdd; mic starts; 3 s silence submits |
| `Ctrl+Shift+S` | Capture screen as a task |
| `Ctrl+Shift+C` | Ask about your tasks (chat) |
| `Ctrl+Shift+,` | Settings |

---

## 11. Related docs

- `docs/google-setup.md` — OAuth client and scopes
- `docs/voice.md` — STT path and why Transformers.js
- `docs/screen-capture.md` — OCR vs VLM and deadline normalisation
- `eval/results/` — measured prompt experiments (including the weekday-header
  regression)
