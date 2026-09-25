/*
 * OrionGenix service worker: makes the installed app start fast and survive a weak connection.
 *
 * Three kinds of request, three rules:
 *
 *   /_next/static/…   Game code. Every file name carries a hash of its contents, so a cached copy
 *                     is correct forever: served straight from the cache.
 *
 *   models, textures, environments, audio
 *                     The heavy part (~180 MB). Their names do NOT change when the file does (a
 *                     re-optimised model keeps its path), so they're served from the cache at
 *                     once and quietly re-checked in the background. The re-check is a
 *                     conditional request: an unchanged file costs a few hundred bytes, a changed
 *                     one is fetched once and used from the next start.
 *
 *   pages             Network first, so a new deploy shows up immediately; the cached page is
 *                     used only when offline.
 *
 * Nothing is fetched just to fill the cache except the files the game has already loaded in
 * this session (see "warm" below), taken from the browser's own HTTP cache where possible — so
 * installing never costs a second download of the whole world on mobile data.
 *
 * Only same-origin GET requests are touched. A full cache (a phone short of space) is not an
 * error: the request is simply served from the network as before.
 */

const VERSION = "v1";
const STATIC_CACHE = `orion-static-${VERSION}`;
const ASSET_CACHE = `orion-assets-${VERSION}`;
const PAGE_CACHE = `orion-pages-${VERSION}`;
const KEEP = new Set([STATIC_CACHE, ASSET_CACHE, PAGE_CACHE]);
/** Old builds' code files pile up across deploys; beyond this many, the oldest go. */
const STATIC_LIMIT = 400;

const ASSET_PATH = /^\/(models|textures|environments|audio)\//;
const STATIC_PATH = /^\/_next\/static\//;

self.addEventListener("install", () => {
	// Take over as soon as installed; there's no old version whose pages would break.
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		// Caches from a previous version of this worker.
		for (const name of await caches.keys()) {
			if (name.startsWith("orion-") && !KEEP.has(name)) await caches.delete(name);
		}
		await self.clients.claim();
	})());
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	// Partial requests (media seeking) can't be answered from a whole cached file.
	if (request.headers.has("range")) return;

	if (STATIC_PATH.test(url.pathname)) event.respondWith(cacheFirst(request, STATIC_CACHE));
	else if (ASSET_PATH.test(url.pathname)) event.respondWith(cacheThenRevalidate(event, request));
	else if (request.mode === "navigate") event.respondWith(networkFirst(request));
});

/**
 * The page tells the worker which files it has already loaded, once it controls the page. They
 * were fetched before the worker existed (on the very first visit), so they'd otherwise only be
 * cached on the second visit.
 */
self.addEventListener("message", (event) => {
	const data = event.data;
	if (!data || data.type !== "warm" || !Array.isArray(data.urls)) return;
	event.waitUntil(warm(data.urls));
});

async function warm(urls) {
	const assets = await caches.open(ASSET_CACHE);
	const statics = await caches.open(STATIC_CACHE);
	// The page itself loaded before the worker existed too; without it an offline start fails.
	const pages = await caches.open(PAGE_CACHE);
	if (!(await pages.match("/"))) {
		try {
			const page = await fetch("/", { cache: "force-cache" });
			if (page.ok) await store(pages, "/", page);
		} catch {
			// Offline; the next online start caches it.
		}
	}
	for (const href of urls) {
		let url;
		try {
			url = new URL(href, self.location.origin);
		} catch {
			continue;
		}
		if (url.origin !== self.location.origin) continue;
		const cache = STATIC_PATH.test(url.pathname) ? statics : ASSET_PATH.test(url.pathname) ? assets : null;
		if (!cache || (await cache.match(url.pathname))) continue;
		try {
			// "force-cache": take the copy the browser already holds rather than downloading again.
			const response = await fetch(url.pathname, { cache: "force-cache" });
			if (response.ok) await store(cache, url.pathname, response);
		} catch {
			// Offline or refused; it'll be cached the next time the game loads it.
		}
	}
	// Once a session is a good time to let go of previous builds' code files.
	await trimStatic();
}

async function cacheFirst(request, name) {
	const cache = await caches.open(name);
	const hit = await cache.match(request);
	if (hit) return hit;
	const response = await fetch(request);
	if (response.ok) await store(cache, request, response.clone());
	return response;
}

async function cacheThenRevalidate(event, request) {
	const cache = await caches.open(ASSET_CACHE);
	const hit = await cache.match(request);
	if (!hit) {
		const response = await fetch(request);
		if (response.ok) await store(cache, request, response.clone());
		return response;
	}
	event.waitUntil(revalidate(cache, request, hit).catch(() => undefined));
	return hit;
}

/**
 * Asks the server whether the cached copy is still current, sending its fingerprint (ETag). An
 * unchanged file comes back as an empty 304; only a changed one is downloaded and stored. This
 * is done by hand rather than left to the browser, whose own copy may have been evicted — then
 * a plain re-check would re-download a 20 MB model on every launch.
 */
async function revalidate(cache, request, hit) {
	const etag = hit.headers.get("etag");
	const modified = hit.headers.get("last-modified");
	// With neither, there's no cheap way to ask: keep the copy (a new deploy's new worker version
	// clears the cache if a file ever has to be forced).
	if (!etag && !modified) return;
	const headers = etag ? { "If-None-Match": etag } : { "If-Modified-Since": modified };
	const response = await fetch(request.url, { headers, cache: "no-store" });
	if (response.status === 200) await store(cache, request, response);
}

async function networkFirst(request) {
	const cache = await caches.open(PAGE_CACHE);
	try {
		const response = await fetch(request);
		if (response.ok) await store(cache, request, response.clone());
		return response;
	} catch (error) {
		const hit = (await cache.match(request)) ?? (await cache.match("/"));
		if (hit) return hit;
		throw error;
	}
}

/** Caches a response, shrugging off a full disk. */
async function store(cache, request, response) {
	try {
		await cache.put(request, response);
	} catch {
		// Out of space: this file just isn't kept.
	}
}

async function trimStatic() {
	const cache = await caches.open(STATIC_CACHE);
	const keys = await cache.keys();
	// Cache keys come back in insertion order, so the oldest are first.
	for (let i = 0; i < keys.length - STATIC_LIMIT; i++) await cache.delete(keys[i]);
}
