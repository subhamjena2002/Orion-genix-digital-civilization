import { AnimTrack, Asset, Color, Entity, Script, StandardMaterial } from "playcanvas";

import { combatAudio } from "../combat/CombatAudio";
import { applyDamage, damageableMoved, damageablesNear, registerDamageable, unregisterDamageable, type Listener } from "../combat/CombatWorld";
import { Health, makeDamageEvent, nextCombatId, type DamageEvent, type DamageSourceRef } from "../combat/Damage";
import { MeleeAttack } from "../combat/MeleeAttack";
import { inCameraView, needsPosing, readPlayerPose } from "../player/PlayerPose";
import { mergeCharacterMaterials } from "../rendering/CharacterMerge";
import { fixSkinnedBounds } from "../rendering/SkinnedBounds";
import { applySmoothShading } from "../rendering/SmoothShading";
import { pavementCorner, ROAD_GRID, roadWidthAt } from "../roads/RoadNetwork";
import { crashEffects } from "../traffic/CrashEffects";
import { registerTrafficAgent, unregisterTrafficAgent, type TrafficAgent } from "../traffic/TrafficAgents";
import { redRemaining, signalGroup } from "../traffic/TrafficSignals";
import { Knockdown } from "./Knockdown";
import { NpcBrain, paceFor, runsThisFrame, updateInterval, type NpcState } from "./NpcBrain";
import type { PedestrianPalette } from "./Pedestrians";

/** Beyond this the pedestrian is recycled to a junction near the player. */
const RECYCLE_DISTANCE = 190;
/**
 * Where recycled pedestrians reappear. The lower bound trades a little pop-in risk for a
 * crowd that's actually visible — at 70+ everyone was a distant speck.
 */
const RESPAWN_MIN = 28;
const RESPAWN_MAX = 150;
/** Recycled pedestrians appear out of sight, or at least this far off. */
const RESPAWN_HIDDEN_RANGE = 120;
const RESPAWN_ATTEMPTS = 12;
/** Walk cycles pause while nobody could see them. */
const ANIMATION_RANGE = 90;

/** Materials that should never be tinted — eyes and metal trim read wrong recoloured. */
const UNTINTED = ["eye", "metal", "gold", "white"];
/** Ground speed the walk clip looks natural at; playback scales around it. */
const REFERENCE_WALK_SPEED = 1.5;
/** Ground speed the run clip looks natural at. */
const REFERENCE_RUN_SPEED = 4;
const TURN_RESPONSE = 7;

/**
 * Player avoidance. Clearance is the player's capsule radius plus a pedestrian's shoulder
 * half-width plus a little personal space, measured centre to centre.
 */
const AVOID_CLEARANCE = 1.05;
/** How far ahead along the path a pedestrian starts reacting to the player. */
const AVOID_LOOK_AHEAD = 4;
/** Keep holding the side-step until the player is this far behind them. */
const AVOID_LOOK_BEHIND = 0.8;
const AVOID_RESPONSE = 3.5;
/** Pedestrians slow down while they sidestep instead of barging through at full pace. */
const AVOID_MIN_SPEED_FACTOR = 0.35;
/** Two pedestrians passing need less room than a pedestrian passing the player's capsule. */
const PERSON_CLEARANCE = 0.8;
/** Extra metres of red light a pedestrian wants beyond the road width before stepping out. */
const CROSSING_MARGIN = 3;
const STATE_BLEND_SECONDS = 0.3;

const HEALTH = 100;
const BODY_RADIUS = 0.3;
const BODY_HEIGHT = 1.8;
/** A pedestrian who fights back punches like this. */
const PUNCH = { windup: 0.28, active: 0.12, recovery: 0.35, cooldown: 0.45 };
const PUNCH_DAMAGE = 7;
/** Knockback a blow needs to throw a body rather than drop it where it stood. */
const THROW_IMPULSE = 3.5;
/** Leaning back from a blow, degrees, easing out over the stagger. */
const STAGGER_LEAN = 14;

