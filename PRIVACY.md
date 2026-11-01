# AmbientMind privacy policy

Effective 1 November 2026. Applies to AmbientMind 0.2 and later, on macOS and Windows.

## The short version

- AmbientMind runs on your computer. There is no AmbientMind server and no account, so the publisher never receives your mail, tasks, voice or anything else about you.
- It reads Gmail and Google Calendar straight from Google with your sign-in to find things you need to do. On a Mac it can also use Apple Calendar, Reminders and your own contact card.
- The AI that reads them runs on your computer: Ollama, or on a Mac also Apple's on-device model. Nothing is used to train any model.
- No analytics, no advertising, no tracking, no cookies, and nothing is sold or shared.
- Everything it keeps is on your computer. You can see it, export it, forget part of it or erase all of it from Settings → Your data.

## Who is responsible

AmbientMind is free, open-source software (MIT licence) published by Suraj Singh Shekhawat. Because the app has no server, the publisher holds no personal data about you; your data is under your control on your own computer.

Questions, requests or complaints: open an issue at https://github.com/surajsinghshekhawat/AmbientMind/issues. Please don't paste personal data into a public issue; say you have a privacy question and we will arrange a private channel.

## What AmbientMind reads, and why

| Source | What it reads | Why | Needs |
| --- | --- | --- | --- |
| Gmail | New messages from the last two days: sender, subject, body, labels | To find requests, deadlines and commitments and turn them into tasks | Your Google sign-in (`gmail.readonly`) |
| Google Calendar | Your upcoming events | To show what is coming up, warn about clashes and suggest preparation tasks | Your Google sign-in (`calendar.readonly`) |
| Google Calendar (optional) | Writes recurring tasks to a separate "AmbientMind" calendar it creates | Only if you turn on calendar write-back | `calendar.app.created`, which cannot see or change your other calendars |
| Apple Calendar (Mac only) | Upcoming events | As for Google Calendar | macOS Calendars permission |
| Apple Reminders (Mac only) | Your reminders lists, read and write | To keep tasks and Reminders in step | macOS Reminders permission |
| Your name | On a Mac, your own contact card (name and email addresses); on Windows, your Windows user name (or the name you give it in Settings) | So it knows which mail is from you and addressed to you | macOS Contacts permission; nothing on Windows |
| Microphone | Audio, only while you hold or toggle voice capture | To turn what you say into a task | Microphone permission (macOS, or Windows Settings → Privacy & security → Microphone) |
| Screen | Text in the front window, only when you ask it to read the screen, and only if you turned screen reading on (off by default) | To make a task from what is in front of you | macOS Screen Recording and Accessibility permissions; nothing extra on Windows |
| What you type | Tasks, chat messages, notes about yourself in Settings | To do what you ask | Nothing |

Every permission is optional. Turn any of them off and the rest of the app keeps working.

## What stays on your computer, and for how long

Everything below is in AmbientMind's data folder (Settings → About → Data folder): on a Mac `~/Library/Application Support/AmbientMind`, with the crash log in `~/Library/Logs/AmbientMind`; on Windows `%APPDATA%\AmbientMind`, with the crash log in its `logs` folder.

