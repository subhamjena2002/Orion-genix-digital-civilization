"use client";

import { Entity } from "@playcanvas/react";
import { useApp } from "@playcanvas/react/hooks";
import { Entity as PlayCanvasEntity, Mesh, MeshInstance, PRIMITIVE_TRIANGLES, StandardMaterial } from "playcanvas";
import { memo, useEffect, useState } from "react";

import type { DistrictGeometry, ParkedCarSpot } from "@/engine/orion/world/DistrictProps";
import { DOWNTOWN_PARKED_CARS, downtownGeometry } from "@/engine/orion/world/DowntownCore";
import { SPAWN_PARKED_CARS, spawnDistrictGeometry } from "@/engine/orion/world/SpawnDistrict";

import { ParkedVehicle } from "./Vehicles";

/** The spawn district's car park, plaza, garden and avenue furniture (see world/SpawnDistrict). */
export const SpawnDistrict = memo(function SpawnDistrict() {
	return <DistrictDressing name="spawn-district" build={spawnDistrictGeometry} cars={SPAWN_PARKED_CARS} seed={6113} />;
});

/** Downtown's car park, market square, railside fences and avenue furniture (see world/DowntownCore). */
export const DowntownDressing = memo(function DowntownDressing() {
	return <DistrictDressing name="downtown-dressing" build={downtownGeometry} cars={DOWNTOWN_PARKED_CARS} seed={7019} />;
});

/**
 * A district's dressing: one vertex-coloured mesh, one draw call and its shadow, and one static
 * collider for the solid pieces. The cars in its car park are real ones, there for the taking.
 */
function DistrictDressing({ name, build, cars, seed }: Readonly<{ name: string; build: () => DistrictGeometry; cars: readonly ParkedCarSpot[]; seed: number }>) {
	const app = useApp();
	const [root, setRoot] = useState<PlayCanvasEntity | null>(null);

	useEffect(() => {
		if (!app || !root) return;
		const device = app.graphicsDevice;
		const { props, collider } = build();

		const mesh = new Mesh(device);
		mesh.setPositions(props.positions);
		mesh.setNormals(props.normals);
		mesh.setUvs(0, props.uvs);
		mesh.setColors(props.colors!);
		mesh.setIndices(new Uint16Array(props.indices));
		mesh.update(PRIMITIVE_TRIANGLES);

		const material = new StandardMaterial();
		material.name = `${name}-props`;
		material.diffuseVertexColor = true;
		material.useMetalness = true;
		material.metalness = 0;
		material.gloss = 0.35;
		material.update();

		const geometry = new PlayCanvasEntity(`${name}-geometry`);
		geometry.addComponent("render", { meshInstances: [new MeshInstance(mesh, material)], castShadows: true, receiveShadows: true });
		root.addChild(geometry);

		const colliderMesh = new Mesh(device);
		colliderMesh.setPositions(collider.positions);
		colliderMesh.setIndices(new Uint16Array(collider.indices));
		colliderMesh.update(PRIMITIVE_TRIANGLES);
		const solid = new PlayCanvasEntity(`${name}-solid`);
		// The collision component only reads `meshes` from a render resource.
		solid.addComponent("collision", { type: "mesh", render: { meshes: [colliderMesh] } as never });
		solid.addComponent("rigidbody", { type: "static" });
		root.addChild(solid);

		return () => {
			geometry.destroy();
			solid.destroy();
			mesh.destroy();
			colliderMesh.destroy();
			material.destroy();
		};
	}, [app, root, name, build]);

	return (
		<>
			<Entity ref={setRoot} name={name} />
			{cars.map((car, index) => (
				<ParkedVehicle
					key={car.id}
					vehicle={{ id: car.id, style: car.style, colour: car.colour, seed: seed * (index + 1), speedFactor: 1 }}
					home={{ x: car.x, z: car.z, yaw: car.yaw, ground: car.ground }}
				/>
			))}
		</>
	);
}
