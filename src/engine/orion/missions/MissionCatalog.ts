import { AIRFIELD_GATE, HELIPAD } from "../world/MilitaryBase";
import { STANDS } from "../world/Airfield";
import { HIGHWAY_GEOMETRY, HIGHWAYS, type Highway } from "../world/Highways";
import { PARKED_PATROL_CARS } from "../police/Police";
import type { VehicleStyle } from "../traffic/Vehicles";
import type { Checkpoint, MissionDefinition, MissionSpawn } from "./MissionDirector";

/**
 * The missions, as data: who gives each, what they ask, what it pays. Places come from the
 * world's own data (the highways, the air base, the police lot) so they move with it. Every
 * character, crew and car here is made up.
 *
 * Two arcs. The story: a car job, a police car, a gang, a time trial, a jet and a gunship. The
 * street races, open once the first job's done: a city circuit, a highway sprint and a hill climb
 * against three other drivers. Timings are set from the cars' measured pace (the Phoenix tops
 * 60 m/s, the sedan pulls about 4 m/s²) so each clock leaves room for a clean run and not much more.
 */

/** The player's safehouse: a house in Hillcrest, its garage holding the cars they've earned. */
export const SAFEHOUSE = {
	label: "Safehouse",
	x: -1,
	z: -310,
	/** Where the driveway meets the road. */
	door: { x: -2, z: -295 },
	/** Garage bays: x, z and heading. Cars earned fill them in order. */
	bays: [
		{ x: -2, z: -302, yaw: 175 },
		{ x: 10, z: -293, yaw: 85 },
		{ x: -14, z: -293, yaw: 85 },
		{ x: 22, z: -293, yaw: 85 },
		{ x: -26, z: -293, yaw: 85 },
		{ x: 34, z: -293, yaw: 85 },
	],
} as const;

/** The chop shop: stolen cars go here and don't come back. */
export const CHOP_SHOP = { label: "Chop shop", x: -300, z: 160 } as const;

type Point2 = readonly [number, number];

function highway(id: string): Highway {
	const found = HIGHWAYS.find((road) => road.id === id);
	if (!found) throw new Error(`No highway ${id}`);
	return found;
}

/**
 * Evenly spaced points along a highway, from its city end; `keepLeft` metres off the centreline
 * to the left of the way out (traffic keeps left, and the centreline is the median barrier).
 */
function alongHighway(id: string, count: number, keepLeft = 0): { x: number; z: number; y: number }[] {
	const { samples } = highway(id);
	return Array.from({ length: count }, (_, index) => {
		const sample = samples[Math.round(((index + 1) / count) * (samples.length - 1))];
		// Left of travel along (dx, dz) is (dz, -dx).
		return { x: sample.x + sample.dirZ * keepLeft, z: sample.z - sample.dirX * keepLeft, y: sample.y };
	});
}

/**
 * A route moved `offset` metres into the left-hand lanes of the way it's driven, corners mitred
 * so a right-angle bend keeps its lane on both roads. `closed` joins the last point to the first.
 */
function inLane(points: readonly Point2[], offset: number, closed: boolean): Point2[] {
	const left = (from: Point2, to: Point2): Point2 => {
		const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
		return [(to[1] - from[1]) / length, -(to[0] - from[0]) / length];
	};
	return points.map((point, index) => {
		const previous = points[index - 1] ?? (closed ? points[points.length - 1] : undefined);
		const next = points[index + 1] ?? (closed ? points[0] : undefined);
		const lefts = [previous ? left(previous, point) : null, next ? left(point, next) : null].filter((value): value is Point2 => value !== null);
		const sumX = lefts.reduce((sum, value) => sum + value[0], 0);
		const sumZ = lefts.reduce((sum, value) => sum + value[1], 0);
		const length = Math.hypot(sumX, sumZ) || 1;
		const reach = offset / Math.max(0.5, (sumX * lefts[0][0] + sumZ * lefts[0][1]) / length);
		return [point[0] + (sumX / length) * reach, point[1] + (sumZ / length) * reach];
	});
}

/** On a 14 m arterial, between the two lanes on the left: clear of oncoming traffic and the kerb. */
const ARTERIAL_LANE = 3.5;
/** On the expressways, between the two outbound lanes: clear of the median and the shoulder. */
const HIGHWAY_LANE = HIGHWAY_GEOMETRY.median / 2 + HIGHWAY_GEOMETRY.laneWidth;

// ---- The story ------------------------------------------------------------------------------------

const SPRINT_CHECKPOINTS: readonly Checkpoint[] = alongHighway("sea-link", 6).map((point) => ({ x: point.x, z: point.z, radius: 13 }));

