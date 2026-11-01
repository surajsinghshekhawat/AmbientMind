# AmbientMind rebuild plan: Mac-first, redesigned, finished

Written 31 October 2026 against commit `05952b6`. It is based on four
investigations done the same day: a line-by-line audit of the UI and main
process, an actual install, test, build and launch on an Apple M5 Pro running
macOS 26.7.1, a read of the Atticus source (`github.com/SaarthurR/atticus-mac`,
v1.5.5), and web research on Electron for macOS, design references, local AI on
Apple Silicon and Cursor tooling.

`docs/SYSTEM.md` explains how the current system works. `docs/BACKLOG.md` lists
backend problems; it says "nothing is broken", and that is only true of the
backend. This file is the plan for everything else.

---

## 1. Decisions already made

| Question | Decision |
| --- | --- |
| Platforms | Mac first. Windows keeps working from the same codebase. |
| Framework | Stay on Electron, upgrade it, add a small Swift helper for Apple-only features. Keep the React UI code and the backend. |
| Task sources | Apple Calendar and Reminders through EventKit, plus Gmail. Google Calendar stays as an option. |
| Audience | You first. Polished enough for a public release later; signing and notarization are deferred until then. |
| Look | Atticus's visual language: the thinking orb, a dark glass card, quiet type, spring motion. |
| AI | Apple's on-device model when available, Ollama with a better model as the fallback. |
| Isolation | This is a work machine. Nothing for the project lives outside the repo folder: toolchain, caches, app data, models, Cursor add-ons and scratch files all go in `.local/` or the repo's `.cursor/`. Every command runs through `./dev`. See §0. |

---

## 0. Working inside the repo only

Set up and verified on 31 October 2026. Rules for agents are in
`.cursor/rules/isolation.mdc`.

- **`./dev`** wraps every command. It points `HOME`, `TMPDIR`, the XDG
  folders, npm's cache, Electron and electron-builder download caches and the
  clang module cache into `.local/`, and puts the pinned Node from
  `.node-version` (in `.local/node`) first on `PATH`. `./dev setup` installs
  Node and runs `npm ci`; then `./dev npm run dev`, `./dev npm test`,
  `./dev run <cmd>`, `./dev shell`.
- **App data.** `electron/isolation.ts` is the first import in `main.ts`. Any
  unpackaged run keeps userData, the Chromium profile, logs and crash dumps in
  `.local/data`, and uses Chromium's mock keychain so nothing is written to the
  login keychain. Electron scripts do the same through `scripts/isolation.cjs`.
  Login items are never registered by isolated runs.
- **Packaged builds** run only through `./dev packaged`, which applies the same
  isolation. Opening the `.app` from Finder writes to `~/Library`. It launches
  through LaunchServices (`open --env …`) so macOS asks for permissions on
  AmbientMind's behalf, not the terminal's; output goes to
  `.local/logs/packaged.log`.
- **Ollama.** `./dev ollama start` runs a separate server on port 11435 with
  models and keys in `.local/`; the app reads `OLLAMA_URL` from the wrapper.
  The global `~/.ollama` is never used. The `ollama` CLI starts the global app
  when it can't reach a server, so only call it through `./dev ollama`.
- **What macOS writes anyway.** Every app that runs gets a preferences file and
  saved window state in `~/Library`, regardless of `HOME`; `./dev` deletes them
  when the command exits. Privacy grants (microphone, screen recording) are
  stored by macOS and kept so they needn't be re-granted;
  `./dev clean-system --yes` removes every trace, including those.
- **Checks.** `./dev doctor` fails if anything from the project exists outside
  the repo. `postinstall` and `dist` refuse to run outside `./dev` on macOS.
- **npm 11** blocks dependency install scripts unless listed in
  `allowScripts` in `package.json`. New native dependencies need
  `./dev npm install-scripts approve <pkg>`.
- **Git** identity is repo-local, and the credential helper is cleared for
  this repo so a push won't store credentials in the Keychain. How to push is
  decided later.

---

## 2. Where we actually are

### 2.1 What works on this Mac today

Measured, not assumed:

- `npm ci` installs cleanly and every native module is arm64: better-sqlite3,
  sqlite-vec, onnxruntime, sharp.
- `npm test` passes 110 of 110. `smoke:sqlite` and `smoke:vec` pass.
- `npm run dev` opens all four windows. Whisper loads in about 6 seconds,
  tesseract OCR runs in under 700 ms, and Ollama runs on Metal.
- Data landed in `~/Library/Application Support/ambientmind`. It now lands in
  `.local/data` (§0), and that test run's leftovers were removed.

### 2.2 What is broken on the Mac

- **Quit never quits.** The overlay is `closable: false`
  (`electron/overlay.ts:71`), and macOS cancels `app.quit()` when a window
  refuses to close. The database close in `will-quit` never runs. Confirmed at
  runtime, and confirmed that `setClosable(true)` fixes it.
- **A Dock icon appears** despite `app.dock.hide()`, because
  `setVisibleOnAllWorkspaces` without `skipTransformProcessType` promotes the
  app, and there is no `LSUIElement`.
- **Screen capture fails silently** without Screen Recording permission
  ("Failed to get sources") and gives no guidance.
- **The shortcuts take over Mac keys.** `CommandOrControl+Shift+S` becomes ⌘⇧S,
  which is Save As in nearly every app. ⌘⇧A and ⌘⇧C collide with Finder and
  Chrome.
- **`npm run build` fails** on an unused import (`src/chat/App.tsx:1`).
- **No Mac packaging.** No `mac:` target, a 256 px icon (512 minimum), generic
  Electron permission text, and a 530 MB bundle that carries Linux and Windows
  binaries.
- Electron 37 reached end of life on 15 January 2026.

### 2.3 What is broken everywhere

These are user-facing bugs found by reading the code, several confirmed by
running the functions. File references are in the audit; the short version:

1. **Quick Add cannot be typed into.** Opening it always starts the mic and
   disables the input for up to 25 seconds; Escape does nothing while recording;
   Enter is dead after a "heard nothing" error.
2. **Deleted tasks come back.** Every Sync now, Connect and wake from sleep
   clears the processed-message window, and deletes are hard deletes, so the
   same mail and calendar events are re-imported. Each re-import also adds a
   duplicate RAG example.
3. **Deleted recurring occurrences come back within 30 seconds**, and 14 days of
   occurrences plus 7 days of calendar "Prepare for…" tasks flood the list and
   the orb count.
4. **"Call Sam tomorrow morning" becomes a daily 09:00 rule.** "This evening"
   and "at night" do the same.
5. **"Finish this task by Friday" triggers screen OCR** instead of adding a
   task. So does anything containing "screen", "this task" or "that todo".
6. **Sync failures leave "syncing" on forever** and record no error. A revoked
   Google token still reports "connected".
7. **Settings text fields drop spaces and newlines as you type**, because every
   keystroke is trimmed and written back. The model field cannot be cleared.
