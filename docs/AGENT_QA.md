# Unattended agent QA for AmbientMind

How an agent tests the whole app while you keep working on this Mac (or
overnight), measures the numbers instead of trusting them, and hands you a
report to review like a pull request. Adapted from the "overnight agent-QA"
pattern: **guardrails first, autonomy second.**

## The short version

An agent drives AmbientMind through every window, flow and failure it can
reach, across several targets (dev build, packaged build, a Windows-shaped
renderer, light and dark, empty and heavy data). It runs under fixed limits:

- It never touches your live data. App instances it launches get a **copy**.
  Your Google sign-in is copied too, but only Google's read requests and token
  refresh get through; every write, revoke and new sign-in is blocked.
- It never reaches the outside world. Inside a QA instance, opening the
  browser, Finder or System Settings, showing notifications, adding login
  items, grabbing global shortcuts, asking for permissions and any network
  request off this Mac are replaced by recorders that write the attempt to a
  file.
- It doesn't disturb you. Its windows are never shown on your screen, it
  steals no focus or shortcuts, and it runs at low priority.
- It never fixes anything itself. Cleanup, database repairs and code fixes are
  written as files you read and run in the morning.

Every finding comes with evidence (screenshots, log lines, a query and its
result, or repro steps), and there's a "claims vs reality" pass that checks the
docs and the app's own copy against what actually happened.

## Decisions (1 November 2026)

- QA instances use a copy of your real database **and** seeded profiles.
- Gmail and Calendar: your real account, read-only through the network
  filter; the fake Google only for labelled-accuracy runs.
- Model-heavy missions run now, at normal priority. Your running app's AI
  answers may be slower while they do.
- The harness is built and committed on a `qa-harness` branch.
- The run folder will hold copies of your tokens and screenshots of
  mail-derived tasks. It's inside `.local/` (git-ignored), and `cleanup.sh`
  lists the token copies first.

## 1. What changes from the original pattern

The original targets a web backend on three phones. AmbientMind is a local,
single-user desktop app, so each piece has a local equivalent:

| Original | AmbientMind |
| --- | --- |
| Read-only Postgres role | A snapshot of `.local/data/ambientmind.db` taken through SQLite's read-only backup, in the run folder. QA instances are launched with `AMBIENTMIND_DATA_DIR` pointing at the run folder and refuse anything else. |
| Sentry MCP (traces, p50/p95, error rates) | `ai-calls.jsonl` (engine, latency, prompt size, failure, fallback for every model call) summarised by `npm run ai:budget`; `network.jsonl`; `crash.log`; the `decisions` table; Electron's `getAppMetrics`; timings the test driver takes itself. Adding Sentry would break "nothing leaves this Mac", so it stays out. |
| Three phones | Targets: the dev build, a separate copy of the packaged build, and a Windows-shaped renderer, each in several states (§4). |
| `adb` / `idb` taps | Playwright's Electron driver. The accessibility tree (role + name of every control) plays the part of `uiautomator dump`. |
| "Never use a device signed into a real account" | QA instances use the fake Swift helper (no Calendar, Reminders, mic or screen). They read your real Gmail and Calendar through a filter that lets only read requests and token refresh through; labelled-accuracy tests use a local fake Google. |
| New: you're using the same Mac | No windows on your screen, no focus or shortcut stealing, no system prompts, low CPU priority, and nothing that can quit or replace the app you have running. |

## 2. Guardrails, set before the first run

Each one is enforced by code or configuration, not by the prompt, and each has
a place where an attempt shows up.

### G1. Your live data is read-only, structurally

- **Snapshot, don't share.** At the start of a run the agent copies the live
  database with `sqlite3 "file:.local/data/ambientmind.db?mode=ro" ".backup <run>/data/ambientmind.db"`,
  plus `config.json`, `ai-calls.jsonl`, `secrets.json` and
  `google-credentials.json`. In the copied config, recurring rules on Google
  Calendar are switched off. The copied tokens can only be used through the
  QA network filter (G2), and only launches that read your real mail
  (`liveGoogle: true`: M3b and the export check) get a copy of them; every
  other launch of the snapshot starts signed out.