/** Rings in the sky: low over the sea south of the runway, up round the coast, down over the city. */
const RINGS: readonly Checkpoint[] = [
	{ x: 195, z: 950, y: 70, radius: 24 },
	{ x: 330, z: 1080, y: 45, radius: 24 },
	{ x: 560, z: 1000, y: 120, radius: 24 },
	{ x: 660, z: 760, y: 200, radius: 24 },
	{ x: 560, z: 330, y: 230, radius: 24 },
	{ x: 380, z: 120, y: 90, radius: 24 },
	{ x: 150, z: -40, y: 150, radius: 24 },
	{ x: -120, z: -180, y: 160, radius: 24 },
];

/** The convoy runs west along the arterial and off out of town up the Ghats Expressway. */
const CONVOY_ROUTE: readonly Point2[] = [
	[-396, ARTERIAL_LANE],
	...alongHighway("ghats-expressway", 24, HIGHWAY_LANE).map((point): Point2 => [point.x, point.z]),
];
const CONVOY_VANS = 4;
/** Quicker than the traffic: a gunship that dawdles at the pad won't catch them. */
const CONVOY_CRUISE = 19;

function convoyVan(index: number): MissionSpawn {
	const x = -140 - index * 16;
	const z = ARTERIAL_LANE;
	return { type: "vehicle", id: `m6-van-${index + 1}`, style: "van", colour: "#2b2f33", x, z, yaw: 270, route: [[x, z], ...CONVOY_ROUTE], cruise: CONVOY_CRUISE };
}

/** The crew on the street in Sunset Park; the gunmen are hardened and take more stopping. */
const GANG: readonly MissionSpawn[] = [
	{ type: "hostile", id: "m3-goon-1", x: -240, z: 338, armed: true, toughness: 1.6 },
	{ type: "hostile", id: "m3-goon-2", x: -225, z: 364, armed: false },
	{ type: "hostile", id: "m3-goon-3", x: -147, z: 375, armed: true, toughness: 1.6 },
	{ type: "hostile", id: "m3-goon-4", x: -135, z: 346, armed: false },
	{ type: "hostile", id: "m3-goon-5", x: -205, z: 386, armed: true, toughness: 1.6 },
];
/** And the back-up they call in, from the far side of the loop. */
const BACKUP: readonly MissionSpawn[] = [
	{ type: "hostile", id: "m3-goon-6", x: -251, z: 281, armed: true, toughness: 2 },
	{ type: "hostile", id: "m3-goon-7", x: -174, z: 390, armed: true, toughness: 2 },
	{ type: "hostile", id: "m3-goon-8", x: -135, z: 316, armed: true, toughness: 2 },
];

const PATROL_LOT = PARKED_PATROL_CARS[0].position;
const JET_STAND = STANDS[1];

// ---- Street races ---------------------------------------------------------------------------------

/** The same three rivals turn up to every race, each in their own Phoenix. */
const RIVALS: readonly { id: string; colour: string }[] = [
	{ id: "racer-1", colour: "#f2c14e" },
	{ id: "racer-2", colour: "#2f7fd6" },
	{ id: "racer-3", colour: "#2e9e5b" },
];
/** The Phoenix the player races in, waiting on the grid. */
const RACE_CAR = { id: "race-coupe", style: "luxury" as VehicleStyle, colour: "#e8e8e8" };

interface RaceLayout {
	/** The course, centreline points in order; a circuit's last point is its finish line. */
	course: readonly Point2[];
	/** Where the rivals drive it: the same course in their lane. */
	lane: readonly Point2[];
	laps: number;
	/** Grid slots, front to back; the player starts from the last. */
	grid: readonly Point2[];
	/** Facing on the grid, degrees. */
	yaw: number;
	/** Each rival's cruising pace, m/s, fastest last. */
	paces: readonly number[];
	radius: number;
}

function racers(race: RaceLayout): MissionSpawn[] {
	const route = Array.from({ length: race.laps }, () => race.lane).flat();
	return RIVALS.map((rival, index): MissionSpawn => ({
		type: "vehicle",
		id: rival.id,
		style: "luxury",
		colour: rival.colour,
		x: race.grid[index][0],
		z: race.grid[index][1],
		yaw: race.yaw,
		route,
		cruise: race.paces[index],
		racer: true,
	}));
}

function raceMission(race: RaceLayout, mission: Omit<MissionDefinition, "objectives" | "spawns" | "protect">): MissionDefinition {
	const [x, z] = race.grid[RIVALS.length];
	return {
		...mission,
		spawns: [{ type: "vehicle", id: RACE_CAR.id, style: RACE_CAR.style, colour: RACE_CAR.colour, x, z, yaw: race.yaw }, ...racers(race)],
		protect: [RACE_CAR.id],
		objectives: [
			{ kind: "enterVehicle", label: "Get in the white Phoenix on the grid", vehicle: RACE_CAR.id, x, z, timeLimit: 60 },
			{
				kind: "race",
				label: "Win the race",
				points: race.course.map(([px, pz]) => ({ x: px, z: pz, radius: race.radius })),
				laps: race.laps,
				racers: RIVALS.map((rival) => rival.id),
			},
		],
	};
}