8. **The overlay is mouse-only.** It is `focusable: false`, so inline edit
   cannot receive keys, and every action is hover-only.
9. **The expanded overlay can swallow desktop clicks** in a full-height strip
   after it is opened from the tray.
10. **Unreadable on light wallpapers.** No surface behind text, CSS blur that
    blurs nothing, no light mode, native controls rendered in light theme.
11. **No undo, no confirmation, and no view of done or snoozed tasks.**
12. **No onboarding.** Google needs a hand-placed OAuth JSON file; the health
    banner is permanent without it.
13. **Connect Google blocks the UI for the whole first sync**, or 10 minutes if
    the browser tab is closed.
14. **Shipped but unreachable:** Pause AI and encrypted backup have no UI.
    Opacity and work-hours settings do nothing. Deadline, priority and rules
    cannot be edited.
15. Quick-add enrichment ignores the configured model and overwrites edits made
    in the meantime. Background sync keeps a stale profile until restart. Rules
    created from Quick Add or chat never reach the calendar. Settings never
    receives live updates because pushes go only to the overlay. Any exception
    in a timer or `ipcMain.on` handler kills the app. Dev seeding can write fake
    tasks into the real database.

### 2.4 The design

There is no design system: four colour tokens, eleven font sizes, fifteen white
opacity steps, emoji glyphs as icons with 15 px hit targets, no focus rings, no
animation between states, a Windows font stack, and a Settings page that is one
long scroll with sections in the wrong places.

The conclusion that shapes the plan: **the backend is worth keeping and the
renderers are not.** Several of the bugs above live in UI code that will be
replaced anyway, so they are fixed by the redesign rather than patched first.
Bugs in logic that survives the redesign are fixed first.

---

## 3. What we take from Atticus, and what we don't

Atticus is a spoken remote control for the whole Mac, backed by Claude Code.
AmbientMind is an ambient todo list. We take its Mac plumbing and its visual
discipline, not its agent.

### 3.1 Adopt

| From Atticus | Becomes in AmbientMind |
| --- | --- |
| Thinking orb (`thinking-orbs`, MIT, on npm with a React component) | The orb itself. Its state tells you what AmbientMind is doing. |
| Dark glass card: hairline borders, 13 px system type, spring motion, shimmer on live status, blinking caret on partial text | The visual language for every surface (§5). |
| Non-activating panel on the display under the mouse, clamped to the visible frame, fades in and out, Esc to dismiss | Overlay and Quick Capture window behaviour. |
| Permission onboarding with live status per permission and deep links into System Settings | First-run flow and a Permissions section in Settings. |
| Focused-window text through Accessibility, then single-window ScreenCaptureKit plus Vision OCR | Replaces whole-screen tesseract. Fixes BACKLOG P2-4. |
| Apple SpeechAnalyzer streaming with live partials and contextual hints | Replaces CPU Whisper on the Mac. Live transcript while you speak. |
| Hold-to-talk with press and release events, short-tap cancel, 1.3 s pause end in toggle mode | Voice capture. |
| EventKit calendar with exact-match checks before move or delete | Apple Calendar as a source, no OAuth setup. |
| Confirm cards for destructive or external actions; "couldn't confirm" wording | Chat actions, bulk operations, calendar and Reminders writes. |
| Fast path: no model call when the input is already complete | Quick Add skips enrichment when nothing is missing. |
| Latency budget enforced by a test, prompt-size cap | Same, for local model calls. |
| Mock-bridge UI tests and a fake native layer for evals | Component tests and helper fakes (§8). |
| Stable local signing identity so permission grants survive rebuilds | Dev builds, until a Developer ID certificate exists. Kept in a keychain file inside `.local/`, never the login keychain. |
| Hide from screen sharing | A Privacy toggle (`setContentProtection`). |
| Quiet during calls and full-screen apps | Notifications and nudges hold until you are free. |

Attribution: the `thinking-orbs` package carries its own MIT licence. If any
Atticus or Plip code is copied rather than reimplemented, keep its copyright
header and ship a `THIRD_PARTY_NOTICES` file. Never reuse the Atticus name or
icon.

### 3.2 Do not adopt

- **Hands** (clicking and typing in other apps), **agents**, **Claude Code
  routing**. A todo overlay must not act on other apps, and AmbientMind stays
  local-first.
- **Wake word**, **meeting copilot**, **screen drawing**. Separate products.
- **Ringing toggles in System Settings through Accessibility.** Breaks every
  macOS release.
- **Git-pull updater, curl install, Nix, LaunchAgent with KeepAlive, launchd
  routines, `osascript` notifications, required Homebrew whisper-server,
  default-on remote telemetry.** Each has a better supported equivalent below.

### 3.3 New work Atticus does not help with

**Apple Reminders two-way sync.** Atticus never touches reminders. This is the
biggest Mac-only win: a task completed on iPhone or Apple Watch flows back
through iCloud, which answers BACKLOG P2-3 (no sync bus, no mobile) for Apple
users without running a server.

---

## 4. Target architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ Renderers: React 19, Tailwind 4, shared design system              │
│ Orb · Panel · Quick Capture · Chat · Settings · Onboarding         │
│ Typed IPC client + TanStack Query; one store per window            │
└──────────────┬─────────────────────────────────────────────────────┘
               │ contextBridge (sandboxed renderers)
┌──────────────▼─────────────────────────────────────────────────────┐
│ Electron main (current supported release)                          │
│ windows · menu-bar tray · shortcuts · broadcast bus · scheduler    │
│ task store · rules · decisions · sync (Gmail, Google Cal, EventKit)│
│ model router: Apple on-device ⇄ Ollama · embeddings · RAG          │
│ platform layer: mac/ and win/ implementations behind one interface │
└───────┬───────────────┬──────────────────┬─────────────────────────┘
        │ JSON lines    │ HTTP localhost    │ HTTPS
