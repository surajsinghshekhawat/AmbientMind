# Connecting Google (Gmail + Calendar)

AmbientMind talks to Google directly from your machine, so you need your own
OAuth client. This takes about ten minutes and costs nothing.

## 1. Create a project and enable the APIs

1. Open <https://console.cloud.google.com/> and create a project (any name).
2. Under **APIs & Services → Library**, enable:
   - **Gmail API**
   - **Google Calendar API**

## 2. Configure the consent screen

1. **APIs & Services → OAuth consent screen** (now called **Google Auth
   Platform → Branding / Audience / Data access**), user type **External**.
2. Fill in the app name and your own email for the support and developer fields.
3. Under **Data access** (the old **Scopes** step) add:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.app.created`: only needed for
     recurring rules on Google Calendar (below). It reaches only calendars
     AmbientMind creates, never your own.
4. Under **Audience → Test users**, **add your own Google account**. This is
   the step people miss; without it the consent screen refuses to complete.

All three scopes are classed *sensitive*, not *restricted*, so no CASA security
assessment is needed. Leaving the app unverified is fine for personal use: the
limit is 100 test users, and you will see an "unverified app" interstitial that
you can click through via **Advanced → Go to AmbientMind**. Verification (4–6
weeks) is only required to publish to strangers.

## 3. Create the OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**.
3. Download the JSON.

No redirect URI configuration is needed. Desktop clients are allowed to use
loopback redirects, and AmbientMind starts a short-lived listener on a random
`127.0.0.1` port for each sign-in.

## 4. Install the credentials

Save the downloaded file as `google-credentials.json` in the app data folder:

| How you run it | Folder |
| --- | --- |
| From the repo (`./dev npm run dev`, `./dev packaged`) | `.local/data/` in the repo |
| Installed on a Mac | `~/Library/Application Support/AmbientMind/` |
| Installed on Windows | `%APPDATA%\AmbientMind\` |

Settings → Your data → **Show in Finder** (**Show in Explorer**) opens the right folder. The file Google gives
you works as-is; it does not need editing.

For development you can instead set `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` as environment variables, which take precedence. Release
builds (`npm run dist:release`) ignore them and only read the file.

> The client secret in a desktop OAuth app is not really a secret — Google
> treats it as an identifier and expects it to ship inside the application.
> The actual protection comes from PKCE, which AmbientMind uses.

## 5. Connect

Settings → **Sources** → **Connect** (or onboarding's Sources step). Your
browser opens Google's consent page.

**Tick every box on that page.** Google shows each permission as a separate
checkbox, unticked by default for Gmail and Calendar. If you continue without
ticking them, sign-in succeeds but AmbientMind can't read anything; it now
refuses such a sign-in, revokes it and says "Google signed in without access to
Gmail and Calendar." Disconnect, connect again, and tick both boxes.

Tokens are encrypted with the OS keystore (Keychain on macOS, DPAPI on Windows)
and written to `secrets.json` in the same folder. Runs from the repo use a mock
keychain instead, so nothing is added to your login keychain.

### Recurring rules on Google Calendar

Settings → Sources → **Recurring rules on Google Calendar** writes your
recurring rules as events in a separate "AmbientMind" calendar that the app
creates. Turning it on after you connected may ask you to reconnect once, since
Google doesn't add a scope to an existing grant silently.

## What AmbientMind reads

- **Gmail**: messages from the last two days (`newer_than:2d`), excluding
  chats. Bulk mail is discarded on headers (`List-Unsubscribe`,
  `Precedence: bulk`, no-reply senders) before any model call, and quoted reply
  history is trimmed off. Access is read-only; nothing is ever sent or modified.
- **Calendar**: events in the next 48 hours from your primary calendar. Each
  becomes a "prepare for…" task due an hour before it starts.

Message bodies go to the model on this machine: Apple Intelligence when it's on
and the message fits, otherwise the project's Ollama on `127.0.0.1`. Settings →
Privacy → **What leaves this Mac** lists every request that goes off the
machine; for Google that's only `googleapis.com` and the sign-in pages.