| What | Kept |
| --- | --- |
| Your tasks, including, for tasks found in mail, the subject and up to the first 2,000 characters of the message | Until you delete the task |
| A marker for a deleted task (its source and message id, no text), so the same mail doesn't bring it back | 90 days |
| Ids of mail already read (no text) | 90 days |
| Examples that guide the AI: short mail excerpts and the tasks you kept from them | The newest 2,000 |
| Which suggestions you accepted or dismissed | The newest 5,000 |
| Recurring-task rules | Until you delete them |
| Chat | The last 40 messages |
| AI call log: which model, when, how long and how many characters, never what was asked | About 1 MB, oldest trimmed first |
| Network log: time, method, host, a path with ids masked, and status, never what was sent | About 1 MB, oldest trimmed first |
| Crash log | Until you delete it. It is never sent anywhere |
| Settings | Until you change them |
| Google sign-in token, encrypted with a key held by the system (the login Keychain on a Mac, your Windows account's data protection on Windows) | Until you disconnect Google |
| Downloaded speech and text-recognition models | Until you delete the data folder |

Not kept at all:

- **Audio.** It is turned into text and discarded.
- **Screenshots and screen text.** Only the one-line summary the AI writes is saved, with the task it made.
- **Mail with nothing to do in it.** Only its id is recorded, for 90 days.

Encrypted backups are saved wherever you choose. They are encrypted with AES-256-GCM using a key derived from your passphrase (scrypt). Without the passphrase nobody, including the publisher, can open them.

## What leaves your computer

AmbientMind logs every request it makes to another machine. Settings → Privacy → "What leaves this Mac" ("this PC" on Windows) shows the log.

- **Google** (`gmail.googleapis.com`, `www.googleapis.com`, `oauth2.googleapis.com`): reading mail and calendars, refreshing the sign-in, and, if you turned it on, writing recurring tasks to the AmbientMind calendar. This goes directly between your computer and Google. You sign in on Google's own page in your browser; AmbientMind never sees your password.
- **Hugging Face** (`huggingface.co`) and **jsDelivr** (`cdn.jsdelivr.net`): one-time downloads of the Whisper speech model and Tesseract text-recognition data, the first time voice or screen reading needs them. Only the file is requested. As with any download, those sites see your IP address.
- **Apple** (Mac only): macOS downloads its own speech model for on-device dictation. That is between macOS and Apple and is not in AmbientMind's log. On Windows, voice always uses Whisper.

Nothing else. There are no analytics, crash-reporting, advertising or tracking services in the app, and it sets no cookies.

## AI

- **It runs locally.** Mail, screen text and chat are read by Ollama on your computer, or on a Mac by Apple's on-device model. No prompt is sent to a cloud AI service. AmbientMind only talks to Ollama at a loopback address on your own computer (`127.0.0.1` or `::1`), and refuses any other address.
- **No training.** Nothing you do in AmbientMind is used to train or improve any AI model, the publisher's or anyone else's. Examples of tasks you kept are stored on your computer and shown to your local model as hints. That is not training, and you can see and clear them in Settings → Your data.
- **It can be wrong.** Tasks the AI found are marked as such, with the quoted line they came from, and those it is unsure about wait for your OK. Check anything that matters.

## Google user data

AmbientMind's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Specifically:

- Gmail and Calendar data is used only to provide AmbientMind's features: finding tasks, showing your schedule, and warning about clashes.
- It is not transferred to anyone. It goes from Google to your computer and stays there.
- It is not used for advertising, and is not sold.
- No person reads it. It is processed by software on your own computer.
- It is not used to train AI models.

You can remove AmbientMind's access in Settings → Sources → Disconnect, which revokes the token with Google. You can also remove it at https://myaccount.google.com/permissions.

## Your controls and rights

All of these work in the app, with no request to anyone:

- **See it.** Settings → Your data counts everything stored, by source.
- **Export it.** Settings → Your data → Export saves everything as JSON (never the sign-in token).
- **Correct it.** Edit any task. Change what it knows about you in Settings → General.
- **Forget part of it.** Forget every task from one source (Gmail, Google or Apple Calendar, voice, screen, chat or typed), or everything before a date. Your Apple Reminders stay yours: turn the source off in Settings → Sources instead. Clear chat, the AI call log and the network log.
- **Stop it.** Pause AI for an hour, until tomorrow or until you resume. Turn off any source or permission.
- **Delete all of it.** Settings → Your data → Erase everything disconnects Google, deletes everything listed above and restarts AmbientMind as new. To remove the app too, erase first, then delete it. Your Reminders, your calendars, events already in your Google AmbientMind calendar, and backups you saved are yours and are not touched. (The Google client file you set up is kept so you can reconnect. On a Mac, the "AmbientMind Safe Storage" item stays in your Keychain until you delete it in Keychain Access. It holds only the key that encrypted the sign-in token, nothing about you.)

Depending on where you live, laws such as the GDPR (EU/UK), the CCPA (California) or India's Digital Personal Data Protection Act give you rights over personal data. Because the publisher holds none of yours, the controls above are how you exercise them. If you think something is wrong, contact us as described above. You can also complain to your local data-protection authority.

## Security

- The Google token is encrypted with a key held by the system: the macOS Keychain, or Windows data protection tied to your account.
- Backups are encrypted with your passphrase.
- AmbientMind's windows can be hidden from screen sharing and screenshots (Settings → Privacy).
- Your data folder is protected by your computer's user account, so keep your computer locked and disk encryption on (FileVault on a Mac, BitLocker or device encryption on Windows).

## Children

AmbientMind is not directed at children under 13 (or the minimum age for digital consent where you live). It does not knowingly process children's data.

## If you measure accuracy on your mail

Settings → AI & Models → "Measure accuracy on your mail" writes recent mail and the AI's draft tasks to a file in your data folder, so you can check its answers against your own mail. It runs only when you click it. The file stays on your computer until you delete it.

## Changes

If this policy changes, the new version will be published in the repository with a new effective date, and listed in the release notes of the version it applies to. AmbientMind will never start sending your data anywhere new without a release that says so.
