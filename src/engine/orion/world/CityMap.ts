export interface WorldAddress {
	cityId: string;
	regionId: string;
	districtId: string;
	blockId: string | null;
	parcelId: string | null;
}

export const ORION_START_ADDRESS: WorldAddress = {
	cityId: "orion-city-001",
	regionId: "north-region",
	districtId: "low-density-residential",
	blockId: "low-density-residential-block-001",
	parcelId: "parcel-001",
};