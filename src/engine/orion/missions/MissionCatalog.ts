import { AIRFIELD_GATE, HELIPAD } from "../world/MilitaryBase";
import { STANDS } from "../world/Airfield";
import { HIGHWAY_GEOMETRY, HIGHWAYS, type Highway } from "../world/Highways";
import { SAFEHOUSE_BAYS_LOCAL, SAFEHOUSE_DRIVEWAY_LOCAL, SAFEHOUSE_SITE, toWorld as toSafehouse, yawToWorld as safehouseYaw } from "../world/Safehouse";
import { PARKED_PATROL_CARS, POLICE_STATION } from "../police/Police";
import type { VehicleStyle } from "../traffic/Vehicles";
import type { Checkpoint, Line, MissionDefinition, MissionSpawn, PersonLook } from "./MissionDirector";

/**
 * The missions, as data: who gives each, what they ask, what it pays. Places come from the
 * world's own data (the highways, the air base, the police lot) so they move with it. Every
 * character, crew, company and car here is made up.
 *
 * The story — "The Meridian Job". Someone drives a client's car off Benny Kasper's lot, and the
 * plates lead to Meridian Logistics: Silas Crane's respectable freight firm, which moves stolen
 * ordnance under its manifests and pays the Cinder Boys to clear Sunset Park for its new
 * warehouses. The player works up from Benny's errands to taking Crane apart, and the choices
 * made on the way — who to tell about Dez, where Crane's ledger goes, what happens to Jax Ruelle
 * — decide who stands with them at the end, and what's waiting at Crane's door.
 *
 * Alongside: Tomas Quill's sprint and Rosa Vega's street races, and the street jobs (JOBS) that
 * turn up as leads between missions. Timings are set from the cars' measured pace (the Vesper
 * tops 60 m/s, the sedan pulls about 4 m/s²) so each clock leaves room for a clean run and not
 * much more.
 */

/** The player's safehouse: a villa in Hillcrest (world/Safehouse), its garage holding the cars they've earned. */
const [driveX, , driveZ] = toSafehouse(SAFEHOUSE_DRIVEWAY_LOCAL);
export const SAFEHOUSE = {
	label: "Safehouse",
	x: SAFEHOUSE_SITE.x,
	z: SAFEHOUSE_SITE.z,
	/** Where the driveway meets the road. */
	door: { x: driveX, z: driveZ },
	/** Garage bays: x, z and heading. Cars earned fill them in order. */
	bays: SAFEHOUSE_BAYS_LOCAL.map((bay) => {
		const [x, , z] = toSafehouse([bay.x, 0, bay.z]);
		return { x, z, yaw: safehouseYaw(bay.yaw) };
	}),
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
 * A place near a highway's far end, in its own frame: `ahead` metres on out past the end (back
 * along the road, if negative) and `left` metres to the left of the way out.
 */
function nearEnd(id: string, ahead: number, left: number): { x: number; z: number } {
	const { samples } = highway(id);
	const back = ahead < 0 ? Math.min(samples.length - 1, Math.round(-ahead / HIGHWAY_GEOMETRY.sampleSpacing)) : 0;
	const at = samples[samples.length - 1 - back];
	const on = ahead < 0 ? 0 : ahead;
	return { x: at.x + at.dirX * on + at.dirZ * left, z: at.z + at.dirZ * on - at.dirX * left };
}

