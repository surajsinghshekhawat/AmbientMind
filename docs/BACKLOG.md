# AmbientMind — Problems, remaining work, and what to do next

A working document: everything currently wrong or missing, tiered by how much
it matters, followed by a sequenced plan. `docs/SYSTEM.md` explains how the
system works and why; this file is the list of what is left and what to do
about it.

Compiled 16 September 2026 against commit `b136530`, from a live audit rather
than from memory. Every claim below has evidence attached.

> **Update — Wave 1 and Wave 2 are done.** P1-1 through P1-5 and P2-6 are
> implemented, tested and verified against the live database; see §7 for what
> shipped and what the verification actually showed. P1-6 remains blocked on
> usage. P0-1 and P0-2 are untouched and are now the whole of the critical
> path.

---

## 1. Verified snapshot

Measured just now, not recalled:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Clean, zero errors |
| `npm test` | **85 / 85 passing** |
| `TODO` / `FIXME` / `@ts-ignore` markers | **None** in `electron/`, `src/`, `shared/`, `prompts/` |
| Working tree | Clean |
| Schema version | `user_version = 9`, all migrations applied |
| Live database | 3.3 MB — 15 tasks, 54 examples, 74 processed messages, 2 sync states |
| Built installer | `release/AmbientMind Setup 0.2.0.exe`, 158.4 MB |
| Ollama | **Not running at time of audit** |

**The headline: nothing is broken.** There is no failing test, no type error, no
uncommitted work and no accumulated `TODO` debt. Every problem in this document
is either a *latent* issue that will bite later, a *missing* capability, or a
*deliberate* limitation. That is a genuinely good position to be starting a
backlog from, and it means none of the work below is cleanup.

Ollama being down is not a defect — it is the exact condition the health check
(§7.3 of `SYSTEM.md`) was built to explain. Worth starting before any demo.

---

## 2. What is healthy — do not spend time here

Recording this so effort does not get sunk into things that are already done or
already verified.

- **Sync robustness.** Message retry with an attempts counter, early abort when
  Ollama disappears mid-pass, and `powerMonitor` resume handling are all
  implemented and covered by tests.
- **Migrations.** Nine applied cleanly, including the tricky table rebuild in
  005. `npm run check:migration` rehearses against a copy of the live database.
- **Determinism.** Recurrence parsing, clash resolution, deduplication, deadline
  normalisation, decision matching and snooze arithmetic are plain code with
  unit tests, not model calls.
- **Packaging.** The installer builds, native modules are correctly unpacked
  from the asar, launch-at-login works.
- **Two things already checked and found correct**, so they should not be
  re-investigated: Ollama calls carry bounded timeouts, and the overlay
  repositions on display add/remove/metrics-changed.

---

## 3. Problems

Tiered by consequence, not by effort.

### P0 — Blocks real use by anyone other than you

**P0-1 · The installer is unsigned.**
*Evidence:* `release/AmbientMind Setup 0.2.0.exe` exists and is unsigned.
*Impact:* Windows SmartScreen shows "Windows protected your PC" on first run.
Most non-technical users stop there. This is the single thing standing between
"it installs" and "it installs without frightening someone".
*Fix:* An OV code-signing certificate (roughly $200–400/year, and it needs
organisational identity verification), or an EV certificate for immediate
SmartScreen reputation at higher cost. Then wire signing into
`electron-builder.yml`.
*Effort:* Hours of work, weeks of waiting on certificate issuance. **Start the
paperwork early — the lead time, not the labour, is the bottleneck.**

**P0-2 · There is no update path.**
*Evidence:* No `electron-updater` dependency; nothing in `electron-builder.yml`
publishes an update feed.
*Impact:* Anyone who installs 0.2.0 stays on 0.2.0 forever. Every fix in this
document is undeliverable to an installed copy. This compounds: the longer it
is unaddressed, the more installed copies are stranded.
*Fix:* `electron-updater` against a GitHub Releases feed is the conventional
route. Note it wants signed builds to be meaningful, so it is naturally
sequenced after P0-1.
*Effort:* 1–2 days.

### P1 — Correctness, data and quality

