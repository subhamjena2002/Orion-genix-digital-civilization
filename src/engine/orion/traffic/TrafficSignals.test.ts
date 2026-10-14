import { describe, expect, it } from "vitest";

import { redRemaining, SIGNAL_CYCLE_SECONDS, signalColour, signalCountdown } from "./TrafficSignals";

describe("signal countdown", () => {
	it("always agrees with the lamps, and counts down to the change without showing 0", () => {
		for (let time = 0; time < SIGNAL_CYCLE_SECONDS * 2; time += 0.25) {
			for (const axis of ["ns", "ew"] as const) {
				const shown = signalCountdown(0, axis, time);
				expect(shown.colour).toBe(signalColour(0, axis, time));
				expect(shown.seconds).toBeGreaterThanOrEqual(1);
				// The lamp is still this colour just inside the time shown, and has changed after it.
				expect(signalColour(0, axis, time + shown.seconds - 1.001)).toBe(shown.colour);
				if (shown.colour === "red") expect(shown.seconds).toBe(Math.ceil(redRemaining(0, axis, time)));
			}
		}
	});
});
