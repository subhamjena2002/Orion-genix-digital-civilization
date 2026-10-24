# Cloud saves (Cloudflare D1)

The game keeps the player's progress in the browser as before, and also backs it up to a
Cloudflare D1 database in the background. Players don't need an account. Signing in (see
[accounts.md](accounts.md)) moves the guest save into an account, so it follows them across
devices.

## How the pieces fit

```
Browser game ── Progress.ts (localStorage, the copy the game plays from)
                   │ change events (checkpoints only)
                   ▼
               CloudSave.ts  ── debounced, one request at a time ──►  /api/save  (worker/index.ts)
                                                                          │
                                                                          ▼
                                                                  D1: orion-genix-saves
```

- **Hosting.** It's still the same Worker (`orion-genix-digital-civilization`) serving the static
  export in `out/`. `wrangler.jsonc` adds a script (`worker/index.ts`) with
  `run_worker_first: ["/api/*"]`, so the script runs only for the API. Every page, model and
  texture is served straight from assets, as before. There's no OpenNext and no second server.
- **Database.** D1 `orion-genix-saves` (id `94f086d4-a68e-4a71-bf1a-ff586da22118`, APAC), bound as
  `DB`. The schema is in `migrations/`.
- **Shared rules.** `src/engine/orion/missions/SaveSchema.ts` is the strict save validator. Both the
  API and the game use it.

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/save` | Returns `{ owner, revision, schemaVersion, save }`. On a first visit it also sets the guest cookie and returns `revision: 0, save: null`. It never writes to the database. |
| PUT | `/api/save` | Takes `{ baseRevision, schemaVersion, writeId, save }`. Returns `{ revision }`, or `409 { revision, save }` when `baseRevision` is stale. |

Errors come back as `{ "error": "<code>" }` with these statuses:

- `400`: malformed body or save
- `401`: no guest cookie
- `403`: request from another origin
- `413`: body too large
- `415`: not JSON
- `429`: rate limited (sends `retry-after`)
- `404` / `405`: unknown path or method
- `500`: server error (details are never included)

### Guest identity

- **The cookie.** A random 256-bit token is set as `__Host-orion_guest`, with `Secure; HttpOnly;
  SameSite=Lax; Path=/` and a 400-day lifetime that renews on each visit. Over plain-http
  localhost (`wrangler dev`) the cookie is `orion_guest` without `Secure`.
- **What the database stores.** Only the SHA-256 of the token. A leaked table can't be used to
  act as a player.
- **Who a save belongs to.** The cookie alone decides it. A guest id or anything else in the
  request body is ignored.
- **`owner`.** A non-secret tag derived from the hash. The game uses it to tell whether a cached
  save belongs to the current guest.
- **No recovery.** Clearing cookies or site data, or switching browser or device, means a new
  guest. Nothing can recover the old save. Signing in to an account (accounts.md)
  is the way to keep a save beyond one browser.

### Protections

- **Writes must come from the game's own page.** Every write needs a matching `Origin` header (or
  `Sec-Fetch-Site: same-origin`) and a JSON content type. A cross-site form or `fetch` can't send
  that without a CORS preflight, and the API never answers preflights.
- **Strict validation.** Saves are checked field by field: whole numbers in range, known weapon
  ids, at most 512 entries per list, no duplicates, no control characters, no unknown fields.
  The body may be at most about 17 KB, and the stored JSON at most 16 KB, enforced by the API
  and by a database `CHECK`.
- **Safe queries.** All SQL is parameterised.
- **Rate limits.** These use Workers rate-limit bindings: 20 writes a minute per guest, and 30 new
  guests a minute per IP address.
- **Limits of what the server can check.** The server checks that a save is well formed and
  within range. It can't re-run the mission logic, so it can't prove the cash was earned. The game
  decides rewards, as it did with local saves.

## What's stored where

| Data | Where | Why |
|---|---|---|
| `orion.progress.v1`: cash, missions passed, best times, ratings, weapons, garage, story flags, standing, pages collected, jobs done | **D1**, plus localStorage as the copy the game plays from and the offline cache | Long-lived progress |
| `orion.cloud.v1`: owner tag, last synced revision, last agreed save | localStorage | Sync bookkeeping |
| `orion.progress.v1.backup` | localStorage, written only when needed | A cached save from a *different* guest, kept aside rather than uploaded |
| `orion.audio`: master and effects volume, mute | localStorage only | Per-device preference |
| `orion.graphics`: adaptive quality, shadow distance | localStorage only | Per-device preference |
| Position, health, ammo in the clip, armour, wanted level, vehicle damage, traffic, pedestrians, physics, the mission in progress, HUD state | Memory only | Changes per frame or per session; a reload has always started these fresh |

The game doesn't use sessionStorage or IndexedDB anywhere.

## Keeping it off the frame budget

- **The game never waits on the network.** `Progress` reads and writes localStorage
  synchronously, as before. Rewards apply immediately, and the upload happens later.
- **Startup is deferred.** `startCloudSave()` (in `OrionEntry`) waits for `requestIdleCallback`
  (3 s at most), then sends one GET.
- **No uploads from game loops.** Uploads come only from progress change events, which happen at
  checkpoints: a mission passed, a job done, a purchase, a page collected. Nothing in the render,
  physics, traffic or AI code calls the API, and a test checks this.
- **Changes are batched.** Each upload waits 2 s after the last change, or 10 s at most after the
  first, then sends the whole save (a few hundred bytes to a few KB) in one request. Only one
  request is in flight at a time.
- **Failures are bounded.** Each request times out after 8 s. Retries back off exponentially
  with jitter, up to 6 tries, then wait for the `online` event or the next change. While
  offline, nothing is attempted.
- **Leaving the page is best effort.** When the page is hidden or closed, any unsent change is
  sent with `keepalive`. This is never the only way a change gets saved.

The cost in a real browser (local `wrangler dev`, production build): loading `/play` with an
existing local save made one GET and one PUT, and nothing more while idle.

## Migration, conflicts and reset

- **First run.** If the server has no save and the local one has progress, the local save is
  uploaded as is. `orion.progress.v1` is left in place, because the game keeps playing from it.
- **Revisions.** Each write names the revision it's based on. The database update only lands if
  that revision is still current (`WHERE revision = ?`), so an older save can never overwrite a
  newer one.
- **Conflicts (for example, two tabs).** A 409 hands back the server's save, and the game merges
  it using the last agreed save as the common base:
  - Lists (missions passed, flags, weapons, garage) are combined.
  - Best times keep the lowest and ratings keep the highest.
  - Cash, jobs and standing add *what each side earned since the base*, so nothing is counted
    twice.
  - With no known base, counters take the larger side instead of adding.
- **Retries.** Each upload carries a `writeId`. If a write landed but its reply was lost, the
  retry is recognised as already done (`replayed: true`) and isn't applied twice.
- **Local storage cleared, cookie kept.** For example, Safari deletes script storage after 7
  days. The server's save is brought back and merged in.
- **Reset.** `resetProgress()` (the dev-only `__orionMissions.reset()`; there's no reset button
  in the game) starts a new game locally and uploads the new-game save. The reset therefore
  applies to both the local copy and the cloud copy.

## Free-tier budget

The free tier allows 100k Worker requests a day, 5M D1 rows read a day, 100k rows written a day,
and 5 GB of storage. This game uses:

- **Per session:** 1 GET (1 row read), plus 1 PUT per checkpoint burst. Each PUT is about 2 rows
  written (the row plus the `updated_at` index) and 1 row read.
- **Per save:** under 4 KB of storage. A million guests would still fit in 5 GB.

Nothing deletes old saves. A retention policy (for example, deleting saves untouched for N
months, using the `updated_at` index) would need your approval.

## Running and testing locally

```bash
npm test
```
```bash
npm run cf:dev
```

`cf:dev` builds the static export, applies migrations to a **local** D1 under `.wrangler/`, and
serves the game and API at http://localhost:8787. Plain `npm run dev` (Next on :3000) has no
API. Cloud save switches itself off there, and the game saves locally as before.

## Deploying (not done yet; needs approval)

```bash
npm run build
```
```bash
npm run db:migrate:remote
```
```bash
npx wrangler deploy
```

The remote database already has migration `0001` applied and recorded in `d1_migrations`, so
`db:migrate:remote` will report nothing to apply. Wrangler must be logged in (`npx wrangler
login`) for the last two commands.