┌───────▼────────┐ ┌────▼─────┐   ┌────────▼────────┐
│ ambientmind-   │ │ Ollama   │   │ Gmail, Google   │
│ helper (Swift) │ │ :11434   │   │ Calendar        │
│ permissions    │ └──────────┘   └─────────────────┘
│ focused window │
│ Vision OCR     │
│ SpeechAnalyzer │
│ EventKit       │
│ Foundation     │
│ Models         │
└────────────────┘
```

### 4.1 Why a Swift helper and not a native Node addon

SpeechAnalyzer, ScreenCaptureKit, Vision, modern EventKit and Foundation Models
are Swift APIs. A separate process avoids rebuilding against Electron's ABI
(already painful with better-sqlite3), and a crash in it cannot take down the
app. macOS attributes permissions to the app that launched the helper, so the
prompts say "AmbientMind". That attribution must be proven in the first spike
(§9).

Shape:

- SwiftPM package at `native/mac-helper/`, arm64, built by an npm script.
- Shipped in `Contents/MacOS/` with electron-builder `extraFiles`, signed with
  the same identity and hardened runtime.
- One long-lived process, newline-delimited JSON over stdio, request ids,
  pushed events. Exits when its parent dies. `--selftest` for CI and support.
- `electron/native/helper.ts`: typed client, restart with backoff, version
  handshake. Every caller has a fallback: on Windows or without the helper, the
  current tesseract and Transformers.js paths stay in use.

Methods, in the order they are built:

```text
hello                    -> version, macOS version, feature list
perms.status / request   -> mic, speech, accessibility, screen, calendar, reminders, contacts
context.focused          -> app, bundleId, windowId, title, url, selectedText, text, source ax|ocr
capture.windowOCR        -> text for one window (ScreenCaptureKit + Vision)
speech.start/stop/cancel -> events speech.partial, speech.final, speech.level
hotkey.register          -> events hotkey down|up (hold-to-talk)
reminders.*              -> ensureList, list, upsert, complete, delete, events reminders.changed
calendar.*               -> list, add, update/delete with expected snapshot
contacts.me              -> name, emails (fixes "who is me" without guessing)
system.busy              -> onCall, fullscreenApp, idleSeconds
fm.available / fm.extract-> Apple on-device model, schema-constrained output
```

### 4.2 Platform layer in main

`electron/platform/{index,mac,win}.ts` owns everything that differs: window
options, levels, tray icon, shortcut defaults, data paths, permission checks,
login items. Feature code calls the interface and never checks
`process.platform` itself. This is what keeps Windows working while the Mac
becomes the lead platform.

### 4.3 IPC and state

- Keep `shared/ipc.ts` as the single list of channels.
- Add a typed `invoke` wrapper with zod validation on the main side, and a
  broadcast helper so `tasks:changed`, `config:changed`, `sync:status` and new
  events reach every open window, not only the overlay.
- Renderers read through TanStack Query with IPC events invalidating queries.
  This removes the hand-rolled refresh logic that causes most of the
  out-of-sync bugs.
- Add missing channels: expanded state, done and snoozed lists, unsnooze, undo,
  Pause AI, restore backup, edit rule, open task source, permission status,
  model download progress.

### 4.4 Data model changes

- **Soft delete with tombstones.** Deleting a task sets `status='deleted'` and
  keeps the row, so `(source, source_id)` keeps blocking re-imports. A
  retention sweep removes old tombstones.
- **Skipped occurrences.** Handled by the same tombstones: deleting one
  occurrence leaves a `deleted` row for that rule and time, so it is never
  materialised again. No separate `rule_skips` table (decided in Phase 1).
- **Suggestions.** `tasks.state` gains a `suggested` stage: AI-extracted tasks
  wait for acceptance unless auto-accept is on and confidence is high.
- **Provenance.** `source_url` (Gmail thread link, calendar event link) and
  `evidence` (the quoted sentence that produced the task).
- **External links.** `task_links(task_id, provider, external_id, etag,
  updated_at)` for Reminders and calendar sync.
- **Edit tracking.** `user_edited_at` so background enrichment never
  overwrites something you changed.
- **Example dedupe.** A unique index on `examples(source, source_id)`.

All of it ships as numbered migrations, rehearsed with `npm run
check:migration` against a copy of the real database.

---

## 5. Design direction

### 5.1 Principles

1. **Glanceable first.** The collapsed state answers "is anything due?" without
   a click.
2. **Calm until it matters.** Nothing moves or glows unless it changes what you
   should do next. From Linear: structure should be felt, not seen.
3. **AI proposes, you decide.** Extracted tasks arrive as suggestions with
   their source and the sentence that produced them.
4. **Never lie, never lose.** Every destructive action has undo; every failure
   says what failed and what to do.
5. **Keyboard complete.** Everything the mouse can do, the keyboard can do.
6. **Native manners.** System font, Mac shortcuts, light and dark, Reduce
   Motion, Reduce Transparency, content protection during screen shares.

### 5.2 Visual system

- **Material:** a dark glass card by default. Native vibrancy (`hud`) with
  `visualEffectState: 'active'` behind a translucent tint calibrated so text
  passes 4.5:1 contrast on any wallpaper. `electron-liquid-glass` behind a flag
  only; it is lightly maintained and may use private API.
- **Type:** `system-ui, -apple-system`. Scale 11 / 12 / 13 / 15 / 20.
  `tabular-nums` for times and counts.
- **Colour:** semantic OKLCH tokens (`bg`, `surface`, `text-1..3`, `hairline`,
  `accent`, `danger`, `warning`, `success`, four urgency tones). One accent.
  Light theme for Settings and Onboarding follows the system; the overlay can
  stay dark.
- **Surfaces:** 0.5 px inset hairlines instead of borders, 18 px outer radius,
  12 px inner radius, no drop shadows on flat UI.
- **Motion:** two curves, from Atticus: `--ease: cubic-bezier(.2,.8,.2,1)` and
  `--spring: cubic-bezier(.34,1.56,.64,1)`. Entrances 180–420 ms, exits faster.
  Every animation has a Reduce Motion path.
- **Icons:** Lucide in the UI, a template image (or SF Symbol) in the menu bar.
- **Components:** shadcn/ui on Base UI with Tailwind 4, Motion for animation,
  Sonner for in-app toasts. Primitives live in `src/ui/` and every window uses
  them.

### 5.3 The orb

The current orb is a static gradient disc. The new one is a `ThinkingOrb`
inside a small glass circle (48 px, configurable), with state mapped to what
AmbientMind is doing:

| AmbientMind state | `thinking-orbs` state |
| --- | --- |
| Idle, nothing due | `breathing`, slow and dim |
| Idle, something due soon | `breathing` plus a thin urgency arc |
| Overdue | a slow pulse on the arc, not the whole orb |
| Syncing mail or calendar | `connecting` |
| Extracting tasks with the model | `weaving` |
| Listening | `listening` |
| Reading the screen | `searching` |
| Chat composing an answer | `composing` |
| Needs attention (permission, model missing) | a small amber dot, not motion |

A count badge appears only for overdue and due today, never for the total.
Hovering shows a one-line peek of the next thing ("Reply to Priya · in 2h").
Click expands. Drag snaps to the nearest corner. The orb stops animating when
covered by a full-screen app or when the Mac is idle.

### 5.4 The panel (expanded overlay)

A glass card that grows from the orb with a spring, sized to its content up to
the visible frame, instead of a full-height transparent strip.

- **Header:** orb, a one-line status that shimmers while something is live
  ("Reading 3 new emails…"), and icon buttons for capture, chat and settings.
- **Sections:** Now (overdue and today), Suggested (AI tasks awaiting a
  decision), Upcoming (calendar, compact), Later. Empty sections disappear;
  when everything is empty the panel says why ("All clear. Next sync in 12
  min.").
- **Task row:** checkbox, title, one meta line (due, source chip, people).
  Expands in place for details: the evidence quote, an Open in Gmail or Open in
  Calendar link, deadline and priority pickers. No layout jump under the cursor.
- **Suggestions:** accept, edit then accept, dismiss, "Include all", "Never
  from this sender". Confidence as high, medium or low, never a percentage.
- **Keyboard:** ↑↓ or j/k to move, Space or x to complete, e to edit, s to
  snooze, Delete to delete, ⌘Z to undo, Esc to collapse.
- **Undo toast** for complete, delete, snooze and bulk actions.
- **Views:** Done today, Snoozed (with unsnooze), and a search field.
- The window becomes focusable while expanded so inline edits receive keys, and
  click-through applies only outside the card.

### 5.5 Quick Capture

The default shortcut changes to ⌃⌥Space (rebindable, with conflict detection).
The window takes Atticus's composer shape:

- The text field has focus on open. Typing works immediately.
- Hold the shortcut, or click the mic, to talk. The transcript appears live
  with a blinking caret. Releasing ends it; a short tap cancels.
- Live parse chips under the text: date, time, priority, people, and recurrence
  only when an explicit cue is present ("every", "each", "weekdays").
- Enter saves and the field morphs into a green check, then closes. ⌘Enter
  saves and stays open. Esc always cancels.
- "Add what's on my screen" is a button and an explicit phrase, never inferred
  from ordinary words.

### 5.6 Chat

The same card. Streaming answers, a Stop button, actions shown as a step list
with live, done and failed dots, confirm cards for deletes, bulk changes and
external writes, Markdown rendering, and a clear-history control.

### 5.7 Settings

A normal window with a 208 px sidebar (System Settings layout), not always on
top:

General · Sources (Gmail, Google Calendar, Apple Calendar, Reminders) · AI &
Models · Capture (voice, screen) · Shortcuts (recorder) · Recurring · Learned ·
Privacy & Data (what it knows, retention, Pause AI, backup and restore, content
protection, excluded apps) · Permissions · About.

Fields save on blur or after a debounce, with a toast. Nothing is trimmed while
you type.

### 5.8 Onboarding

Welcome → what stays on this Mac → choose sources → permissions asked only for
the sources chosen, each with live status and a deep link → model setup
(detects Apple Intelligence; otherwise detects Ollama and pulls the model with
progress) → shortcut keycaps → done. It can be reopened from Settings.

### 5.9 Menu bar

A template icon that adapts to light and dark menu bars. Left click toggles the
panel. Right click opens the menu: Capture, Ask, Pause AI for 1 hour, Sync now,
Settings, Quit.

---

## 6. Roadmap

Each phase lands on its own branch as small reviewable PRs. Each has an exit
check that must pass before the next phase starts. Estimates are focused working
days with agents doing most of the typing.

### Phase 0 — Set up (1 day) — done 1 November 2026, branch `phase-0-setup`

- Isolation (§0). Dev data is separate from real data (`.local/data`).
- The type error is fixed; `npm run build` passes.
- Cursor tooling from §7 in `.cursor/`, plus `design-system.mdc` and
  `electron-mac.mdc` rules.
- Sample tasks are opt-in: `./dev npm run dev:seed`.
- Vitest with happy-dom and an in-memory bridge (`src/dev/mockAmbient.ts`,
  fixtures in `src/dev/fixtures.ts`). `./dev npm run gallery` serves
  `http://localhost:5199/gallery/index.html`: every overlay component in every
  state, on dark and light wallpaper, without Electron.
