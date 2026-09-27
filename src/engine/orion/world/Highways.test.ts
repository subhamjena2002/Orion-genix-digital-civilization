import { describe, expect, it } from "vitest";

import { pavedHeightAt } from "../roads/RoadNetwork";
import { ROAD_TOP_Y } from "../traffic/TrafficSignals";
import { buildHighwayMeshes } from "./HighwayMeshes";
import { HIGHWAY_GEOMETRY, HIGHWAYS, highwaySurfaceAt, projectOnto, spanAt } from "./Highways";
import { LAND_Y, MASSIFS, massifHeight, terrainHeightAt, toLocal, tunnelCrownRise } from "./Mountains";
import { ORION_OCEAN } from "./Ocean";
import { isOnLand } from "./StateOutline";

const byId = (id: string) => HIGHWAYS.find((highway) => highway.id === id)!;

describe("highway routes", () => {
	it("leave from a city road, level with it", () => {
		for (const highway of HIGHWAYS) {
			const start = highway.samples[0];
			expect(pavedHeightAt(start.x, start.z)).not.toBeNull();
			expect(start.y).toBeCloseTo(ROAD_TOP_Y, 3);
		}
	});

	it("stay on land except on bridges, and every bridge starts and ends on land", () => {
		for (const highway of HIGHWAYS) {
			for (const sample of highway.samples) {
				if (spanAt(highway, sample.distance)?.kind === "bridge") continue;
				expect(isOnLand(sample.x, sample.z), `${highway.id} at ${sample.distance.toFixed(0)} m`).toBe(true);
			}
			for (const span of highway.spans.filter((candidate) => candidate.kind === "bridge")) {
				const ends = highway.samples.filter((sample) => Math.abs(sample.distance - span.from) < 4 || Math.abs(sample.distance - span.to) < 4);
				for (const end of ends) expect(isOnLand(end.x, end.z)).toBe(true);
			}
		}
	});

	it("crosses open sea on the Sea Link, high enough above the water", () => {
		const link = byId("sea-link");
		const overWater = link.samples.filter((sample) => !isOnLand(sample.x, sample.z));
		expect(overWater.length * HIGHWAY_GEOMETRY.sampleSpacing).toBeGreaterThan(200);
		for (const sample of overWater) {
			expect(spanAt(link, sample.distance)?.kind).toBe("bridge");
			expect(sample.y - ORION_OCEAN.level).toBeGreaterThan(5);
		}
	});

	it("keeps gradients drivable", () => {
		for (const highway of HIGHWAYS) {
			for (let i = 1; i < highway.samples.length; i++) {
				const a = highway.samples[i - 1];
				const b = highway.samples[i];
				expect(Math.abs(b.y - a.y) / (b.distance - a.distance)).toBeLessThan(0.08);
			}
		}
	});

	it("bores each tunnel dead straight", () => {
		for (const highway of HIGHWAYS) {
			for (const span of highway.spans.filter((candidate) => candidate.kind === "tunnel")) {
				const bore = highway.samples.filter((sample) => sample.distance >= span.from && sample.distance <= span.to);
				expect(bore.length).toBeGreaterThan(10);
				for (const sample of bore) {
					expect(sample.dirX * bore[0].dirX + sample.dirZ * bore[0].dirZ).toBeGreaterThan(Math.cos((0.5 * Math.PI) / 180));
				}
			}
		}
	});

	it("reports the road surface on the carriageway and nothing off it", () => {
		const link = byId("sea-link");
		const middle = link.samples[Math.floor(link.samples.length / 2)];
		expect(highwaySurfaceAt(middle.x, middle.z)).toBeCloseTo(middle.y, 3);
		expect(highwaySurfaceAt(middle.x - middle.dirZ * 30, middle.z + middle.dirX * 30)).toBeNull();
		const hit = projectOnto(link, middle.x - middle.dirZ * 5, middle.z + middle.dirX * 5);
		expect(hit.lateral).toBeCloseTo(5, 3);
	});
});

