/**
 * Shot spread. Kept apart from the player's combat class (which pulls in the whole engine) so it
 * can be tested on its own.
 */

/** A direction scattered uniformly within a cone of half-angle `spread` around (x, y, z). */
export function scatter(x: number, y: number, z: number, spread: number, random: () => number = Math.random): [number, number, number] {
	if (spread <= 0) return [x, y, z];
	// Two axes perpendicular to the direction.
	const helperX = Math.abs(y) < 0.9 ? 0 : 1;
	const helperY = Math.abs(y) < 0.9 ? 1 : 0;
	let ux = y * 0 - z * helperY;
	let uy = z * helperX - x * 0;
	let uz = x * helperY - y * helperX;
	const uLength = Math.hypot(ux, uy, uz) || 1;
	ux /= uLength;
	uy /= uLength;
	uz /= uLength;
	const vx = y * uz - z * uy;
	const vy = z * ux - x * uz;
	const vz = x * uy - y * ux;
	// Uniform over the cone's cap.
	const cosAngle = 1 - random() * (1 - Math.cos(spread));
	const sinAngle = Math.sqrt(1 - cosAngle * cosAngle);
	const around = random() * Math.PI * 2;
	const a = Math.cos(around) * sinAngle;
	const b = Math.sin(around) * sinAngle;
	return [x * cosAngle + ux * a + vx * b, y * cosAngle + uy * a + vy * b, z * cosAngle + uz * a + vz * b];
}
