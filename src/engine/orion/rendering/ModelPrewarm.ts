import { fetchAsset } from "@playcanvas/react/utils";
import { BoundingBox, Entity as EntityClass, MeshInstance as MeshInstanceClass, SHADERDEF_BATCH, type AppBase, type Asset, type ContainerResource, type Entity, type Material, type MeshInstance, type RenderComponent } from "playcanvas";

import { VEHICLE_MODEL_BASE, VEHICLE_MODELS } from "../traffic/VehicleModels";
import { enableAsyncShaderCompile } from "./AsyncShaderCompile";

/**
 * Loads the city's models up front and draws each once, out of sight, so driving into a new
 * area doesn't stall.
 *
 * Models were fetched the first time a building or car of that kind came into range, and a
 * material's shaders compile the first time it's drawn (about 70 ms each here, blocking) — so
 * the first drive through a district froze for a quarter to over a second at a time. Doing it
 * while the game starts moves that cost to where nobody is driving yet.
 *
 * Fetched exactly as `useModel(url)` fetches (same asset key), so the scene reuses these loads
 * rather than repeating them.
 *
 * The train, the army base's kit, the aircraft and the vehicles marked `deferred` aren't here: they
 * load after the loading screen (see DeferredModels), and are drawn the same way as they arrive —
 * but a material at a time (`gradual`), because by then someone is playing. Drawn whole, the
 * base's kit compiled about 21 shader programs in one frame and froze the game for ~3 s (measured
 * in Phase 2.1); a material per step spreads that over many short frames.
 */

/** Frames each model (or, gradually, each material) stays drawn: colour, shadow and post passes. */
const DRAWN_FRAMES = 3;
/** Most frames to wait for one material's shaders before moving on regardless. */
const MATERIAL_WAIT_FRAMES = 90;
/**
 * Largest size of the speck in front of the lens, m: far too small to see. Scaled from the model's
 * own bounds, since models come in metres, centimetres or millimetres — a fixed scale left the
 * millimetre-built civic vehicles metres across in front of the camera while the game loaded.
 */
const SPECK_SIZE = 0.002;

export function modelsToPrewarm(): string[] {
	// Buildings aren't here: they're built in code (CityBuilding) on a few shared materials.
	const urls = new Set<string>();
	for (const spec of VEHICLE_MODELS) if (!spec.deferred) urls.add(`${VEHICLE_MODEL_BASE}/${spec.file}`);
	return [...urls];
}

export interface PrewarmOptions {
	/** Fetches a model instead of the plain fetch (DeferredModels releases each to the scene first). */
	load?: (url: string) => Promise<Asset>;
	/** Draw a material at a time, each until its shaders are ready, rather than the whole model. */
	gradual?: boolean;
	/** Each model once it has been drawn, failed or been skipped by a cancel. */
	onDone?: (url: string) => void;
	/**
	 * Models the scene draws inside a static batch (the army base's kit). A batched draw carries
	 * the engine's BATCH shader flag, a different shader key from the same mesh drawn on its own,
	 * so the prewarm draws these with `batching` set: otherwise it builds shaders the scene never
	 * uses and the batch links its own on first sight (measured: the defines were 66060 against
	 * 82444, the difference being SHADERDEF_BATCH).
	 */
	batched?: (url: string) => boolean;
}

/**
 * One model at a time, in the background: fetch, draw for a few frames at the camera, remove.
 * Returns a cancel for when the camera goes away.
 */