/** Animation state for each brain state; clips a model lacks fall back sensibly. */
function clipFor(state: NpcState): "Walk" | "Idle" | "Run" | "Punch" | "Hit" {
	switch (state) {
		case "FLEE":
		case "RUN": return "Run";
		case "ATTACK": return "Punch";
		case "HIT": return "Hit";
		case "IDLE":
		case "ALERT": return "Idle";
		default: return "Walk";
	}
}

/**
 * A pedestrian: walks the city's pavements, and reacts when things go wrong.
 *
 * Movement follows the junction lattice as a graph: the pedestrian walks kerb-to-kerb between
 * adjacent junctions, then picks a new direction on arrival — so they genuinely roam the city
 * rather than pacing one block, and turns at junctions stay on the pavement. Fleeing uses the
 * same graph at a run, turning away from the danger at each junction.
 *
 * Behaviour comes from an NpcBrain (state machine) fed by events — damage, gunshots heard,
 * fights seen — rather than per-frame decisions. Logic runs at a rate set by distance from the
 * player (every frame close up, down to every eighth frame far off and out of sight), with the
 * skipped time accumulated so movement stays correct.
 *
 * Anyone who drifts too far from the player is recycled to a junction nearby as someone new,
 * keeping a constant local crowd.
 */
export class OrionPedestrian extends Script {
	public static scriptName = "orionPedestrian";

	public asset: Asset | null = null;
	public speed = 1.3;
	public seed = 1;
	public palette: PedestrianPalette | null = null;

	private random: () => number = Math.random;
	private ready = false;
	private xIndex = 0;
	private zIndex = 0;
	private targetX = 0;
	private targetZ = 0;
	private sideX = 1;
	private sideZ = 1;
	private progress = 0;
	private heading: number | null = null;
	/** Sideways displacement from the kerb line, used to step around the player. */
	private avoidOffset = 0;
	private animRoot: Entity | null = null;
	private agent: TrafficAgent | null = null;
	private knockdown: Knockdown | null = null;
	private readonly clips = new Set<string>();
	private currentClip = "";

	private brain: NpcBrain = new NpcBrain(0);
	private readonly health = new Health(HEALTH);
	private readonly source: DamageSourceRef = { id: nextCombatId(), kind: "npc", x: 0, z: 0 };
	private body: Listener | null = null;
	private readonly punch = new MeleeAttack(PUNCH);
	private readonly event: DamageEvent = makeDamageEvent();
	/** Off the pavement graph (fighting), and where the graph was left. */
	private freeX = 0;
	private freeZ = 0;
	private offGraph = false;
	private staggerLean = 0;
	private accumulated = 0;
	private posX = 0;
	private posY = 0;
	private posZ = 0;
	private waitingAtCrossing = false;

	public initialize() {
		this.random = mulberry32(this.seed);
		this.sideX = this.random() < 0.5 ? -1 : 1;
		this.sideZ = this.random() < 0.5 ? -1 : 1;
		// Most people run from trouble; about one in six will square up to whoever hit them.
		this.brain = new NpcBrain(this.random() < 0.17 ? 0.85 : 0.05, this.random);
		this.agent = registerTrafficAgent("person", 0.3);
		this.agent.onStruck = (velocityX, velocityZ) => this.struck(velocityX, velocityZ);
		this.knockdown = new Knockdown(this.entity, this.app);
		const isAlive = () => this.health.alive && this.ready;
		this.body = {
			id: this.source.id,
			kind: "person",
			x: 0, y: 0, z: 0,
			radius: BODY_RADIUS,
			height: BODY_HEIGHT,
			halfLength: 0, headingX: 0, headingZ: 1,
			get alive() {
				return isAlive();
			},
			takeDamage: (event) => this.takeDamage(event),
			disturb: (threat) => this.brain.onDisturbance(threat),
		};
		this.on("destroy", () => {
			if (this.agent) unregisterTrafficAgent(this.agent);
			if (this.body) unregisterDamageable(this.body);
			this.knockdown?.destroy();
		});
		this.recycleNearPlayer();
		this.trySetup();
	}

