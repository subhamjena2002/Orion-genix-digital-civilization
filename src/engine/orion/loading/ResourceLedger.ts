/**
 * What the game has downloaded, from the browser's own record of each file (Resource Timing):
 * the numbers behind the loading screen's "Assets loaded" line, and the initial payload — what had
 * arrived when the game became playable — kept for platform reporting later.
 *
 * How bytes are counted:
 *
 * - **Size of a file** is its `encodedBodySize`: the body as delivered (compressed if the server
 *   compressed it), headers excluded. It is the same number whether the file came over the
 *   network or out of a cache, so a cached second visit shows the same game size as the first.
 * - **From the network** is that size for files whose `transferSize` is non-zero; a file with
 *   `transferSize` 0 and a body came from a cache (HTTP cache or the service worker). The two
 *   always add up to the total, so neither can come out larger than it.
 * - **Each file once.** Entries are keyed by URL (without its #fragment); a second request for the
 *   same file (a revalidation, a second fetch) is not added again — unless it is the first to bring
 *   the file itself: a request that came back empty (a HEAD asking whether the file exists, as
 *   WeaponModels does) or failed (a download tried again by DeferredModels) gives way to the
 *   request that then fetched it.
 * - **Failed requests don't count** (status 400 or more); they are tallied separately.
 * - **Other sites don't count.** The browser hides their sizes (they read as 0) and they aren't
 *   the game's data (analytics).
 *
 * Which bucket a file goes in:
 *
 * - **startup**: requested before the game was ready, and not one of the models deliberately left
 *   until after it. A startup file that only finishes after Ready still counts as startup (it was
 *   asked for to start the game), but the initial payload counts only what had arrived by Ready.
 * - **background**: requested after Ready, or one of the deferred models whenever requested.
 */

export interface ResourceRecord {
	/** Absolute URL. */
	name: string;
	/** ms since navigation start. */
	startTime: number;
	responseEnd: number;
	encodedBodySize: number;
	transferSize: number;
	/** HTTP status, where the browser reports it (0 or absent when it doesn't). */
	responseStatus?: number;
}

export interface PayloadTotals {
	/** Files counted. */
	files: number;
	/** Their size, bytes (see above). */
	bytes: number;
	/** Of `bytes`, what came over the network. */
	networkBytes: number;
	/** Of `bytes`, what came from a cache. */
	cachedBytes: number;
}

export interface InitialPayload extends PayloadTotals {
	/** When the game became playable, ms since navigation start. */
	readyAt: number;
	/** Startup files still downloading at that moment (counted once they arrive). */
	lateFiles: number;
	lateBytes: number;
}

const emptyTotals = (): PayloadTotals => ({ files: 0, bytes: 0, networkBytes: 0, cachedBytes: 0 });

interface Counted {
	responseEnd: number;
	bytes: number;
	cached: boolean;
}

function add(totals: PayloadTotals, file: Counted) {
	totals.files++;
	totals.bytes += file.bytes;
	if (file.cached) totals.cachedBytes += file.bytes;
	else totals.networkBytes += file.bytes;
}

function remove(totals: PayloadTotals, file: Counted) {
	totals.files--;
	totals.bytes -= file.bytes;
	if (file.cached) totals.cachedBytes -= file.bytes;
	else totals.networkBytes -= file.bytes;
}

/** What became of the first request for a URL: counted in a bucket, or failed. */
type Seen = { file: Counted; totals: PayloadTotals } | "failed";

export class ResourceLedger {
	private readonly seen = new Map<string, Seen>();
	private readonly startupFiles: Counted[] = [];
	private readonly startupTotals = emptyTotals();
	private readonly backgroundTotals = emptyTotals();
	private failedCount = 0;
	private readyAt: number | null = null;

	/**
	 * @param origin  The game's own origin; files from anywhere else are ignored.
	 * @param deferred  Whether a path (e.g. "/models/rail/metro-train.glb") is a model loaded after Ready.
	 */
	public constructor(private readonly origin: string, private readonly deferred: (path: string) => boolean) {}

	/**
	 * Adds one finished request; entries may arrive in any order and after Ready, since they're
	 * classified by their own timestamps. Says whether it was counted.
	 */
	public record(entry: ResourceRecord): boolean {
		let url: URL;
		try {
			url = new URL(entry.name);
		} catch {
			return false;
		}
		if (url.origin !== this.origin) return false;
		const key = url.origin + url.pathname + url.search;
		const failed = (entry.responseStatus ?? 0) >= 400;
		const bytes = Number.isFinite(entry.encodedBodySize) ? Math.max(0, entry.encodedBodySize) : 0;
		const file: Counted = { responseEnd: entry.responseEnd, bytes, cached: bytes > 0 && !(entry.transferSize > 0) };
		const before = this.seen.get(key);
		if (before !== undefined) {
			if (failed) return false;
			if (before === "failed") {
				// Tried again and fetched this time: the file didn't fail after all.
				this.failedCount--;
			} else if (before.file.bytes === 0 && bytes > 0) {
				// The first request only asked whether the file was there; this one brought it. It
				// stays in the bucket the first put it in, which was asked for at the same moment.
				remove(before.totals, before.file);
				Object.assign(before.file, file);
				add(before.totals, before.file);
				return true;
			} else {
				return false;
			}
		}
		if (failed) {
			this.seen.set(key, "failed");
			this.failedCount++;
			return false;
		}

		const background = this.deferred(url.pathname) || (this.readyAt !== null && entry.startTime >= this.readyAt);
		const totals = background ? this.backgroundTotals : this.startupTotals;
		add(totals, file);
		if (!background) this.startupFiles.push(file);
		this.seen.set(key, { file, totals });
		return true;
	}

	/** The game is playable: fixes the moment the initial payload is measured at. Once only. */
	public markReady(time: number): void {
		if (this.readyAt === null) this.readyAt = time;
	}

	/** Every startup file so far, including any that finished after Ready. */
	public get startup(): Readonly<PayloadTotals> {
		return this.startupTotals;
	}

	/** Deferred models, and anything first requested after Ready. */
	public get background(): Readonly<PayloadTotals> {
		return this.backgroundTotals;
	}

	public get failed(): number {
		return this.failedCount;
	}

	/** The startup files that had arrived when the game became playable; null until then. */
	public get initialPayload(): InitialPayload | null {
		const readyAt = this.readyAt;
		if (readyAt === null) return null;
		const totals = emptyTotals();
		let lateFiles = 0;
		let lateBytes = 0;
		for (const file of this.startupFiles) {
			if (file.responseEnd <= readyAt) {
				add(totals, file);
			} else {
				lateFiles++;
				lateBytes += file.bytes;
			}
		}
		return { ...totals, readyAt, lateFiles, lateBytes };
	}
}

/** Bytes as the loading screen shows them: one decimal of a megabyte (10^6 bytes). */
export function formatMegabytes(bytes: number): string {
	return `${(Math.max(0, bytes) / 1e6).toFixed(1)} MB`;
}
