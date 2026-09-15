export interface InstanceBatchDefinition {
	id: string;
	assetId: string;
	maxInstances: number;
	materialVariant: string | null;
}

export const ORION_INSTANCE_BATCHES: readonly InstanceBatchDefinition[] = [
	{ id: "instance-street-trees", assetId: "vegetation-street-tree", maxInstances: 500, materialVariant: "default" },
	{ id: "instance-street-lights", assetId: "prop-street-light-standard", maxInstances: 300, materialVariant: "default" },
	{ id: "instance-bollards", assetId: "prop-bollard-standard", maxInstances: 500, materialVariant: "default" },
];