	public update(dt: number) {
		if (!this.ready) {
			this.trySetup();
			if (!this.ready) return;
		}
		if (this.knockdown?.active) {
			this.updateKnockedDown(dt);
			return;
		}

		// Distance-tiered logic: skipped frames' time is carried to the next update.
		const player = readPlayerPose();
		this.accumulated += dt;
		const distanceToPlayer = Math.hypot(this.posX - player.x, this.posZ - player.z);
		const interval = this.brain.roaming ? updateInterval(distanceToPlayer, inCameraView(this.posX, this.posZ, ANIMATION_RANGE)) : 1;
		if (!runsThisFrame(this.app.frame, this.agent?.id ?? 0, interval)) return;
		const step = Math.min(this.accumulated, 0.25);
		this.accumulated = 0;

		const threat = this.brain.threat;
		if (threat?.attackable) this.brain.trackThreat(player.x, player.z);
		const threatDistance = threat ? Math.hypot(threat.x - this.posX, threat.z - this.posZ) : Infinity;
		const state = this.brain.update(step, threatDistance);
		this.setClip(clipFor(state));

		if (state === "RUN" || state === "ATTACK" || state === "HIT") this.updateOffGraph(step, state);
		else if (this.offGraph) this.returnToGraph(step);
		else this.updateOnGraph(step, state);

		this.publishBody();
		// Animating a whole crowd is expensive; nobody notices a stride paused off-screen.
		// Pausing (not disabling) keeps the component's state, so resuming costs nothing.
		const anim = this.animRoot?.anim;
		if (anim) {
			const seen = inCameraView(this.posX, this.posZ, ANIMATION_RANGE);
			if (anim.playing !== seen) anim.playing = seen;
		}

		if (this.brain.roaming && distanceToPlayer > RECYCLE_DISTANCE && !inCameraView(this.posX, this.posZ, RESPAWN_HIDDEN_RANGE)) {
			this.recycleNearPlayer();
		}
	}