/** Two laps of four downtown blocks: two long straights, four right-angle bends at the arterials. */
const DOWNTOWN_COURSE: readonly Point2[] = [[40, 0], [160, 0], [160, -80], [160, -160], [0, -160], [-160, -160], [-160, -80], [-160, 0], [-110, 0]];
const DOWNTOWN: RaceLayout = {
	course: DOWNTOWN_COURSE,
	lane: inLane(DOWNTOWN_COURSE, ARTERIAL_LANE, true),
	laps: 2,
	// Eastbound on the arterial at z = 0: its left-hand lanes are at z = -1.75 and -5.25.
	grid: [[-122, -1.75], [-122, -5.25], [-134, -1.75], [-134, -5.25]],
	yaw: 90,
	paces: [34, 38, 42],
	radius: 16,
};

/** The Sea Link end to end, flat out, from the arterial onto the bridge. */
const SEA_LINK_COURSE: readonly Point2[] = alongHighway("sea-link", 10).map((point): Point2 => [point.x, point.z]);
const SEA_LINK: RaceLayout = {
	course: SEA_LINK_COURSE,
	lane: alongHighway("sea-link", 10, HIGHWAY_LANE).map((point): Point2 => [point.x, point.z]),
	laps: 1,
	grid: [[372, -161.75], [372, -165.25], [360, -161.75], [360, -165.25]],
	yaw: 90,
	paces: [44, 47, 50],
	radius: 14,
};

/** Up the Ghats Expressway from the city, through the tunnel to the top. */
const GHATS_COURSE: readonly Point2[] = [[-396, 0], ...alongHighway("ghats-expressway", 14).map((point): Point2 => [point.x, point.z])];
const GHATS: RaceLayout = {
	course: GHATS_COURSE,
	lane: [[-396, ARTERIAL_LANE], ...alongHighway("ghats-expressway", 14, HIGHWAY_LANE).map((point): Point2 => [point.x, point.z])],
	laps: 1,
	// Westbound at z = 0: the left-hand lanes are at z = +1.75 and +5.25.
	grid: [[-338, 1.75], [-338, 5.25], [-326, 1.75], [-326, 5.25]],
	yaw: 270,
	paces: [38, 41, 44],
	radius: 14,
};

// ---- The catalog ----------------------------------------------------------------------------------

