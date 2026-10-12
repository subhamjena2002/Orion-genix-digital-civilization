import type { Texture } from "playcanvas";
import { describe, expect, it } from "vitest";

import { fitWithin, releaseUploadedImages, rememberFileBytes, textureCapFor } from "./TextureBudget";

/** Just the fields the release reads: a pixel source and whether an upload is still pending. */
function fakeTexture(uploaded: boolean) {
	return { _levels: [{ width: 1024, height: 1024 }] as unknown[], _needsUpload: !uploaded, _needsMipmapsUpload: !uploaded };
}

describe("texture budget", () => {
	it("caps at 1024 on a desktop, 512 on phones and small machines, 2048 with full quality pinned", () => {
		expect(textureCapFor({ deviceMemory: 8, coarsePointer: false, fullQuality: false })).toBe(1024);
		// Safari doesn't report memory: a desktop without the figure isn't assumed small.
		expect(textureCapFor({ coarsePointer: false, fullQuality: false })).toBe(1024);
		expect(textureCapFor({ deviceMemory: 4, coarsePointer: false, fullQuality: false })).toBe(512);
		expect(textureCapFor({ coarsePointer: true, fullQuality: false })).toBe(512);
		expect(textureCapFor({ deviceMemory: 2, coarsePointer: true, fullQuality: true })).toBe(2048);
	});

	it("scales down to fit, keeping proportions, and never up", () => {
		expect(fitWithin(2048, 2048, 1024)).toEqual({ width: 1024, height: 1024 });
		expect(fitWithin(2048, 1024, 1024)).toEqual({ width: 1024, height: 512 });
		expect(fitWithin(1000, 500, 1024)).toEqual({ width: 1000, height: 500 });
		expect(fitWithin(4096, 1, 512)).toEqual({ width: 512, height: 1 });
	});

	it("lets go only of model images already on the GPU, once", () => {
		const uploaded = fakeTexture(true);
		const pending = fakeTexture(false);
		const notFromAModel = fakeTexture(true);
		rememberFileBytes(uploaded as unknown as Texture, new ArrayBuffer(8));
		rememberFileBytes(pending as unknown as Texture, new ArrayBuffer(8));
		const textures = [uploaded, pending, notFromAModel] as unknown as Texture[];

		expect(releaseUploadedImages(textures)).toBe(1);
		expect(uploaded._levels[0]).toBeNull();
		// Still to be uploaded: the engine needs the picture for that.
		expect(pending._levels[0]).not.toBeNull();
		// No file bytes to decode it again from, so it's kept.
		expect(notFromAModel._levels[0]).not.toBeNull();
		expect(releaseUploadedImages(textures)).toBe(0);

		pending._needsUpload = false;
		pending._needsMipmapsUpload = false;
		expect(releaseUploadedImages(textures)).toBe(1);
		expect(pending._levels[0]).toBeNull();
	});

	it("lets go of a few per check, so a model's worth arriving at once doesn't cost one frame", () => {
		const batch = Array.from({ length: 5 }, () => fakeTexture(true));
		for (const texture of batch) rememberFileBytes(texture as unknown as Texture, new ArrayBuffer(8));
		const textures = batch as unknown as Texture[];
		expect(releaseUploadedImages(textures, 2)).toBe(2);
		expect(releaseUploadedImages(textures, 2)).toBe(2);
		expect(releaseUploadedImages(textures, 2)).toBe(1);
		expect(batch.every((texture) => texture._levels[0] === null)).toBe(true);
	});
});