	/** Walking (or fleeing) along the pavement graph. */
	private updateOnGraph(dt: number, state: NpcState) {
		const from = pavementCorner(ROAD_GRID.xs[this.xIndex], ROAD_GRID.zs[this.zIndex], this.sideX, this.sideZ);
		const to = pavementCorner(ROAD_GRID.xs[this.targetX], ROAD_GRID.zs[this.targetZ], this.sideX, this.sideZ);
		const legLength = Math.hypot(to[0] - from[0], to[2] - from[2]);
		const dirX = (to[0] - from[0]) / Math.max(legLength, 0.001);
		const dirZ = (to[2] - from[2]) / Math.max(legLength, 0.001);
		// Perpendicular to the direction of travel (pedestrian's right-hand side).
		const perpX = -dirZ;
		const perpZ = dirX;
		const fleeing = state === "FLEE";

		// Fleeing towards the danger? Turn round on the spot and run back the way you came.
		const threat = this.brain.threat;
		if (fleeing && threat && (threat.x - this.posX) * dirX + (threat.z - this.posZ) * dirZ > 0 && legLength > 0.001) {
			[this.xIndex, this.targetX] = [this.targetX, this.xIndex];
			[this.zIndex, this.targetZ] = [this.targetZ, this.zIndex];
			this.progress = 1 - this.progress;
			return;
		}

		const player = readPlayerPose();
		const baseX = from[0] + (to[0] - from[0]) * this.progress;
		const baseZ = from[2] + (to[2] - from[2]) * this.progress;

		// Step around whoever is closest ahead in the walking line: the player, another
		// pedestrian or a posted officer. The offset keeps full clearance on the side away from
		// them; once they're behind, the pedestrian eases back onto the kerb line.
		let targetOffset = 0;
		let speedFactor = 1;
		let nearestAhead = Infinity;
		const avoid = (ox: number, oz: number, clearance: number) => {
			const relX = ox - baseX;
			const relZ = oz - baseZ;
			const ahead = relX * dirX + relZ * dirZ;
			const lateral = relX * perpX + relZ * perpZ;
			if (ahead <= -AVOID_LOOK_BEHIND || ahead >= AVOID_LOOK_AHEAD || Math.abs(lateral) >= clearance) return;
			if (ahead >= nearestAhead) return;
			nearestAhead = ahead;
			const side = lateral > 0 ? -1 : 1;
			targetOffset = lateral + side * clearance;
			// Not yet stepped clear and close ahead: slow right down while sidestepping.
			const gap = Math.abs(lateral - this.avoidOffset);
			speedFactor = ahead > 0 && gap < clearance
				? Math.max(AVOID_MIN_SPEED_FACTOR, Math.min(1, ahead / AVOID_LOOK_AHEAD) * (gap / clearance))
				: 1;
		};
		avoid(player.x, player.z, AVOID_CLEARANCE);
		// Only people within look-ahead range matter; the grid finds them without scanning the crowd.
		for (const other of damageablesNear(baseX, baseZ, AVOID_LOOK_AHEAD + 1)) {
			if (other.kind === "person" && other.id !== this.source.id && other.alive) avoid(other.x, other.z, PERSON_CLEARANCE);
		}
		this.avoidOffset += (targetOffset - this.avoidOffset) * (1 - Math.exp(-AVOID_RESPONSE * dt));

		const pace = paceFor(state);
		const step = this.speed * pace * (fleeing ? 1 : speedFactor) * dt;
		// People running for their lives don't wait for the lights.
		const waiting = pace > 0 && !fleeing && this.mustWaitToCross(baseX, baseZ, dirX, dirZ, step);
		if (waiting !== this.waitingAtCrossing) {
			this.waitingAtCrossing = waiting;
			this.brain.setWaiting(waiting);
		}
		if (!waiting && pace > 0) this.progress += step / Math.max(legLength, 0.001);
		if (this.progress >= 1) {
			this.xIndex = this.targetX;
			this.zIndex = this.targetZ;
			this.progress = 0;
			this.chooseNextJunction(fleeing);
			return;
		}

		const x = from[0] + (to[0] - from[0]) * this.progress + perpX * this.avoidOffset;
		const z = from[2] + (to[2] - from[2]) * this.progress + perpZ * this.avoidOffset;
		const movedX = x - this.posX;
		const movedZ = z - this.posZ;
		// Face the actual direction of movement so the sidestep reads as a turn. Someone alert
		// turns to look at the trouble instead.
		const moving = Math.hypot(movedX, movedZ) > 0.0005;
		let targetHeading = Math.atan2(moving ? movedX : dirX, moving ? movedZ : dirZ) * 180 / Math.PI;
		if (state === "ALERT" && threat) targetHeading = Math.atan2(threat.x - x, threat.z - z) * 180 / Math.PI;
		this.moveTo(x, from[1], z, targetHeading, dt);
		// Slow the stride with the body so the feet don't skate while sidestepping.
		const anim = this.animRoot?.anim;
		if (anim && !waiting) anim.speed = fleeing ? Math.max(0.8, (this.speed * pace) / REFERENCE_RUN_SPEED) : this.walkRate(pace * speedFactor);
		if (this.agent) {
			this.agent.headingX = dirX;
			this.agent.headingZ = dirZ;
			this.agent.speed = waiting ? 0 : step / Math.max(dt, 1e-4);
		}
	}

	/** Fighting or staggering: free movement on the ground, towards the target. */
	private updateOffGraph(dt: number, state: NpcState) {
		if (!this.offGraph) {
			this.offGraph = true;
			this.freeX = this.posX;
			this.freeZ = this.posZ;
		}
		const threat = this.brain.threat;
		let heading = this.heading ?? 0;
		if (threat) {
			const dx = threat.x - this.freeX;
			const dz = threat.z - this.freeZ;
			const distance = Math.hypot(dx, dz);
			heading = Math.atan2(dx, dz) * 180 / Math.PI;
			if (state === "RUN" && distance > 0.9) {
				const step = Math.min(distance - 0.9, this.speed * paceFor("RUN") * dt);
				this.freeX += (dx / distance) * step;
				this.freeZ += (dz / distance) * step;
			}
		}
		if (state === "ATTACK") this.updatePunch(dt);
		else this.punch.cancel();
		this.staggerLean *= Math.exp(-6 * dt);
		this.moveTo(this.freeX, this.posY, this.freeZ, heading, dt);
		const anim = this.animRoot?.anim;
		if (anim) anim.speed = state === "RUN" ? 1.1 : 1;
	}