export const MISSIONS: readonly MissionDefinition[] = [
	{
		id: "clean-wheels",
		title: "Clean Wheels",
		giver: { name: "Benny Kasper", x: 8, z: 50 },
		briefing: "A client left a sedan on the east side and I want it in my garage up in Hillcrest. It's alarmed, so the cops will come running. Lose them before you get to mine, keep it pretty, and be quick.",
		reward: { cash: 500 },
		spawns: [{ type: "vehicle", id: "m1-sedan", style: "sedan", colour: "#1f4f8a", x: 83.8, z: 40, yaw: 0 }],
		protect: ["m1-sedan"],
		objectives: [
			{ kind: "enterVehicle", label: "Get in the blue sedan", vehicle: "m1-sedan", x: 83.8, z: 40, timeLimit: 60 },
			{ kind: "deliver", label: "Take it to Benny's garage", vehicle: "m1-sedan", x: SAFEHOUSE.door.x, z: SAFEHOUSE.door.z, radius: 10, minIntegrity: 70, clean: true, wanted: 1, timeLimit: 80 },
		],
	},
	{
		id: "blue-lights",
		title: "Blue Lights",
		giver: { name: "Dez Moreno", x: 86, z: -40 },
		briefing: "There's a buyer for a patrol car, lights and all. Take one from the station lot. The whole force will be on you — shake them, then get it to the chop shop before my buyer walks.",
		requires: ["clean-wheels"],
		reward: { cash: 1500 },
		objectives: [
			{ kind: "enterVehicle", label: "Steal a police car", police: true, x: PATROL_LOT[0], z: PATROL_LOT[1], timeLimit: 60 },
			{ kind: "loseWanted", label: "Lose the cops", wanted: 3, timeLimit: 120 },
			{ kind: "deliver", label: "Drop the police car at the chop shop", police: true, x: CHOP_SHOP.x, z: CHOP_SHOP.z, radius: 12, minIntegrity: 40, clean: true, timeLimit: 70 },
		],
	},
	{
		id: "street-sweep",
		title: "Street Sweep",
		giver: { name: "Marisol Reyes", x: -150, z: 234 },
		briefing: "A crew's been leaning on the families in Sunset Park. Five on the street, three of them carrying, and they'll call for back-up the moment it starts. End it.",
		requires: ["blue-lights"],
		reward: { cash: 1000, weapons: ["shotgun"] },
		area: { x: -194, z: 339, radius: 200 },
		objectives: [
			{ kind: "goto", label: "Go to Sunset Park", x: -190, z: 290, radius: 18, timeLimit: 90 },
			{ kind: "eliminate", label: "Take out the crew", x: -194, z: 355, targets: GANG.map((goon) => goon.id), spawns: GANG, timeLimit: 150 },
			{ kind: "eliminate", label: "Their back-up's here: take them out", x: -194, z: 340, targets: BACKUP.map((goon) => goon.id), spawns: BACKUP, timeLimit: 90 },
		],
	},
	{
		id: "coastal-sprint",
		title: "Coastal Sprint",
		giver: { name: "Tomas Quill", x: 372, z: -151 },
		briefing: "My Phoenix, the sea link, the far end in thirty seconds. Traffic's your problem. Beat the clock and she's yours.",
		requires: ["street-sweep"],
		reward: { cash: 750, vehicles: [{ id: "reward-coupe", style: "luxury", colour: "#b3121b", name: "Red Phoenix" }] },
		timed: true,
		spawns: [{ type: "vehicle", id: "m4-coupe", style: "luxury", colour: "#b3121b", x: 382, z: -163.5, yaw: 90 }],
		protect: ["m4-coupe"],
		objectives: [
			{ kind: "enterVehicle", label: "Get in the red Phoenix", vehicle: "m4-coupe", x: 382, z: -163.5 },
			{ kind: "checkpoints", label: "Race the sea link", points: SPRINT_CHECKPOINTS, timeLimit: 30 },
		],
	},
	{
		id: "ring-run",
		title: "Ring Run",
		giver: { name: "Captain Ilsa Brandt", x: AIRFIELD_GATE.x - 8, z: AIRFIELD_GATE.z },
		briefing: "You want to fly with us, you fly the course. Eight rings, two of them down on the waves, two and a half minutes. Miss one and you go round again.",
		requires: ["coastal-sprint"],
		reward: { cash: 3000, weapons: ["ar"] },
		objectives: [
			{ kind: "enterVehicle", label: "Climb into a jet", vehicleKind: "jet", x: JET_STAND.x, z: JET_STAND.z, timeLimit: 60 },
			{ kind: "checkpoints", label: "Fly through the rings", points: RINGS, timeLimit: 150 },
		],
	},
	{
		id: "convoy",
		title: "Convoy",
		giver: { name: "Major Odile Vos", x: HELIPAD.x - 14, z: HELIPAD.z - 10 },
		briefing: "Four vans of stolen ordnance left the city a minute ago, heading for the expressway. The gunship's on the pad. None of them reaches the hills.",
		requires: ["ring-run"],
		reward: { cash: 5000, weapons: ["rocketLauncher"] },
		// They're already on their way as the briefing ends.
		spawns: Array.from({ length: CONVOY_VANS }, (_, index) => convoyVan(index)),
		objectives: [
			{ kind: "enterVehicle", label: "Take the gunship", vehicleKind: "gunship", x: HELIPAD.x, z: HELIPAD.z },
			{ kind: "destroyVehicles", label: "Destroy the convoy", x: -300, z: 0, ids: Array.from({ length: CONVOY_VANS }, (_, index) => `m6-van-${index + 1}`) },
		],
	},
	raceMission(DOWNTOWN, {
		id: "downtown-dash",
		title: "Downtown Dash",
		giver: { name: "Rosa \"Redline\" Vega", x: -100, z: 9 },
		briefing: "Two laps round the blocks, lights or no lights. My three best are already on the grid. You start at the back — win it.",
		requires: ["clean-wheels"],
		reward: { cash: 1500 },
	}),
	raceMission(SEA_LINK, {
		id: "sea-link-showdown",
		title: "Sea Link Showdown",
		giver: { name: "Rosa \"Redline\" Vega", x: 352, z: -169 },
		briefing: "Straight line, top speed, whoever blinks loses. The far end of the bridge, first one there.",
		requires: ["downtown-dash"],
		reward: { cash: 2500 },
	}),
	raceMission(GHATS, {
		id: "ghats-hillclimb",
		title: "Ghats Hillclimb",
		giver: { name: "Rosa \"Redline\" Vega", x: -320, z: -9 },
		briefing: "Up the Ghats, through the tunnel, to the top. They know every bend. Beat them and the gold Phoenix is yours.",
		requires: ["sea-link-showdown"],
		reward: { cash: 4000, vehicles: [{ id: "reward-gold-coupe", style: "luxury", colour: "#c9a227", name: "Gold Phoenix" }] },
	}),
];

export function missionById(id: string): MissionDefinition | undefined {
	return MISSIONS.find((mission) => mission.id === id);
}
