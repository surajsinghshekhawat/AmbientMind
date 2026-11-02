# Security

## Reporting a vulnerability

Please report it privately through GitHub:
[Report a vulnerability](https://github.com/surajsinghshekhawat/AmbientMind/security/advisories/new).
Don't open a public issue for anything that could hurt users before a fix is
out.

Include the version, the platform (macOS or Windows), what an attacker needs
(send an email, hand over a file, run a local program), and the steps. You can
expect a reply within a week. AmbientMind is maintained by one person, so
please allow reasonable time for a fix.

## Supported versions

Only the latest release gets security fixes.

## What AmbientMind protects

AmbientMind is local-first: no AmbientMind server, no account, no analytics.

| Asset | Where it lives | Protection |
| --- | --- | --- |
| Google refresh token | `secrets.json` in the data folder | Encrypted with the OS keystore (Keychain, DPAPI) |
| Tasks, read mail text, chat, learned examples | `ambientmind.db` (SQLite) in the data folder | Your OS account, plus FileVault or BitLocker |
| macOS privacy grants (Calendar, Reminders, mic, screen) | Held by the signed app | Release builds lock the Electron fuses that would let another program run as the app |
| Mail and screen text sent to a model | Ollama at `127.0.0.1`, or Apple's on-device model | Only loopback IP addresses are accepted |

The data folder is `~/Library/Application Support/AmbientMind/` on macOS and
`%APPDATA%\AmbientMind\` on Windows.

## Threats designed for

- **Email and calendar invites are untrusted.** Their text can carry
  instructions aimed at the model. The model's output is a fixed set of
  actions checked by code:
  - chat only changes tasks the user named;
  - suggestions from mail can't be acted on through chat;
  - nothing a stranger sends becomes a few-shot example unless the user acts
    on it.
- **Backups are untrusted files.** A restore is decrypted, integrity-checked
  and compared with the schema the app itself would create; anything extra is
  refused.
- **Web pages can reach loopback ports.** The OAuth callback listens on a
  random port, checks `state` and PKCE, and ignores anything else.
- **Windows only show the app's own pages.** All windows are sandboxed, run
  with context isolation and a strict Content Security Policy, and can only
  navigate to bundled files. Links open in the browser.

Out of scope: malware already running as your user, and someone with your
unlocked account.

## Release builds and development builds

| | Development (`./dev …`) | Release (`./dev npm run dist:release`) |
| --- | --- | --- |
| Environment overrides (`AMBIENTMIND_DATA_DIR`, `AMBIENTMIND_HELPER`, QA mode, Google client) | Honoured | Compiled out |
| `--sync-now`, `--export-corpus` | Available | Compiled out |
| Electron fuses (RunAsNode, `NODE_OPTIONS`, `--inspect`) | Left on, for Playwright | Off; asar integrity on |
| Output folder | `release/`, `.local/qa/build/` | `.local/release-public/` |

Only distribute release builds. A development build trusts its launch
environment, which is what lets the QA harness drive it.

## Known limitations

- The database is not encrypted beyond your disk encryption.
- On a Mac, an existing Reminders list named "AmbientMind" is adopted by
  title, even if it is shared from another Apple ID.
- Mac builds are signed with a local identity, not an Apple Developer ID, and
  are not notarised; Windows builds are unsigned.

The latest audit, with every finding and its status, is in
[docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).