describe("mountains", () => {
	it("never overlap one another", () => {
		const corners = (index: number) => {
			const m = MASSIFS[index];
			return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => [
				m.centreX + m.ux * su * m.halfLength - m.uz * sv * m.halfWidth,
				m.centreZ + m.uz * su * m.halfLength + m.ux * sv * m.halfWidth,
			]);
		};
		const axes = (points: number[][]) => [0, 1].map((k) => {
			const [x0, z0] = points[k];
			const [x1, z1] = points[k + 1];
			return [-(z1 - z0), x1 - x0];
		});
		for (let i = 0; i < MASSIFS.length; i++) {
			for (let j = i + 1; j < MASSIFS.length; j++) {
				const a = corners(i);
				const b = corners(j);
				const separated = [...axes(a), ...axes(b)].some(([ax, az]) => {
					const pa = a.map(([x, z]) => x * ax + z * az);
					const pb = b.map(([x, z]) => x * ax + z * az);
					return Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa);
				});
				expect(separated, `${MASSIFS[i].id} overlaps ${MASSIFS[j].id}`).toBe(true);
			}
		}
	});

	it("rise to real peaks, and stay flat in the city and at sea", () => {
		for (const massif of MASSIFS) {
			let highest = 0;
			for (let u = -massif.halfLength; u <= massif.halfLength; u += 10) {
				for (let v = -massif.halfWidth; v <= massif.halfWidth; v += 10) highest = Math.max(highest, massifHeight(massif, u, v));
			}
			expect(highest, massif.id).toBeGreaterThan(massif.peak * 0.45);
		}
		for (const [x, z] of [[0, 0], [-380, 0], [380, -200], [-390, 230], [1200, 0], [0, -700]]) {
			expect(terrainHeightAt(x, z)).toBeCloseTo(LAND_Y, 5);
		}
	});

	it("never bury a road: the ground stays under the carriageway outside tunnels", () => {
		for (const highway of HIGHWAYS) {
			for (const sample of highway.samples) {
				if (spanAt(highway, sample.distance)) continue;
				for (const lateral of [0, -HIGHWAY_GEOMETRY.halfWidth, HIGHWAY_GEOMETRY.halfWidth]) {
					const x = sample.x - sample.dirZ * lateral;
					const z = sample.z + sample.dirX * lateral;
					expect(terrainHeightAt(x, z), `${highway.id} at ${sample.distance.toFixed(0)} m`).toBeLessThanOrEqual(sample.y + 0.01);
				}
			}
		}
	});

	it("leaves the valley under every bridge clear of the deck", () => {
		for (const highway of HIGHWAYS) {
			for (const sample of highway.samples) {
				if (spanAt(highway, sample.distance)?.kind !== "bridge") continue;
				for (const lateral of [0, -HIGHWAY_GEOMETRY.halfWidth, HIGHWAY_GEOMETRY.halfWidth]) {
					const x = sample.x - sample.dirZ * lateral;
					const z = sample.z + sample.dirX * lateral;
					expect(terrainHeightAt(x, z), `${highway.id} at ${sample.distance.toFixed(0)} m`).toBeLessThan(sample.y - 2);
				}
			}
		}
	});

	it("opens the cutting right up to each tunnel mouth, so nothing stands across the road", () => {
		const ridge = MASSIFS.find((massif) => massif.tunnel)!;
		const tunnel = ridge.tunnel!;
		for (const side of [-1, 1]) {
			for (const du of [0, 0.4, 2, 6]) {
				for (const v of [-9, -5, 0, 5, 9]) {
					expect(massifHeight(ridge, side * (tunnel.halfLength + du), v, "open"), `u=${side}·(T+${du}) v=${v}`).toBeLessThan(tunnel.roadRise);
				}
			}
		}
	});

	it("covers the whole tunnel with rock", () => {
		const ridge = MASSIFS.find((massif) => massif.tunnel)!;
		const tunnel = ridge.tunnel!;
		for (let u = -tunnel.halfLength + 1; u < tunnel.halfLength; u += 4) {
			for (const v of [-8, 0, 8]) {
				expect(massifHeight(ridge, u, v, "roof")).toBeGreaterThanOrEqual(tunnelCrownRise(tunnel) + HIGHWAY_GEOMETRY.tunnelCover - 0.01);
			}
		}
		// The ridge is a real mountain over it, not a hump.
		expect(massifHeight(ridge, 0, 0, "roof")).toBeGreaterThan(25);
		// And the tunnel runs through the massif's middle, along its u axis.
		const mid = toLocal(ridge, (tunnel.highway.samples[0].x), tunnel.highway.samples[0].z);
		expect(Math.abs(mid.u)).toBeGreaterThan(tunnel.halfLength);
	});
});

describe("highway meshes", () => {
	it("build every part with sound triangles", () => {
		for (const highway of HIGHWAYS) {
			const set = buildHighwayMeshes(highway);
			for (const [name, mesh] of Object.entries(set)) {
				expect(mesh.indices.length % 3, name).toBe(0);
				const vertices = mesh.positions.length / 3;
				for (const index of mesh.indices) expect(index).toBeLessThan(vertices);
				expect(mesh.positions.every(Number.isFinite), name).toBe(true);
			}
			expect(set.road.indices.length).toBeGreaterThan(0);
			expect(set.collision.indices.length).toBeGreaterThan(set.road.indices.length);
		}
		expect(buildHighwayMeshes(byId("sea-link")).cables.indices.length).toBeGreaterThan(0);
		expect(buildHighwayMeshes(byId("ghats-expressway")).tunnelLining.indices.length).toBeGreaterThan(0);
	});
});
