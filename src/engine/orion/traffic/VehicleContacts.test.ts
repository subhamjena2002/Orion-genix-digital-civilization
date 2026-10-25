import { describe, expect, it } from "vitest";

import { footprintContact, separationShares, type Footprint } from "./VehicleContacts";

function car(x: number, z: number, headingDegrees: number, halfLength = 2.3, halfWidth = 0.9): Footprint {
	const radians = (headingDegrees * Math.PI) / 180;
	return { x, z, sin: Math.sin(radians), cos: Math.cos(radians), halfLength, halfWidth };
}

describe("footprintContact", () => {
	it("finds nothing between cars apart", () => {
		expect(footprintContact(car(0, 0, 0), car(0, 5, 0))).toBeNull();
		expect(footprintContact(car(0, 0, 0), car(2, 0, 0))).toBeNull();
	});

	it("parts a rear-end along the line of travel", () => {
		const contact = footprintContact(car(0, 0, 0), car(0, 4, 0));
		expect(contact).not.toBeNull();
		expect(contact!.normalZ).toBeCloseTo(-1);
		expect(contact!.depth).toBeCloseTo(0.6);
		expect(contact!.pointZ).toBeGreaterThan(1.5);
		expect(contact!.pointZ).toBeLessThan(2.5);
	});

	it("finds a nose poking into a door between the corners", () => {
		// B crosses A side-on; its nose sits in A's flank, well away from A's corners and the
		// middle of its side — where the old point sweep had no ray.
		const a = car(0, 0, 0);
		const b = car(3.0, 1.1, -90);
		const contact = footprintContact(a, b);
		expect(contact).not.toBeNull();
		expect(contact!.normalX).toBeCloseTo(-1);
		expect(contact!.depth).toBeGreaterThan(0.1);
		expect(contact!.pointZ).toBeCloseTo(1.1, 0);
	});

	it("handles any angle exactly", () => {
		// Two cars at 45° just clear of each other, then just touching.
		const a = car(0, 0, 45);
		expect(footprintContact(a, car(1.9 * Math.cos(Math.PI / 4), -1.9 * Math.sin(Math.PI / 4), 45))).toBeNull();
		expect(footprintContact(a, car(1.7 * Math.cos(Math.PI / 4), -1.7 * Math.sin(Math.PI / 4), 45))).not.toBeNull();
	});

	it("is symmetric: the normal flips with the order", () => {
		const one = footprintContact(car(0, 0, 10), car(1, 3.5, 70))!;
		const two = footprintContact(car(1, 3.5, 70), car(0, 0, 10))!;
		expect(one.depth).toBeCloseTo(two.depth);
		expect(one.normalX).toBeCloseTo(-two.normalX);
		expect(one.normalZ).toBeCloseTo(-two.normalZ);
	});

	it("counts a margin as touching", () => {
		expect(footprintContact(car(0, 0, 0), car(0, 4.8, 0))).toBeNull();
		expect(footprintContact(car(0, 0, 0), car(0, 4.8, 0), 0.3)).not.toBeNull();
	});
});

describe("separationShares", () => {
	it("moves the lighter body more", () => {
		const [a, b] = separationShares(1500, 4500, true);
		expect(a).toBeCloseTo(0.75);
		expect(b).toBeCloseTo(0.25);
	});

	it("leaves it all to A against something that can't move", () => {
		expect(separationShares(1500, 4500, false)).toEqual([1, 0]);
	});
});
