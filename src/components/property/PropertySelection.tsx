"use client";

import type { ReactNode } from "react";

import { Entity } from "@playcanvas/react";
import { Render } from "@playcanvas/react/components";

import type { PropertyRecord } from "@/engine/orion/properties/Properties";

interface PropertySelectionProps {
	property: PropertyRecord;
	selected: boolean;
	onSelect: (propertyId: string) => void;
	interactive?: boolean;
	markerPosition?: [number, number, number];
	children: ReactNode;
}

export function PropertySelection({
	property,
	selected,
	onSelect,
	interactive = true,
	markerPosition = [0, -0.48, 0],
	children,
}: Readonly<PropertySelectionProps>) {
	return (
		<Entity
			name={property.id}
			position={property.position}
			rotation={property.rotation}
			scale={property.scale}
			onClick={interactive ? () => onSelect(property.id) : undefined}
		>
			{children}
			<Entity
				name={`${property.id}-selection-marker`}
				position={markerPosition}
				scale={[5, 0.12, 5]}
				enabled={selected}
			>
				<Render type="torus" />
			</Entity>
		</Entity>
	);
}