- `./dev npm run test:smoke` builds, launches the app with Playwright, opens all
  four windows and fails on any page error.

Exit check passed: build, typecheck, `./dev npm test` (110 logic + 8 component
tests), the smoke test, `smoke:sqlite`, `smoke:vec`, and `./dev doctor`.

### Phase 1 — Fix the logic that survives the redesign (3–4 days) — done, branch `phase-1-logic`

1. Tombstone deletes; forced sync no longer resurrects anything; dedupe RAG
   examples.
2. Recurring occurrences: tombstones instead of a skip table, show only the
   next occurrence per rule, orb counts only overdue and today.
3. Calendar import: upsert on reschedule, remove on cancel, page through
   results, import only events that need preparation.
4. Recurrence parsing requires an explicit cue. Add the failing phrases as
   tests first.
5. Screen-capture intent requires an explicit phrase. Tests first.
6. Sync errors: always emit idle, record `last_error`, detect `invalid_grant`
   and show Google as disconnected. Separate status channel for screen capture.
7. Enrichment uses the configured model and never overwrites user edits.
8. Scheduler reads the current profile on every run.
9. Rules from Quick Add and chat are mirrored to the calendar.
10. Config trims on save, not per keystroke; guard NaN.
11. Wrap every `ipcMain.on` handler and timer; replace exit-on-any-error with a
    crash-loop guard.
12. Broadcast events to all windows.
13. Timeouts on every Ollama call; fix the speech-model switch race.
14. Login item: one source of truth, default off.
15. Security: renderer sandbox on, CSP in dev too, media permission only for
    the mic and only for our windows, navigation guards.

Exit: every fix has a test; the audit's top bugs 2–7 and 15 cannot be
reproduced.

What landed:

- Migrations 011 (task lifecycle: `deleted` and `suggested` states,
  `deleted_at`, `user_edited_at`, `source_url`, `evidence`) and 012 (one RAG
  example per source, unique index). Tombstones are purged after 90 days by
  the retention sweep. `check:migration` passes against a copy of the dev
  database.
- `./dev npm test` now runs three suites: `test:logic` (`node:test` over
  `eval/`), `test:db` (`db/tests/`, real SQLite under Electron's Node with a
  stubbed `electron` module and a temp data dir, fetch mocked for Google), and
  `test:ui` (Vitest).
- Calendar import keeps only timed meetings with other people in the next 48
  hours (`shared/calendarPrep.ts`) and reconciles: rescheduled events move,
  cancelled ones are removed, past ones archived. It no longer needs Ollama.
- Main-process failures go through `guard()` and a crash-loop limiter instead
  of exiting on the first error; renderer reloads are rate-limited.
- Security: every window is sandboxed. Builds carry the CSP as a `<meta>` tag
  (pages load from `file://`, which has no response headers); the dev server
  gets the same policy as a header plus what Vite needs. Only audio capture
  from our own pages is allowed. Navigation away, webviews and new windows are
  blocked, and web links open in the default browser. The smoke test checks
  all of this.
- The login item defaults to off and is written only from the config; the
  tray toggle saves the config like Settings does.

Left for Phase 2: the overlay refuses to close, which cancels a normal quit
(the smoke test kills the process).

Exit check passed: build, typecheck, `./dev npm test` (135 logic + 27 db + 11
component tests), the smoke test, `smoke:sqlite`, `smoke:vec`,
`check:migration`, and `./dev doctor`.