export function prewarmModels(app: AppBase, camera: Entity, urls: readonly string[], options: PrewarmOptions = {}): () => void {
	const { load, gradual = false, onDone, batched } = options;
	let cancelled = false;
	let current: Entity | null = null;

	const waitFrames = frameWaiter(app, () => cancelled);

	const done = new Set<string>();
	const finish = (url: string) => {
		if (done.has(url)) return;
		done.add(url);
		onDone?.(url);
	};

	// Gradually, the shaders also build in the background: a material's programs no longer hold up
	// the frame they're first drawn in (see AsyncShaderCompile). Only for as long as this run lasts.
	const stopAsyncCompile = gradual ? enableAsyncShaderCompile(app) : () => {};

	const run = async () => {
		for (const url of urls) {
			if (cancelled) return;
			try {
				// fetchAsset only uses the asset registry, which every AppBase has.
				const asset = await (load ? load(url) : fetchAsset({ app: app as Parameters<typeof fetchAsset>[0]["app"], url, type: "container" }));
				if (cancelled) return;
				const resource = asset.resource as ContainerResource | undefined;
				if (!resource?.instantiateRenderEntity) continue;
				current = resource.instantiateRenderEntity();
				camera.addChild(current);
				current.setLocalPosition(0, 0, -1.5);
				current.setLocalScale(1, 1, 1);
				const scale = SPECK_SIZE / Math.max(largestSize(current), 1e-6);
				current.setLocalScale(scale, scale, scale);
				if (batched?.(url)) drawAsBatched(current);
				if (gradual) await drawByMaterial(current, waitFrames, () => cancelled);
				else await waitFrames(DRAWN_FRAMES);
			} catch {
				// A model that fails here fails in the scene too, where it's already handled.
			} finally {
				current?.destroy();
				current = null;
				if (!cancelled) finish(url);
			}
		}
	};
	void run().finally(stopAsyncCompile);

	return () => {
		cancelled = true;
		stopAsyncCompile();
		current?.destroy();
		current = null;
		// Nobody is left to draw them: whoever waits on them mustn't wait for ever.
		for (const url of urls) finish(url);
	};
}

/**
 * Shows `root` a material at a time: every mesh drawn with the next material is revealed, and kept
 * drawn until all that material's shaders are built (at least DRAWN_FRAMES, at most
 * MATERIAL_WAIT_FRAMES), then the next. Materials whose shaders were already built pass in a step.
 */
export async function drawByMaterial(root: Entity, waitFrames: (count: number) => Promise<void>, cancelled: () => boolean): Promise<void> {
	const groups = materialGroups(root);
	for (const instances of groups.values()) for (const instance of instances) instance.visible = false;
	for (const [material, instances] of groups) {
		if (cancelled()) return;
		for (const instance of instances) instance.visible = true;
		let frames = 0;
		do {
			await waitFrames(1);
			frames++;
		} while (!cancelled() && frames < MATERIAL_WAIT_FRAMES && (frames < DRAWN_FRAMES || !shadersBuilt(material)));
	}
}

/** Resolves after `count` rendered frames (or at once, frame-wise, once `cancelled`). */
function frameWaiter(app: AppBase, cancelled: () => boolean): (count: number) => Promise<void> {
	return (count: number) => new Promise<void>((resolve) => {
		let left = count;
		const onFrame = () => {
			if (--left > 0 && !cancelled()) return;
			app.off("frameend", onFrame);
			resolve();
		};
		app.on("frameend", onFrame);
	});
}

/**
 * Builds the shaders of materials the scene will only draw later, by drawing `instances` as a
 * speck at the camera a material at a time until they're built (`drawByMaterial`), with the
 * driver compiling in the background meanwhile (AsyncShaderCompile). For a material made in code
 * rather than loaded with a model — the vehicle LODs' flat paint, whose first sight linked its
 * shader in one 280–370 ms frame (measured, Phase 2.3). Resolves once done; the speck is gone.
 */
export async function prewarmMeshInstances(app: AppBase, camera: Entity, instances: readonly MeshInstance[]): Promise<void> {
	if (instances.length === 0) return;
	let finished = false;
	const stopAsyncCompile = enableAsyncShaderCompile(app);
	const speck = new EntityClass("prewarm-materials");
	try {
		speck.addComponent("render", { meshInstances: [...instances], castShadows: true, receiveShadows: true });
		camera.addChild(speck);
		speck.setLocalPosition(0, 0, -1.5);
		const scale = SPECK_SIZE / Math.max(largestSize(speck), 1e-6);
		speck.setLocalScale(scale, scale, scale);
		await drawByMaterial(speck, frameWaiter(app, () => finished), () => finished);
	} finally {
		finished = true;
		speck.destroy();
		stopAsyncCompile();
	}
}

/** How often the loading-time scene prewarm looks for materials not yet drawn, ms. */
const SCENE_SCAN_MS = 600;

/** What a scene mesh needs drawn to build the shader it will be drawn with. */
export interface SceneWarmCandidate {
	instance: MeshInstance;
	castShadow: boolean;
	receiveShadow: boolean;
	/** In a static batch: drawn with the batch shader key (see `PrewarmOptions.batched`). */
	batched: boolean;
	/** Material, shader defines and shadow casting: one per shader. */
	key: string;
}