**P1-1 · Nothing is ever pruned. No retention policy exists anywhere.**
*Evidence:* A search for `DELETE FROM` across all services returns only
targeted deletes — a single decision subject, rule cleanup, one task, and the
force-resync window. **`examples`, `example_vectors`, `processed_messages` and
`decisions` have no expiry at all.** Currently 54 examples and 74 processed
messages.
*Impact:* Two distinct problems from one cause. First, unbounded growth: at ~30
messages a day this reaches roughly 11,000 examples a year, each carrying a
768-float vector at 3 KB, so tens of MB of vectors plus every mail body.
Second, and worse, **`sqlite-vec` scans every stored vector on every query**
(§3.4 of `SYSTEM.md`). Retrieval is brute force, so sync latency grows linearly
and without limit. The design is correct at hundreds of rows and degrades
silently past that.
*Fix:* A retention sweep beside the existing archive sweep. Cap `examples` at a
few thousand, evicting oldest-unrated first and keeping anything rated. Expire
`processed_messages` well past the retry window. Keep `decisions` — they are
small and are the fine-tuning corpus (§12.7 of `SYSTEM.md`) — but bound them
too.
*Effort:* 1 day including a migration and tests.

**P1-2 · Full email bodies are stored indefinitely in plaintext.**
*Evidence:* `embeddingText()` in `sync.ts` builds `Subject / From / body` and
`storeExample()` writes it to `examples.message`. `safeStorage` encrypts
`secrets.json` only — **the database itself is not encrypted**, and combined
with P1-1 nothing ever removes the bodies.
*Impact:* An app whose founding premise is privacy keeps a growing, unencrypted
archive of the user's mail at a predictable path. Anyone with read access to
the profile can read it. This is defensible as a design choice but is currently
neither chosen deliberately nor disclosed to the user.
*Fix:* Pick one and document it. Store a truncated or redacted body rather than
the full text; or encrypt the column; or state it plainly in the privacy copy
planned for Phase F. Combined with a retention policy, truncation is probably
the right trade — retrieval quality depends far more on the opening of a
message than on its tail.
*Effort:* Half a day for truncation, more for encryption.

**P1-3 · The RAG feedback loop is scaffolded but not wired.**
*Evidence:* `setFeedback()` in `vectorStore.ts` is **defined and never called
anywhere**. Migration 002 has a `feedback` column, a `CHECK` constraint, a
dedicated index, and a comment explaining that negative examples are retrieved
deliberately because showing the model what *not* to extract is as useful as
showing what to.
*Impact:* Bad extractions get stored as few-shot examples and influence later
prompts with no way to correct them — the "poisoning" risk named in §8.4 of
`SYSTEM.md`. The infrastructure to fix it already exists and is inert.
*Fix:* Wire a thumbs-down on a task back to the example that produced it. The
storage layer needs nothing; this is a link from task to example plus a UI
affordance.
*Effort:* 1 day. **Best value-per-hour on this list**, because the hard part is
already built.

**P1-4 · Gmail sync silently truncates.**
*Evidence:* The API caps `listRecentMessageIds` at 50 per call and there is no
pagination.
*Impact:* On a busy day, mail past the 50th is never seen — and because the
window is `newer_than:2d`, it ages out rather than being picked up later. The
failure is *silent*, which puts it in the same category as the bugs in §9 of
`SYSTEM.md` that were worth fixing precisely because nothing surfaced them.
*Fix:* Follow `nextPageToken`, bounded by the existing extraction budget.
*Effort:* Half a day.

**P1-5 · Embeddings are sent without nomic-embed's task prefixes.**
*Evidence:* `embed()` in `ollama.ts` posts raw text. nomic-embed v1.5 expects
`search_document:` for stored passages and `search_query:` for lookups.
*Impact:* Usage is symmetric, so retrieval still ranks sensibly, but the model
runs outside its trained input distribution and the document/query geometry it
learned goes unused. Bounded quality loss, cheap fix. Full explanation in
§17.5 of `SYSTEM.md`.
*Fix:* Add the prefixes, then **re-embed the existing 54 examples**, since old
and new vectors would otherwise occupy slightly different spaces. Measure
before and after on the eval harness rather than assuming improvement.
*Effort:* Half a day including a backfill.

