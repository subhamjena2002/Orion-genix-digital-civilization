# Accounts

Players can still play as guests, with no sign-up (see [cloud-saves.md](cloud-saves.md)). An
account keeps the save across browsers and devices. Everything runs in the same Worker as the save
API (`worker/auth.ts`), because the site is a static export with no Next server.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Tables, sessions, `/api/auth/me`, sign-out, guest save joining the account | **Done** |
| 2 | Email and password sign-up and sign-in (Turnstile, breach check, rate limits), `/signin` and `/signup` pages, "Sign in" in the landing header | **Done** |
| 3 | Google sign-in (OAuth code flow with PKCE, ID token checked against Google's keys, account linking) | **Done**. Needs the Google Cloud setup below before it shows. |
| 4 | Email confirmation, forgotten password and reset, sign-up that doesn't reveal who has an account (`/verify`, `/forgot`, `/reset`) | **Done**. Needs the email setup below before it's switched on. |
| 5 | `/account` page, in-game prompt, privacy and terms | To do |
| 6 | Signed-in devices, change password, delete account | To do |

Before going live, these need settling:

- **The Workers plan.** On the free plan, a request gets 10 ms of CPU. PBKDF2-SHA256 at 100k
  iterations (the most Workers allows) took about 16 ms in Node on the development laptop, and
  sign-up and sign-in each hash once. Expect to need Workers Paid, or confirm the timing in
  production first.
- **Turnstile** (optional, recommended). Create a widget in the Cloudflare dashboard, then:
  - set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` when building
  - set `TURNSTILE_SECRET` with `npx wrangler secret put TURNSTILE_SECRET`

  Set both or neither: a secret with no site key on the page refuses every sign-in.
- **Google sign-in.** It stays hidden until it's set up (see "Setting up Google sign-in" below).
- **Account emails.** They need a domain you own and a Resend account (see "Setting up email"
  below). Until both are set, sign-up signs in straight away and says when an email is taken,
  and "Forgot password?" says it isn't available.

## Tables (`migrations/0002_accounts.sql`)

- `users`: one row per player. `email` is stored trimmed and lower-cased, and is unique.
  `password_hash` is NULL for an account that only signs in with Google.
- `oauth_accounts`: provider and provider user id (Google's `sub`). The id is the identity, never
  the email.
- `sessions`: the SHA-256 of each session token. Nothing that could be used to sign in as someone.
- `email_tokens`: single-use verification and reset links, stored hashed.
- `user_saves`: the account's save, with the same shape and rules as `guest_saves`.

Deleting a user removes all of their rows (`ON DELETE CASCADE`).

## Sessions

- **The cookie.** `__Host-orion_session` holds a random 256-bit token. It's `HttpOnly; Secure;
  SameSite=Lax; Path=/`. Over plain-http localhost the cookie is `orion_session` without `Secure`.
- **How long it lasts.** A session lasts 30 days from its last use. While the session is in use,
  its expiry and cookie are renewed at most once an hour, which costs one database write an hour
  rather than one per request.
- **New token on sign-in.** Every sign-in gets a new token, and any session the browser already
  had is ended.
- **Bad or old cookies.** A forged, unknown or expired session cookie is cleared, and the browser
  is treated as a guest.

## Guest save → account

`startSession` (which every way of signing in calls once it knows who the player is) moves the
browser's guest save into the account first:

1. **Claim the guest row.** It's taken out with `DELETE … RETURNING`, so only one sign-in can ever
   claim it. Replaying the guest cookie into a second account finds nothing.
2. **Account has no save:** the guest save becomes the account's save.
3. **Account has a save:** the two are merged with `mergeSaves`
   (`src/engine/orion/missions/SaveMerge.ts`), taking a new game as the common base. Both sides
   started from a new game, so:
   - Lists combine (missions passed, flags, weapons, garage).
   - Best times keep the lowest, ratings the highest.
   - Cash, jobs and standing add up what each side earned.
   - The account's revision goes up by one, so another device holding the old revision gets a 409
     and merges.
4. **If joining fails:** the guest row is put back and the sign-in fails, so it can be tried
   again. This happens if the stored save is unreadable, the merge is too large, or the account
   save kept changing for 3 attempts.
5. **Guest cookie.** It's cleared on success.

A guest save that's still a new game is just dropped.

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/auth/me` | `{ user: null }`, or `{ user: { email, emailVerified, displayName, hasPassword, providers } }` |
| POST | `/api/auth/signup` | `{ email, password, displayName?, turnstileToken? }`. With email set up: `202 { checkInbox: true }`, the same whether or not the address has an account (see "Account emails"). Without: creates the account and signs in, `201 { user }`. |
| POST | `/api/auth/signin` | `{ email, password, turnstileToken? }`. Returns `200 { user }`, or `401 invalid_credentials` for any wrong email or password. |
| POST | `/api/auth/signout` | Same origin only. Ends the session and clears the session and guest cookies, so the next `/api/save` starts a new guest. Fine when not signed in. |
| GET/PUT | `/api/save` | Unchanged contract. Uses the account's save when signed in, otherwise the guest's. `owner` is different for an account and a guest. |

Sign-up and sign-in only take JSON from the game's own page (otherwise `403` or `415`). Their
errors:

| Error | Status | Meaning |
|---|---|---|
| `email`, `display_name` | 400 | Not a usable email or player name. |
| `password_too_short`, `password_too_long` | 400 | The password must be 10–128 characters, counted as characters. There are no other rules. |
| `password_breached` | 400 | The password is in Have I Been Pwned's breach list. Only the first five characters of its SHA-1 are sent; if the service is down, sign-up goes ahead. |
| `turnstile` | 400 | The Turnstile check is missing or failed (only once a secret is set). |
| `email_taken` | 409 | Only while email isn't set up: there's already an account with this email. Once email is set up, sign-up never says this; the address gets an email instead. |
| `invalid_credentials` | 401 | No such email, an account with no password, or the wrong password. The answer and the time taken are the same for all three. |
| `try_later` | 429 | Too many attempts (with `retry-after`). The limit is 10 a minute per address and per email (`AUTH_LIMITER`). After 10 wrong passwords in a row, the account takes none for 15 minutes. |

### Passwords (`worker/password.ts`)

- **Hashing.** PBKDF2-SHA256, 100,000 iterations, a 16-byte random salt, stored as
  `pbkdf2-sha256$iterations$salt$hash`.
- **Same password however it's typed.** Passwords are NFKC-normalised first, so the same
  password typed with composed or decomposed accents matches.
- **Comparison.** The hashes are compared in constant time, so timing reveals nothing.
- **Upgrades.** A hash stored at fewer iterations is replaced at the next successful sign-in.

### Pages

- **`/signin` and `/signup`** (`src/components/account/`):
  - The landing page's look, and work at phone width.
  - Labelled fields with the `autocomplete` values password managers look for (`username`,
    `current-password`, `new-password`), plus a show/hide toggle.
  - Errors are announced to screen readers.
  - Turnstile appears when its site key is set.
  - The Google button appears once Google sign-in is set up. Development builds show it greyed
    out, marked "Not set up yet", until then.
  - "Forgot password?" on the sign-in form goes to `/forgot`.
  - After sign-up with email set up, the form shows "Check your inbox" instead of signing in.
  - While signed in with an unconfirmed address, the page offers to send a new link.
- **After signing in** the browser goes to `?return=` (a path on this site only) or `/play`.
  It's a full page load, so the game starts under the account's save.
- **Already signed in:** visiting either page shows who you're signed in as, with Play and
  Sign out.
- **The landing header** shows "Sign in", or the player's name once signed in.
- **Where it works.** Plain `npm run dev` has no API, so the pages say sign-in isn't available
  there. Use `npm run cf:dev` (http://localhost:8787).

## Google sign-in (`worker/google.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/auth/options` | `{ google }`: whether the button is shown. It's true once both Google settings are set. |
| GET | `/api/auth/google/start?return=/play` | `303` to Google's account chooser. Sets a 10-minute HttpOnly `__Host-orion_oauth` cookie holding the state, nonce and PKCE verifier. |
| GET | `/api/auth/google/callback` | Where Google sends the player back. Signs them in and goes `303` to `return`. If it didn't work, goes back to `/signin?error=…` instead. |

**What's checked:**
- **The callback.** Its `state` must match the cookie. A forged callback, a replayed callback,
  or a missing cookie gets `google_failed`.
- **The code exchange.** The code is exchanged with Google directly, using the client secret and
  the PKCE verifier.
- **The ID token.**
  - Its RS256 signature is checked against Google's published keys. The keys are cached as long
    as Google says, and looked up again for an unknown key id at most once a minute.
  - `iss` must be Google, `aud` must be our client id.
  - `exp` and `iat` are checked, allowing 60 s for clock differences.
  - The `nonce` must match this sign-in.
  - Google must have verified the email (otherwise `google_unverified`).
- **`return`** must be a path on this site, otherwise it's `/play`.

**Which account it signs into:** Google's `sub` (their account id) decides, never the email.

| What's found | What happens |
|---|---|
| This Google account is already linked | Signs into that account, even if the email has changed at Google. |
| An account with this email, email confirmed | Linked; its password still works. |
| An account with this email, email **not** confirmed | Linked, but its password is removed and its sessions are ended. |
| Nothing | A new account, email confirmed, named after the Google profile. |

**Why the unconfirmed case removes the password.** Anyone can sign up with an address they
don't own. Google proves who owns it, and the password proves nothing. A player who confirms
their address (or resets their password) first keeps the password when linking Google. Players
who signed up before email was set up have unconfirmed addresses until they do.

**Errors shown on `/signin`:**

| Error | Meaning |
|---|---|
| `google_cancelled` | The player cancelled at Google. |
| `google_failed` | Anything above didn't check out. |
| `google_unverified` | Google hasn't verified the email. |
| `google_unavailable` | Google sign-in isn't set up. |
| `try_later` | Too many attempts. |

### Setting up Google sign-in

1. **Create the client.** In Google Cloud Console → APIs & Services → Credentials, create an
   **OAuth client ID** of type **Web application**.
2. **Add the redirect URIs** under "Authorized redirect URIs", one for each address the site is
   served from:
   - `https://orion-genix-digital-civilization.subhamj811.workers.dev/api/auth/google/callback`
   - `https://<your custom domain>/api/auth/google/callback`, once you have one
   - `http://localhost:8787/api/auth/google/callback`, for `npm run cf:dev`
3. **Set up the OAuth consent screen:**
   - The app's name and logo.
   - A support email.
   - The scopes `openid`, `email` and `profile` only. These need no Google review.
   - Links to a privacy policy and terms (phase 5 adds the pages).
   - Publish it ("In production") so anyone can sign in, not just the test users you list.
4. **The client id** is not a secret. Add it to `wrangler.jsonc`:
   `"vars": { "GOOGLE_CLIENT_ID": "….apps.googleusercontent.com" }`.
5. **The client secret** is a secret. Set it with `npx wrangler secret put GOOGLE_CLIENT_SECRET`.
6. **For local testing**, put both in `.dev.vars`, which is git-ignored:
   ```
   GOOGLE_CLIENT_ID=….apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   ```

`worker/google.test.ts` covers all of this with a real RSA key standing in for Google's:

- new, linked and taken-over accounts
- the guest save joining
- every refusal, including forged state and bad tokens
- safe return paths
- key caching

## Account emails (`worker/email.ts`, `worker/recovery.ts`)

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/verify` | `{ token }`. Confirms the address and signs this browser in. |
| POST | `/api/auth/verify/send` | Sends the signed-in player a new confirmation link (`{ sent }`), at most once a minute. |
| POST | `/api/auth/forgot` | `{ email, turnstileToken? }`. Always `202 { sent: true }`; only an address with an account gets mail. |
| POST | `/api/auth/reset/check` | `{ token }` → `{ valid }`, so `/reset` can say a link has expired before anything is typed. |
| POST | `/api/auth/reset` | `{ token, password }`. Sets the password, confirms the address, ends every other session, signs this browser in. |

### Sign-up with email set up

The reply is always `202`, "check your inbox", so sign-up can't be used to find out who has an
account. The email is what differs:

| The address… | Gets |
|---|---|
| Is new | "Confirm your email". The account is made unconfirmed, and its link confirms and signs in (24 hours). |
| Already has an account | "You already have an account", with a reset link (30 minutes): "Set a password" for a Google-only account. |

Both cases do the same work (one password hash), and the email goes out after the response
(`ctx.waitUntil`), so timing doesn't tell them apart either. A new account can be signed into with
its password straight away; confirming is what keeps it safe if the address is later used with
Google.

### The links

- **Where the token goes.** In the fragment (`/verify#token=…`, `/reset#token=…`). Browsers never
  send a fragment to a server or in a Referer header.
- **The page wipes it** from the address bar on first render, before the analytics tag loads,
  and the pages send no referrer.
- **Storage.** Only the token's SHA-256 is stored (`email_tokens`).
- **Single use.** A link is spent atomically the moment it's used. The newest link of a kind
  replaces the earlier ones, and no more than one of a kind goes out per minute.
- **Expiry.** Confirmation links last 24 hours, reset links 30 minutes.
- **Resetting a password:**
  - It's checked (length, breach list) *before* the link is spent, so a weak password doesn't
    use the link up.
  - It confirms the address.
  - It lifts any lock from wrong passwords.
  - It signs out every other device.
- **Rate limits.** 10 a minute per address for the link endpoints. For forgot, 10 a minute per
  address and per email. Forgot also goes through Turnstile when that's set up.

### Setting up email

You need **a domain you own** (email can't be sent from `workers.dev`) and **a Resend account**
(free tier: 3,000 emails a month, 100 a day).

1. **Add your domain to Resend.** Use a subdomain for mail, such as `mail.yourdomain.com`.
   Resend shows DNS records: SPF (TXT), DKIM (TXT) and a return-path (MX). Add them in
   Cloudflare DNS; if the domain is already on Cloudflare, Resend can add them for you. Wait
   until Resend shows the domain as verified.
2. **Add a DMARC record** on the domain, for example a TXT record at `_dmarc` reading
   `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`. Gmail and Yahoo expect one from senders.
3. **Create an API key** in Resend with "Sending access" for that domain only.
4. **Set the sender** in `wrangler.jsonc`, under `"vars"`, on the verified domain:
   `"EMAIL_FROM": "OrionGenix <accounts@mail.yourdomain.com>"`.
5. **Set the key** with `npx wrangler secret put RESEND_API_KEY`.
6. **Serve the site from the domain too** (a Workers custom domain), so the links in emails
   match where players play. Then:
   - set `NEXT_PUBLIC_SITE_URL` when building
   - add the domain's callback to the Google client

**Local development.** Without Resend, `EMAIL_DEV_LOG=1` in `.dev.vars` (git-ignored) writes
each email, link included, to the wrangler console instead of sending it. Never set it on the
live Worker: it would put working links in the logs.

## Notes for the game client (phase 5)

- **Flush before signing in.** `CloudSave` already treats a change of `owner` as a different
  player: it puts the cached local save aside rather than uploading it. Changes made in the last
  few seconds before signing in may not have been uploaded yet, so send them before going to the
  sign-in page.
- **Sign-out on a shared computer.** After sign-out, the client should drop the account's cached
  save from local storage, not just set it aside.

## Daily clean-up (`worker/cleanup.ts`)

A cron trigger (`wrangler.jsonc` → `triggers.crons`, 03:17 UTC daily, no extra cost) deletes:

- **Sessions past their expiry.** A session is deleted when it's presented after it expires, but
  one whose cookie is gone (cookies cleared, a private window closed) is never presented again.
- **Email links that were used or have expired.**

Accounts, sign-in methods and saves are never touched. Rows are deleted 2,000 at a time, up to
25 batches a run, so a run never holds the database for long; any backlog beyond that is
finished the next day. The log line gives counts only.

To run it by hand against the local database, start wrangler with
`npx wrangler dev --test-scheduled`, then open `http://localhost:8787/__scheduled`.

## Testing

`npm test` covers these on a real in-memory SQLite database with the migrations applied.
`worker/signin.test.ts` covers sign-up, sign-in, locking, rate limits and Turnstile, with the
outside services stubbed. `worker/recovery.test.ts` covers the account emails, with Resend
stubbed: sign-up that doesn't reveal accounts, confirming, resending, forgot and reset, link
expiry and single use. `worker/password.test.ts` covers hashing and the breach check.
`worker/auth.test.ts` covers:

- sessions, sliding expiry, forged cookies
- guest saves joining an account: adoption, merge, replay, rollback
- sign-out, and deleting an account
