import { forgetSavedProgress, onProgressChange, parseProgress, progressStorage, readProgress, replaceProgress, type ProgressState } from "./Progress";
import { mergeSaves } from "./SaveMerge";
import { canonicalSave, checkSave, SAVE_SCHEMA_VERSION, sameSave, type SaveData } from "./SaveSchema";

/**
 * Keeps a copy of the player's progress on the server (the save API, worker/index.ts), so it
 * outlives the browser clearing local storage — without the game ever waiting for it.
 *
 * The game plays from local storage exactly as before (Progress). This listens for progress
 * changing — which only happens at checkpoints: a mission passed, a purchase, a page found, a
 * job done, never per frame — and a couple of seconds after things settle, sends the whole save
 * in one request. One request at a time; changes made meanwhile go in the next one. Failures
 * back off and give up after a few tries until the connection comes back or progress changes
 * again; the local copy is never touched by a failure.
 *
 * Keeping the two copies straight:
 *  - Each server save has a revision. A write says which revision it was based on and is refused
 *    if that's stale (another tab saved since); the refusal carries the server's save, which is
 *    merged with the local one (`mergeSaves`) and sent again.
 *  - What was last agreed with the server (`base`) is remembered beside the revision, so the
 *    merge knows what each side changed since: lists are combined, best times and ratings keep
 *    the best, and cash, jobs and standing add up what each side earned — never twice.
 *  - The first time, an existing local save is uploaded as it is (nothing local is removed).
 *  - The server's save is tagged with whose it is; a cached save from a different guest is put
 *    aside (BACKUP_KEY), never uploaded as this guest's.
 */

const API = "/api/save";
const META_KEY = "orion.cloud.v1";
const BACKUP_KEY = "orion.progress.v1.backup";
/** Wait this long after the last change before sending, so a burst of changes is one request... */
const SETTLE_MS = 2000;
/** ...but no longer than this after the first. */
const MAX_WAIT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 8000;
const RETRY_BASE_MS = 2000;
const RETRY_CAP_MS = 60_000;
/** Then wait for the connection to come back, or for progress to change again. */
const MAX_RETRIES = 6;
/** Merge-and-resend rounds for one save before backing off (only tabs racing each other). */
const MAX_CONFLICTS = 3;
/** Start once the page has settled, so the first request doesn't compete with loading. */
const START_IDLE_MS = 3000;

interface CloudMeta {
	/** Whose save this is (from the server; not a secret). */
	owner: string;
	revision: number;
	/** The save as last agreed with the server at `revision`; null before the first. */
	base: SaveData | null;
}

interface ServerSave {
	owner: string;
	revision: number;
	save: SaveData | null;
}

export type CloudStatus = "off" | "starting" | "synced" | "pending" | "offline" | "disabled";

export interface CloudSaveDeps {
	fetch: typeof fetch;
	online: () => boolean;
	random?: () => number;
}

const fresh = (): SaveData => canonicalSave(parseProgress(null) as SaveData);
const isFresh = (save: SaveData) => sameSave(save, fresh());

function readMeta(): CloudMeta | null {
	try {
		const raw = progressStorage()?.getItem(META_KEY);
		if (!raw) return null;
		const meta = JSON.parse(raw) as Partial<CloudMeta>;
		if (typeof meta.owner !== "string" || typeof meta.revision !== "number" || !Number.isInteger(meta.revision) || meta.revision < 0) return null;
		const base = meta.base === null ? null : checkSave(meta.base);
		if (base && !base.ok) return null;
		return { owner: meta.owner, revision: meta.revision, base: base ? base.save : null };
	} catch {
		return null;
	}
}

function writeLocal(key: string, value: unknown): void {
	try {
		progressStorage()?.setItem(key, JSON.stringify(value));
	} catch {
		// Kept in memory for this session.
	}
}

function parseServerSave(body: unknown): ServerSave | null {
	if (!body || typeof body !== "object") return null;
	const { owner, revision, save } = body as Record<string, unknown>;
	if (typeof owner !== "string" || !/^[0-9a-f]{16}$/.test(owner)) return null;
	if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) return null;
	if (save === null) return revision === 0 ? { owner, revision, save: null } : null;
	const checked = checkSave(save);
	return checked.ok && revision > 0 ? { owner, revision, save: checked.save } : null;
}