- **The app refuses the real folder.** QA mode (G2) only starts when
  `AMBIENTMIND_DATA_DIR` is inside `.local/qa/runs/`; anything else exits with
  an error before a single file is opened. A unit test proves this.
- **The agent's own commands are filtered.** A project hook
  (`.cursor/hooks.json`, `beforeShellExecution`) blocks any shell command that
  names `.local/data` except the read-only forms above, and logs the blocked
  command to `<run>/attempts-agent.jsonl`.
- **How you'd notice:** the hook log, and `qa:verify` in the morning (§9),
  which runs SQLite's integrity check on your live database and confirms the
  QA processes never opened it (they never had the path).

### G2. QA mode: the app can look, it cannot reach out

Started with `AMBIENTMIND_QA=1` (plus the folder check above). In this mode the
main process swaps every outside-world call for a recorder that appends to
`<run>/attempts-app.jsonl` and returns a scripted answer:

| Real call (where) | In QA mode |
| --- | --- |
| `shell.openExternal` (Google sign-in, permission help, links) | Recorded with the URL; nothing opens |
| `shell.openPath` (data folder, crash log) | Recorded; Finder doesn't open |
| `dialog.showMessageBox` / `showSaveDialog` / `showOpenDialog` / `showErrorBox` | Recorded; answered from a script (e.g. "Forget" or "Cancel", a save path inside the run folder) |
| `new Notification` (sync, due-soon, permission) | Recorded with title, body and buttons; the agent can "press" Done or Snooze through the recorder |
| `app.setLoginItemSettings` | Recorded; no login item is added |
| `globalShortcut.register` | Recorded; your shortcuts stay with your running app |
| `askForMediaAccess`, `isTrustedAccessibilityClient(true)`, `desktopCapturer` | Recorded; no system prompt appears and the screen isn't captured |
| A page's `getUserMedia` (Quick Capture's Whisper fallback, the onboarding mic test) | Refused and recorded as `permission.media`; Chromium also gets fake devices, so the real microphone never opens |
| Swift helper | `AMBIENTMIND_HELPER` points at `eval/fixtures/fake-helper.cjs`: no EventKit, mic or screen access |
| Network | Allowed: Ollama on `127.0.0.1` (directly or through the fault proxy, §6), the local fake Google, and these Google calls only: `GET gmail.googleapis.com/gmail/v1/…`, `GET www.googleapis.com/calendar/v3/…`, `GET www.googleapis.com/oauth2/v3/userinfo`, and `POST oauth2.googleapis.com/token` with `grant_type=refresh_token`. Everything else (calendar writes, revoke, a new sign-in, any other host) is rejected in a `fetch` wrapper and the session's `webRequest`, and recorded. |
| Windows | Created hidden and never focused; captured with `capturePage`. Tray and Dock icon are skipped. |

A test checks that every row is stubbed when QA mode is on, and inert when it
isn't. QA mode is compiled into the app but does nothing without both the
environment variable and a run folder.

### G3. Cleanup and repairs are written down, not done

The agent never deletes, repairs or patches during a run. It writes:

- `cleanup.sh`: deletions it wants, **only** inside `.local/qa/`, each line
  with a comment saying what created it. You read it, then run it.
- `proposed-repairs.sql`: anything it thinks is wrong in your live data (an
  orphaned link, a task stuck in a state), as statements with the evidence
  query above each. Never executed by the agent.
- `proposed-patches/NNN-short-name.diff`: code fixes for findings, one per
  finding, ready for `git apply`. Source files aren't edited during the run.

### G4. A list it may never cross

See §3. The list is in the mission prompt, and every item is also blocked by
the hook (G1), QA mode (G2) or file placement, so a slip is blocked and logged
rather than trusted not to happen.

### G5. Don't get in your way

- One QA app instance at a time.
- Ollama is shared with the app you're using, so model-heavy missions send
  one request at a time.
- Packaged builds go to `.local/qa/build/`, never `release/`, because your
  running app is executed from `release/`.

## 3. The never-do list