/** The engine's per-instance shader inputs (internal: `_shaderDefs`, and the shaders it has used). */
function internals(instance: MeshInstance): { shaderDefs: number; drawn: boolean } {
	const inner = instance as unknown as { _shaderDefs: number; _shaderCache?: Map<unknown, unknown> };
	return { shaderDefs: inner._shaderDefs, drawn: (inner._shaderCache?.size ?? 0) > 0 };
}

/**
 * One mesh instance per shader the scene will need and hasn't built yet. The engine keys a
 * material's shaders by the instance's shader defines (vertex streams, shadow receiving, batching)
 * as well as the material, so a material shared by many meshes needs a shader per kind of mesh:
 * an instance is wanted if it has never been drawn and no drawn instance has its material and
 * defines. Skinned, morphed and dynamically batched meshes are left out: their shaders need the
 * skin, so a copy drawn elsewhere wouldn't build the right one. `isDynamicGroup` says whether a
 * batch group is dynamic.
 */
export function sceneWarmCandidates(root: Entity, isDynamicGroup: (groupId: number) => boolean): SceneWarmCandidate[] {
	const renders = (root.findComponents("render") as RenderComponent[])
		.filter((render) => !render.entity.name.startsWith("prewarm") && render.entity.name !== "shader-prewarm");
	const keyOf = (instance: MeshInstance, batched: boolean) => `${instance.material.id}|${internals(instance).shaderDefs | (batched ? SHADERDEF_BATCH : 0)}`;
	const drawn = new Set<string>();
	for (const render of renders) {
		for (const instance of render.meshInstances) {
			if (instance.material && internals(instance).drawn) drawn.add(keyOf(instance, false));
		}
	}
	const found = new Map<string, SceneWarmCandidate>();
	for (const render of renders) {
		if (!render.enabled) continue;
		const group = render.batchGroupId ?? -1;
		if (group >= 0 && isDynamicGroup(group)) continue;
		for (const instance of render.meshInstances) {
			const material = instance.material as (Material & { variants?: Map<unknown, unknown> }) | null;
			if (!instance.visible || !material?.variants || !instance.mesh?.vertexBuffer) continue;
			if (instance.skinInstance || instance.morphInstance || internals(instance).drawn) continue;
			const key = keyOf(instance, group >= 0);
			if (drawn.has(key)) continue;
			const withShadow = `${key}|${render.castShadows}`;
			if (!found.has(withShadow)) found.set(withShadow, { instance, castShadow: render.castShadows, receiveShadow: render.receiveShadows, batched: group >= 0, key: withShadow });
		}
	}
	return [...found.values()];
}

/**
 * While the loading screen is up, builds the shaders of the named parts of the world (`roots`,
 * entity names) that haven't been drawn yet, so they don't stop the game the first time they come
 * into view.
 *
 * A shader is linked the first time something using it is drawn, and on this hardware some of the
 * world's take 0.3–1.3 s each: the estate pavement and asphalt, the palm trunks and fronds, the
 * street lights, the railway track (measured in Chrome traces, Phase 2.7). Whether they were first
 * drawn just before the loading screen went or just after was a matter of luck; after, the game
 * froze for that long. Kept to those parts: building every material in the scene up front kept the
 * GPU busy compiling programs that weren't needed yet, and the first seconds of play got no
 * smoother (measured).
 *
 * Every SCENE_SCAN_MS the roots are searched for materials never drawn (see `sceneWarmCandidates`);
 * a copy of one mesh per shader is drawn as a speck in front of the lens for DRAWN_FRAMES frames,
 * linking as a normal draw would, behind the loading screen. It stops, and takes its speck away,
 * as soon as `finished()` says the game is showing: it never draws after that, and it doesn't
 * delay the game being shown.
 */
