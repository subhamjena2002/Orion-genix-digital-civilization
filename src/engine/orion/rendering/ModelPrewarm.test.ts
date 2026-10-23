import type { Entity, Material } from "playcanvas";
import { describe, expect, it } from "vitest";

import { MILITARY_KIT_MODEL, STATIC_BATCHED_MODELS } from "./DeferredModels";
import { drawAsBatched, drawByMaterial, materialGroups, sceneWarmCandidates, shadersBuilt } from "./ModelPrewarm";

interface FakeShader {
	ready: boolean;
	failed: boolean;
}

interface FakeInstance {
	material: Material;
	visible: boolean;
}

/** A material with the engine's per-material shader cache (`variants`), empty until drawn. */
function material(name: string) {
	return { name, variants: new Map<number, FakeShader>() } as unknown as Material & { variants: Map<number, FakeShader> };
}

/** An entity drawing one mesh per entry, with that entry's material. */
function model(materials: Material[]): Entity {
	const meshInstances: FakeInstance[] = materials.map((m) => ({ material: m, visible: true }));
	return { findComponents: () => [{ meshInstances }] } as unknown as Entity;
}

/**
 * A frame clock that "draws" the visible meshes each frame: a material drawn for the first time
 * gets a shader that is built `buildFrames` frames later (Infinity: never).
 */
function frames(root: Entity, buildFrames: (name: string) => number) {
	const groups = materialGroups(root);
	let frame = 0;
	const firstDrawn = new Map<Material, number>();
	const visibleLog: string[][] = [];
	const waitFrames = async (count: number) => {
		for (let i = 0; i < count; i++) {
			frame++;
			const shown: string[] = [];
			for (const [m, instances] of groups) {
				if (!instances.some((instance) => instance.visible)) continue;
				const name = (m as unknown as { name: string }).name;
				shown.push(name);
				if (!firstDrawn.has(m)) firstDrawn.set(m, frame);
				const variants = (m as unknown as { variants: Map<number, FakeShader> }).variants;
				const built = frame - firstDrawn.get(m)! >= buildFrames(name);
				variants.set(0, { ready: built, failed: false });
			}
			visibleLog.push(shown);
		}
	};
	return { waitFrames, visibleLog, frame: () => frame };
}

describe("gradual prewarm", () => {
	it("reveals one material at a time, each until its shaders are built", async () => {
		const [a, b, c] = [material("a"), material("b"), material("c")];
		// Two meshes share "a": it is one step, not two.
		const root = model([a, b, a, c]);
		const clock = frames(root, (name) => (name === "b" ? 5 : 1));
		await drawByMaterial(root, clock.waitFrames, () => false);
		// Nothing but "a" in the first frame: the frame that freezes is one material's, not the model's.
		expect(clock.visibleLog[0]).toEqual(["a"]);
		// "a" takes the minimum 3 frames; "b" stays alone (with "a") until built, 6 frames.
		expect(clock.visibleLog[3]).toEqual(["a", "b"]);
		expect(clock.visibleLog[8]).toEqual(["a", "b"]);
		expect(clock.visibleLog[9]).toEqual(["a", "b", "c"]);
		expect(clock.frame()).toBe(3 + 6 + 3);
	});

	it("moves on from a material whose shaders never build", async () => {
		const [a, b] = [material("a"), material("b")];
		const root = model([a, b]);
		const clock = frames(root, (name) => (name === "a" ? Infinity : 1));
		await drawByMaterial(root, clock.waitFrames, () => false);
		expect(clock.frame()).toBe(90 + 3);
	});

	it("stops when cancelled", async () => {
		const root = model([material("a"), material("b")]);
		const clock = frames(root, () => 1);
		let cancelled = false;
		const waitFrames = async (count: number) => {
			await clock.waitFrames(count);
			cancelled = true;
		};
		await drawByMaterial(root, waitFrames, () => cancelled);
		expect(clock.frame()).toBe(1);
	});

	it("counts a material as built only once drawn, and a failed shader as done", () => {
		const m = material("m");
		expect(shadersBuilt(m)).toBe(false);
		m.variants.set(1, { ready: true, failed: false });
		m.variants.set(2, { ready: false, failed: false });
		expect(shadersBuilt(m)).toBe(false);
		m.variants.set(2, { ready: false, failed: true });
		expect(shadersBuilt(m)).toBe(true);
	});
});