type Outcome =
	| { kind: "ok"; status: number; body: unknown }
	| { kind: "failed"; status: number; retryAfter: number | null; body: unknown }
	| { kind: "network" };

export class CloudSave {
	private status: CloudStatus = "off";
	/** Whether this session has heard from the server yet (and reconciled with it). */
	private connected = false;
	private booting = false;
	private meta: CloudMeta | null = null;
	private stopListening: (() => void) | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private firstPendingAt = 0;
	private inFlight = false;
	private again = false;
	private retries = 0;
	private conflicts = 0;
	private applying = false;
	/** The save being sent and its write id: a retry of the same save reuses the id. */
	private sending: { json: string; writeId: string } | null = null;
	private readonly random: () => number;

	public constructor(private readonly deps: CloudSaveDeps) {
		this.random = deps.random ?? Math.random;
	}

	public state(): CloudStatus {
		return this.status;
	}

	public start(): void {
		if (this.status !== "off") return;
		this.status = "starting";
		this.meta = readMeta();
		this.stopListening = onProgressChange((change) => {
			if (change === "replace" && this.applying) return;
			this.retries = 0;
			this.conflicts = 0;
			this.schedule();
		});
		void this.bootstrap();
	}

	public stop(): void {
		this.stopListening?.();
		this.stopListening = null;
		this.clearTimer();
		this.status = "off";
		this.connected = false;
	}

	/** The connection's back: try again now. */
	public online(): void {
		this.retries = 0;
		if (this.status === "off" || this.status === "disabled") return;
		if (this.connected) void this.flush();
		else void this.bootstrap();
	}

	/**
	 * Sends what's waiting now, rather than in a moment: before signing out. True when the server
	 * has everything this browser has.
	 */
	public async settle(): Promise<boolean> {
		this.clearTimer();
		if (this.ready() && !this.inFlight && this.dirty()) await this.flush();
		return this.ready() && !this.inFlight && !this.dirty();
	}

	/** The page is going away or out of sight: send what's waiting, best effort. */
	public hidden(): void {
		if (this.ready() && !this.inFlight && this.dirty()) void this.flush({ keepalive: true });
	}

	private ready(): boolean {
		return this.connected && this.status !== "off" && this.status !== "disabled";
	}

	private local(): SaveData {
		return canonicalSave(readProgress() as SaveData);
	}

	private dirty(): boolean {
		const base = this.meta?.base;
		const local = this.local();
		return base ? !sameSave(local, base) : !isFresh(local);
	}