export function prewarmSceneMaterials(app: AppBase, camera: Entity, roots: readonly string[], finished: () => boolean): () => void {
	let stopped = false;
	let specks: Entity[] = [];
	// Drawn by the speck already: the scene's own instance still hasn't been, so it would be found again.
	const warmed = new Set<string>();
	let timer = 0;
	const clear = () => {
		for (const speck of specks) speck.destroy();
		specks = [];
	};
	const stop = () => {
		if (stopped) return;
		stopped = true;
		window.clearTimeout(timer);
		clear();
	};
	const waitFrames = frameWaiter(app, () => stopped || finished());
	const isDynamicGroup = (id: number) => Boolean((app.batcher as unknown as { _batchGroups?: Record<number, { dynamic?: boolean }> } | null)?._batchGroups?.[id]?.dynamic);

	const pass = async () => {
		if (stopped) return;
		if (finished()) return stop();
		const candidates = roots
			.map((name) => app.root.findByName(name) as Entity | null)
			.flatMap((root) => (root ? sceneWarmCandidates(root, isDynamicGroup) : []))
			.filter((candidate) => !warmed.has(candidate.key));
		for (const candidate of candidates) warmed.add(candidate.key);
		if (candidates.length > 0) {
			// One speck per shadow setting: a render component sets casting and receiving for all
			// its mesh instances, and both are part of the shader.
			const bySetting = new Map<string, SceneWarmCandidate[]>();
			for (const candidate of candidates) {
				const key = `${candidate.castShadow}|${candidate.receiveShadow}`;
				const list = bySetting.get(key);
				if (list) list.push(candidate);
				else bySetting.set(key, [candidate]);
			}
			for (const list of bySetting.values()) {
				const speck = new EntityClass("prewarm-scene");
				// Copies: the scene's own mesh instances stay where they are and are never reassigned.
				const instances = list.map((candidate) => {
					const copy = new MeshInstanceClass(candidate.instance.mesh, candidate.instance.material);
					if (candidate.batched) copy.batching = true;
					return copy;
				});
				speck.addComponent("render", { meshInstances: instances, castShadows: list[0].castShadow, receiveShadows: list[0].receiveShadow });
				camera.addChild(speck);
				speck.setLocalPosition(0, 0, -1.5);
				const scale = SPECK_SIZE / Math.max(largestSize(speck), 1e-6);
				speck.setLocalScale(scale, scale, scale);
				specks.push(speck);
			}
			await waitFrames(DRAWN_FRAMES);
			clear();
		}
		if (stopped) return;
		if (finished()) return stop();
		timer = window.setTimeout(() => void pass(), SCENE_SCAN_MS);
	};
	void pass();
	// Also checked on a timer, so the speck goes at once when the game shows even if no frame
	// is drawn meanwhile.
	const watch = window.setInterval(() => {
		if (stopped || finished()) {
			window.clearInterval(watch);
			stop();
		}
	}, 100);
	return () => {
		window.clearInterval(watch);
		stop();
	};
}

/** Gives every mesh `root` draws the shader key of a static batch (see `PrewarmOptions.batched`). */
export function drawAsBatched(root: Entity): void {
	for (const instances of materialGroups(root).values()) for (const instance of instances) instance.batching = true;
}

/** Every mesh instance `root` draws, by material, in the order first met. */
export function materialGroups(root: Entity): Map<Material, MeshInstance[]> {
	const groups = new Map<Material, MeshInstance[]>();
	for (const render of root.findComponents("render") as RenderComponent[]) {
		for (const instance of render.meshInstances) {
			const group = groups.get(instance.material);
			if (group) group.push(instance);
			else groups.set(instance.material, [instance]);
		}
	}
	return groups;
}

/**
 * Whether the material has been drawn and every shader it was drawn with is linked and ready (or
 * has failed, which drawing again won't change). The engine keeps them in `material.variants`.
 */
export function shadersBuilt(material: Material): boolean {
	const variants = (material as unknown as { variants?: Map<unknown, { ready: boolean; failed: boolean }> }).variants;
	if (!variants || variants.size === 0) return false;
	for (const shader of variants.values()) if (!shader.ready && !shader.failed) return false;
	return true;
}

/** The largest dimension of everything an entity draws, in world units. */
function largestSize(root: Entity): number {
	const bounds = new BoundingBox();
	let first = true;
	for (const render of root.findComponents("render") as RenderComponent[]) {
		for (const instance of render.meshInstances) {
			if (first) bounds.copy(instance.aabb);
			else bounds.add(instance.aabb);
			first = false;
		}
	}
	if (first) return 0;
	const half = bounds.halfExtents;
	return 2 * Math.max(half.x, half.y, half.z);
}
