export type Vector3Tuple = [number, number, number];

export type PropertyType = "residential" | "commercial" | "infrastructure";

export type PropertyStatus = "unowned" | "owned";

export type SaleStatus = "not-listed" | "listed" | "offer-received";

export type LineageEventType = "created" | "transferred" | "customized" | "sold" | "offer-received";

export interface LineageEvent {
	type: LineageEventType;
	label: string;
	actorId: string | null;
	occurredAt: string;
}

export interface PropertyRecord {
	id: string;
	type: PropertyType;
	ownerId: string | null;
	status: PropertyStatus;
	position: Vector3Tuple;
	rotation: Vector3Tuple;
	scale: Vector3Tuple;
	parcelId: string;
	districtId: string;
	blockId: string;
	buildingId: string | null;
	value: number;
	saleStatus: SaleStatus;
	currentCustomization: string | null;
	createdAt: string;
	lineage: readonly LineageEvent[];
	metadata: Readonly<Record<string, string>>;
}

function createProperty(
	id: string,
	displayName: string,
	position: Vector3Tuple,
	value: number,
): PropertyRecord {
	return {
		id,
		type: "residential",
		ownerId: null,
		status: "unowned",
		position,
		rotation: [0, 0, 0],
		scale: [1, 1, 1],
		parcelId: `parcel-${id.slice(-3)}`,
		districtId: "low-density-residential",
		blockId: "low-density-residential-block-001",
		buildingId: null,
		value,
		saleStatus: "not-listed",
		currentCustomization: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		lineage: [
			{
				type: "created",
				label: "Created in OrionGenix",
				actorId: null,
				occurredAt: "2026-01-01T00:00:00.000Z",
			},
		],
		metadata: {
			displayName,
			category: "Modern residential facade",
		},
	};
}

export const ORION_PROPERTIES: readonly PropertyRecord[] = [
	createProperty("property-001", "Orion Apartment 001", [-19, 0, -19], 10000),
	createProperty("property-002", "Orion Apartment 002", [19, 0, -19], 12000),
	createProperty("property-003", "Orion Apartment 003", [-19, 0, 19], 11500),
	createProperty("property-004", "Orion Apartment 004", [19, 0, 19], 13500),
];

export const ORION_PROPERTY = ORION_PROPERTIES[0];