### Phase 2 — Mac foundation (3–4 days) — done, branch `phase-2-mac`

- Upgrade Electron to the current supported release and electron-builder to
  match; rebuild native modules; rerun all tests and smoke checks.
- Platform layer (§4.2). On the Mac: `type: 'panel'`, `showInactive`,
  `skipTransformProcessType`, hidden from Mission Control, a sane window level,
  no `setShape`, overlay on the display under the mouse.
- Quit works. No Dock icon (`LSUIElement`); a temporary Dock presence while
  Settings or Chat is open.
- App menu with Edit roles so ⌘C, ⌘V, ⌘X, ⌘A and ⌘Z work in every field.
- Mac shortcut defaults (⌃⌥Space capture, others on ⌃⌥), conflict detection,
  ⌘ glyph labels.
- Crash log in `app.getPath('logs')`.
- Menu-bar template icon.
- Mic and Screen Recording status through `systemPreferences`, with a clear
  message and a deep link when denied.
- Packaging: a `mac:` block (dmg and zip, arm64), a 1024 px icon, real usage
  strings, hardened runtime and entitlements, per-platform native binaries
  only, a Mac-aware preflight, and a stable local signing identity so
  permission grants survive rebuilds.

Exit: a dev-signed DMG installs, runs without a Dock icon, quits cleanly, keeps
its permissions across a rebuild, and is under 250 MB.

What landed:

- Electron 45.2.1 (Node 24.22) and electron-builder 26.18. Electron 45
  downloads its binary on first use, not at install.
- `electron/platform/` holds every macOS/Windows difference. On the Mac the
  overlay is a floating panel, hidden from Mission Control, on every Space
  without becoming a Dock app, with no `setShape`, and it opens on the display
  under the cursor. Settings and Chat are normal windows there and bring a
  Dock icon while open; Electron ignores a hide within a second of a show, so
  that hide is deferred.
- Quit: the overlay stays closable and refuses only outside a quit. The smoke
  test now quits for real and expects exit code 0.
- Shortcuts in `shared/shortcuts.ts`: ⌃⌥Space, ⌃⌥S, ⌃⌥C, ⌃⌥, on the Mac;
  Ctrl+Shift on Windows. Settings shows glyph labels and says when a shortcut
  conflicts or another app holds it. Rebinding is Phase 3.
- Settings → Permissions shows microphone and Screen Recording with a link to
  the right System Settings pane; a refused capture says how to fix it.
- Crash log in `app.getPath('logs')`. Tray: left-click toggles the panel,
  right-click opens the menu.
