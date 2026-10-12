import { describe, expect, it } from "vitest";

import { gpuName } from "./DeviceCheck";

describe("gpuName", () => {
	it("takes the chip out of what each platform's browser reports", () => {
		expect(gpuName("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("Intel Iris Xe Graphics");
		expect(gpuName("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002520) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("NVIDIA GeForce RTX 3060 Laptop GPU");
		expect(gpuName("ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("AMD Radeon Graphics");
		expect(gpuName("ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)")).toBe("Apple M1");
		expect(gpuName("Adreno (TM) 730")).toBe("Adreno 730");
		expect(gpuName("Apple GPU")).toBe("Apple GPU");
	});
});