| Never | Why | Blocked by | Where an attempt shows |
| --- | --- | --- | --- |
| Write, move or delete anything in `.local/data/` | Your real tasks, config and Google sign-in | Hook; QA instances never get the path | `attempts-agent.jsonl` |
| Quit, kill or restart your running AmbientMind | You're using it | Hook blocks `pkill`/`kill` matching the app | `attempts-agent.jsonl` |
| Build into or modify `release/` | Your app runs from there | Hook; QA build output is `.local/qa/build/` | `attempts-agent.jsonl`; `qa:verify` checks `release/` timestamps |
| Edit tracked source, or `git commit`, `push`, `checkout`, `reset`, `stash` | Fixes are proposals | Hook blocks the git verbs; an after-edit hook logs any edit outside `.local/qa/` | `attempts-agent.jsonl`; `git status` in the morning |
| Write to Google: calendar changes, revoking or replacing your sign-in, anything but reading mail and calendar | Real mail and calendar | QA network filter allows only the four read calls; write-back off in the copied config | `attempts-app.jsonl` |
| Touch Calendar, Reminders, mic, Screen Recording or Accessibility | Real data and system prompts | Fake helper; QA mode stubs | `attempts-app.jsonl` |
| Open your browser, Finder or System Settings | It would take over your screen | QA mode stubs | `attempts-app.jsonl` |
| Add login items, run `defaults write`, `launchctl`, `osascript`, `security`, `tccutil` | System state outside the repo | Hook; QA mode stub for login items | Both logs |
| Write outside the repo (`/tmp`, `~`) | Isolation rule | Hook; sandbox | `attempts-agent.jsonl`; `./dev doctor` |
| Install anything, `brew`, `pip`, `ollama pull`, global npm | Isolation rule, disk and memory | Hook | `attempts-agent.jsonl` |
| Run `./dev clean-system` | It removes preferences your running app is using | Hook | `attempts-agent.jsonl` |

## 4. Targets (the "devices")

| Target | What it is | Notes |
| --- | --- | --- |
| T1 Dev | `electron-vite build` output launched by Playwright | Fastest; most missions |
| T2 Packaged | `dist:mac` built into `.local/qa/build/`, launched from there | Catches asar, native module and signing problems |
| T3 Windows-shaped | Renderer tests and the gallery with a Windows user agent; platform-layer logic tests | A simulation. Real Windows needs a Windows machine, and the report says so. |

Each target runs in several states: light and dark theme; reduced motion and
reduced transparency; the smallest and largest window sizes; fresh install
(onboarding); and each data profile below.

## 5. Data

- **Your snapshot:** a copy of your live database (your 15 tasks, rules,
  decisions), config and Google sign-in. Syncs read your real mail and
  calendar through the filter, so extraction is measured on mail you
  actually get.
- **Seeded profiles** generated per run: *empty*; *typical* (40 tasks, 5
  rules); *heavy* (500 tasks, 30 rules, 2,000 decisions); *adversarial* (very
  long titles, emoji, right-to-left text, HTML and Markdown injection, deadlines
  in the past, clashing meetings, duplicates across sources).
- **Mail replay:** a local fake Google server that answers the Gmail and
  Calendar APIs from `eval/corpus/seed.jsonl` and the prepared Enron set
  (`npm run eval:prepare`), so the real sync → extraction → dedup → suggestion
  pipeline runs end to end with the real model, without Google.
- **Voice fixtures:** spoken task phrases rendered to audio files with macOS
  `say -o` into the run folder, fed to Whisper.

## 6. Missions

### M1. Every control on every screen

For each target and state, for each window (overlay collapsed and expanded,
task panel, Quick Capture, Chat, all 11 Settings sections, all 6 onboarding
steps, and the tray menu, read from the main process rather than clicked in
the OS):

1. Read the accessibility tree: every button, switch, link, field and option,
   with its role, name and box.
2. Skip anything visited this run (key: screen hash + role + name), or it walks
   in circles.
3. Screenshot, activate the control, wait for idle, screenshot again.
4. Record the control, both screenshots, renderer console and main-process log
   tail, any QA-mode attempts, and whether the screen changed.
5. Go back (Esc or the previous section) and continue.

Destructive buttons (Delete, Forget, Clear, Restore, Disconnect) **are**
pressed, because the data is a throwaway copy and their confirmations are
answered by the dialog script. That's how the destructive paths get tested.

Flags: a control that changes nothing; console errors; controls with no name;
focus lost to the page body; text cut off or overflowing its window; a layout
shift after the first paint; anything that hits a QA-mode recorder unexpectedly.