- Signing without a keychain: `scripts/mac-sign.cjs` uses
  [rcodesign](https://github.com/indygreg/apple-platform-rs) and a self-signed
  certificate in `.local/signing/` (created once by `npm run sign:setup`). The
  designated requirement is pinned to that certificate, so a rebuild satisfies
  the requirement macOS stored with a grant. Hardened runtime and
  entitlements (JIT, library validation off for the self-signed native
  modules, audio input) on the app and its helpers.
- Size: app 530 → 353 MB (242 MB of it is Electron), DMG 154 MB.
- `AmbientMind --selftest` loads sqlite, sqlite-vec, the speech runtime and
  the OCR core. `./dev npm run test:packaged` installs the DMG into
  `.local/install`, checks the signature, runs the self-test, and checks that
  the installed app is a `UIElement` with no Dock icon that quits with code 0.
- `./dev clean-system` also unregisters the repo's app bundles from
  LaunchServices.

Exit check: build, typecheck, `./dev npm test` (152 logic + 27 db + 11
component tests), the smoke test, `test:packaged`, `smoke:sqlite`,
`smoke:vec`, `check:migration`, and `./dev doctor` all pass. A second build
has a different code hash and the same designated requirement, and
`codesign -R` confirms it satisfies the first build's. Checked by hand: the
microphone grant survives a rebuild. Screen Recording needs an admin account to
grant and is untested. The Windows packaging block was updated but
not built here, since cross-building would replace the Mac native modules in
`node_modules`.

### Phase 3 — Design system and new UI (7–10 days) — done, branch `phase-3-ui`

- Tokens, primitives and motion in `src/ui/`; light and dark; Reduce Motion
  and Reduce Transparency.
- Build in order, each first in the gallery, then wired to real data: orb →
  panel → Quick Capture → chat → Settings → onboarding.
- Glass via vibrancy; contrast checked on light, dark and busy wallpapers.
- Explore two or three orb and panel variants in parallel worktrees and pick
  from screenshots before committing to one.
- Delete the old renderers once each replacement is wired.

Exit: every surface in §5 exists; keyboard-only use works end to end; the
audit's UI bugs 1 and 8–14 are gone; screenshots on light and dark wallpapers
pass review.

What landed (branch `phase-3-ui`):

- `src/ui/`: OKLCH tokens for dark and light (`tokens.css`), Reduce Motion and
  Reduce Transparency, and primitives: Button, IconButton (fixed tones, since
  `cn()` does not merge classes), Kbd, Check, StatusLine, Toast with undo,
  Orb, and a Markdown renderer that builds elements and never injects HTML.
- Orb: `ThinkingOrb` in a 64 px glass disc. Activity sets the motion,
  urgency sets a thin arc that pulses when overdue, the badge counts only
  today and overdue, and an amber dot means something needs attention.
- Panel: the window is exactly as big as the orb or the panel, focusable only
  when open. Sections Now, Suggested, Upcoming and Later; rows expand in place
  with the evidence quote, an Open in Gmail link, and deadline and priority
  pickers. Full keyboard control, undo toasts, Done today and Snoozed views,
  and search.
- Quick Capture in the composer shape: typing works at once, the mic is
  opt-in (press the shortcut again, ⌘L, or the button), live chips show the
  parsed date, priority, people and recurrence, Enter morphs to a check,
  ⌘Enter keeps it open.
- Chat on a frameless glass card: Markdown answers, the changes as a step
  list, Stop (aborts the request in main), Clear, Retry on failure.
- Settings: a 208 px sidebar window with ten sections, Light, Dark or Auto,
  grouped rows, a shortcut recorder (physical keys, conflicts shown, current
  shortcuts suspended while recording, re-registered live), Pause AI,
  encrypted backup, and a "Saved" toast per burst of changes.
- Onboarding: welcome, privacy, sources, permissions (the mic is asked from
  here), model check and shortcuts. It opens until finished and can be
  reopened from Settings → About.
- Connect Google returns as soon as the account is linked; the first sync
  runs in the background (audit bug 13).
- `./dev npm run gallery` shows every surface in every state on dark, light
  and busy wallpapers; `./dev npm run gallery:shots [ids]` writes 2× PNGs to
  `.local/shots`. The smoke test walks onboarding, opens the panel, chat and
  Settings in the real app, and screenshots each.

Not done, and why:

- Native vibrancy. Screenshots of the desktop need Screen Recording, which
  needs an admin account here, so the glass is a 95 % tint that passes on
  busy wallpaper instead.
- Hold-to-talk. Electron global shortcuts see key-down only.
- Orb drag-to-snap and a hover peek (the peek is the tooltip for now).
- Streaming chat and confirm cards (Phase 6), "Never from this sender"
  (needs a sender rule store), Apple Calendar and Reminders (Phase 5), Apple
  Intelligence (Phase 6). Their places in the UI say "Coming soon".
- Parallel orb variants in worktrees; one direction was built and reviewed
  from screenshots instead.
- Google still needs a hand-placed OAuth client file (audit bug 12, partly);
  onboarding and Settings now say where it goes.

Exit check: typecheck, `./dev npm test` (177 logic + 30 db + 34 component
tests) and the smoke test pass; gallery screenshots reviewed on dark, light
and busy wallpapers.

### Phase 4 — Swift helper (7–10 days) — two rounds done, branch `phase-4-helper`

1. **Spike first (1 day):** a helper that reports permissions, launched by a
   dev-signed AmbientMind. Proves that prompts and the System Settings entry
   say AmbientMind. If not, fall back to running the helper as an XPC service
   or a login item inside the bundle.
2. Permissions and the onboarding wiring.
3. Focused window: Accessibility text, then ScreenCaptureKit window capture
   plus Vision OCR, then whole display. Excluded apps (password managers,
   banking) never read. Tesseract remains the Windows path.
4. SpeechAnalyzer streaming with partials, level meter and hints (task titles,
   contact names); hold-to-talk hotkey. Transformers.js remains the Windows path
   and moves into a utility process.
5. `contacts.me` and `system.busy`.
6. A fake helper for tests and evals.

Exit: "capture what's on screen" reads the window you were looking at, not the
whole display; voice shows live words and lands within a second of release.

What landed in the first round (branch `phase-4-helper`):

- `native/mac-helper`: a SwiftPM executable (Swift 6 toolchain, macOS 14+),
  built by `./dev npm run helper` with every SwiftPM and clang cache in
  `.local/`. It speaks newline-delimited JSON on stdin/stdout, exits when
  stdin closes or its parent dies, and has a `--selftest` that renders a
  phrase and reads it back with Vision.
- Methods: `hello`, `perms.status` and `perms.request` (microphone, speech,
  Accessibility, Screen Recording, calendar, reminders, contacts; a request
  is refused if the app's Info.plist lacks the usage string, since macOS
  would kill the helper instead of asking), `context.focused` (the window in
  front: title, document or page address, selection and visible text through
  Accessibility, with the app history so Quick Capture taking focus doesn't
  hide it), `capture.windowOCR` and `capture.displayOCR` (ScreenCaptureKit
  plus Vision; never prompts), `ocr.image`, `system.busy` (idle time, mic in
  use, full-screen app) and `contacts.me`.
- The spike's answer: the helper sits in `Contents/MacOS`, signed with the
  app under the hardened runtime and only `audio-input`. Launched through
  LaunchServices, macOS holds `com.ambientmind.app` responsible for it
  (`responsibility_get_pid_responsible_for_pid`, reported in `hello`), and
  the app and helper agree on every permission. `test:packaged` launches the
  installed app with `open --args --helper-check` and fails otherwise. No
  XPC service or login item needed.
- `electron/native/helperClient.ts`: request ids, timeouts, events, a hello
  handshake that refuses another protocol version, and restart with backoff
  (1 s doubling to 30 s, reset after a minute up). A missing binary or a
  protocol mismatch is `unavailable` at once and never retried. Tested
  against a fake helper (`eval/fixtures/fake-helper.cjs`) and the real one.
- Screen capture on the Mac: Accessibility text when there is enough of it,
  then that one window by ScreenCaptureKit and Vision, then the old
  whole-display path, with Vision instead of Tesseract when the helper is
  up. Password managers are refused outright, with no screenshot fallback.
  The prompt is told whether its text is exact or OCR. Windows is unchanged.
- Accessibility in Settings → Permissions, Settings → Capture and
  onboarding, with an Allow button that shows the macOS prompt.
- Usage strings for speech, calendars, reminders and contacts in the
  bundle, ready for the methods that need them.

Exit check (first round): typecheck, `./dev npm test` (195 logic + 30 db +
35 component tests), the smoke test (the helper starts as the app's child and
leaves with it), `test:packaged` including the attribution check, and
`./dev doctor` all pass.

What landed in the second round:

- `speech.status`, `speech.install`, `speech.start`, `speech.stop` and
  `speech.cancel` (macOS 26): SpeechAnalyzer with volatile results, the
  user's name, people and short task titles as contextual strings, and
  pushed `speech.partial` and `speech.level` events. Starting refuses
  cleanly when the model is missing, the mic is refused, or the usage
  string is absent.
- `hotkey.set` and `hotkey.clear`: a Carbon hotkey that reports press and
  release with no permission. The helper now runs a `.prohibited`
  `NSApplication` loop, which Carbon needs, and waits briefly for in-flight
  replies when stdin closes.
- Hold-to-talk: on the Mac, the Quick Capture shortcut is held by the helper
  instead of `globalShortcut`. A tap opens Quick Capture or toggles the mic;
  a hold (300 ms) starts listening and letting go finishes. If the helper
  can't take the keys, `globalShortcut` takes over as before.
- Quick Capture shows live words in the field while listening, with the
  level meter; a pause ends toggle mode but not a hold. Any failure of the
  live path falls back to Whisper.
- Settings → Capture → Live words: a Download button for Apple's model (a
  macOS asset stored with Dictation's, so never fetched without asking),
  progress, and "On" once installed, when the Whisper picker becomes the
  fallback. Whisper is only loaded when it will be used.

Not done yet, and why:

- Live words through the real microphone: the en-US model is installed
  and `ambientmind-helper --transcribe <file> [hints]` runs the same feed,
  analyzer and results path on a `say` recording (word-perfect, names from
  the hints, about 0.7 s for 5 s of speech). The microphone itself still
  needs a person talking to it.
- Hold-to-talk release needs a physical key test; the hotkey registers and
  clears in the probe and the smoke test.
- Moving Transformers.js into a utility process: less pressing now that the
  Mac path doesn't load it; it stays for Windows.
- Accessibility and Screen Recording both need an admin account to switch
  on here, so the Accessibility and window-capture paths are proven by the
  protocol tests and `--selftest`, not by a real capture on this Mac. Without
  them, capture falls back exactly as before.

Exit check (second round): typecheck, `./dev npm test` (203 logic + 30 db +
39 component tests), the smoke test (including the helper's speech status),
`test:packaged`, and `./dev doctor` all pass.

### Phase 5 — Apple sources (4–6 days) — done

- Apple Calendar through EventKit for every account in macOS Internet
  Accounts. When Google Calendar is also connected, dedupe by event identity.
- Reminders two-way sync with an "AmbientMind" list: title, notes, due date,
  priority, completion and recurrence. Changes on iPhone arrive through
  `EKEventStoreChanged`. Conflicts resolve by last edit; deletes are tombstones
  on both sides; writes check the expected snapshot first.
- Settings → Sources shows each source's state, last sync and errors.

Exit: complete a task on iPhone and it clears in the overlay within seconds;
add one in the overlay and it appears in Reminders.

What landed (branch `phase-4-helper`, helper 0.3.0):

- Helper EventKit methods: `calendar.events` (every calendar in Internet
  Accounts, with iCalendar UIDs), `reminders.ensureList`, `reminders.list`,
  `reminders.upsert` and `reminders.delete`. Writes carry only the fields
  that changed and refuse a stale version (`conflict`). A debounced
  `eventstore.changed` event covers edits arriving from other devices.
- Migration 013: `acalendar` and `reminders` sources, `tasks.updated_at` kept
  by triggers, and `task_links` with a snapshot of both sides per link.
- Apple Calendar: the Google prep rule on EventKit events, reconciled as its
  own source, minus meetings Google already reported (same UID, or same
  title at the same minute).
- Reminders: a pure field-by-field planner (`shared/remindersSync.ts`) and an
  executor (`electron/services/reminders.ts`). Last edit wins per field,
  tombstones both ways, an edit after a delete restores, a vanished list or a
  mass disappearance deletes nothing. Passes run on EventKit changes, 1.5 s
  after a local change, and every five minutes.
- Settings → Sources → On this Mac: switches that ask macOS first, then show
  what each source last did, or why it couldn't.
- Tests: 14 planner cases, 3 calendar mapping and dedupe cases, 9 database
  cases against an in-memory Reminders that enforces versions, 3 Settings
  cases, and a smoke check that both sources are reachable and off by
  default.
- Device check passed: the installed app asked for Calendar and Reminders,
  pushed open tasks into the list, and completions and new reminders crossed
  both ways. Two fixes got it there: `./dev packaged` launches through
  LaunchServices so macOS asks as AmbientMind rather than the terminal, and
  the app and helper are signed with the `personal-information` entitlements
  the hardened runtime requires (`test:packaged` now checks them). In
  development macOS still asks on Cursor's behalf, so the switch explains
  that and refuses.

Not done yet, and why:

- Recurrence is not written to Reminders: a recurring rule's occurrences go
  as separate reminders. Recurring reminders made on the phone sync as
  ordinary changes.
- Notes sync one way: a task's evidence becomes the reminder's notes when it
  is created, and a reminder's notes become the task's context when it
  arrives. Later note edits don't cross.

### Phase 6 — AI upgrade (4–6 days) — done

- Model router: Apple Foundation Models through the helper when available
  (schema-constrained output, 4K context per session, so one message per call),
  otherwise Ollama.
- Benchmark Ollama candidates on the eval harness against `qwen2.5:3b`:
  `Qwen3-4B-Instruct-2507`, `qwen3.5:4b`, `gemma4:e4b`. Use GGUF tags, keep JSON
  schema `format`, and validate every response with zod.
- Suggestion-first pipeline with confidence buckets and evidence quotes;
  optional auto-accept above a high threshold.
- Quick Add skips the model when nothing is missing.
- Per-call latency log, a `--budget` command and a prompt-size test.
- Keep `nomic-embed-text` for now; a move to `qwen3-embedding` needs a full
  re-embed and is a separate decision.

Exit: extraction quality is at least as good as today on the eval set, and no
AI task reaches your list without a source and evidence.

What landed (branch `phase-4-helper`, helper 0.4.0):

- Helper `llm.status` and `llm.generate` on Apple's Foundation Models,
  weak-linked so the helper still starts on older macOS. The JSON Schema we
  already send Ollama is translated to a `DynamicGenerationSchema`, so both
  engines produce the same shape. Guardrail, refusal, context overflow and
  busy come back as typed errors.
- Router (`electron/services/ai.ts`): Automatic, Apple or Ollama. Automatic
  uses Apple when it is ready and the prompt fits its 4K window, otherwise
  Ollama, and falls back to Ollama when Apple refuses or fails. Extraction,
  enrichment, chat and screen capture all go through it; extraction drops
  few-shot examples and clips long mail for Apple.
- Every response is validated with zod (`electron/services/extract.ts`). The
  schema opens with an `asksUser` yes/no, and a "no" discards whatever tasks
  the model wrote anyway; that took Apple's task-free accuracy from 25% to
  100% and made `qwen2.5:3b` work again under Ollama 0.40.
- Evidence (`shared/evidence.ts`): every task carries a quote checked against
  the message. A paraphrase is replaced by the message's own best-matching
  sentence and capped below "high" confidence; a task nothing supports is
  dropped. Deadlines are resolved from the quote's own words against the
  message date ("by end of week", "Friday morning") rather than trusting the
  model's arithmetic.
- Mail tasks arrive as suggestions with a Gmail link and the quote.
  Settings → AI & Models can add confident ones straight away (0.9 and a
  verified quote; off by default).
- Quick Add skips the model when the parser already found everything; the
  parser now knows end of day, week and month, and morning, afternoon and
  evening.
- Every model call is logged to `ai-calls.jsonl` in the data folder;
  `./dev npm run ai:budget` prints calls, failures, fallbacks and p50/p95
  latency per purpose and engine. A prompt-size test keeps the fixed prompt
  small enough to leave Apple at least 3,000 characters of mail.
- Settings → AI & Models: Apple Intelligence status with the reason when it
  is off, which engine is answering, the engine switch, and auto-accept.
- `test:packaged` asks the signed helper for Apple's model and fails if a
  model that says it is ready does not answer.

Benchmark on `eval/corpus/seed.jsonl` (14 messages, results in
`eval/results/*-v7-final.json`), on this M-series Mac:

| Engine                          | F1   | Task-free left alone | Deadline | Median latency |
| ------------------------------- | ---- | -------------------- | -------- | -------------- |
| `qwen2.5:3b`                    | 100% | 100%                 | 71%      | 0.2 s          |
| `qwen3:4b-instruct-2507-q4_K_M` (default) | 100% | 100%       | 57%      | 0.2 s          |
| `gemma3n:e4b`                   | 100% | 100%                 | 57%      | 0.5 s          |
| Apple on-device                 | 86%  | 100%                 | 50–67%   | 0.8 s          |

The previous best was 83.3% F1 and 60% deadlines. Apple's deadline score
moves between runs: on one task-free message it sometimes dates "ASAP".

Chat, on `eval:chat` (18 scripted messages checking the task each change
lands on and the time it resolves to): `qwen3:4b-instruct-2507` 18/18,
`qwen2.5:3b` 16/18, `gemma3n:e4b` 15/18, Apple 14/18. Apple's model copies the
prompt's examples back and acts on questions, so Automatic gives chat to
Ollama while it runs, and `qwen3:4b-instruct-2507` became the default: equal
on mail, clearly better at chat, 2.5 GB against 1.9 GB.

Chat was rebuilt after the first device test, where "remind me to shower in
an hour" made four tasks with no time and "what tasks are done" listed open
ones. One model call now returns a `kind` (question, change or other), the
changes, and a reply. Tasks are named by their copied title and times by
the user's own words, which the Quick Add parser resolves; it learned "in an
hour", "in 20 minutes", "in two days" and "next week" for this. Code writes
the confirmation from what really changed, a question can never change the
list, an add repeated within 15 minutes moves the first one instead, and a
reply that claims a change it didn't list is asked once more, then replaced
with "I didn't change anything". `gemma3n:e4b`
stood in for the plan's `gemma4:e4b`; `qwen3.5:4b` was not benchmarked.

Not done yet, and why:

- The eval set is 14 messages; the differences between engines are one or
  two tasks. A larger labelled set (real mail, with consent) is needed before
  reading much into the ranking.
- The remaining deadline misses need context outside the quote ("ahead of
  it", meaning a meeting named earlier) or are models dating "ASAP".
- Chat context is not trimmed for Apple's 4K window: Automatic sends a chat
  that doesn't fit to Ollama, and with Apple chosen alone it fails as too
  long.

### Phase 7 — Trust and privacy (3–4 days)

- "What AmbientMind knows" page: counts per source, where data lives,
  retention, export, delete by source or date.
- Outbound network log, so "local-only" is something you can check.
- Screen reading off by default, a visible indicator while it runs, excluded
  apps.
- Pause AI (1 hour, until tomorrow, until resumed) in the menu bar and Settings.
- Backup and restore UI over the existing encrypted backup.
- Content protection toggle; quiet mode during calls and full-screen apps.

Exit: every BACKLOG Phase F item is reachable from the UI.

### Phase 8 — Polish and release readiness (3–5 days)

- Idle budget: no CPU when nothing changes, orb paused when hidden, memory
  measured with only the overlay running.
- Accessibility pass: VoiceOver labels, focus order, contrast.
- Notifications with actions (Done, Snooze 1h).
- Windows parity check on the platform layer.
- Update `SYSTEM.md`, `google-setup.md` and `voice.md`.
- When going public: Apple Developer ID, notarization, electron-updater with
  signed releases, and Gmail restricted-scope verification (unverified apps are
  capped at 100 users).

Total: roughly 35–50 focused days.

---

## 7. Cursor tooling to add

Everything is project-scoped: MCP servers in the repo's `.cursor/mcp.json`,
skills in `.cursor/skills/`, rules in `.cursor/rules/`. Nothing goes in
`~/.cursor` or any global config. Run installers through `./dev npx ...` and
check each one writes only inside the repo. Stdio MCP servers that use `npx` get
`"env": { "npm_config_cache": "<repo>/.local/cache/npm" }` in `mcp.json`,
because Cursor starts them without `./dev`. Verify each package at install
time; these were current on 31 October 2026.

| Tool | Why | Where it goes |
| --- | --- | --- |
| shadcn MCP | Pull and adapt components directly | `.cursor/mcp.json` entry running `npx shadcn@latest mcp` |
| Anthropic `frontend-design` skill | Pushes generated UI away from generic templates | Copied into `.cursor/skills/frontend-design/` from `anthropics/skills` |
| Vercel `web-design-guidelines` skill | Interface review checklist | Copied into `.cursor/skills/` from `vercel-labs/agent-skills` |
| Context7 | Current docs for Electron, Base UI, Motion, EventKit | Remote MCP URL in `.cursor/mcp.json`; no local install |
| Browser review | Screenshot the gallery | Cursor's built-in browser; no Playwright MCP needed. Electron windows are covered by the Playwright smoke test. |
| Xcode MCP | Build and debug the Swift helper | Phase 4. Needs Xcode 26.3 or later; only the Command Line Tools are installed now. Then a `.cursor/mcp.json` entry running `xcrun mcpbridge`. |
| Apple docs (Sosumi) | Apple API docs for the helper | Remote MCP URL `https://sosumi.ai/mcp` in `.cursor/mcp.json` |
| Figma (optional) | Only if designs are drawn in Figma first | Skip unless needed; it is a user-level plugin |

Skip flashy component marketplaces (21st.dev, Magic UI); their style fights a
calm overlay. Skip community Electron-driving MCPs unless reviewed first.

Project rules to add:

- `.cursor/rules/design-system.mdc`: tokens, type scale, motion curves, the
  suggestion-first rule, desktop conventions (no pointer cursor, no hover
  flicker, no layout jump).
- `.cursor/rules/electron-mac.mdc`: platform layer only, never inline
  `process.platform` checks; every helper call has a fallback; every IPC event
  broadcasts.

---

## 8. Testing and verification

- **Unit:** existing `node:test` suites, plus new tests for every Phase 1 fix,
  written to fail first.
- **Components:** Vitest with happy-dom and a mock bridge, the way Atticus
  tests its WebKit UI against a fake native bridge.
- **Visual:** the `/gallery` route screenshotted on light, dark and busy
  wallpapers at each phase exit.
- **App:** Playwright Electron smoke tests for launch, every window, quit.
- **Helper:** `--selftest`, plus a fake helper that returns canned window text,
  OCR, transcripts and EventKit data, so the screen and Reminders paths run in
  CI without a Mac.
- **Model:** the eval harness on every model or prompt change, plus the latency
  budget.
- **Reviews:** a Bugbot review on each phase branch; a security review on
  Phases 1, 4 and 7.

---

## 9. Risks and open questions

| Risk | Plan |
| --- | --- |
| Helper permissions might be attributed to the helper, not AmbientMind | Resolved in Phase 4: launched through LaunchServices, macOS holds AmbientMind responsible; `test:packaged` checks it on every build. |
| Electron cannot yet make a non-activating panel that takes keystrokes (open issue) | Quick Capture activates briefly, and the helper reactivates the previous app on close. |
| sqlite-vec may need `disable-library-validation` under hardened runtime | Resolved in Phase 2: a self-signed certificate has no Team ID, so the entitlement is set and every native module loads in the signed build. Revisit with a Developer ID. |
| Foundation Models needs Apple Intelligence enabled and has a 4K context | Router falls back to Ollama; one message per call. |
| Ollama's MLX backend has ignored JSON `format` in some releases | Use GGUF tags, validate with zod. |
| Screen Recording re-prompts monthly since macOS 15 | Say so in onboarding; prefer Accessibility text so capture is rarely needed. |
| `electron-liquid-glass` is lightly maintained | Vibrancy is the default; glass is a flag. |
| Electron upgrade can break native modules | Phase 2 starts with the upgrade, before other changes. |
| Gmail restricted scope caps unverified apps at 100 users | Fine for personal use; verification is a Phase 8 item when going public. |