**P1-6 · Extraction quality is effectively unmeasured.**
*Evidence:* `eval/corpus/seed.jsonl` holds 14 hand-written messages in Enron
house style carrying 7 gold tasks. `enron-200.jsonl` was tooled but never
built. One flipped judgement moves F1 by roughly 12 points.
*Impact:* Every accuracy number in `SYSTEM.md` rests on a corpus too small to
support it. Worse, §10.2 established the user's own inbox contains almost no
task mail, so the usual fix — label your own data — is unavailable.
*Fix:* This is genuinely hard and should **not** be brute-forced. The honest
route is the decisions table (§12.7 of `SYSTEM.md`): completions and deletions
are implicit labels accumulating during normal use. Build the exporter when
there are a few hundred.
*Effort:* Blocked on usage, not on engineering.

### P2 — Architectural and operational

**P2-1 · Extraction and chat share one model.** `config.ollamaModel` serves
both. Two 2 GB models will not fit on a 4 GB card, and swapping per call costs
a multi-second load. Consequence: any future fine-tune must preserve
conversational ability, and `eval/chatActions.ts` becomes a mandatory
regression gate. Documented in §12.6 of `SYSTEM.md`; no action needed now, but
it constrains later choices.

**P2-2 · Chat has no transcript memory between windows.** Closing the panel
forgets the conversation. It does see relevant past *decisions*, so this is a
missing transcript rather than missing history. Moderate effort, moderate
payoff.

**P2-3 · No sync bus, therefore no mobile.** Calendar write-back carries
recurring rules to a phone one-way. One-off tasks, and completing something on
the phone, both need a real bus. **This decision gates the entire mobile
phase** and has not been made.

**P2-4 · Foreground-window capture is blocked.** Electron cannot identify the
foreground window and `desktopCapturer` returns window sources in no documented
order. Needs a native Win32 call. Whole-desktop OCR can pick the wrong window
on a busy screen.

**P2-5 · Thirteen catch blocks discard the error.** Found in `chat.ts`,
`config.ts`, `corpusExport.ts`, `googleAuth.ts` (×3), `health.ts`, `ollama.ts`
(×3) and `secrets.ts` (×3). Most look deliberate — health probes and optional
parses where failure genuinely means "not available". But §9 of `SYSTEM.md`
records three expensive bugs whose common property was **silence**, so this
pattern deserves one deliberate pass to confirm each case is intentional and to
add a debug log where it is not.

**P2-6 · Packaging has two known traps**, both documented in §10.3 of
`SYSTEM.md` and neither automated: `sharp` fails to rebuild with `EPERM` if the
app is running during `npm run dist`, and every new native dependency must be
added to `asarUnpack` by hand or it will fail only in the packaged build. A
preflight check in the `dist` script would remove the first entirely.

**P2-7 · `secrets.json` is bound to the OS user.** By design — DPAPI — but it
means no backup or profile migration without reconnecting Google. Acceptable;
should be in the privacy copy so it is not a surprise.

---

## 4. Features not yet built

Split by whether the path is clear.

### Ready to build

| Feature | Notes |
| --- | --- |
| Auto-update | P0-2. Sequenced after signing. |
| Retention sweep | P1-1. Clear design, needs a migration. |
| RAG thumbs-down | P1-3. Storage already exists. |
| Gmail pagination | P1-4. Small and well understood. |
| Embedding prefixes | P1-5. Needs a backfill of 54 rows. |
| Crash UX | Phase F. Currently a crash is silent. |
| Encrypted DB export without tokens | Phase F. Backup story. |
| Privacy copy | Phase F. What is local, what goes to Google, what is retained. Should absorb P1-2 and P2-7. |
| "Pause AI for an hour" | Phase F. Cheap, and the kind of control that builds trust. |
| Start-at-login reboot test | Phase F. Implemented, never verified across an actual reboot. |

### Blocked on a decision, not on effort

| Feature | Blocked by |
| --- | --- |
| Mobile app | P2-3 — no sync bus chosen |
| Fine-tuning | Labelled data (§12 of `SYSTEM.md`) |
| Foreground-window capture | P2-4 — needs native Win32 |
| Chat transcript memory | Scope question: how much history, and where stored |