### M2. The flows people actually use

Scripted, with assertions on the database as well as the screen: add,
complete, undo, snooze, edit and delete a task; Quick Capture with dates
("tomorrow 5pm", "every Tue and Thu"); typed voice intents; recurring rules;
accepting and dismissing suggestions; chat actions (`eval:chat`); due-soon
notifications, pressing Done and Snooze through the recorder; Pause AI;
forgetting a source; export; backup and restore round trip; opening the
privacy policy from About and erasing everything (F15: the restart is
recorded with `--erase-data`, then relaunched with it, and the profile must
come back empty but for the Google client file); the migration rehearsal on
your snapshot.

### M3. The mail pipeline with the real model

Two halves. **Your mail:** full syncs against your real Gmail and Calendar
(read-only), measuring speed, failures, what became a suggestion and why;
nothing is labelled, so accuracy here is judged case by case with the
message quoted as evidence. **Labelled mail:** replay through the fake Google
for accuracy against the labelled corpus (`eval/evaluate.ts`), evidence quotes that really appear in the
message, deduplication across Gmail and Calendar, routing between Apple
Intelligence and Ollama, and retries.

### M4. Real numbers, not guesses

Measured on T1 and T2, reported as p50 / p95 / max with the sample size:

- Cold start to orb visible; panel open; Quick Capture submit to row visible.
- Extraction per email, per engine; chat answer; Quick Capture enrichment;
  Whisper per second of audio.
- One sync pass over 50 messages.
- Idle CPU and memory (`measure:idle`), and memory slope over the soak (M8).
- Database query times on the heavy profile.

Your real history is reported separately: `ai:budget` over a copy of your
`ai-calls.jsonl`. It has 18 calls today, so it's labelled as a small sample.

### M5. Failure rates under faults

A small proxy between the QA instance and Ollama (`AMBIENTMIND_OLLAMA_PORT`)
injects faults without touching the Ollama your app uses: slow responses,
dropped connections, malformed JSON, timeouts. Plus: the fake helper's crash
modes, a corrupted `config.json`, a locked database, and sleep/wake. For each:
failure rate, retries, what the user sees, and whether anything was lost.

### M6. Claims vs reality