describe("prewarming a statically batched model", () => {
	it("draws every mesh with the batch's shader key", () => {
		const instances = [{ material: material("a"), visible: true, batching: false }, { material: material("b"), visible: true, batching: false }];
		const root = { findComponents: () => [{ meshInstances: instances }] } as unknown as Entity;
		drawAsBatched(root);
		expect(instances.map((instance) => instance.batching)).toEqual([true, true]);
	});

	it("is asked for the base's kit and nothing else", () => {
		expect([...STATIC_BATCHED_MODELS]).toEqual([MILITARY_KIT_MODEL]);
	});
});

describe("scene materials to prewarm before the game shows", () => {
	let nextId = 1;
	const material = () => ({ id: nextId++, variants: new Map() });
	/** A scene mesh instance: `defs` stands for the engine's shader defines (vertex streams, shadows…). */
	const instance = (mat: object, options: { defs?: number; drawn?: boolean; visible?: boolean; skin?: boolean } = {}) => ({
		material: mat, mesh: { vertexBuffer: {} }, visible: options.visible ?? true, skinInstance: options.skin ? {} : null, morphInstance: null,
		_shaderDefs: options.defs ?? 1, _shaderCache: new Map(options.drawn ? [[1, {}]] : []),
	});
	const render = (instances: object[], options: { name?: string; enabled?: boolean; cast?: boolean; receive?: boolean; group?: number } = {}) => ({
		enabled: options.enabled ?? true, entity: { name: options.name ?? "chunk" }, castShadows: options.cast ?? true, receiveShadows: options.receive ?? true, batchGroupId: options.group ?? -1, meshInstances: instances,
	});
	const root = (renders: object[]) => ({ findComponents: () => renders }) as unknown as Entity;
	const none = () => false;

	it("takes one mesh per material and shader defines never drawn", () => {
		const pavement = material(), asphalt = material();
		const found = sceneWarmCandidates(root([render([instance(pavement), instance(pavement), instance(asphalt)])]), none);
		expect(found.map((c) => c.instance.material)).toEqual([pavement, asphalt]);
	});

	it("skips what has been drawn, or shares material and defines with something drawn", () => {
		const track = material();
		const found = sceneWarmCandidates(root([
			render([instance(track, { drawn: true })]),
			render([instance(track)]),
		]), none);
		expect(found).toEqual([]);
	});

	it("still wants a shared material's other kinds of mesh (the railway track's case)", () => {
		const shared = material();
		const found = sceneWarmCandidates(root([
			render([instance(shared, { defs: 1, drawn: true })]),
			render([instance(shared, { defs: 3 })]),
		]), none);
		expect(found).toHaveLength(1);
		expect((found[0].instance as unknown as { _shaderDefs: number })._shaderDefs).toBe(3);
	});

	it("keeps apart what makes a different shader: defines, shadow casting, static batching", () => {
		const palm = material();
		const found = sceneWarmCandidates(root([
			render([instance(palm)]),
			render([instance(palm, { defs: 5 })]),
			render([instance(palm)], { cast: false }),
			render([instance(palm)], { group: 4 }),
			render([instance(palm)], { name: "other-chunk" }),
		]), none);
		expect(found).toHaveLength(4);
		expect(found.filter((c) => c.batched)).toHaveLength(1);
	});

	it("leaves out what a copy can't stand in for, and what isn't drawn", () => {
		const m = material();
		const found = sceneWarmCandidates(root([
			render([instance(m, { skin: true })]),
			render([instance(m, { visible: false })]),
			render([instance(m)], { enabled: false }),
			render([instance(m)], { group: 7 }),
			render([instance(m)], { name: "prewarm-scene" }),
			render([instance(m)], { name: "shader-prewarm" }),
		]), (group) => group === 7);
		expect(found).toEqual([]);
	});
});