### Deliberately deferred

Outlook and Teams (Graph admin consent), OS notification scraping (no clean
API, and it looks like spyware), wake word (paid or limited; the shortcut
works), macOS (after Windows is solid). Reasons in §11.3 of `SYSTEM.md`.

---

## 5. What to do

Four waves. The ordering is deliberate and the reasoning matters more than the
list.

### Wave 1 — Start the clock on signing, then fix silent data problems

**Do first, today: begin the code-signing certificate application (P0-1).** Not
because it is the most valuable work, but because it is the only item whose
delay is external. Everything else on this list can be done while waiting;
nothing shortens a certificate authority's verification queue. Starting it
later delays shipping by exactly however long you waited.

Then, while that is in flight, fix the three problems that lose or degrade data
without saying anything:

1. **Retention sweep (P1-1)** — the only unbounded growth in the system, and it
   degrades sync latency silently.
2. **Gmail pagination (P1-4)** — half a day, and it is the same class of silent
   loss as the retry bug that turned out to be eating real personal mail.
3. **Body truncation plus a decision on P1-2** — naturally the same change as
   the retention work, since both touch what `examples` stores.

*Why this order:* every item is silent, and §9 of `SYSTEM.md` is a record of
three expensive bugs whose shared property was that nothing surfaced them. The
lesson has been learned once already; this is applying it rather than
relearning it.

### Wave 2 — Close the two open quality loops

4. **Wire the RAG thumbs-down (P1-3).** Best value per hour available: the
   schema, the index and the retrieval of negative examples all exist and are
   inert. This closes the last open learning loop in the app — decisions
   already feed back on *tasks*, but nothing feeds back on the stored
   *examples*.
5. **Add embedding prefixes and backfill (P1-5).** Measure on the eval harness
   before and after. If it shows nothing on 14 messages, that is a statement
   about the corpus rather than the change, which is worth knowing explicitly.

### Wave 3 — Ship properly

6. **Signing lands** — wire it into `electron-builder.yml`.
7. **Auto-update (P0-2)**, immediately after, because an update mechanism that
   ships unsigned builds is of limited use.
8. **Phase F hardening:** crash UX, encrypted export, privacy copy absorbing
   P1-2 and P2-7, "pause AI", and an actual reboot test of start-at-login.
9. **A `dist` preflight (P2-6)** that refuses to build while the app is
   running. Ten minutes; removes a trap that has already cost one failed build.

*Why signing does not come first in execution order:* the application starts in
Wave 1 and the wiring is trivial. Putting the *waiting* at the front would idle
the project.

### Wave 4 — Decide before building

10. **Choose the sync bus (P2-3).** This is a decision, not a task, and it
    gates the entire mobile phase. The realistic options — a private encrypted
    relay with real operational cost, versus a LAN-only bridge that dies off
    home Wi-Fi — have very different commitments. **Do not begin mobile work
    before this is settled.**
11. **Build the decisions-to-training-rows exporter** once a few hundred rows
    exist, and measure the *prompted* model against them first. That alone may
    close the accuracy gap for free, and it is the only route to P1-6 that does
    not depend on an inbox that does not contain the necessary mail.

### Explicitly not now

- **Fine-tuning.** Two independent blockers, and the cheap version of the
  experiment already regressed precision. Full argument in §12 of `SYSTEM.md`.
- **Mobile.** Blocked on item 10.
- **Outlook, notifications, wake word, macOS.** See §11.3 of `SYSTEM.md`.
- **Chat transcript memory.** Real, but it is a comfort feature and every P0
  and P1 above outranks it.

---

## 6. The short version

Nothing is broken. The build is clean, the tests pass, and the hardening work
on sync and power events holds up.

**What is actually at risk is data and distribution.** Four problems lose or
degrade something quietly — unbounded growth, unpruned plaintext mail bodies,
silent Gmail truncation, and an inert feedback loop — and two problems mean
nobody else can comfortably install or update the result.

**The single highest-leverage action is the one with a queue in front of it.**
Start the certificate application today; do the silent-data fixes while it
clears.
