"use client";

import { useState } from "react";

import type { LineageEvent, PropertyRecord } from "./Properties";

const LOCAL_PLAYER_ID = "player-001";

export function usePropertyStore(initialProperties: readonly PropertyRecord[]) {
	const [properties, setProperties] = useState<readonly PropertyRecord[]>(initialProperties);

	function acquireProperty(propertyId: string) {
		setProperties((currentProperties) => currentProperties.map((property) => {
			if (property.id !== propertyId || property.status === "owned") {
				return property;
			}

			const event: LineageEvent = {
				type: "transferred",
				label: "Acquired by Player 001",
				actorId: LOCAL_PLAYER_ID,
				occurredAt: new Date().toISOString(),
			};

			return {
				...property,
				ownerId: LOCAL_PLAYER_ID,
				status: "owned",
				lineage: [...property.lineage, event],
			};
		}));
	}

	function makeOffer(propertyId: string) {
		setProperties((currentProperties) => currentProperties.map((property) => {
			if (property.id !== propertyId || property.status !== "owned") {
				return property;
			}

			const event: LineageEvent = {
				type: "offer-received",
				label: "Offer received from Orion market",
				actorId: LOCAL_PLAYER_ID,
				occurredAt: new Date().toISOString(),
			};

			return {
				...property,
				saleStatus: "offer-received",
				lineage: [...property.lineage, event],
			};
		}));
	}

	return { properties, acquireProperty, makeOffer };
}

export { LOCAL_PLAYER_ID };