	/** Swinging at the player when in reach. */
	private updatePunch(dt: number) {
		this.punch.start();
		this.punch.update(dt);
		if (!this.punch.active) return;
		const player = readPlayerPose();
		if (player.inVehicle) return;
		for (const target of damageablesNear(this.freeX, this.freeZ, 1.6)) {
			if (target.kind !== "player" || !this.punch.canHit(target.id)) continue;
			this.punch.markHit(target.id);
			const away = Math.hypot(target.x - this.freeX, target.z - this.freeZ) || 1;
			const event = this.event;
			event.amount = PUNCH_DAMAGE;
			event.type = "melee";
			event.source = this.source;
			event.x = target.x;
			event.y = target.y + 1.4;
			event.z = target.z;
			event.directionX = (target.x - this.freeX) / away;
			event.directionZ = (target.z - this.freeZ) / away;
			event.impulse = 1.2;
			applyDamage(target, event);
			combatAudio().play("punch", target.x, target.y + 1.4, target.z);
		}
	}

	/**
	 * Back onto the pavement graph after a fight or a stagger: to the leg's nearer corner at a
	 * walk, or — running from danger — to whichever end of the leg is further from it, at a run.
	 */
	private returnToGraph(dt: number) {
		const state = this.brain.state;
		const threat = this.brain.threat;
		if (state === "FLEE" && threat) {
			const here = pavementCorner(ROAD_GRID.xs[this.xIndex], ROAD_GRID.zs[this.zIndex], this.sideX, this.sideZ);
			const there = pavementCorner(ROAD_GRID.xs[this.targetX], ROAD_GRID.zs[this.targetZ], this.sideX, this.sideZ);
			if (Math.hypot(there[0] - threat.x, there[2] - threat.z) > Math.hypot(here[0] - threat.x, here[2] - threat.z)) {
				this.xIndex = this.targetX;
				this.zIndex = this.targetZ;
			}
		}
		const pace = paceFor(state === "FLEE" ? "FLEE" : "WALK");
		const corner = pavementCorner(ROAD_GRID.xs[this.xIndex], ROAD_GRID.zs[this.zIndex], this.sideX, this.sideZ);
		const dx = corner[0] - this.freeX;
		const dz = corner[2] - this.freeZ;
		const distance = Math.hypot(dx, dz);
		if (distance < 0.1) {
			this.offGraph = false;
			this.progress = 0;
			this.avoidOffset = 0;
			this.chooseNextJunction(state === "FLEE");
			return;
		}
		const step = Math.min(distance, this.speed * pace * dt);
		this.freeX += (dx / distance) * step;
		this.freeZ += (dz / distance) * step;
		this.setClip(state === "FLEE" ? "Run" : "Walk");
		this.moveTo(this.freeX, corner[1], this.freeZ, Math.atan2(dx, dz) * 180 / Math.PI, dt);
	}

	/** Places the body, easing its heading round; skips the transform when nobody would see it. */
	private moveTo(x: number, y: number, z: number, targetHeading: number, dt: number) {
		this.posX = x;
		this.posY = y;
		this.posZ = z;
		if (this.heading === null) this.heading = targetHeading;
		const turn = ((targetHeading - this.heading + 540) % 360) - 180;
		this.heading += turn * (1 - Math.exp(-TURN_RESPONSE * dt));
		if (needsPosing(x, z, this.app.frame, this.agent?.id ?? 0)) {
			this.entity.setPosition(x, y, z);
			this.entity.setEulerAngles(-this.staggerLean, this.heading, 0);
		}
		if (this.agent) {
			this.agent.x = x;
			this.agent.z = z;
		}
	}

