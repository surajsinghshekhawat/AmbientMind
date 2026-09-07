# Connecting Google (Gmail + Calendar)

AmbientMind talks to Google directly from your machine, so you need your own
OAuth client. This takes about ten minutes and costs nothing.

## 1. Create a project and enable the APIs

1. Open <https://console.cloud.google.com/> and create a project (any name).
2. Under **APIs & Services → Library**, enable:
   - **Gmail API**
   - **Google Calendar API**

## 2. Configure the consent screen

1. **APIs & Services → OAuth consent screen**, user type **External**.
2. Fill in the app name and your own email for the support and developer fields.
3. On the **Scopes** step add:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/calendar.readonly`
4. On the **Test users** step, **add your own Google account**. This is the step
   people miss; without it the consent screen will refuse to complete.

Both scopes are classed *sensitive*, not *restricted*, so no CASA security
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

- Windows: `%APPDATA%\ambientmind\google-credentials.json`
- macOS: `~/Library/Application Support/ambientmind/google-credentials.json`

The file Google gives you works as-is; it does not need editing.

For development you can instead set `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` as environment variables, which take precedence.

> The client secret in a desktop OAuth app is not really a secret — Google
> treats it as an identifier and expects it to ship inside the application.
> The actual protection comes from PKCE, which AmbientMind uses.

## 5. Connect

Tray icon → **Connect Google account…**. Your browser opens, you grant access,
and the tab tells you when it is done. Tokens are encrypted with the OS keystore
(DPAPI on Windows, Keychain on macOS) and written to `secrets.json` in the same
app data folder.

## What AmbientMind reads

- **Gmail**: messages from the last two days, excluding chats and the promotions
  category. Bulk mail is discarded on headers (`List-Unsubscribe`,
  `Precedence: bulk`, no-reply senders) before any model call. Quoted reply
  history is trimmed off. Access is read-only; nothing is ever sent or modified.
- **Calendar**: the next seven days from your primary calendar, pulled
  incrementally with a sync token.

Message bodies are sent only to Ollama on `localhost`. Nothing leaves the
machine.
