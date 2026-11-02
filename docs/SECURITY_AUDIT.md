# Security audit, November 2026

A source audit of AmbientMind 0.2 at commit 3ba8802, following Cloudflare's
[security-audit skill](https://github.com/cloudflare/security-audit-skill)
(standard profile, 20-agent budget), and the fixes made in response.

## Scope and limits, first

- **Run status: incomplete.** Coverage is complete: 18 attack-surface units,
  two waves of hunters, a post-wave critic and a final-clean critic that
  returned no missing units. Candidates were checked by fresh verifiers, but in
  groups rather than one verifier per candidate, and the skill's Phase 5
  per-record re-verification did not fit in the budget.
- **Nothing is marked "confirmed".** The skill only allows that after a bounded
  local run inside an OS-enforced sandbox (no network, read-only target,
  resource limits). That was not available, so no target code was executed as
  evidence. Surviving candidates are `needs_validation`.
- In scope: `electron/`, `shared/`, `src/`, the Swift helper, prompts,
  build and signing scripts, `electron-builder.yml`, `package.json`, the lock
  file, `dev` and `.cursor/`.

## Threat model in one paragraph

AmbientMind is a local-first desktop app: no server, no account. The assets
are the Google refresh token, the user's mail, calendar, reminders, contact
card and screen text, and the macOS privacy grants the signed app holds. The
attackers considered are **anyone who can send the user an email or calendar
invite** (prompt injection, parser denial of service), **anyone who can hand
the user a file** (a backup), **web pages and other local users** (loopback
ports, OAuth callback), and **anything able to launch the signed app with a
chosen environment or arguments** (to borrow its Keychain and privacy grants).
A process already running as the same user with full disk access is out of
scope.

## Results

13 candidates survived verification (`needs_validation`), 4 were rejected.

| Finding | Status |
| --- | --- |
| Packaged app loads any `ELECTRON_RENDERER_URL` into privileged windows | Fixed |
| Packaged app spawns any executable named by `AMBIENTMIND_HELPER` | Fixed in release builds |
| Packaged app honours `--sync-now` / `--export-corpus` with the Google token | Fixed in release builds |
| QA mode can be switched on by environment in packaged builds | Fixed in release builds |
| Electron fuses left at defaults (RunAsNode, NODE_OPTIONS, inspect) | Fixed in release builds |
| Ollama endpoint overridable to any host; mail and screen text sent there | Mitigated |
| Chat could act on tasks the user never mentioned (prompt injection) | Fixed |
| Unreviewed extractions replayed as few-shot examples | Fixed |
| Backup restore accepts arbitrary triggers and views | Fixed |
| Calendar write-back adopts any owner-role calendar by name | Fixed |
| Quadratic HTML stripping of incoming mail | Fixed |
| Derived data stored in plaintext in the data folder | Accepted, documented |
| Reminders adopts any list named "AmbientMind" | Accepted, documented |

"Release builds" means `./dev npm run dist:release`. Builds made through `./dev`
for development and QA keep the developer overrides on purpose, because the
packaged QA harness and `./dev packaged` depend on them. See
[SECURITY.md](../SECURITY.md#release-builds-and-development-builds).

## What changed

**Build profiles.** `electron/devHooks.ts` decides, at build time, whether
environment overrides (data folder, helper path, QA mode, Google client) and
the headless CLI commands exist. They do for unpackaged runs and `./dev`
builds, and not for release builds or builds made outside `./dev`. The dev
server URL is never read by a packaged app. `scripts/release.cjs` builds with
`AMBIENTMIND_RELEASE=1` into `.local/release-public/`, and the afterPack hook
sets the Electron fuses before signing: no RunAsNode, no `NODE_OPTIONS`, no
`--inspect`, embedded asar integrity validation, and app code only from the
asar.

**Mail and prompt injection.**
- Chat changes (done, delete, snooze, move) only apply to a task the user's own
  words, or the reply they are answering, point at. Suggested tasks, whose
  titles come straight from mail, are shown but can't be targeted.
- Few-shot examples are replayed only if they are seeds or the user rated
  them, and a message can no longer close its example block.
- HTML mail is stripped in one linear pass with an input cap.

**Files from elsewhere.**
- Restore compares the backup's schema with what the app's own migrations
  produce at that version, and refuses extra or rewritten triggers and views.
- Every connection runs with `trusted_schema = OFF`.
- A task's "Open in…" link only opens allow-listed https hosts.

**Network and origin checks.**
- Ollama defaults to `127.0.0.1` and accepts overrides only to a loopback IP
  over http.
- `isLoopback` parses addresses instead of matching a `127.` prefix.
- `file:` navigation is limited to the bundled renderer folder.
- A forged OAuth callback with the wrong `state` is ignored rather than
  cancelling the sign-in.
- Calendar and message ids are URL-encoded, and only a calendar the account
  itself owns is written to.

**Supply chain.** The rcodesign download is checked against a pinned SHA-256
instead of a checksum from the same server.

Every fix has a regression test; `./dev npm test` runs 330 logic, 50 database
and 79 UI tests.

## Still open

- **Data at rest.** The SQLite database, logs and caches are plaintext in the
  user's data folder. Protection is the OS account plus FileVault or
  BitLocker. The Google token is encrypted with the OS keystore.
- **Reminders list adoption.** The helper adopts an existing list by title. A
  list named "AmbientMind" shared from another Apple ID would receive tasks.
  It needs an EventKit source check.
- **Local port squatting.** Another process of the same user can start a fake
  Ollama on the loopback port first.
- **IPC sender checks.** Handlers trust any frame of the app's own windows.
  Navigation is locked to app pages and no remote content is loaded, so this
  is defence in depth only.
- **Distribution signing.** Mac builds are signed with a local self-signed
  identity, not an Apple Developer ID, and are not notarised. Windows builds
  are unsigned.

## Git history

A scan of the full history for keys, tokens, private keys and credential files
found none. Personal data in the working tree (a mail handle, a real sender
and subject in a test, a description of real mail) was replaced with generic
text. Older commits still contain those strings.