/** Facing (degrees about Y, 0 = +Z) from one place toward another. */
function facing(from: { x: number; z: number }, to: { x: number; z: number }): number {
	return Math.atan2(to.x - from.x, to.z - from.z) * 180 / Math.PI;
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

/**
 * A chased car's driver gives up once it's knocked below this condition. Crashes cost what they
 * would for real: a sedan ramming a Vesper takes about 1 point off it at 10 m/s closing, 2 at 15
 * and 4–5 in a T-bone at 20, and a pistol round from the kerb 5 — so this is a few good hits
 * through the corners, where the driver has to slow.
 */
const GIVES_UP_BELOW = 80;
/** A van's heavier: the same ram moves it (and dents it) about half as much. */
const VAN_GIVES_UP_BELOW = 85;

/** Up the Ghats Expressway, in lane, from where it leaves the city. */
const GHATS_LANE: readonly Point2[] = alongHighway("ghats-expressway", 24, HIGHWAY_LANE).map((point): Point2 => [point.x, point.z]);
/** Out over the Sea Link, in lane, to the turning circle at its far end. */
const SEA_LINK_LANE: readonly Point2[] = alongHighway("sea-link", 24, HIGHWAY_LANE).map((point): Point2 => [point.x, point.z]);

// ---- The cast -------------------------------------------------------------------------------------

/** Who says what: the names subtitles carry. */
const BENNY = "Benny";
const DEZ = "Dez";
const MARISOL = "Marisol";
const STATIC = "Static";
const KINCAID = "Kincaid";
const CRANE = "Silas Crane";
const JAX = "Jax";
const QUILL = "Quill";
const ROSA = "Rosa";
const BRANDT = "Capt. Brandt";
const VOS = "Maj. Vos";

/** Meridian's private security: grey-blue uniforms, the firm's colours. */
const GUARD_LOOK: PersonLook = { model: "man", palette: { skin: "#a9724a", shirt: "#2b3340", pants: "#14171c", hair: "#141010" } };
const DEZ_LOOK: PersonLook = { model: "manCasual", palette: { skin: "#94603f", shirt: "#6a3fa0", pants: "#d8d2c4", hair: "#141010" } };
const MARISOL_LOOK: PersonLook = { model: "womanWorker", palette: { skin: "#a9724a", shirt: "#d9762b", pants: "#3a3f33", hair: "#141010" } };
const WITNESS_LOOK: PersonLook = { model: "womanCasual", palette: { skin: "#7d4f30", shirt: "#2c6e8f", pants: "#1f2933", hair: "#1d1512" } };

/** The givers, as they stand at their markers and tell the player the job (see MissionDefinition.giver). */
const BENNY_LOOK: PersonLook = { model: "man", palette: { skin: "#c58c63", shirt: "#3d4a5c", pants: "#2a2622", hair: "#6b6b6b" } };
const STATIC_LOOK: PersonLook = { model: "manCasual", palette: { skin: "#e0b48f", shirt: "#4d5b3a", pants: "#23262b", hair: "#2b1d14" } };
const KINCAID_LOOK: PersonLook = { model: "womanSuit", palette: { skin: "#8a5a3c", shirt: "#2f3b4f", pants: "#1b1f27", hair: "#141010" } };
const NIA_LOOK: PersonLook = { model: "womanWorker", palette: { skin: "#5a3826", shirt: "#2f6e4f", pants: "#203a2c", hair: "#141010" } };
const BRANDT_LOOK: PersonLook = { model: "womanSuit", palette: { skin: "#e4bd9c", shirt: "#4a5a3f", pants: "#3c4834", hair: "#c9a46a" } };
const VOS_LOOK: PersonLook = { model: "womanWorker", palette: { skin: "#b98863", shirt: "#55603f", pants: "#3f4730", hair: "#2b1d14" } };
const QUILL_LOOK: PersonLook = { model: "man", palette: { skin: "#e6c3a5", shirt: "#6b2737", pants: "#262321", hair: "#d8d4cc" } };
const ROSA_LOOK: PersonLook = { model: "womanCasual", palette: { skin: "#a26b47", shirt: "#c4152b", pants: "#151517", hair: "#141010" } };

function guard(id: string, at: { x: number; z: number }, yaw: number, role: "sentry" | "guard" = "sentry"): MissionSpawn {
	return { type: "hostile", id, x: at.x, z: at.z, armed: true, toughness: 1.3, role, yaw, ...GUARD_LOOK };
}

/** Benny's own car, parked outside Kasper Motors: the one he lends for jobs that need a nose for trouble. */
const BENNY_CAR: MissionSpawn = { type: "vehicle", id: "benny-car", style: "sedan", colour: "#5b3a26", x: -5.25, z: 46, yaw: 180 };
/** Kasper Motors, on the main north–south arterial. */
const KASPER = { x: 8, z: 50 };
const KASPER_YARD = { x: 3.5, z: 64 };
/** Where Static parks his van and listens to the city's radios. */
const STATIC_SPOT = { x: -86, z: -74 };
/** Detective Kincaid meets people where the station can't see her. */
const KINCAID_SPOT = { x: -90, z: 9 };
const POLICE_FRONT = { x: POLICE_STATION.position[0], z: 3 };
const SUNSET_GATE = { x: -155, z: 236 };

// ---- 1. Cold Open: a car off Benny's lot -----------------------------------------------------------

/** The thief heads north out of downtown, west along the Ghats arterial and up the expressway. */
const THIEF_ROUTE: readonly Point2[] = [
	...inLane([[0, 20], [0, -160], [-320, -160], [-320, 0], [-396, 0]], ARTERIAL_LANE, false),
	...GHATS_LANE,
];

const COLD_OPEN: MissionDefinition = {
	id: "cold-open",
	title: "Cold Open",
	giver: { name: "Benny Kasper", speaker: BENNY, look: BENNY_LOOK, role: "Fixer · Kasper Motors", ...KASPER },
	briefing: "Kid — you're the new driver? Good timing. Somebody just drove my client's silver Vesper off my lot. Take my car, catch him, and bring it back. Bent is fine. Gone is not.",
	spawns: [
		BENNY_CAR,
		// Slower than Benny's sedan on the straights, so it's caught in town or on the ramp, not at the top.
		{ type: "vehicle", id: "cold-target", style: "luxury", colour: "#b8bcc2", x: THIEF_ROUTE[0][0], z: THIEF_ROUTE[0][1], yaw: 180, route: THIEF_ROUTE, cruise: 18, disableBelow: GIVES_UP_BELOW },
	],
	protect: ["cold-target"],
	intro: [{ who: BENNY, text: "Keys are in it. Go, go!" }],
	objectives: [
		{ kind: "enterVehicle", label: "Get in Benny's car", vehicle: "benny-car", x: BENNY_CAR.x, z: BENNY_CAR.z, timeLimit: 40 },
		{
			step: "chase",
			kind: "disable",
			label: "Ram the silver Vesper until it stops",
			targets: ["cold-target"],
			below: GIVES_UP_BELOW,
			x: THIEF_ROUTE[0][0],
			z: THIEF_ROUTE[0][1],
			say: [{ who: BENNY, text: "He's a pro — he won't stop for a honk. Put him into something." }],
			done: [{ who: BENNY, text: "He's stopped! Get my client's car before he gets ideas." }],
		},
		{ kind: "enterVehicle", label: "Pull the thief out and take the Vesper", vehicle: "cold-target", x: 0, z: 0, timeLimit: 60 },
		{
			kind: "deliver",
			label: "Bring the Vesper back to Kasper Motors",
			vehicle: "cold-target",
			x: KASPER_YARD.x,
			z: KASPER_YARD.z,
			radius: 10,
			clean: true,
			say: [{ who: BENNY, text: "Bring her home. Gently. Ish." }],
		},
	],
	triggers: [
		// Said while he's still crossing town, well before he reaches the ramp and the line below.
		{ when: { step: "chase", after: 12 }, say: [{ who: BENNY, text: "If he makes the Ghats Expressway, he's gone. Stop him in town." }] },
		{ when: { step: "chase", targetNear: { id: "cold-target", x: -396, z: 3.5, radius: 30 } }, say: [{ who: BENNY, text: "He's on the expressway ramp — now or never, kid!" }], notice: "Last chance before the hills" },
	],
	outro: [
		{ who: BENNY, text: "Glovebox is empty. Whatever he wanted, he got it before you caught him." },
		{ who: BENNY, text: "These plates are Meridian Logistics fleet. Silas Crane's people. Huh." },
		{ who: "Unknown caller", text: "You put a dent in Mr. Crane's afternoon. He noticed. — Jax." },
	],
	bonuses: [
		{ id: "quick", label: "Back inside 3:00", kind: "time", seconds: 180 },
		{ id: "benny-car", label: "Keep Benny's car above 60%", kind: "intact", min: 60, vehicle: "benny-car" },
	],
	reward: { cash: 400, rep: { street: 1, meridian: -1 } },
};

// ---- 4. Loose Lips: who told Crane the car was there? ---------------------------------------------

const LOOSE_LIPS: MissionDefinition = {
	id: "loose-lips",
	title: "Loose Lips",
	giver: { name: "Static", speaker: STATIC, look: STATIC_LOOK, role: "Informant · lives on the scanners", ...STATIC_SPOT },
	requires: ["blue-lights"],
	briefing: "Benny wants to know who told Meridian his client's car was on the lot. I've got the dispatch logs. You've got legs. Between us we've got a detective. Kind of.",
	spawns: [
		{ type: "vehicle", id: "static-van", style: "van", colour: "#d7d2c4", x: -82.5, z: -56, yaw: 180 },
		{ type: "hostile", id: "witness", x: 264, z: -8.5, armed: false, role: "passive", yaw: 180, ...WITNESS_LOOK },
		{ type: "hostile", id: "dez", x: 330, z: 246, armed: false, role: "passive", yaw: 0, ...DEZ_LOOK },
	],
	protect: ["witness", "dez"],
	objectives: [
		{
			kind: "inspect",
			label: "Go through Static's scanner logs in his van",
			x: -86.5,
			z: -56,
			radius: 4,
			seconds: 3,
			done: [
				{ who: STATIC, text: "Two a.m.: a call from Kasper Motors' own line to a Meridian dispatch number. Thirty seconds." },
				{ who: STATIC, text: "Somebody inside. A night attendant at Sunrise Hospital saw a Meridian van that night." },
			],
		},
		{
			kind: "inspect",
			label: "Talk to the night attendant at Sunrise Hospital",
			person: "witness",
			x: 264,
			z: -8.5,
			radius: 4,
			seconds: 3,
			done: [
				{ who: "Attendant", text: "Kid in a purple jacket sat in that van ten minutes. Moustache like a dare. Hard to forget." },
				{ who: STATIC, text: "Purple jacket. Oh no. Oh, Benny's not going to like this." },
			],
		},
		{
			kind: "choice",
			label: "Dez wears purple. Go straight to him, or get proof first?",
			options: [
				{ label: "Check the chop shop's books first", detail: "Hard proof. Takes longer.", next: "books" },
				{ label: "Find Dez now", detail: "He's at the marina.", next: "dez" },
			],
		},
		{
			step: "books",
			kind: "inspect",
			label: "Find the payments in the chop shop's books",
			x: CHOP_SHOP.x,
			z: CHOP_SHOP.z,
			radius: 5,
			seconds: 4,
			flags: ["proof"],
			done: [{ who: STATIC, text: "Two grand from Meridian Logistics, filed as 'consulting'. Consulting. Ha." }],
		},
		{
			step: "dez",
			kind: "inspect",
			label: "Talk to Dez at the marina",
			person: "dez",
			x: 330,
			z: 246,
			radius: 4,
			seconds: 3,
			done: [
				{ who: DEZ, text: "Purple's a popular colour, man. Half this city—", onlyIf: ["!proof"] },
				{ who: DEZ, text: "...okay. Okay! They said nobody'd get hurt. It was one phone call.", onlyIf: ["!proof"] },
				{ who: DEZ, text: "You've got the books? ...Yeah. Two grand. I'm not proud of it.", onlyIf: ["proof"] },
				{ who: DEZ, text: "Crane's people said it was an insurance thing. I needed the money. I'm sorry.", onlyIf: ["proof"] },
			],
		},
		{
			kind: "choice",
			label: "What happens to Dez?",
			options: [
				{
					label: "Tell Benny",
					detail: "Family business. Benny decides.",
					flags: ["dez-exposed"],
					reward: { rep: { street: 2 } },
					say: [
						{ who: BENNY, text: "My own nephew. ...Thank you for telling me straight, kid." },
						{ who: DEZ, text: "You just cost me everything. Remember that." },
					],
				},
				{
					label: "Keep it between you",
					detail: "Dez owes you one. A big one.",
					flags: ["dez-owes"],
					reward: { rep: { street: -1 } },
					say: [{ who: DEZ, text: "I owe you. I mean it — whatever you need, whenever." }],
				},
			],
		},
	],
	bonuses: [
		{ id: "proof", label: "Get hard proof before facing Dez", kind: "flag", flag: "proof" },
		{ id: "quick", label: "Done inside 5:00", kind: "time", seconds: 300 },
	],
	reward: { cash: 1200 },
};

// ---- 6. Quiet Money: the ledger at the Sea Link depot ---------------------------------------------

/** Meridian's depot: the turning circle at the Sea Link's far end, and the deck leading to it. */
const DEPOT = nearEnd("sea-link", 0, 0);
const depot = (ahead: number, left: number) => nearEnd("sea-link", ahead, left);
const DEPOT_APPROACH = depot(-95, 0);
const LEDGER = depot(9, 7);
/** Out across the water from the deck's left side, and back toward the city. */
const SEAWARD = facing(DEPOT, depot(0, 10));
const OUTWARD = facing(depot(-20, 0), DEPOT);

const DEPOT_GUARDS: readonly MissionSpawn[] = [
	guard("guard-1", depot(6, 0), SEAWARD),
	guard("guard-2", depot(0, 12), SEAWARD),
	guard("guard-3", depot(0, -12), (SEAWARD + 180) % 360),
	guard("guard-4", depot(-48, 6), SEAWARD),
	guard("guard-5", depot(-22, -6), OUTWARD),
];
/** Cinder Boys from a van at the bridge end, if the yard raises the alarm. */
const DEPOT_REINFORCEMENTS: readonly MissionSpawn[] = [
	{ type: "hostile", id: "m3-goon-6", ...depot(-70, 5), armed: true, toughness: 1.6 },
	{ type: "hostile", id: "m3-goon-7", ...depot(-74, -5), armed: true, toughness: 1.6 },
	{ type: "hostile", id: "m3-goon-8", ...depot(-80, 0), armed: false },
];

const QUIET_MONEY: MissionDefinition = {
	id: "quiet-money",
	title: "Quiet Money",
	giver: { name: "Det. Ada Kincaid", speaker: KINCAID, look: KINCAID_LOOK, role: "OCPD · Organised Crime", ...KINCAID_SPOT },
	requires: ["street-sweep"],
	briefing: "You've been busy on Meridian's dime. Crane keeps a paper ledger at his Sea Link depot — the man doesn't trust computers. Bring it to me and I can open a case. Get seen, and his people will shoot first.",
	intro: [{ who: KINCAID, text: "Five on the yard. Crane pays for loyalty, not eyesight. Come at them from behind." }],
	objectives: [
		{
			kind: "goto",
			label: "Get to the Meridian depot at the end of the Sea Link",
			...DEPOT_APPROACH,
			radius: 22,
			spawns: DEPOT_GUARDS,
			say: [{ who: KINCAID, text: "Park on the bridge and walk. An engine at that gate gets noticed." }],
		},
		{
			kind: "inspect",
			label: "Find the ledger in the depot office",
			...LEDGER,
			radius: 3,
			seconds: 4,
			checkpoint: { ...DEPOT_APPROACH, yaw: OUTWARD },
			say: [{ who: STATIC, text: "Tip from me: they can't see behind them. A quiet word from behind does wonders." }],
			done: [{ who: KINCAID, text: "Got it? Then get off that bridge." }],
		},
		{ kind: "leave", label: "Get clear of the depot", ...DEPOT, radius: 150 },
		{
			kind: "choice",
			label: "The ledger's worth a lot. To whom?",
			options: [
				{
					label: "Give it to Kincaid",
					detail: "A case against Crane. The police owe you.",
					flags: ["ledger-police"],
					reward: { rep: { law: 2, meridian: -2 } },
					next: "kincaid",
				},
				{
					label: "Sell it to Tomas Quill",
					detail: "$6,000. Kincaid won't forget it.",
					flags: ["ledger-sold"],
					reward: { cash: 6000, rep: { law: -2, street: 1 } },
					next: "quill",
				},
			],
		},
		{ step: "kincaid", kind: "goto", label: "Bring the ledger to Kincaid", ...KINCAID_SPOT, radius: 8, next: "pass", done: [{ who: KINCAID, text: "This is enough to start. Not to finish. Stay reachable." }] },
		{ step: "quill", kind: "goto", label: "Sell the ledger to Tomas Quill", x: 372, z: -151, radius: 8, next: "pass", done: [{ who: QUILL, text: "Crane's handwriting! I'll have it framed. And then I'll have it used." }] },
	],
	triggers: [
		{
			when: { alerted: true },
			alertAll: true,
			notice: "You've been spotted",
			spawns: DEPOT_REINFORCEMENTS,
			say: [
				{ who: "Meridian guard", text: "Somebody's on the yard! Lock the gate!" },
				{ who: KINCAID, text: "That alarm rings at Meridian, not at us. Their muscle's coming down the bridge." },
			],
		},
	],
	bonuses: [
		{ id: "unseen", label: "Never seen", kind: "undetected" },
		{ id: "quick", label: "Done inside 5:00", kind: "time", seconds: 300 },
	],
	reward: { cash: 2500 },
};

// ---- 7. Tailgate: Jax Ruelle, and the money ---------------------------------------------------------

const JAX_START: Point2 = [80, -160];
/** What Jax drives toward, until a call changes his plans at the junction… */
const JAX_ROUTE = inLane([JAX_START, [160, -160], [160, 0], [160, 160]], ARTERIAL_LANE, false);
/** …and where the meet really is: the Marina Heights gate. */
const JAX_REROUTE = inLane([[160, 0], [320, 0], [320, 236]], ARTERIAL_LANE, false);
const MEET = { x: 326, z: 248 };
/** Spooked at the meet, he runs for the Sea Link. */
const JAX_ESCAPE: readonly Point2[] = [...inLane([[320, 236], [320, -160], [396, -160]], ARTERIAL_LANE, false), ...SEA_LINK_LANE];
const BUYERS: readonly MissionSpawn[] = [
	{ type: "hostile", id: "m3-goon-1", x: 334, z: 250, armed: true, toughness: 1.4, role: "sentry", yaw: 200 },
	{ type: "hostile", id: "m3-goon-2", x: 317, z: 252, armed: true, toughness: 1.4, role: "sentry", yaw: 160 },
	{ type: "hostile", id: "m3-goon-3", x: 327, z: 258, armed: false, role: "sentry", yaw: 180 },
];

const TAILGATE: MissionDefinition = {
	id: "tailgate",
	title: "Tailgate",
	giver: { name: "Static", speaker: STATIC, look: STATIC_LOOK, role: "Informant · lives on the scanners", ...STATIC_SPOT },
	requires: ["quiet-money"],
	briefing: "Jax Ruelle — Crane's driver, the guy who called you — is moving Meridian money to a buyer today. Follow him to the meet. Not close. He's paranoid, and he's good.",
	spawns: [
		{ type: "vehicle", id: "static-hatch", style: "sedan", colour: "#c9b27c", x: -82.5, z: -50, yaw: 180 },
		{ type: "vehicle", id: "jax-car", style: "luxury", colour: "#15171a", x: JAX_ROUTE[0][0], z: JAX_ROUTE[0][1], yaw: 90, disableBelow: GIVES_UP_BELOW },
	],
	objectives: [
		{ kind: "enterVehicle", label: "Take Static's beige sedan", vehicleKind: "car", x: -82.5, z: -50, timeLimit: 60, say: [{ who: STATIC, text: "Take my sedan. Beige. Nobody has ever noticed a beige sedan. That's the genius." }] },
		{
			kind: "goto",
			label: "Stake out Meridian's city office",
			x: 52,
			z: -150,
			radius: 20,
			timeLimit: 120,
			spawns: BUYERS,
			done: [{ who: STATIC, text: "Black Vesper pulling out. That's him. Hang back." }],
		},
		// Jax cruises at about 16 m/s: 95 m is six seconds behind, so a red light he made costs the tail.
		{ step: "tail", kind: "tail", label: "Follow Jax without being seen", target: "jax-car", near: 22, far: 95, spotted: "chase" },
		{
			step: "meet",
			kind: "choice",
			label: "Jax is at the meet. Make your move.",
			options: [
				{ label: "Hit the handoff", detail: "Take the buyers down. Jax will run.", flags: ["ambushed"], next: "ambush" },
				{ label: "Photograph the buyers and slip away", detail: "Kincaid gets names. Jax walks.", flags: ["buyer-marked"], reward: { cash: 1500, rep: { law: 1 } }, next: "mark" },
			],
		},
		{
			step: "ambush",
			kind: "eliminate",
			label: "Take out the buyers",
			x: MEET.x,
			z: MEET.z,
			targets: BUYERS.map((buyer) => buyer.id),
			timeLimit: 120,
			done: [{ who: STATIC, text: "Jax is moving! He's going for the Sea Link!" }],
		},
		{ step: "bolt", kind: "disable", label: "Stop Jax before he crosses the Sea Link", targets: ["jax-car"], below: GIVES_UP_BELOW, x: MEET.x, z: MEET.z, next: "jax" },
		{ step: "mark", kind: "inspect", label: "Get the buyers' plates — stay back", ...MEET, radius: 45, seconds: 4, on: "either", say: [{ who: STATIC, text: "Close enough to read a plate, far enough not to be shot. You know. Easy." }] },
		{ kind: "leave", label: "Slip away", ...MEET, radius: 160, next: "pass", done: [{ who: KINCAID, text: "Plates came through. Two Meridian accountants and a man with no fingerprints. Thanks." }] },
		{ step: "chase", kind: "disable", label: "He's made you — stop the black Vesper", targets: ["jax-car"], below: GIVES_UP_BELOW, x: MEET.x, z: MEET.z, timeLimit: 150 },
		{ step: "jax", kind: "inspect", label: "Drag Jax out of the car", person: "jax-car", x: MEET.x, z: MEET.z, radius: 7, seconds: 2.5, done: [{ who: JAX, text: "Fine. You can drive. Now what?" }] },
		{
			kind: "choice",
			label: "Jax is on the ground. What now?",
			options: [
				{ label: "Let him walk", detail: "He'll owe you. Crane won't know.", flags: ["jax-spared"], reward: { rep: { meridian: 1, street: 1 } }, say: [{ who: JAX, text: "I'll remember this. Not fondly. But I'll remember." }] },
				{ label: "Call Kincaid", detail: "One fewer gun at Crane's side.", flags: ["jax-arrested"], reward: { cash: 1000, rep: { law: 2 } }, say: [{ who: KINCAID, text: "Ruelle? In cuffs? I'm buying you a coffee. A small one." }] },
			],
			next: "pass",
		},
	],
	triggers: [
		{ when: { step: "tail" }, reroute: { id: "jax-car", route: JAX_ROUTE, cruise: 15 } },
		// At his first turn, clear of the call at the junction about sixteen seconds in.
		{ when: { step: "tail", after: 6 }, say: [{ who: STATIC, text: "He signals every turn. Nobody signals every turn. Paranoid." }] },
		{
			when: { step: "tail", targetNear: { id: "jax-car", x: 163.5, z: -3.5, radius: 16 } },
			reroute: { id: "jax-car", route: JAX_REROUTE, cruise: 15 },
			notice: "The meet's moved",
			say: [{ who: STATIC, text: "He took a call — he's turning east. The meet's moved to Marina Heights." }],
		},
		{ when: { step: "meet", alerted: true }, goto: "ambush", alertAll: true, say: [{ who: STATIC, text: "They've seen you! It's happening now!" }] },
		// He's the better driver, but the beige sedan has to be able to stay with him.
		{ when: { step: "chase" }, pace: { id: "jax-car", cruise: 22 }, say: [{ who: JAX, text: "Should've stayed home, beige." }] },
		// The player's on foot after the shoot-out: slow enough that the sedan catches him on the bridge.
		{ when: { step: "bolt" }, reroute: { id: "jax-car", route: JAX_ESCAPE, cruise: 20 } },
	],
	bonuses: [
		{ id: "ghost", label: "Never spotted on the tail", kind: "flag", flag: "!spotted" },
		{ id: "quick", label: "Done inside 5:00", kind: "time", seconds: 300 },
	],
	reward: { cash: 2000 },
};

// ---- 10. Extraction: Marisol at the Ghats lookout -------------------------------------------------

const LOOKOUT = nearEnd("ghats-expressway", 0, 0);
const lookout = (ahead: number, left: number) => nearEnd("ghats-expressway", ahead, left);
const LOOKOUT_APPROACH = lookout(-110, 0);
const L_SEAWARD = facing(LOOKOUT, lookout(0, 10));
const L_DOWNHILL = facing(LOOKOUT, lookout(-20, 0));
const LOOKOUT_GUARDS: readonly MissionSpawn[] = [
	guard("guard-1", lookout(0, 9), L_SEAWARD),
	// "The one by the rail": watching across the road over Marisol, so he's taken from behind,
	// along the rail, before she can be cut loose.
	guard("guard-2", lookout(0, -7), L_SEAWARD),
	guard("guard-3", lookout(-26, 5), facing(lookout(-26, 5), LOOKOUT)),
	guard("guard-4", lookout(-55, -6), (L_SEAWARD + 180) % 360),
];

const EXTRACTION: MissionDefinition = {
	id: "extraction",
	title: "Extraction",
	giver: { name: "Benny Kasper", speaker: BENNY, look: BENNY_LOOK, role: "Fixer · Kasper Motors", ...KASPER },
	requires: ["convoy"],
	briefing: "Crane's had enough of Sunset Park making noise. Static heard it on the scanner: they've taken Marisol up to the Ghats lookout. Bring her home, kid. Quiet if you can, but bring her home.",
	spawns: [{ type: "hostile", id: "marisol", ...lookout(7, 0), armed: false, role: "passive", yaw: L_DOWNHILL, ...MARISOL_LOOK }],
	protect: ["marisol"],
	intro: [{ who: STATIC, text: "Four of Crane's at the top. Drive in and they'll hear the engine. Walk the last bit." }],
	objectives: [
		{ kind: "goto", label: "Get up to the Ghats lookout", ...LOOKOUT_APPROACH, radius: 22, spawns: LOOKOUT_GUARDS },
		{
			kind: "inspect",
			label: "Cut Marisol loose",
			person: "marisol",
			x: LOOKOUT.x,
			z: LOOKOUT.z,
			radius: 3,
			seconds: 3,
			checkpoint: { ...LOOKOUT_APPROACH, yaw: facing(LOOKOUT_APPROACH, LOOKOUT) },
			say: [{ who: MARISOL, text: "Psst. Over here. Mind the one by the rail — he hums when he's bored." }],
			done: [{ who: MARISOL, text: "Took you long enough. Let's go." }],
		},
		{
			step: "escort",
			kind: "escort",
			label: "Get Marisol home to Sunset Park",
			person: "marisol",
			...SUNSET_GATE,
			radius: 16,
			followers: ["marisol"],
			flags: ["marisol-saved"],
			next: "pass",
		},
		{ step: "shake", kind: "loseWanted", label: "Lose the police — they'd hold her for questioning", next: "escort" },
	],
	triggers: [
		{
			when: { alerted: true },
			alertAll: true,
			notice: "You've been spotted",
			say: [{ who: "Meridian guard", text: "Visitors! Watch the woman!" }, { who: MARISOL, text: "Well, that's subtle." }],
		},
		{ when: { step: "escort", wanted: 2 }, goto: "shake", say: [{ who: KINCAID, text: "Somebody reported shots at the lookout. Lose my people before you get her home, or she spends the night in an interview room." }] },
		{ when: { step: "escort", after: 25 }, say: [{ who: MARISOL, text: "They wanted to know who's organising the tenants. I told them: everybody." }] },
	],
	bonuses: [
		{ id: "unseen", label: "Get her out unseen", kind: "undetected" },
		{ id: "quick", label: "Done inside 7:00", kind: "time", seconds: 420 },
	],
	reward: { cash: 4000, rep: { sunset: 3, meridian: -2 } },
};

// ---- 11. The Meridian Job --------------------------------------------------------------------------

/** Meridian's city office, on the corner of the arterial and Eighth. */
const TOWER = { x: 160, z: -80 };
const TOWER_OFFICE = { x: 171, z: -84 };
const TOWER_GUARDS: readonly MissionSpawn[] = [
	guard("guard-1", { x: 168.5, z: -86.5 }, 90),
	guard("guard-2", { x: 151.5, z: -73.5 }, 0),
	guard("guard-3", { x: 168.5, z: -73.5 }, 180),
];
const FRONT_GUARDS: readonly MissionSpawn[] = [
	guard("guard-4", { x: 151.5, z: -60 }, 180, "guard"),
	guard("guard-5", { x: 168.5, z: -62 }, 180, "guard"),
];
const CRANE_START = { x: 156.5, z: -64 };
const CRANE_ESCAPE: readonly Point2[] = [...inLane([[160, -64], [160, -160], [396, -160]], ARTERIAL_LANE, false), ...SEA_LINK_LANE];

const finaleOutro: readonly Line[] = [
	{ who: KINCAID, text: "Silas Crane, booked at 9:14. The ledger made it stick. Thank you — off the record.", onlyIf: ["crane-arrested"] },
	{ who: BENNY, text: "You took his money. I'm not judging. I'm just... noting it.", onlyIf: ["crane-paid"] },
	{ who: MARISOL, text: "The tenants' committee had a long talk with Mr. Crane. He's signing the land over.", onlyIf: ["crane-sunset"] },
	{ who: DEZ, text: "Side door, like I promised. We're square now, right? Right?", onlyIf: ["dez-owes"] },
	{ who: JAX, text: "Heard Crane drove himself. Badly. Told you I'd remember.", onlyIf: ["jax-spared"] },
	{ who: BENNY, text: "Kasper Motors is open for business. And you, kid, are a partner." },
];

const MERIDIAN_JOB: MissionDefinition = {
	id: "meridian-job",
	title: "The Meridian Job",
	giver: { name: "Benny Kasper", speaker: BENNY, look: BENNY_LOOK, role: "Fixer · Kasper Motors", ...KASPER },
	requires: ["extraction"],
	briefing: "Crane knows it's you. So we end it tonight: his office on the arterial, his guards, his getaway. Take my car. Whatever you decide about him at the end — decide it like you'll have to live here after.",
	spawns: [
		BENNY_CAR,
		...TOWER_GUARDS,
		{ type: "vehicle", id: "crane-car", style: "luxury", colour: "#ece8df", x: CRANE_START.x, z: CRANE_START.z, yaw: 180, disableBelow: GIVES_UP_BELOW },
	],
	intro: [{ who: BENNY, text: "Gear's in the back. Don't scratch it. Kidding. Scratch it all you like tonight." }],
	objectives: [
		{ kind: "enterVehicle", label: "Take Benny's car", vehicle: "benny-car", x: BENNY_CAR.x, z: BENNY_CAR.z, timeLimit: 60 },
		{
			kind: "choice",
			label: "How do you go in?",
			options: [
				{ label: "Through the front", detail: "Two more guards, and they'll be waiting.", flags: ["front"], next: "front" },
				{ label: "Dez's service door", detail: "Dez owes you. The side's lightly watched.", flags: ["side"], next: "side", onlyIf: ["dez-owes"] },
			],
		},
		{ step: "front", kind: "goto", label: "Hit Meridian's front entrance", x: TOWER.x, z: -40, radius: 16, spawns: FRONT_GUARDS, next: "tower-front" },
		{ step: "side", kind: "goto", label: "Meet Dez at the service door", x: 205, z: -86, radius: 12, say: [{ who: DEZ, text: "Door's propped. Three on the corner, they're bored. Good luck, I'm leaving." }], next: "tower-side" },
		{ step: "tower-front", kind: "eliminate", label: "Take out Crane's security", x: TOWER.x, z: TOWER.z, targets: [...TOWER_GUARDS, ...FRONT_GUARDS].map((spawn) => spawn.id), next: "office" },
		{ step: "tower-side", kind: "eliminate", label: "Deal with the corner guards", x: TOWER.x, z: TOWER.z, targets: TOWER_GUARDS.map((spawn) => spawn.id) },
		{
			step: "office",
			kind: "inspect",
			label: "Search Crane's office",
			...TOWER_OFFICE,
			radius: 3,
			seconds: 3,
			checkpoint: { x: TOWER.x - 12, z: TOWER.z + 14, yaw: 90 },
			done: [{ who: STATIC, text: "He's not in there — garage door's open! White Vesper, heading for the Sea Link!" }],
		},
		{ step: "flight", kind: "disable", label: "Stop Crane's car before he reaches the depot", targets: ["crane-car"], below: GIVES_UP_BELOW, x: CRANE_START.x, z: CRANE_START.z },
		{ kind: "inspect", label: "Drag Crane out", person: "crane-car", x: CRANE_START.x, z: CRANE_START.z, radius: 7, seconds: 2.5, done: [{ who: CRANE, text: "Let's be adults. Everyone has a number. What's yours?" }] },
		{
			kind: "choice",
			label: "Silas Crane's fate",
			options: [
				{ label: "Hand him to Kincaid", detail: "Prison. The law owes you.", flags: ["crane-arrested"], reward: { cash: 5000, rep: { law: 3, meridian: -3 } }, next: "hq" },
				{ label: "Take his offer", detail: "$25,000 and he leaves Orion for good.", flags: ["crane-paid"], reward: { cash: 25000, rep: { law: -3, sunset: -2, meridian: 2 } }, next: "walk" },
				{ label: "Let Sunset Park decide", detail: "Marisol's tenants want a word.", flags: ["crane-sunset"], reward: { cash: 5000, rep: { sunset: 4, meridian: -3 } }, next: "sunset", onlyIf: ["marisol-saved"] },
			],
		},
		{ step: "hq", kind: "deliver", label: "Drive Crane to Police HQ", vehicleKind: "car", ...POLICE_FRONT, radius: 14, clean: true, next: "pass" },
		{ step: "walk", kind: "goto", label: "Let him go and get back to Benny's", ...KASPER_YARD, radius: 12, next: "pass", say: [{ who: CRANE, text: "A pleasure doing business. You'll never see me again." }] },
		{ step: "sunset", kind: "deliver", label: "Drive Crane to Sunset Park", vehicleKind: "car", ...SUNSET_GATE, radius: 16, clean: true, next: "pass" },
	],
	triggers: [
		{ when: { flags: ["dez-exposed"] }, spawns: [{ type: "hostile", id: "dez", x: 176, z: -96, armed: true, toughness: 1.2, role: "guard", ...DEZ_LOOK }] },
		{ when: { step: "tower-front", flags: ["dez-exposed"] }, say: [{ who: DEZ, text: "Crane pays better than family, turns out!" }] },
		{ when: { step: "tower-side", alerted: true }, alertAll: true, notice: "You've been spotted", say: [{ who: "Meridian guard", text: "Side door! Somebody's at the side door!" }] },
		// The player starts this on foot in the office, about twelve seconds behind: Benny's sedan
		// closes on the straights and the Sea Link, a little slower with Jax at Crane's wheel.
		{ when: { step: "flight", flags: ["!jax-spared", "!jax-arrested"] }, reroute: { id: "crane-car", route: CRANE_ESCAPE, cruise: 22 }, say: [{ who: JAX, text: "Buckle up, Mr. Crane. This one's personal." }] },
		{ when: { step: "flight", flags: ["jax-spared"] }, reroute: { id: "crane-car", route: CRANE_ESCAPE, cruise: 18 }, say: [{ who: CRANE, text: "Where is Ruelle? Where is my driver?" }, { who: JAX, text: "Took the day off. You're welcome." }] },
		{ when: { step: "flight", flags: ["jax-arrested"] }, reroute: { id: "crane-car", route: CRANE_ESCAPE, cruise: 18 }, say: [{ who: CRANE, text: "I'll drive myself, then. How hard can it be?" }] },
		// Once the garage line and the getaway driver have had their say, not queued up behind them.
		{ when: { step: "flight", after: 10, flags: ["!ledger-police"] }, alarm: 2, say: [{ who: STATIC, text: "Somebody called it in. Cops inbound — lots of them." }] },
		{ when: { step: "flight", after: 10, flags: ["ledger-police"] }, say: [{ who: KINCAID, text: "My units are holding the bridge approach. Nobody's coming for you. Today." }] },
	],
	outro: finaleOutro,
	bonuses: [
		{ id: "benny-car", label: "Keep Benny's car above 35%", kind: "intact", min: 35, vehicle: "benny-car" },
		{ id: "quick", label: "Done inside 8:00", kind: "time", seconds: 480 },
	],
	reward: { cash: 8000, rep: { street: 2 }, vehicles: [{ id: "reward-white-vesper", style: "luxury", colour: "#ece8df", name: "White Vesper" }] },
};

// ---- The story's existing jobs ---------------------------------------------------------------------

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
const CONVOY_ROUTE: readonly Point2[] = [[-396, ARTERIAL_LANE], ...GHATS_LANE];
const CONVOY_VANS = 4;
/** Quicker than the traffic: a gunship that dawdles at the pad won't catch them. */
const CONVOY_CRUISE = 19;

function convoyVan(index: number): MissionSpawn {
	const x = -140 - index * 16;
	const z = ARTERIAL_LANE;
	return { type: "vehicle", id: `m6-van-${index + 1}`, style: "van", colour: "#2b2f33", x, z, yaw: 270, route: [[x, z], ...CONVOY_ROUTE], cruise: CONVOY_CRUISE };
}
const VANS = Array.from({ length: CONVOY_VANS }, (_, index) => convoyVan(index));

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

/** The same three rivals turn up to every race, each in their own Vesper. */
const RIVALS: readonly { id: string; colour: string }[] = [
	{ id: "racer-1", colour: "#f2c14e" },
	{ id: "racer-2", colour: "#2f7fd6" },
	{ id: "racer-3", colour: "#2e9e5b" },
];
/** The Vesper the player races in, waiting on the grid. */
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
		chapter: "race",
		...mission,
		spawns: [{ type: "vehicle", id: RACE_CAR.id, style: RACE_CAR.style, colour: RACE_CAR.colour, x, z, yaw: race.yaw }, ...racers(race)],
		protect: [RACE_CAR.id],
		objectives: [
			{ kind: "enterVehicle", label: "Get in the white Vesper on the grid", vehicle: RACE_CAR.id, x, z, timeLimit: 60 },
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

/** Story missions first, in the order they're played; then side jobs and the races. */
// ---- Code Three ---------------------------------------------------------------------------------

const NIA = "Nia";
const DISPATCH = "Dispatch";
/** City Hospital's ambulance bay (see Hospitals): where the rigs wait, and where patients come in. */
const AMBULANCE_BAY = { x: -58, z: 16 };
const HOSPITAL_DOORS = { x: -52, z: 9 };
/** A T-bone on the west avenue, a block from the hospital: between junctions, clear of the railway. */
const CRASH = { x: -160, z: -45 };
const PATIENT_LOOK: PersonLook = { model: "womanSuit", palette: { skin: "#c89a7a", shirt: "#e4e1d8", pants: "#2b2f3a", hair: "#3a2416" } };
/**
 * Her hatchback, smashed and smoking, and the SUV that hit it, burning, both in the west lanes;
 * her on the pavement beside them, inside the SUV's blast if it goes up (BLAST_RADIUS, 9 m).
 */
const CRASH_SCENE: readonly MissionSpawn[] = [
	{ type: "vehicle", id: "c3-crash-a", style: "hatchback", colour: "#8f1d1d", x: CRASH.x - 3.5, z: CRASH.z + 3, yaw: 200, integrity: 30 },
	{ type: "vehicle", id: "c3-crash-b", style: "suv", colour: "#5c6166", x: CRASH.x - 1, z: CRASH.z - 3, yaw: 30, integrity: 25, burning: true },
	{ type: "hostile", id: "c3-patient", x: CRASH.x - 8, z: CRASH.z, armed: false, role: "passive", yaw: 90, ...PATIENT_LOOK },
];

/**
 * Code Three: an ambulance run. Take a rig from City Hospital, get to a crash with one car on
 * fire, and decide — pull the driver out now, before the fire takes the car she's lying beside
 * (it goes up about twenty seconds later), or keep her still and wait for the fire crew, who
 * come on their own to any car burning near the player. Then get her to the hospital alive, in
 * a rig still fit to carry her. If you're slow getting there, the fire spreads to her car too.
 */
const CODE_THREE: MissionDefinition = {
	id: "code-three",
	title: "Code Three",
	chapter: "side",
	giver: { name: "Nia Okafor", speaker: NIA, look: NIA_LOOK, role: "Paramedic · City Hospital", x: HOSPITAL_DOORS.x, z: HOSPITAL_DOORS.z },
	briefing: "We're a driver short and there's a T-bone on the west avenue, one car on fire. Take a rig from the bay — lights and siren, Code Three. Get her out, get her back here, and don't shake her to pieces on the way.",
	requires: ["clean-wheels"],
	reward: { cash: 1200, rep: { law: 1 } },
	protect: ["c3-patient"],
	objectives: [
		{
			kind: "enterVehicle",
			label: "Take an ambulance from the bay",
			style: "ambulance",
			x: AMBULANCE_BAY.x,
			z: AMBULANCE_BAY.z,
			timeLimit: 60,
		},
		{
			kind: "goto",
			step: "respond",
			label: "Get to the crash on the west avenue",
			x: CRASH.x,
			z: CRASH.z,
			radius: 16,
			timeLimit: 60,
			spawns: CRASH_SCENE,
			say: [{ who: DISPATCH, text: "Medic One, T-bone on the west avenue, one vehicle fully involved, one occupant out. Fire's been called." }],
		},
		{
			kind: "inspect",
			step: "assess",
			label: "Check on the driver",
			person: "c3-patient",
			x: CRASH.x,
			z: CRASH.z,
			radius: 3,
			seconds: 3,
			say: [{ who: NIA, text: "On foot. Talk to her, check her airway, and don't stand downwind of that thing." }],
		},
		{
			kind: "choice",
			label: "The SUV's burning beside her",
			options: [
				{
					label: "Pull her out now",
					detail: "Move her before the fire spreads — if the tank goes, nobody near it walks away",
					flags: ["pulled-early"],
					next: "carry",
				},
				{
					label: "Wait for the fire crew",
					detail: "Keep her still; the engine company's on its way",
					flags: ["waited-for-crew"],
					next: "wait",
				},
			],
		},
		{
			kind: "enterVehicle",
			step: "carry",
			label: "Get her into the ambulance — the tank's going",
			style: "ambulance",
			x: CRASH.x,
			z: CRASH.z,
			followers: ["c3-patient"],
			next: "deliver",
			say: [{ who: NIA, text: "It's leaking fuel. You've got seconds. Move her, now!" }],
		},
		{
			// Until the crew has put it out (the trigger below), or long enough that they must have.
			kind: "survive",
			step: "wait",
			label: "Keep her still until the fire crew puts it out",
			x: CRASH.x,
			z: CRASH.z,
			seconds: 75,
			say: [{ who: NIA, text: "Good call. Collar on, keep her talking. The engine's on its way." }],
		},
		{
			kind: "enterVehicle",
			step: "board",
			label: "Get her into the ambulance",
			style: "ambulance",
			x: CRASH.x,
			z: CRASH.z,
			followers: ["c3-patient"],
		},
		{
			kind: "deliver",
			step: "deliver",
			label: "Get her to City Hospital",
			style: "ambulance",
			person: "c3-patient",
			x: AMBULANCE_BAY.x,
			z: AMBULANCE_BAY.z,
			radius: 10,
			minIntegrity: 70,
			timeLimit: 90,
			say: [{ who: NIA, text: "Smooth and quick. Every pothole, she feels it — and so does the rig." }],
		},
	],
	triggers: [
		// Slow to the scene: the fire takes her car too (held burning, like the first).
		{
			when: { step: "respond", after: 40 },
			ignite: "c3-crash-a",
			flags: ["fire-spread"],
			notice: "The fire's spreading",
			say: [{ who: DISPATCH, text: "Medic One, caller says the second car's caught. Where are you?" }],
		},
		// Pulling her out early: the leak goes, and the SUV burns down to the tank.
		{ when: { step: "carry" }, letBurn: "c3-crash-b" },
		{
			when: { step: "wait", putOut: "c3-crash-b" },
			say: [{ who: DISPATCH, text: "Engine company reports the fire's knocked down. Load and go, Medic One." }],
			goto: "board",
		},
		{ when: { step: "deliver", wanted: 1 }, say: [{ who: DISPATCH, text: "Medic One, units are clearing your route. Nobody's chasing an ambulance today." }] },
	],
	outro: [
		{ who: NIA, text: "Pulled her clear with seconds to spare. Reckless — but she's alive. Come drive for us again.", onlyIf: ["pulled-early"] },
		{ who: NIA, text: "Textbook. The crew says you kept her still the whole time. Come drive for us again.", onlyIf: ["waited-for-crew"] },
	],
	bonuses: [
		{ id: "quick", label: "Done inside 3:00", kind: "time", seconds: 180 },
		{ id: "gentle", label: "Keep the rig above 90%", kind: "intact", min: 90 },
		{ id: "contained", label: "Reach the crash before the fire spreads", kind: "flag", flag: "!fire-spread" },
	],
};

// ---- Counting House: Benny's payback heist --------------------------------------------------------

const LENA = "Lena";
const LENA_LOOK: PersonLook = { model: "womanCasual", palette: { skin: "#d8a47f", shirt: "#1e2226", pants: "#2c2f36", hair: "#7a2a1c" } };
/** Meridian's counting house: a payday-loan shop on the commercial strip, its cash cage out back. */
const COUNTING_DOOR = { x: -120, z: 152 };
/** Across the arterial from it, where the van pulls up. */
const COUNTING_KERB = { x: -120, z: 165 };
/** The lockup by the port where the clean car waits, in the kerb lane of the west arterial. */
const LOCKUP = { x: -323, z: -100 };
/** The crew van outside Kasper Motors, on Benny's side of the street, and Lena on the pavement beside it. */
const CREW_VAN: MissionSpawn = { type: "vehicle", id: "static-van", style: "van", colour: "#d7d2c4", x: 5.25, z: 60, yaw: 0 };
const CREW: MissionSpawn = { type: "hostile", id: "lena", x: 8.1, z: 63.5, armed: false, role: "passive", yaw: 270, ...LENA_LOOK };
/** Meridian's security on the door: two watching the street, two walking it. */
const DOOR_GUARDS: readonly MissionSpawn[] = [
	guard("guard-1", { x: -124, z: 152 }, 0),
	guard("guard-2", { x: -116, z: 152 }, 0),
	guard("guard-3", { x: -131, z: 151.6 }, 0, "guard"),
	guard("guard-4", { x: -109, z: 151.6 }, 0, "guard"),
];
/** The Cinder Boys, called in by Meridian, from the west end of the strip; and one more guard from the east. */
const WEST_BACKUP: readonly MissionSpawn[] = [
	{ type: "hostile", id: "m3-goon-6", x: -158, z: 152, armed: true, toughness: 1.4 },
	{ type: "hostile", id: "m3-goon-7", x: -160, z: 156, armed: true, toughness: 1.4 },
];
const EAST_BACKUP: readonly MissionSpawn[] = [guard("guard-5", { x: -84, z: 152 }, 270, "guard")];
/**
 * Police roadblocks on the two ways west: across the west avenue's southbound lanes north of the
 * Ghats arterial, and across the port arterial. Two cars nose to nose, a car's width of kerb free
 * at either end for anyone brave enough.
 */
const ROADBLOCKS: readonly MissionSpawn[] = [
	{ type: "vehicle", id: "roadblock-1", style: "police", colour: "#101418", x: -162.6, z: 100, yaw: 75 },
	{ type: "vehicle", id: "roadblock-2", style: "police", colour: "#101418", x: -157.4, z: 100, yaw: 105 },
	{ type: "vehicle", id: "roadblock-3", style: "police", colour: "#101418", x: -322.6, z: 40, yaw: 75 },
	{ type: "vehicle", id: "roadblock-4", style: "police", colour: "#101418", x: -317.4, z: 40, yaw: 105 },
];
/** The clean car in the lockup. */
const SWITCH_CAR: MissionSpawn = { type: "vehicle", id: "m1-sedan", style: "sedan", colour: "#1f4f8a", x: LOCKUP.x, z: LOCKUP.z, yaw: 0 };

/**
 * Counting House: Meridian took a car off Benny's lot, so Benny takes Meridian's till. Drive Lena,
 * a safecracker, to the payday-loan front where Meridian counts its dirty cash; clear the door,
 * hold it while she opens the cage and Meridian's help arrives from both ends of the street; then
 * get out with three stars on you, through the roadblocks, to a clean car in a lockup by the port,
 * shake the police and bring her home. Cutscenes as she meets the player, as the door's looked
 * over, as the cage starts and at the switch; she talks on the drives.
 */
const COUNTING_HOUSE: MissionDefinition = {
	id: "counting-house",
	title: "Counting House",
	chapter: "side",
	giver: { name: "Benny Kasper", speaker: BENNY, look: BENNY_LOOK, role: "Fixer · Kasper Motors", ...KASPER },
	briefing: "Meridian took a car off my lot, so we take something off theirs. They count their dirty cash behind a payday-loan shop on the commercial strip. Lena opens the cage, you drive and keep her breathing. The cops will come, so there's a clean car waiting in a lockup by the port. In, out, home.",
	requires: ["clean-wheels"],
	reward: { cash: 6000, rep: { street: 2, meridian: -2 } },
	spawns: [CREW_VAN, CREW, SWITCH_CAR],
	protect: ["lena"],
	opening: {
		shots: [
			{ on: "lena", angle: 25, distance: 4.4, height: 1.9, orbit: 14, push: 0.8, say: [{ who: LENA, text: "You're Benny's new driver? I'm Lena. I open things that don't want opening." }] },
			{ on: "giver", over: "player", say: [{ who: BENNY, text: "Best box-cracker in the city. Bring her back in one piece, kid. Both of you, ideally." }] },
			{ on: "static-van", angle: 205, distance: 7, height: 1.6, push: 1.8, say: [{ who: LENA, text: "Van's clean. We go in, we come out, we never come back." }] },
		],
	},
	objectives: [
		{ kind: "enterVehicle", label: "Get in the crew van", vehicle: "static-van", x: CREW_VAN.x, z: CREW_VAN.z },
		// She comes over and climbs in once the driver's in.
		{ kind: "deliver", step: "drive", label: "Drive Lena to the counting house", vehicle: "static-van", person: "lena", ...COUNTING_KERB, radius: 12, spawns: DOOR_GUARDS, followers: ["lena"] },
		{
			kind: "eliminate",
			step: "hit",
			label: "Clear the door",
			...COUNTING_DOOR,
			targets: DOOR_GUARDS.map((spawn) => spawn.id),
			scene: {
				shots: [
					{ on: "guard-1", angle: 0, distance: 10, height: 2.4, push: 3, say: [{ who: LENA, text: "Four on the door. Meridian pays them to stand there looking bored." }] },
					{ on: "guard-4", angle: 28, distance: 7, height: 2, orbit: -10, seconds: 2.2 },
					{ on: "player", angle: 160, distance: 4.5, height: 1.8, say: [{ who: LENA, text: "Clear the door. I'll be right behind you." }] },
				],
			},
			done: [{ who: LENA, text: "Door's ours. Now the cage." }],
		},
		{
			kind: "inspect",
			step: "crack",
			label: "Hold the door while Lena opens the cage",
			...COUNTING_DOOR,
			radius: 9,
			seconds: 30,
			scene: { shots: [{ on: "lena", angle: 35, distance: 3.2, height: 1.65, push: 0.7, say: [{ who: LENA, text: "Three locks and a timer. Thirty seconds — and don't let anyone shoot me." }] }] },
			done: [{ who: LENA, text: "Open! Bags, bags, bags — okay, go!" }],
		},
		{
			kind: "enterVehicle",
			label: "Back to the van",
			vehicle: "static-van",
			x: COUNTING_KERB.x,
			z: COUNTING_KERB.z,
			wanted: 3,
			say: [{ who: LENA, text: "Silent alarm on the cage. Every cop in the city just heard about us." }],
		},
		{
			kind: "escort",
			step: "getaway",
			label: "Get Lena to the switch car at the port lockup",
			person: "lena",
			...LOCKUP,
			radius: 14,
			say: [{ who: DISPATCH, text: "All units, armed robbery on the commercial strip. Beige panel van, westbound. Roadblocks are going up." }],
		},
		{
			kind: "enterVehicle",
			label: "Swap into the clean car",
			vehicle: "m1-sedan",
			...LOCKUP,
			scene: { shots: [{ on: "m1-sedan", angle: 200, distance: 6, height: 1.5, push: 1.5, seconds: 2.5, say: [{ who: LENA, text: "Clean car, clean plates. Leave the van, it's done its job." }] }] },
		},
		{ kind: "loseWanted", label: "Lose the police", say: [{ who: LENA, text: "Side streets. Tight corners. They hate tight corners." }] },
		{ kind: "deliver", step: "home", label: "Bring Lena back to Kasper Motors", vehicleKind: "car", person: "lena", ...KASPER_YARD, radius: 10, clean: true },
	],
	triggers: [
		// On the drive in: getting to know each other.
		{ when: { step: "drive", after: 5 }, say: [{ who: LENA, text: "Benny says you caught a Vesper with a family sedan. True, or is Benny being Benny?" }] },
		{ when: { step: "drive", after: 15 }, say: [{ who: LENA, text: "Loans out the front, cash cage out the back. Meridian launders through other people's debts. Charming." }] },
		{ when: { step: "drive", after: 27 }, say: [{ who: BENNY, text: "Lena, the guards are Crane's, not cops. Keep it that way — cops get expensive." }] },
		{ when: { step: "drive", after: 38 }, say: [{ who: LENA, text: "Radio down when we get close. I like to hear a door before I see it." }] },
		// Holding the door: Meridian's help comes from both ends of the street.
		{ when: { step: "crack", after: 7 }, spawns: WEST_BACKUP, alertAll: true, notice: "Back-up from the west", say: [{ who: LENA, text: "Cinder Boys, west end! Meridian called in the help!" }] },
		{ when: { step: "crack", after: 17 }, spawns: EAST_BACKUP, alertAll: true, notice: "And from the east", say: [{ who: LENA, text: "One more, east side! Keep them off me!" }] },
		// The roads west close.
		{ when: { step: "getaway" }, spawns: ROADBLOCKS, notice: "Roadblocks on the way west" },
		{ when: { step: "getaway", after: 12 }, say: [{ who: LENA, text: "Police cars across the avenue up ahead — go round, or go through the gap at the kerb!" }] },
		// The drive home, with the cash in the back.
		{ when: { step: "home", after: 4 }, say: [{ who: LENA, text: "You drive like someone who's never been told no. I like it. Benny will hate it." }] },
		{ when: { step: "home", after: 15 }, say: [{ who: LENA, text: "Crane's going to count his till tonight and come up short. I want to see his face. I won't. But I want to." }] },
	],
	outro: [
		{ who: BENNY, text: "Look at that. Crane's money, in my garage. That's going to make him angry." },
		{ who: LENA, text: "If you ever need a door opened, kid, you know where Benny keeps me." },
	],
	bonuses: [
		{ id: "quick", label: "Done inside 9:00", kind: "time", seconds: 540 },
		{ id: "van", label: "Keep the van above 50%", kind: "intact", min: 50, vehicle: "static-van" },
		{ id: "clean-car", label: "Bring the clean car home above 80%", kind: "intact", min: 80, vehicle: "m1-sedan" },
	],
};

export const MISSIONS: readonly MissionDefinition[] = [
	COLD_OPEN,
	{
		id: "clean-wheels",
		title: "Clean Wheels",
		giver: { name: "Benny Kasper", speaker: BENNY, look: BENNY_LOOK, role: "Fixer · Kasper Motors", ...KASPER },
		briefing: "Crane's people will be watching my lot now, so this client's sedan goes up to your new place in Hillcrest. Yes, kid — the house is yours, a thank-you. It's alarmed, so the cops will come running. Lose them first, keep it pretty, and be quick.",
		requires: ["cold-open"],
		reward: { cash: 500, rep: { street: 1 } },
		spawns: [{ type: "vehicle", id: "m1-sedan", style: "sedan", colour: "#1f4f8a", x: 83.8, z: 40, yaw: 0 }],
		protect: ["m1-sedan"],
		objectives: [
			{ kind: "enterVehicle", label: "Get in the blue sedan", vehicle: "m1-sedan", x: 83.8, z: 40, timeLimit: 60 },
			{
				kind: "deliver",
				label: "Take it to your garage in Hillcrest",
				vehicle: "m1-sedan",
				x: SAFEHOUSE.door.x,
				z: SAFEHOUSE.door.z,
				radius: 10,
				minIntegrity: 70,
				clean: true,
				wanted: 1,
				timeLimit: 80,
				say: [{ who: BENNY, text: "That's the alarm. Lose the boys in blue before Hillcrest — the neighbours talk." }],
			},
		],
		outro: [{ who: BENNY, text: "Garage is yours. Anything you earn, you park there. Welcome to the family business." }],
		bonuses: [{ id: "pristine", label: "Deliver it above 90%", kind: "intact", min: 90, vehicle: "m1-sedan" }],
	},
	{
		id: "blue-lights",
		title: "Blue Lights",
		giver: { name: "Dez Moreno", speaker: DEZ, look: DEZ_LOOK, role: "Benny's nephew · hustler", x: 86, z: -40 },
		briefing: "Uncle Benny thinks I'm a kid. So we do a grown-up job: there's a buyer for a patrol car, lights and all. Take one from the station lot. The whole force will be on you — shake them, then get it to the chop shop before my buyer walks.",
		requires: ["clean-wheels"],
		reward: { cash: 1500, rep: { street: 1, law: -1 } },
		objectives: [
			{ kind: "enterVehicle", label: "Steal a police car", police: true, x: PATROL_LOT[0], z: PATROL_LOT[1], timeLimit: 60 },
			{ kind: "loseWanted", label: "Lose the cops", wanted: 3, timeLimit: 120, say: [{ who: DEZ, text: "Oh, that's a lot of sirens. That's fine! That's the job!" }] },
			{ kind: "deliver", label: "Drop the police car at the chop shop", police: true, x: CHOP_SHOP.x, z: CHOP_SHOP.z, radius: 12, minIntegrity: 40, clean: true, timeLimit: 70 },
		],
		outro: [{ who: DEZ, text: "Ha! Tell Benny. No — don't tell Benny. Tell him I'm doing great." }],
		bonuses: [{ id: "quick", label: "Done inside 3:30", kind: "time", seconds: 210 }],
	},
	LOOSE_LIPS,
	{
		id: "street-sweep",
		title: "Street Sweep",
		giver: { name: "Marisol Reyes", speaker: MARISOL, look: MARISOL_LOOK, role: "Sunset Park tenants' committee", x: -150, z: 234 },
		briefing: "The Cinder Boys have been leaning on families in Sunset Park — Meridian wants the land for warehouses and they're doing the asking. Five on the street, three carrying, and they'll call for back-up the moment it starts. End it.",
		requires: ["loose-lips"],
		reward: { cash: 1000, weapons: ["shotgun"], rep: { sunset: 2, meridian: -1 } },
		area: { x: -194, z: 339, radius: 200 },
		objectives: [
			{ kind: "goto", label: "Go to Sunset Park", x: -190, z: 290, radius: 18, timeLimit: 90 },
			{ kind: "eliminate", label: "Take out the crew", x: -194, z: 355, targets: GANG.map((goon) => goon.id), spawns: GANG, timeLimit: 150 },
			{ kind: "eliminate", label: "Their back-up's here: take them out", x: -194, z: 340, targets: BACKUP.map((goon) => goon.id), spawns: BACKUP, timeLimit: 90, say: [{ who: MARISOL, text: "More coming round the loop — from the north side!" }] },
		],
		outro: [{ who: MARISOL, text: "The Cinder Boys work for Meridian. Everyone knows. Now everyone knows you know." }],
		bonuses: [{ id: "quick", label: "Done inside 4:00", kind: "time", seconds: 240 }],
	},
	QUIET_MONEY,
	TAILGATE,
	{
		id: "ring-run",
		title: "Ring Run",
		giver: { name: "Captain Ilsa Brandt", speaker: BRANDT, look: BRANDT_LOOK, role: "Orion Air Base · flight instructor", x: AIRFIELD_GATE.x - 8, z: AIRFIELD_GATE.z },
		briefing: "Major Vos says you're the civilian who's been embarrassing Meridian Logistics. She wants you in the air. I want proof you won't crash my jet. Eight rings, two of them down on the waves, two and a half minutes.",
		requires: ["tailgate"],
		reward: { cash: 3000, weapons: ["ar"] },
		objectives: [
			{ kind: "enterVehicle", label: "Climb into a jet", vehicleKind: "jet", x: JET_STAND.x, z: JET_STAND.z, timeLimit: 60 },
			{ kind: "checkpoints", label: "Fly through the rings", points: RINGS, timeLimit: 150, say: [{ who: BRANDT, text: "Low over the water first. Don't touch it — it's harder than it looks." }] },
		],
		outro: [{ who: BRANDT, text: "Fine. You can fly. I'll tell the Major. Don't let it go to your head." }],
		bonuses: [{ id: "quick", label: "All rings inside 2:00", kind: "time", seconds: 140 }],
	},
	{
		id: "convoy",
		title: "Convoy",
		giver: { name: "Major Odile Vos", speaker: VOS, look: VOS_LOOK, role: "Orion Army Base", x: HELIPAD.x - 14, z: HELIPAD.z - 10 },
		briefing: "Ordnance stolen from my depot is moving under Meridian Logistics manifests. The vans left the city a minute ago for the expressway. The gunship's on the pad. None of them reaches the hills.",
		requires: ["ring-run"],
		reward: { cash: 5000, weapons: ["rocketLauncher"], rep: { meridian: -2 } },
		// They're already on their way as the briefing ends; Kincaid's roadblock holds one back, if
		// she has the ledger.
		spawns: VANS.slice(0, 3),
		objectives: [
			{ kind: "enterVehicle", label: "Take the gunship", vehicleKind: "gunship", x: HELIPAD.x, z: HELIPAD.z },
			{ kind: "destroyVehicles", label: "Destroy the convoy", x: -300, z: 0, ids: VANS.slice(0, 3).map((van) => van.id), onlyIf: ["ledger-police"] },
			{ kind: "destroyVehicles", label: "Destroy the convoy", x: -300, z: 0, ids: VANS.map((van) => van.id), onlyIf: ["!ledger-police"] },
		],
		triggers: [
			{ when: { flags: ["!ledger-police"] }, spawns: VANS.slice(3) },
			{ when: { flags: ["ledger-police"], after: 4 }, say: [{ who: KINCAID, text: "Your ledger paid off: we've boxed in one van at the ramp. Three left. Your problem." }] },
			{ when: { flags: ["ledger-sold"], after: 4 }, say: [{ who: VOS, text: "Four vans. Your detective friend didn't lift a finger. I wonder why." }] },
		],
		outro: [{ who: VOS, text: "Every crate accounted for. Whatever Crane is planning, he's planning it without my rockets." }],
		bonuses: [{ id: "quick", label: "Done inside 3:00", kind: "time", seconds: 180 }],
	},
	EXTRACTION,
	MERIDIAN_JOB,
	{
		id: "coastal-sprint",
		title: "Coastal Sprint",
		chapter: "side",
		giver: { name: "Tomas Quill", speaker: QUILL, look: QUILL_LOOK, role: "Collector · hates Silas Crane", x: 372, z: -151 },
		briefing: "Crane outbid me on a car once. I've hated him professionally ever since — and anyone who annoys him is a friend. My Vesper, the sea link, the far end in thirty seconds. Beat the clock and she's yours.",
		requires: ["clean-wheels"],
		reward: { cash: 750, vehicles: [{ id: "reward-coupe", style: "luxury", colour: "#b3121b", name: "Red Vesper" }] },
		timed: true,
		spawns: [{ type: "vehicle", id: "m4-coupe", style: "luxury", colour: "#b3121b", x: 382, z: -163.5, yaw: 90 }],
		protect: ["m4-coupe"],
		objectives: [
			{ kind: "enterVehicle", label: "Get in the red Vesper", vehicle: "m4-coupe", x: 382, z: -163.5 },
			{ kind: "checkpoints", label: "Race the sea link", points: SPRINT_CHECKPOINTS, timeLimit: 30 },
		],
		outro: [{ who: QUILL, text: "Magnificent. Keep her. Send Crane a photo." }],
	},
	CODE_THREE,
	COUNTING_HOUSE,
	raceMission(DOWNTOWN, {
		id: "downtown-dash",
		title: "Downtown Dash",
		giver: { name: "Rosa \"Redline\" Vega", speaker: ROSA, look: ROSA_LOOK, role: "Street racing", x: -100, z: 9 },
		briefing: "Two laps round the blocks, lights or no lights. My three best are already on the grid. Jax Ruelle used to race here before Crane bought him. You start at the back — win it.",
		requires: ["clean-wheels"],
		reward: { cash: 1500, rep: { street: 1 } },
		outro: [{ who: ROSA, text: "From the back of the grid! Okay, okay. You're in." }],
	}),
	raceMission(SEA_LINK, {
		id: "sea-link-showdown",
		title: "Sea Link Showdown",
		giver: { name: "Rosa \"Redline\" Vega", speaker: ROSA, look: ROSA_LOOK, role: "Street racing", x: 352, z: -169 },
		briefing: "Straight line, top speed, whoever blinks loses. The far end of the bridge, first one there.",
		requires: ["downtown-dash"],
		reward: { cash: 2500, rep: { street: 1 } },
		outro: [{ who: ROSA, text: "You didn't blink. I'm not sure you have eyelids." }],
	}),
	raceMission(GHATS, {
		id: "ghats-hillclimb",
		title: "Ghats Hillclimb",
		giver: { name: "Rosa \"Redline\" Vega", speaker: ROSA, look: ROSA_LOOK, role: "Street racing", x: -320, z: -9 },
		briefing: "Up the Ghats, through the tunnel, to the top. They know every bend. Beat them and the gold Vesper is yours.",
		requires: ["sea-link-showdown"],
		reward: { cash: 4000, rep: { street: 2 }, vehicles: [{ id: "reward-gold-coupe", style: "luxury", colour: "#c9a227", name: "Gold Vesper" }] },
		outro: [{ who: ROSA, text: "Gold suits you. Don't let it go to your head — let it go to your garage." }],
	}),
];

// ---- Street jobs ------------------------------------------------------------------------------------

/**
 * Small jobs that turn up between missions as leads on the map (see Leads): walk or drive up to
 * one and it starts — no briefing, no retry, paid every time. They share the mission pools with
 * the story, so only one thing runs at once.
 */
/** West along the arterial, north up the west side and back east: about a minute to stop it in. */
const COURIER_ROUTE = inLane([[60, 160], [-320, 160], [-320, -160], [0, -160]], ARTERIAL_LANE, false);
const NIGHT_LOOP: readonly Checkpoint[] = [[160, 0], [160, -160], [0, -160], [0, 0], [86, 0]].map(([x, z]) => ({ x, z, radius: 16 }));

export const JOBS: readonly MissionDefinition[] = [
	{
		id: "job-hot-plates",
		title: "Hot Plates",
		chapter: "job",
		giver: { name: "Street lead", role: "A car worth taking", x: -234, z: -100 },
		briefing: "A sedan with Meridian fleet plates, parked and alarmed. The chop shop pays for those.",
		spawns: [{ type: "vehicle", id: "plates-car", style: "sedan", colour: "#7a1f2b", x: -242.5, z: -96, yaw: 180 }],
		protect: ["plates-car"],
		intro: [{ who: DEZ, text: "Meridian plates on a red sedan, west side. Chop shop's buying.", onlyIf: ["dez-owes"] }],
		objectives: [
			{ kind: "enterVehicle", label: "Take the red sedan", vehicle: "plates-car", x: -242.5, z: -96, timeLimit: 60 },
			{ kind: "deliver", label: "Get it to the chop shop", vehicle: "plates-car", x: CHOP_SHOP.x, z: CHOP_SHOP.z, radius: 12, minIntegrity: 50, clean: true, wanted: 1, timeLimit: 150 },
		],
		reward: { cash: 450, rep: { street: 1 } },
	},
	{
		id: "job-courier",
		title: "Courier Run",
		chapter: "job",
		giver: { name: "Street lead", role: "A Meridian cash van", x: 8, z: 152 },
		briefing: "A Meridian courier van runs cash west along the arterial. Stop it and the bag's yours.",
		spawns: [{ type: "vehicle", id: "courier-van", style: "van", colour: "#2a2d31", x: COURIER_ROUTE[0][0], z: COURIER_ROUTE[0][1], yaw: 270, route: COURIER_ROUTE, cruise: 16, disableBelow: VAN_GIVES_UP_BELOW }],
		intro: [{ who: STATIC, text: "Courier van, westbound, any second now. Don't shoot the bag." }],
		objectives: [
			{ kind: "disable", label: "Stop the Meridian courier van", targets: ["courier-van"], below: VAN_GIVES_UP_BELOW, x: COURIER_ROUTE[0][0], z: COURIER_ROUTE[0][1] },
			{ kind: "inspect", label: "Grab the cash bag", person: "courier-van", x: 0, z: 160, radius: 7, seconds: 2 },
		],
		reward: { cash: 650, rep: { street: 1, meridian: -1 } },
	},
	{
		id: "job-cinder-toll",
		title: "Cinder Toll",
		chapter: "job",
		giver: { name: "Street lead", role: "Cinder Boys shaking down a corner", x: -246, z: 168 },
		briefing: "Three Cinder Boys charging shopkeepers a 'toll' on the corner.",
		area: { x: -246, z: 168, radius: 120 },
		intro: [{ who: MARISOL, text: "They're back on the corner by the chop shop. Please.", onlyIf: ["marisol-saved"] }],
		objectives: [
			{
				kind: "eliminate",
				label: "Run the Cinder Boys off the corner",
				x: -246,
				z: 168,
				targets: ["m3-goon-1", "m3-goon-2", "m3-goon-3"],
				spawns: [
					{ type: "hostile", id: "m3-goon-1", x: -249, z: 151.5, armed: true, toughness: 1.3 },
					{ type: "hostile", id: "m3-goon-2", x: -231.5, z: 170, armed: false },
					{ type: "hostile", id: "m3-goon-3", x: -250, z: 172, armed: false },
				],
				timeLimit: 120,
			},
		],
		reward: { cash: 500, rep: { sunset: 1, meridian: -1 } },
	},
	{
		id: "job-night-loop",
		title: "Night Loop",
		chapter: "job",
		giver: { name: "Street lead", role: "Rosa's crew timing laps", x: 88, z: -8 },
		briefing: "Rosa's crew is timing laps round the downtown blocks. Beat the clock.",
		intro: [{ who: ROSA, text: "Round the blocks, back here, fifty-five seconds. Go when you're rolling." }],
		objectives: [
			{ kind: "enterVehicle", label: "Get a car", vehicleKind: "car", x: 88, z: -8, timeLimit: 45 },
			// A clean lap from a standing start is about 38 s; the clock starts at the door, wherever the car's facing.
			{ kind: "checkpoints", label: "Lap the downtown blocks", points: NIGHT_LOOP, timeLimit: 55 },
		],
		reward: { cash: 350, rep: { street: 1 } },
	},
];

/** Everything the director can run: the missions and the street jobs. */
export const ALL_MISSIONS: readonly MissionDefinition[] = [...MISSIONS, ...JOBS];

export function missionById(id: string): MissionDefinition | undefined {
	return ALL_MISSIONS.find((mission) => mission.id === id);
}
