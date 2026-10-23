import { describe, expect, it } from "vitest";

import { ESTATE_NAMES } from "./Estates";
import { placeKind, placeName } from "./PlaceNames";

describe("place names", () => {
	it("calls the spawn district by its neighbourhood's name", () => {
		expect(placeName(0, 0)).toBe("Palm Row");
		expect(placeKind(0, 0)).toBe("Low density residential");
	});

	it("names the other districts as planned, and an estate by its own name", () => {
		expect(placeName(0, 160)).toBe("Downtown Core");
		const estate = ESTATE_NAMES[0];
		expect(placeName(estate.x, estate.z)).toBe(estate.name);
		expect(placeKind(estate.x, estate.z)).toBe("Estate");
	});

	it("falls back to the state out in the country", () => {
		expect(placeName(5000, 5000)).toBe("Orion State");
		expect(placeKind(5000, 5000)).toBe("Open country");
	});
});
