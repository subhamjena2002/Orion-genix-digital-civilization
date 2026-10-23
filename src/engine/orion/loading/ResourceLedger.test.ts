import { describe, expect, it } from "vitest";

import { formatMegabytes, ResourceLedger, type ResourceRecord } from "./ResourceLedger";

const ORIGIN = "https://game.test";
const deferred = (path: string) => path === "/models/rail/metro-train.glb";

function file(path: string, bytes: number, options: Partial<ResourceRecord> = {}): ResourceRecord {
	return { name: ORIGIN + path, startTime: 10, responseEnd: 20, encodedBodySize: bytes, transferSize: bytes + 300, ...options };
}

describe("resource ledger", () => {
	it("counts each file once, by URL", () => {
		const ledger = new ResourceLedger(ORIGIN, deferred);
		expect(ledger.record(file("/models/a.glb", 1000))).toBe(true);
		expect(ledger.record(file("/models/a.glb", 1000, { startTime: 50, responseEnd: 60 }))).toBe(false);
		expect(ledger.record(file("/models/a.glb#again", 1000))).toBe(false);
		expect(ledger.record(file("/models/a.glb?v=2", 500))).toBe(true);
		expect(ledger.startup).toEqual({ files: 2, bytes: 1500, networkBytes: 1500, cachedBytes: 0 });
	});

	it("counts the download that follows a HEAD asking whether the file exists", () => {
		// WeaponModels asks with HEAD first (no body), then fetches: the same URL, twice. Measured in
		// the game: the rifle's 2.3 MB went uncounted while the HEAD was the entry kept.
		const ledger = new ResourceLedger(ORIGIN, deferred);
		ledger.markReady(100);
		expect(ledger.record(file("/models/weapons/ar.glb", 0, { startTime: 100, responseEnd: 110, transferSize: 300 }))).toBe(true);
		expect(ledger.record(file("/models/weapons/ar.glb", 2_308_952, { startTime: 120, responseEnd: 800 }))).toBe(true);
		// And only once, however many times it is fetched again.
		expect(ledger.record(file("/models/weapons/ar.glb", 2_308_952, { startTime: 900, responseEnd: 950 }))).toBe(false);
		expect(ledger.background).toEqual({ files: 1, bytes: 2_308_952, networkBytes: 2_308_952, cachedBytes: 0 });
		expect(ledger.startup.files).toBe(0);
	});

	it("counts a startup file fetched after an empty first request against the initial payload", () => {
		const ledger = new ResourceLedger(ORIGIN, deferred);
		ledger.record(file("/models/a.glb", 0, { responseEnd: 15 }));
		ledger.record(file("/models/a.glb", 5000, { startTime: 20, responseEnd: 150 }));
		ledger.markReady(100);
		expect(ledger.startup).toEqual({ files: 1, bytes: 5000, networkBytes: 5000, cachedBytes: 0 });
		// It arrived after Ready, so it is late, not part of what had arrived.
		expect(ledger.initialPayload).toMatchObject({ files: 0, bytes: 0, lateFiles: 1, lateBytes: 5000 });
	});

	it("counts a download that failed and then succeeded on a retry, and not as failed", () => {
		const ledger = new ResourceLedger(ORIGIN, deferred);
		expect(ledger.record(file("/models/rail/metro-train.glb", 0, { responseStatus: 503 }))).toBe(false);
		expect(ledger.failed).toBe(1);
		// A second failure of the same file is not a second failed file.
		expect(ledger.record(file("/models/rail/metro-train.glb", 0, { responseStatus: 503 }))).toBe(false);
		expect(ledger.failed).toBe(1);
		expect(ledger.record(file("/models/rail/metro-train.glb", 25_000_000, { startTime: 9000, responseEnd: 12_000 }))).toBe(true);
		expect(ledger.failed).toBe(0);
		expect(ledger.background.bytes).toBe(25_000_000);
	});

	it("tells cached files from downloaded ones without double counting", () => {
		const ledger = new ResourceLedger(ORIGIN, deferred);
		ledger.record(file("/a.js", 400, { transferSize: 0 }));
		ledger.record(file("/b.js", 600));
		expect(ledger.startup).toEqual({ files: 2, bytes: 1000, networkBytes: 600, cachedBytes: 400 });
	});

	it("ignores failures, other sites and nonsense sizes", () => {
		const ledger = new ResourceLedger(ORIGIN, deferred);
		expect(ledger.record(file("/models/missing.glb", 120, { responseStatus: 404 }))).toBe(false);
		expect(ledger.record({ ...file("/x", 999), name: "https://analytics.example/collect" })).toBe(false);
		expect(ledger.record(file("/odd", -5))).toBe(true);
		expect(ledger.record(file("/nan", Number.NaN))).toBe(true);
		expect(ledger.record({ ...file("/x", 1), name: "not a url" })).toBe(false);
		expect(ledger.failed).toBe(1);
		expect(ledger.startup.bytes).toBe(0);
		expect(ledger.startup.files).toBe(2);
	});

	it("keeps deferred models and anything requested after Ready out of startup", () => {
		const ledger = new ResourceLedger(ORIGIN, deferred);
		ledger.record(file("/models/rail/metro-train.glb", 25_000_000, { startTime: 5 }));
		ledger.record(file("/models/car.glb", 2000));
		ledger.markReady(100);
		ledger.record(file("/audio/amb-street.ogg", 500, { startTime: 120, responseEnd: 130 }));
		expect(ledger.startup.bytes).toBe(2000);
		expect(ledger.background).toEqual({ files: 2, bytes: 25_000_500, networkBytes: 25_000_500, cachedBytes: 0 });
	});

	it("fixes the initial payload at Ready, whatever order the entries are reported in", () => {
		const ledger = new ResourceLedger(ORIGIN, deferred);
		expect(ledger.initialPayload).toBeNull();
		ledger.record(file("/a", 1000, { responseEnd: 40 }));
		ledger.markReady(100);
		// Finished before Ready, reported after it.
		ledger.record(file("/b", 2000, { startTime: 30, responseEnd: 90 }));
		// Asked for before Ready, still arriving after it.
		ledger.record(file("/c", 4000, { startTime: 60, responseEnd: 160 }));
		// A second markReady changes nothing.
		ledger.markReady(500);
		expect(ledger.initialPayload).toEqual({ files: 2, bytes: 3000, networkBytes: 3000, cachedBytes: 0, readyAt: 100, lateFiles: 1, lateBytes: 4000 });
		expect(ledger.startup.bytes).toBe(7000);
	});

	it("formats megabytes as the loading screen shows them", () => {
		expect(formatMegabytes(18_440_000)).toBe("18.4 MB");
		expect(formatMegabytes(0)).toBe("0.0 MB");
		expect(formatMegabytes(-3)).toBe("0.0 MB");
	});
});