	private publishBody() {
		const body = this.body;
		if (!body) return;
		body.x = this.posX;
		body.y = this.posY;
		body.z = this.posZ;
		this.source.x = this.posX;
		this.source.z = this.posZ;
		damageableMoved(body);
	}

	private takeDamage(event: DamageEvent) {
		if (!this.ready || this.knockdown?.active) return;
		const killed = this.health.damage(event.amount);
		const source = event.source;
		this.brain.onDamaged(source ? { id: source.id, x: source.x, z: source.z, attackable: source.kind === "player" } : null, killed);
		if (killed) {
			this.die(event);
			return;
		}
		this.staggerLean = STAGGER_LEAN;
		this.setClip("Hit", true);
	}

	/** Down: thrown by a big blow or blast, crumpled where they stood by anything else. */
	private die(event: DamageEvent) {
		if (this.agent) {
			this.agent.alive = false;
			this.agent.speed = 0;
		}
		const impulse = event.impulse >= THROW_IMPULSE ? event.impulse : event.impulse * 0.4;
		this.knockdown?.strike(event.directionX * impulse, event.directionZ * impulse, this.animRoot?.anim, this.heading ?? 0);
		crashEffects(this.app).impact(event.x, event.y, event.z, -event.directionX, 0.3, -event.directionZ, "flesh");
	}

	/** Hit by a car (TrafficAgents): always a killing blow, thrown along the car's path. */
	private struck(velocityX: number, velocityZ: number) {
		if (!this.ready || !this.knockdown || this.knockdown.active) return;
		this.health.damage(this.health.current);
		this.brain.onDamaged(null, true);
		if (this.agent) {
			this.agent.alive = false;
			this.agent.speed = 0;
		}
		this.knockdown.strike(velocityX, velocityZ, this.animRoot?.anim, this.heading ?? 0);
	}

	private updateKnockedDown(dt: number) {
		const knockdown = this.knockdown!;
		const phase = knockdown.update(dt);
		const position = this.entity.getPosition();
		this.posX = position.x;
		this.posZ = position.z;
		if (this.agent) {
			this.agent.x = position.x;
			this.agent.z = position.z;
		}
		if (phase !== "gone") return;

		// Someone new walks on: back on their feet at a junction away from the player.
		knockdown.reset();
		this.health.reset();
		this.brain.reset();
		this.offGraph = false;
		this.staggerLean = 0;
		if (this.agent) this.agent.alive = true;
		this.recycleNearPlayer();
		this.entity.setEulerAngles(0, 0, 0);
		this.waitingAtCrossing = false;
		this.currentClip = "";
		const anim = this.animRoot?.anim;
		if (anim) anim.speed = 1;
		this.setClip("Walk");
	}

	private walkRate(factor: number): number {
		return Math.max(0.3, factor);
	}

	/** Plays a clip by role, falling back to what the model has. */
	private setClip(clip: "Walk" | "Idle" | "Run" | "Punch" | "Hit", restart = false) {
		const anim = this.animRoot?.anim;
		if (!anim) return;
		let state: string = clip;
		if (!this.clips.has(state)) state = clip === "Idle" ? "Walk" : clip === "Hit" ? "Idle" : clip === "Run" ? "Walk" : "Idle";
		if (!this.clips.has(state)) state = "Walk";
		if (state === this.currentClip && !restart) return;
		this.currentClip = state;
		anim.baseLayer?.transition(state, state === "Hit" ? 0.08 : STATE_BLEND_SECONDS);
		if (state === "Idle" || state === "Hit" || state === "Punch") anim.speed = 1;
	}