	private clearTimer(): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
	}

	private schedule(delay = SETTLE_MS): void {
		if (!this.ready()) return;
		const now = Date.now();
		if (this.timer === null) this.firstPendingAt = now;
		this.clearTimer();
		this.status = "pending";
		const wait = Math.max(0, Math.min(delay, this.firstPendingAt + MAX_WAIT_MS - now));
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.flush();
		}, wait);
	}

	private backoff(after: () => void, retryAfterSeconds: number | null = null): void {
		this.retries++;
		if (this.retries > MAX_RETRIES) {
			// Stop here; the next change or the connection coming back starts it again.
			this.status = "offline";
			return;
		}
		const exponential = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (this.retries - 1));
		const delay = retryAfterSeconds !== null ? retryAfterSeconds * 1000 : exponential * (0.5 + this.random() * 0.5);
		this.clearTimer();
		this.timer = setTimeout(() => {
			this.timer = null;
			after();
		}, delay);
	}

	private disable(reason: string): void {
		this.clearTimer();
		this.status = "disabled";
		console.warn(`Cloud save off for this session (${reason}); progress is still saved on this device.`);
	}

	private async request(method: "GET" | "PUT", body?: unknown, keepalive = false): Promise<Outcome> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await this.deps.fetch(API, {
				method,
				credentials: "same-origin",
				cache: "no-store",
				keepalive,
				signal: controller.signal,
				headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
			});
			let parsed: unknown = null;
			if ((response.headers.get("content-type") ?? "").includes("application/json")) {
				try {
					parsed = await response.json();
				} catch {
					parsed = null;
				}
			}
			if (response.ok) return { kind: "ok", status: response.status, body: parsed };
			const retryAfter = Number(response.headers.get("retry-after"));
			return { kind: "failed", status: response.status, retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 300) : null, body: parsed };
		} catch {
			return { kind: "network" };
		} finally {
			clearTimeout(timeout);
		}
	}

	private apply(save: SaveData): void {
		this.applying = true;
		try {
			replaceProgress(save as ProgressState);
		} finally {
			this.applying = false;
		}
	}

	private setMeta(meta: CloudMeta): void {
		this.meta = meta;
		writeLocal(META_KEY, meta);
	}

	private async bootstrap(): Promise<void> {
		if (this.status === "off" || this.status === "disabled" || this.booting) return;
		if (!this.deps.online()) {
			this.status = "offline";
			return;
		}
		this.booting = true;
		const outcome = await this.request("GET");
		this.booting = false;
		// Stopped while waiting.
		if ((this.status as CloudStatus) === "off") return;
		if (outcome.kind === "network" || outcome.kind === "failed" && (outcome.status >= 500 || outcome.status === 429)) {
			this.status = "starting";
			this.backoff(() => void this.bootstrap(), outcome.kind === "failed" ? outcome.retryAfter : null);
			return;
		}
		// 404: no save API here (the plain `next dev` server); anything else is a reply it can't use.
		const server = outcome.kind === "ok" ? parseServerSave(outcome.body) : null;
		if (!server) {
			this.disable(outcome.kind === "failed" ? `HTTP ${outcome.status}` : "unexpected reply");
			return;
		}
		this.retries = 0;
		this.reconcile(server);
		this.connected = true;
		this.status = "synced";
		if (this.dirty()) this.schedule(0);
	}

	/** First contact this session: bring the local copy and the server's into line. */
	private reconcile(server: ServerSave): void {
		const local = this.local();
		const meta = this.meta;
		const known = meta && meta.owner === server.owner ? meta : null;
		if (!server.save) {
			// Nothing on the server yet: whatever's here goes up as it is (the first upload of an
			// existing local save), via the dirty check after this.
			this.setMeta({ owner: server.owner, revision: 0, base: null });
			return;
		}
		if (known) {
			if (known.revision !== server.revision) {
				// Saved elsewhere (another tab) since: take that, plus whatever's new here.
				const merged = mergeSaves(known.base, local, server.save);
				if (!sameSave(merged, local)) this.apply(merged);
			}
			this.setMeta({ owner: server.owner, revision: server.revision, base: known.revision === server.revision ? known.base : server.save });
			return;
		}
		if (!isFresh(local) && !sameSave(local, server.save)) writeLocal(BACKUP_KEY, local);
		if (meta) {
			// This browser's cached save belongs to a different guest: put it aside, don't upload it.
			if (!sameSave(local, server.save)) this.apply(server.save);
		} else {
			// A server save but no record of syncing with it (local storage was cleared, or this
			// is the first run since the cloud save existed): keep the best of both.
			const merged = mergeSaves(null, local, server.save);
			if (!sameSave(merged, local)) this.apply(merged);
		}
		this.setMeta({ owner: server.owner, revision: server.revision, base: server.save });
	}

	private async flush(options: { keepalive?: boolean } = {}): Promise<void> {
		if (!this.ready() || !this.meta) return;
		if (this.inFlight) {
			this.again = true;
			return;
		}
		this.clearTimer();
		if (!this.dirty()) {
			this.status = "synced";
			return;
		}
		if (!this.deps.online()) {
			this.status = "offline";
			return;
		}
		const snapshot = this.local();
		const checked = checkSave(snapshot);
		if (!checked.ok) {
			this.disable(`save not accepted: ${checked.error}`);
			return;
		}
		const json = JSON.stringify(checked.save);
		if (this.sending?.json !== json) this.sending = { json, writeId: crypto.randomUUID() };
		const { writeId } = this.sending;
		const baseRevision = this.meta.revision;

		this.inFlight = true;
		const outcome = await this.request("PUT", { baseRevision, schemaVersion: SAVE_SCHEMA_VERSION, writeId, save: checked.save }, options.keepalive);
		this.inFlight = false;
		if (this.status === "off" || this.status === "disabled") return;

		if (outcome.kind === "ok") {
			const revision = (outcome.body as { revision?: unknown } | null)?.revision;
			if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
				this.disable("unexpected reply");
				return;
			}
			this.saved(revision, checked.save);
			return;
		}
		if (outcome.kind === "failed" && outcome.status === 409) {
			this.conflict(outcome.body, checked.save);
			return;
		}
		if (outcome.kind === "failed" && outcome.status === 401) {
			// The cookie's gone: start over as whoever the server says this is now.
			this.connected = false;
			this.status = "starting";
			void this.bootstrap();
			return;
		}
		if (outcome.kind === "network" || outcome.status >= 500 || outcome.status === 429) {
			this.status = "pending";
			this.backoff(() => void this.flush(), outcome.kind === "failed" ? outcome.retryAfter : null);
			return;
		}
		this.disable(`HTTP ${outcome.status}`);
	}

	private saved(revision: number, sent: SaveData): void {
		this.retries = 0;
		this.conflicts = 0;
		this.sending = null;
		this.setMeta({ owner: this.meta!.owner, revision, base: sent });
		if (this.again || this.dirty()) {
			this.again = false;
			this.schedule();
		} else {
			this.status = "synced";
		}
	}

	private conflict(body: unknown, sent: SaveData): void {
		const { revision, save } = (body ?? {}) as { revision?: unknown; save?: unknown };
		const checked = save === null ? null : checkSave(save);
		if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0 || checked && !checked.ok) {
			this.disable("unexpected reply");
			return;
		}
		const server = checked?.ok ? checked.save : null;
		if (server && sameSave(server, sent)) {
			// It did land; only the reply was lost.
			this.saved(revision, sent);
			return;
		}
		this.conflicts++;
		if (!server) {
			// The server has no save any more: upload this one afresh.
			this.setMeta({ owner: this.meta!.owner, revision: 0, base: null });
		} else {
			const merged = mergeSaves(this.meta!.base, this.local(), server);
			if (!sameSave(merged, this.local())) this.apply(merged);
			this.setMeta({ owner: this.meta!.owner, revision, base: server });
		}
		if (this.conflicts > MAX_CONFLICTS) this.backoff(() => void this.flush());
		else void this.flush();
	}
}

