import { beforeEach, describe, expect, it } from "vitest";

import { ARREST_SECONDS, clearWanted, evadeSeconds, readWanted, reportCrime, spotted, starsForHeat, takeBusted, updateWanted } from "./Wanted";

describe("Wanted", () => {
	beforeEach(() => {
		clearWanted();
		takeBusted();
	});

	it("gives a star for the first crime and more for a run of them", () => {
		reportCrime("assault", 0, 0);
		expect(readWanted().stars).toBe(1);
		reportCrime("murder", 0, 0);
		expect(readWanted().stars).toBe(1);
		reportCrime("murder", 0, 0);
		expect(readWanted().stars).toBe(2);
		for (let i = 0; i < 20; i++) reportCrime("murder", 0, 0);
		expect(readWanted().stars).toBe(5);
	});

	it("rates killing police far above killing civilians", () => {
		expect(starsForHeat(2.5 + 2)).toBeGreaterThan(starsForHeat(2));
		reportCrime("copKilled", 0, 0);
		expect(readWanted().stars).toBe(2);
		reportCrime("policeCarDestroyed", 0, 0);
		expect(readWanted().stars).toBe(3);
	});

	it("keeps the stars while the police can see the player, and clears them once evaded", () => {
		reportCrime("murder", 10, 20);
		for (let t = 0; t < 30; t += 0.1) {
			spotted(10, 20);
			updateWanted(0.1, false);
		}
		expect(readWanted().stars).toBe(1);
		// Out of sight: searching, then the search is called off.
		updateWanted(2, false);
		expect(readWanted().searching).toBe(true);
		for (let t = 0; t < evadeSeconds(1) + 1; t += 0.1) updateWanted(0.1, false);
		expect(readWanted().stars).toBe(0);
	});

	it("remembers where the player was last seen", () => {
		reportCrime("murder", 0, 0);
		spotted(40, -12);
		updateWanted(0.1, false);
		expect(readWanted().lastSeenX).toBe(40);
		expect(readWanted().lastSeenZ).toBe(-12);
	});

	it("arrests a player who stands still beside a patrol at low stars, but not at high", () => {
		reportCrime("murder", 0, 0);
		for (let t = 0; t <= ARREST_SECONDS + 0.2; t += 0.1) {
			spotted(0, 0);
			updateWanted(0.1, true);
		}
		expect(takeBusted()).toBe(true);
		expect(takeBusted()).toBe(false);

		clearWanted();
		for (let i = 0; i < 12; i++) reportCrime("murder", 0, 0);
		for (let t = 0; t <= ARREST_SECONDS + 0.2; t += 0.1) {
			spotted(0, 0);
			updateWanted(0.1, true);
		}
		expect(takeBusted()).toBe(false);
	});
});