	/**
	 * True if the next step would take the pedestrian off the kerb onto a carriageway whose
	 * traffic doesn't have a red light long enough to get across. Once on the road they keep
	 * going, so nobody freezes mid-crossing.
	 */
	private mustWaitToCross(x: number, z: number, dirX: number, dirZ: number, step: number): boolean {
		const alongX = dirX !== 0;
		const position = alongX ? x : z;
		const next = position + (alongX ? dirX : dirZ) * step;
		const lineIndex = alongX ? this.zIndex : this.xIndex;
		for (const index of alongX ? [this.xIndex, this.targetX] : [this.zIndex, this.targetZ]) {
			const centre = alongX ? ROAD_GRID.xs[index] : ROAD_GRID.zs[index];
			const half = roadWidthAt(centre) / 2;
			const entering = Math.abs(position - centre) >= half && Math.abs(next - centre) < half;
			if (!entering) continue;
			// Walking along X crosses a north–south road, whose traffic is on the "ns" signal.
			const group = alongX ? signalGroup(index, lineIndex) : signalGroup(lineIndex, index);
			const crossingSeconds = (2 * half + CROSSING_MARGIN) / Math.max(this.speed, 0.1);
			return redRemaining(group, alongX ? "ns" : "ew") < crossingSeconds;
		}
		return false;
	}

	/**
	 * Picks an adjacent junction, preferring not to double back on itself. Someone fleeing picks
	 * whichever takes them furthest from the danger.
	 */
	private chooseNextJunction(fleeing = false) {
		const options: [number, number][] = [];
		if (this.xIndex > 0) options.push([this.xIndex - 1, this.zIndex]);
		if (this.xIndex < ROAD_GRID.xs.length - 1) options.push([this.xIndex + 1, this.zIndex]);
		if (this.zIndex > 0) options.push([this.xIndex, this.zIndex - 1]);
		if (this.zIndex < ROAD_GRID.zs.length - 1) options.push([this.xIndex, this.zIndex + 1]);

		const threat = this.brain.threat;
		if (fleeing && threat) {
			let best = options[0];
			let bestDistance = -Infinity;
			for (const option of options) {
				const distance = Math.hypot(ROAD_GRID.xs[option[0]] - threat.x, ROAD_GRID.zs[option[1]] - threat.z);
				if (distance > bestDistance) {
					bestDistance = distance;
					best = option;
				}
			}
			[this.targetX, this.targetZ] = best;
			return;
		}
		const forward = options.filter(([x, z]) => x !== this.targetX || z !== this.targetZ);
		const pool = forward.length > 0 && this.random() < 0.85 ? forward : options;
		const [nextX, nextZ] = pool[Math.floor(this.random() * pool.length)];
		this.targetX = nextX;
		this.targetZ = nextZ;
	}

	private recycleNearPlayer() {
		const player = readPlayerPose();
		for (let attempt = 0; attempt < RESPAWN_ATTEMPTS; attempt++) {
			const angle = this.random() * Math.PI * 2;
			const distance = RESPAWN_MIN + this.random() * (RESPAWN_MAX - RESPAWN_MIN);
			this.xIndex = nearestIndex(ROAD_GRID.xs, player.x + Math.cos(angle) * distance);
			this.zIndex = nearestIndex(ROAD_GRID.zs, player.z + Math.sin(angle) * distance);
			const [cx, , cz] = pavementCorner(ROAD_GRID.xs[this.xIndex], ROAD_GRID.zs[this.zIndex], this.sideX, this.sideZ);
			const fromPlayer = Math.hypot(cx - player.x, cz - player.z);
			if (fromPlayer >= RESPAWN_MIN && !inCameraView(cx, cz, RESPAWN_HIDDEN_RANGE)) break;
		}
		this.targetX = this.xIndex;
		this.targetZ = this.zIndex;
		this.progress = 0;
		this.heading = null;
		this.avoidOffset = 0;
		const [cx, cy, cz] = pavementCorner(ROAD_GRID.xs[this.xIndex], ROAD_GRID.zs[this.zIndex], this.sideX, this.sideZ);
		this.posX = cx;
		this.posY = cy;
		this.posZ = cz;
		this.chooseNextJunction();
	}

