# Accounts

Players can still play as guests, with no sign-up (see [cloud-saves.md](cloud-saves.md)). An
account keeps the save across browsers and devices. Everything runs in the same Worker as the save
API (`worker/auth.ts`), because the site is a static export with no Next server.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Tables, sessions, `/api/auth/me`, sign-out, guest save joining the account | **Done** |
| 2 | Email and password sign-up and sign-in (Turnstile, breach check, rate limits), `/signin` and `/signup` pages, "Sign in" in the landing header | **Done** |
| 3 | Google sign-in (OAuth code flow with PKCE, account linking) | To do (the button is there, disabled) |
| 4 | Email verification and password reset | To do |
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
- **Phase 4 only:** a custom domain (email can't be sent from `workers.dev`) and an email
  provider (Resend, or Cloudflare Email Service).

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
| POST | `/api/auth/signup` | `{ email, password, displayName?, turnstileToken? }`. Creates the account and signs in: `201 { user }`. |
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
| `email_taken` | 409 | There's already an account with this email. This does tell anyone who asks that the email has an account. In phase 4 it changes to "check your inbox", with the answer sent by email instead. |
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
  - Turnstile appears when its site key is set. The disabled Google button waits for phase 3.
- **After signing in** the browser goes to `?return=` (a path on this site only) or `/play`.
  It's a full page load, so the game starts under the account's save.
- **Already signed in:** visiting either page shows who you're signed in as, with Play and
  Sign out.
- **The landing header** shows "Sign in", or the player's name once signed in.
- **Where it works.** Plain `npm run dev` has no API, so the pages say sign-in isn't available
  there. Use `npm run cf:dev` (http://localhost:8787).

## Notes for the game client (phase 5)

- **Flush before signing in.** `CloudSave` already treats a change of `owner` as a different
  player: it puts the cached local save aside rather than uploading it. Changes made in the last
  few seconds before signing in may not have been uploaded yet, so send them before going to the
  sign-in page.
- **Sign-out on a shared computer.** After sign-out, the client should drop the account's cached
  save from local storage, not just set it aside.

## Testing

`npm test` covers these on a real in-memory SQLite database with the migrations applied.
`worker/signin.test.ts` covers sign-up, sign-in, locking, rate limits and Turnstile, with the
outside services stubbed. `worker/password.test.ts` covers hashing and the breach check.
`worker/auth.test.ts` covers:

- sessions, sliding expiry, forged cookies
- guest saves joining an account: adoption, merge, replay, rollback
- sign-out, and deleting an account
