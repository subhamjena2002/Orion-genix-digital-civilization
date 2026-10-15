import { describe, expect, it } from "vitest";

import { FIRST_LEAD_SECONDS, LEAD_COOLDOWN_SECONDS, LEAD_RADIUS_IN_VEHICLE, LEAD_RADIUS_ON_FOOT, Leads, type LeadContext } from "./Leads";
import type { MissionDefinition } from "./MissionDirector";

const job = (id: string, x: number, extra: Partial<MissionDefinition> = {}): MissionDefinition => ({
	id, title: id, chapter: "job", giver: { name: "Lead", x, z: 0 }, briefing: "", reward: { cash: 10 }, objectives: [], ...extra,
});

const JOBS = [job("a", 100), job("b", 200, { onlyIf: ["flag-b"] }), job("c", 300)];

function context(extra: Partial<LeadContext> = {}): LeadContext {
	return { free: true, unlocked: true, x: 0, z: 0, inVehicle: false, open: (candidate) => !candidate.onlyIf, ...extra };
}

describe("street leads", () => {
	it("wait until the story's under way and the player is free", () => {
		const leads = new Leads(JOBS);
		leads.update(FIRST_LEAD_SECONDS + 1, context({ unlocked: false }));
		expect(leads.lead).toBeNull();
		leads.update(FIRST_LEAD_SECONDS + 1, context({ free: false }));
		expect(leads.lead).toBeNull();
		leads.update(FIRST_LEAD_SECONDS - 1, context());
		expect(leads.lead).toBeNull();
		leads.update(1.5, context());
		expect(leads.lead?.id).toBe("a");
		expect(leads.announced).toBe(1);
	});

	it("start the job when the player gets there — closer on foot than in a car — and only once", () => {
		const leads = new Leads(JOBS);
		leads.update(FIRST_LEAD_SECONDS + 1, context());
		expect(leads.update(0.1, context({ x: 100 - LEAD_RADIUS_ON_FOOT - 1 }))).toBeNull();
		expect(leads.update(0.1, context({ x: 100 - LEAD_RADIUS_IN_VEHICLE + 1, inVehicle: true }))?.id).toBe("a");
		expect(leads.lead).toBeNull();
		expect(leads.job?.id).toBe("a");
		expect(leads.update(0.1, context({ x: 100 }))).toBeNull();
	});

	it("go round the jobs in order, skipping any not open, after a cooldown", () => {
		const leads = new Leads(JOBS);
		leads.update(FIRST_LEAD_SECONDS + 1, context());
		leads.update(0.1, context({ x: 100 }));
		leads.finished();
		leads.update(LEAD_COOLDOWN_SECONDS - 1, context());
		expect(leads.lead).toBeNull();
		leads.update(1.5, context());
		expect(leads.lead?.id).toBe("c");
	});

	it("never start while a mission is running, and a lead ignored just waits", () => {
		const leads = new Leads(JOBS);
		leads.update(FIRST_LEAD_SECONDS + 1, context());
		expect(leads.update(0.1, context({ x: 100, free: false }))).toBeNull();
		leads.update(10_000, context());
		expect(leads.lead?.id).toBe("a");
		expect(leads.announced).toBe(1);
	});
});