The agent collects every checkable claim from `README`, `docs/SYSTEM.md`,
`docs/REBUILD_PLAN.md`, `docs/google-setup.md`, `docs/voice.md` and the app's
own copy ("No prompt is sent to a server", "Audio is never saved", "Never sent
anywhere", the default model, the 60-second first-sync delay, the 15-minute
interval, 48-hour calendar window, `newer_than:2d`, "fires once per
deadline", the idle numbers, accuracy figures from `eval/results/`). Each is
checked against code and observed behaviour, such as the run's network log, a
file-system scan for audio files, or the engine field in `ai-calls.jsonl`.

| Claim | Where | Observed | Evidence | Verdict |
| --- | --- | --- | --- | --- |

### M7. Privacy and security

The whole run's network log shows nothing leaving the Mac except what's
allowed; files written during the run stay inside its data folder; no prompt
or mail text in any log; Content-Security-Policy violations; navigation
guards against links and script injected through task titles, mail and chat
Markdown.

### M8. Soak

Six to eight hours on the typical profile with background timers sped up:
memory and handle growth, log and `ai-calls.jsonl` trimming, timers that
drift or stack, and whether the orb still settles to idle.

### M10. Spoken capture

`e2e/qa/voice.spec.ts`. Phrases made with `say` (with a breath of silence
first) play through Chromium's fake microphone via
`AMBIENTMIND_QA_FAKE_MIC_FILE`, a WAV inside the run folder, into Quick
Capture's Whisper path. Checks the words heard, the task and its deadline.

### Live mission

Attended only: someone at the Mac clicks Allow once each for Reminders and
Calendar. It reads your real Gmail and calendars, and writes only to a
Reminders list, an Apple calendar and a Google calendar all named
"AmbientMind QA", deleted at the end and checked again.

- **Its own identity.** Built as "AmbientMind QA" (`com.ambientmind.qa`), so
  macOS keeps its permissions apart from the installed app's.
- **Opened through LaunchServices** (`open -g -n`), so macOS asks on its
  behalf rather than Cursor's; driven over QA mode's loopback control
  endpoint (`AMBIENTMIND_QA_CONTROL`, a port and one-time token in the run
  folder), with no debugging port.
- **Two locks.** With `AMBIENTMIND_QA=1` the helper refuses the microphone,
  screen, Contacts and hotkeys and only touches the QA list and calendar
  (`native/mac-helper/Sources/Helper/QA.swift`); `AMBIENTMIND_QA_LIVE=1`
  lets Google calendar writes through only for the QA calendar
  (`shared/qaPolicy.ts`).
- **A fresh database**, with only the sign-in and OAuth client copied from the
  snapshot; delete `secrets.json` copies afterwards.

```sh
./dev npm run helper && ./dev run npx electron-vite build
./dev run npx electron-builder --mac --dir --config.directories.output=.local/qa/build/live \
  --config.appId=com.ambientmind.qa "--config.productName=AmbientMind QA"
QA_RUN=$PWD/.local/qa/runs/<run> QA_LIVE=1 QA_LIVE_TAG=<new name per rerun> \
  ./dev run npx playwright test e2e/qa/live.spec.ts --workers=1
```

`tccutil reset All com.ambientmind.qa` forgets its permissions afterwards.

## 7. The mission prompt

```text
MISSION: unattended QA of AmbientMind, run <date>, targets <T1,T2,T3>,
  missions <M1..M8>, run folder .local/qa/runs/<date>/.
YOU MAY: launch QA instances (AMBIENTMIND_QA=1, data dir inside the run
  folder) on the snapshot and seeded profiles; drive them with Playwright;
  read the live data read-only through the snapshot; read the repo; query
  the run's ai-calls.jsonl, network.jsonl, crash.log and attempts logs; use
  the project Ollama one request at a time; write anything inside the run
  folder.
YOU MAY NOT: anything on the never-do list in docs/AGENT_QA.md §3. If a
  step seems to need one, stop that step and record it as a finding.
DELIVER: report.md with findings ranked by severity, each with evidence
  (screenshots, log lines, query + result, or repro steps) and a suspected
  cause; a claims-vs-observed table; perf.json with p50/p95/max and sample
  sizes; cleanup.sh, proposed-repairs.sql and proposed-patches/ as files,
  none of them executed.
```

## 8. What lands in the run folder

```text
.local/qa/runs/2026-11-02/
  report.md                findings, ranked; summary at the top
  findings.json            the same, machine-readable
  claims.md                claims vs reality
  perf.json                every measured number with its sample size
  attempts-agent.jsonl     blocked agent commands (should be empty)
  attempts-app.jsonl       what QA instances tried to do outside themselves
  cleanup.sh               reviewed by you, then run by you
  proposed-repairs.sql     never run by the agent
  proposed-patches/        one .diff per fixable finding
  data/                    snapshot and seeded profiles
  t1-dev/m1-sweep/settings-privacy/step-0042-before.png, -after.png, .log
  t2-packaged/...
  t3-windows/...
```

A finding looks like this:

```markdown
### F-07 · S2 · Snooze 1 hour from a notification leaves the task visible
- Target / state: T2 packaged, typical profile, dark
- Repro: 1. seed task due in 10 min  2. run due-alert sweep  3. press "Snooze 1 hour" via recorder
- Expected: task leaves the Open list until 1 hour later
- Observed: task stays in Open; snoozed_until is set
- Evidence: t2-packaged/m2-flows/alerts/step-0007-after.png; query `SELECT status, snoozed_until FROM tasks WHERE id='…'` → `pending | 2026-11-02T03:12Z`
- Suspected cause: electron/main.ts snoozeTaskById doesn't broadcast to the overlay
- Patch: proposed-patches/007-alert-snooze-broadcast.diff
- Confidence: high
```

Severity: **S1** data loss, privacy or a broken guarantee; **S2** a broken
flow; **S3** a wrong number or a false claim; **S4** polish.

## 9. The morning review

1. Open `report.md`; read S1 and S2 first.
2. Check `attempts-agent.jsonl` is empty, and read `attempts-app.jsonl` for
   anything surprising.
3. Run `./dev npm run qa:verify`: live database integrity, nothing written
   outside the repo or `.local/qa/`, `release/` untouched, no login items,
   `git status` clean apart from the run folder.
4. Read `cleanup.sh` and `proposed-repairs.sql` before running either.
5. Apply the patches you agree with on a branch, one per finding, and run the
   tests.

## 10. The harness

Built and committed on its own branch (`qa-harness`), separate from product
changes:

| Piece | What it does |
| --- | --- |
| QA mode (`electron/qa.ts`, `shared/qaPolicy.ts`) | The G2 stubs and recorders, the folder check, the read-only Google filter, the fake-Google redirect, and the actions the tray and shortcuts would trigger. Tests: `eval/qaPolicy.test.ts`, `e2e/qa-mode.spec.ts` |
| `scripts/qa-run.cjs` + `./dev npm run qa -- start\|status\|stop` | Run folder, read-only snapshot, seeded profiles, fake helper wrapper, the `ACTIVE` marker the guard reads |
| `.cursor/hooks.json` + `.cursor/hooks/qa_guard.py` | Shell and edit filter for the agent; refusals go to `attempts-agent.jsonl`. Defence in depth: QA mode is what keeps the app in its box |
| `scripts/fake-google.cjs` | Gmail, Calendar and OAuth answers from the labelled corpus, with a fault switch |
| `scripts/ollama-faults.cjs` | Fault-injecting proxy in front of the project Ollama |
| `e2e/qa/harness.ts` | Launch on a fresh profile copy, find windows, run QA actions, read the copy's database, start the local servers |
| `e2e/qa/explore.spec.ts` | M1: enumerate, operate, capture, axe and overflow on every screen |
| `e2e/qa/flows.spec.ts` | M2: fifteen flows with database assertions |
| `e2e/qa/mail.spec.ts` | M3: labelled replay scored with `eval/score.ts`; your real mail, incremental and from scratch |
| `e2e/qa/perf.spec.ts` | M4: cold start, panel, Quick Capture, chat, memory |
| `e2e/qa/faults.spec.ts` | M5: Ollama and Google faults, helper faults, a corrupt config |
| `e2e/qa/soak.spec.ts` | M8: `QA_SOAK_MIN` minutes (default 60) with syncs and panel use |
| `scripts/qa-verify.cjs` + `./dev npm run qa:verify` | The morning checks |
| `./dev npm run qa:build` | The packaged app for T2, built into `.local/qa/build/` |

`./dev npm run qa:missions` builds and runs every mission against the active
run; outside a run the QA specs skip. `QA_TARGET=packaged` points them at T2;
`QA_PROFILES`, `QA_THEMES`, `QA_SCREENS` and `QA_STEP_CAP` narrow M1.

Limits worth knowing when reading a report:

- The fake helper stands in for the Swift one, so Apple's on-device model,
  EventKit and live speech aren't exercised; extraction runs on Ollama.
- The fake Google returns every corpus message regardless of `newer_than`;
  messages are moved by whole weeks so weekdays in the text still hold.
- The labelled corpus is the 14-message seed set; the Enron set needs
  `eval:prepare`, which downloads it.
- The soak defaults to an hour, not six to eight.
- M1 sees onboarding's first step only; F12 in M2 walks all six. QA mode
  creates no tray, so the tray menu isn't covered.

## 11. Readiness

- [x] App state follows `AMBIENTMIND_DATA_DIR`, and `./dev` keeps it in the repo (`electron/isolation.ts`).
- [x] Model calls logged with engine, latency, failures and fallbacks; `ai:budget` gives p50/p95.
- [x] Off-device requests logged (`network.jsonl`); crash log; decisions table.
- [x] Fake Swift helper with normal, mute and crash modes (`eval/fixtures/fake-helper.cjs`).
- [x] Playwright Electron tests (`e2e/`), idle measurement, gallery screenshots, axe on 20 screens.
- [x] The isolation rule is enforced for agents by the hook, not just worded.
- [x] Every outside-world call in the main process is recorded instead of made in QA mode.
- [x] Cleanup is written to a file, never run.
- [x] A local stand-in for Google, and a read-only filter for the real one.
- [x] UI latency timings (M4).
- [ ] Real Windows can't be tested from this Mac.