let instance: CloudSave | null = null;

/**
 * Starts keeping the cloud copy, once the page is idle (or a few seconds in). Safe to call more
 * than once. Browser only.
 */
export function startCloudSave(): () => void {
	if (typeof window === "undefined" || instance) return () => {};
	const cloud = new CloudSave({ fetch: (...args) => window.fetch(...args), online: () => navigator.onLine !== false });
	instance = cloud;
	const begin = () => cloud.start();
	const idleCallbacks = typeof window.requestIdleCallback === "function";
	const idle = idleCallbacks ? window.requestIdleCallback(begin, { timeout: START_IDLE_MS }) : setTimeout(begin, START_IDLE_MS);
	const online = () => cloud.online();
	const hidden = () => {
		if (document.visibilityState === "hidden") cloud.hidden();
	};
	const leaving = () => cloud.hidden();
	window.addEventListener("online", online);
	document.addEventListener("visibilitychange", hidden);
	window.addEventListener("pagehide", leaving);
	return () => {
		if (idleCallbacks) window.cancelIdleCallback(idle as number);
		else clearTimeout(idle);
		window.removeEventListener("online", online);
		document.removeEventListener("visibilitychange", hidden);
		window.removeEventListener("pagehide", leaving);
		cloud.stop();
		instance = null;
	};
}

/** Sends any progress not yet on the server, now; true when the server has it all. */
export function settleCloudSave(): Promise<boolean> {
	return instance ? instance.settle() : Promise.resolve(false);
}

/**
 * After signing out: this browser keeps no copy of the account's progress (on a shared computer,
 * the next player starts a new game). Only once the server has it all (`settleCloudSave`).
 */
export function forgetLocalSave(): void {
	forgetSavedProgress();
	try {
		progressStorage()?.removeItem(META_KEY);
		progressStorage()?.removeItem(BACKUP_KEY);
	} catch {
		// Nothing saved to forget.
	}
}