	private trySetup() {
		const resource = this.asset?.resource as { animations?: readonly Asset[] } | undefined;
		const model = this.resolveModelRoot();
		if (!resource || !model) return;

		applySmoothShading(model);
		fixSkinnedBounds(model);
		this.applyPalette(model);
		mergeCharacterMaterials(model, this.app.graphicsDevice);
		this.assignClips(model, resource.animations);
		this.animRoot = model;
		this.ready = true;
		if (this.body) {
			this.publishBody();
			registerDamageable(this.body);
		}
	}

	/**
	 * `<Container>` renders its own entity and parents the instantiated glTF beneath it, so the
	 * model root sits two levels down from the entity this script is attached to. The anim
	 * component must go on that root or its curve paths won't resolve against the armature.
	 */
	private resolveModelRoot(): Entity | undefined {
		const containerEntity = this.entity.children[0] as Entity | undefined;
		return (containerEntity?.children[0] ?? containerEntity) as Entity | undefined;
	}

	/**
	 * Tints each person individually. Materials must be cloned first: every pedestrian is
	 * instantiated from one shared container asset, so mutating them directly would recolour
	 * the whole crowd at once. The two character packs name their materials differently — the
	 * men use Shirt/Pants, the women use colour names — so anything that isn't skin, hair or
	 * trim is treated as clothing and alternated between the two garment colours.
	 */
	private applyPalette(model: Entity) {
		if (!this.palette) return;
		const palette = this.palette;
		let garmentIndex = 0;

		const renders = model.findComponents("render") as unknown as { meshInstances: { material: StandardMaterial }[] }[];
		for (const render of renders) {
			for (const meshInstance of render.meshInstances) {
				const name = (meshInstance.material.name ?? "").toLowerCase();
				if (UNTINTED.some((skip) => name.includes(skip))) continue;

				let colour: string;
				if (name.includes("skin")) colour = palette.skin;
				else if (name.includes("hair")) colour = palette.hair;
				else colour = (garmentIndex++ % 2 === 0) ? palette.shirt : palette.pants;

				const tinted = meshInstance.material.clone();
				tinted.diffuse = new Color().fromString(colour);
				tinted.update();
				meshInstance.material = tinted;
			}
		}
	}

	/**
	 * Assigns the clips a pedestrian can use. The two character packs name them differently
	 * (Man_Walk / CharacterArmature|Walk, HitRecieve, Punch_Right), so they're matched by pattern.
	 */
	private assignClips(model: Entity, animations: readonly Asset[] | undefined) {
		if (!animations?.length) return;
		model.addComponent("anim", { activate: true });
		const anim = model.anim;
		if (!anim) return;
		const find = (pattern: RegExp) => animations.find((clip) => pattern.test((clip.resource as AnimTrack | undefined)?.name ?? ""));
		// Match playback to ground speed so the feet don't skate. The clip is authored for a
		// roughly 1.5 u/s stroll, so anyone slower or faster plays proportionally.
		const roles: [string, RegExp, boolean, number][] = [
			["Walk", /walk$/i, true, this.speed / REFERENCE_WALK_SPEED],
			["Idle", /(^|[|_])idle$/i, true, 1],
			["Run", /(^|[|_])run$/i, true, 1],
			["Punch", /punch(_right)?$/i, true, 1.2],
			["Hit", /hitrecieve$|hitreact$|hit_?receive$/i, false, 1.3],
			["Death", /death$/i, false, 1],
		];
		for (const [state, pattern, loop, rate] of roles) {
			const clip = find(pattern);
			if (!clip) continue;
			anim.assignAnimation(state, clip.resource as AnimTrack, undefined, rate, loop);
			this.clips.add(state);
		}
		this.setClip("Walk");
	}
}

function nearestIndex(values: readonly number[], target: number): number {
	let best = 0;
	for (let i = 1; i < values.length; i++) {
		if (Math.abs(values[i] - target) < Math.abs(values[best] - target)) best = i;
	}
	return best;
}

function mulberry32(seed: number) {
	let state = seed | 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
