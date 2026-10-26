"""
Builds the vehicle sound set from studio source recordings:

    python scripts/fetch-sounds.py SOURCE_DIR
    python scripts/prepare-vehicle-sounds.py SOURCE_DIR

Every recording comes from the Sonniss GameAudioGDC bundles (royalty-free, commercial use, no
attribution, no redistribution as sound effects, no AI training: https://sonniss.com/gdc-bundle-license/).
docs/audio/vehicle-sound-manifest.md maps each vehicle class and event to the files written here,
with each source's library, publisher and bundle.

Writes public/audio/vehicles/*.ogg and src/engine/orion/audio/VehicleSoundManifest.ts:

- engine families, each with
  - an idle loop: a steady stretch of the engine idling, cut so its end crossfades into its
    start, with its firing frequency measured;
  - either rev ramps (a recorded rev-up, and an overrun where there is one) with their firing
    frequency tracked along them, for the granular player, or RPM layers (steady-RPM loops at a
    few engine speeds) to crossfade between;
  - start and stop one-shots where the recording has them, levelled to match the idle loop;
- tyres rolling on dry asphalt (a loop), air-brake releases and gear-lever movements (one-shots).

Needs ffmpeg (with libvorbis), numpy and scipy; reuses prepare-sounds.py's tools.
"""
import importlib.util
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("prepare_sounds", os.path.join(ROOT, "scripts", "prepare-sounds.py"))
ps = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ps)

SR = ps.SR
OUT = os.path.join(ROOT, "public", "audio", "vehicles")
MANIFEST = os.path.join(ROOT, "src", "engine", "orion", "audio", "VehicleSoundManifest.ts")

# Levels (RMS dB) the parts are written at. The ramps and layers are the engine under load, the
# idle a few dB under them, as a real engine is.
RAMP_DB = -18
LAYER_DB = -19
IDLE_DB = -23
# Seconds the start and stop one-shots overlap the live engine (see EngineAudio): the start's
# tail fades out while the idle fades in, and the stop's head fades in while the idle fades out.
OVERLAP = 0.6
STOP_FADE_IN = 0.25
# Every engine take is softened on the way in: the recordings are close-miked on the block and
# exhaust, and their top end (valve tick, injector and diesel clatter, mic hiss) is what makes a
# looped engine grate. A game mix keeps the body and the note and rolls that off: a high shelf
# -6 dB from 2.2 kHz, and a little more above 6 kHz.
ENGINE_SOFTEN = "treble=g=-6:f=2200:t=s:w=0.7,treble=g=-4:f=6000:t=s:w=0.7"

# ---- Recipes ------------------------------------------------------------------------------------

# Engine families. Times are seconds into the source; `f` is a starting guess at the firing
# frequency (Hz) for the tracker. Each ramp's sections are used in order, each only for the
# pitches above what the sections before it covered, so the read position never flips between
# takes at neighbouring revs.
ENGINES = {
    # Everyday petrol: Audi Q2 (a compact crossover), revs and its own start, idle and shutoff.
    "car": {
        "ramps": [("eng_q2_revs", [(0.3, 7.2, 43)], True), ("eng_q2_revs", [(7.0, 20.5, 200)], False)],
        "idle": ("eng_q2_idle", 4.0, 9.0, 39),
        "start": ("eng_q2_idle", 0.2, 3.6),
        "stop": ("eng_q2_idle", 25.4, 28.2),
    },
    # (The sports cars had a Porsche Carrera GT race-engine family; its idle lumped and rasped,
    # and they now play the V8 below, pitched up. Removed 2026-10-26.)
    # A big American V8 sedan (Ford Crown Victoria, the classic police and livery car): recorded
    # at steady engine speeds, so it's played as RPM layers rather than a ramp. Its pitches are
    # all the eighth crank order (twice the firing frequency): the strongest line in every take.
    "v8": {
        "layers": [
            ("eng_crownvic_steady", 143.5, 151.5, 102),
            ("eng_crownvic_steady", 27.0, 38.0, 137),
            ("eng_crownvic_steady", 84.0, 99.0, 178),
            ("eng_crownvic_steady", 102.5, 109.5, 228),
            ("eng_crownvic_steady", 185.0, 194.0, 314),
        ],
        # The idle is the steady low-speed take, not the "idle, stall various" one: that engine
        # was hunting near a stall, and even smoothed it lumped. Played a little slower at idle.
        "idle": ("eng_crownvic_steady", 143.5, 151.5, 102),
        "start": ("eng_crownvic_idle", 5.3, 9.0, (9.0, 21.0)),
        "stop": ("eng_crownvic_idle", 22.7, 25.2, (9.0, 21.0)),
    },
    # Light commercial diesel: Renault Master 2.3 dCi van, recorded revving up and down from idle.
    # The recording has no start or shutoff.
    "van": {
        "ramps": [("eng_master_ramps", [(19.5, 33.6, 34)], True), ("eng_master_ramps", [(33.6, 41.0, 112)], False)],
        "idle": ("eng_master_ramps", 0.3, 5.0, 27),
    },
    # Heavy diesel: Mercedes-Benz Unimog, with its own start, idle and shutoff.
    "truck": {
        "ramps": [("eng_unimog", [(14.0, 27.0, 36)], True), ("eng_unimog", [(27.2, 37.0, 150)], False)],
        "idle": ("eng_unimog", 2.5, 12.5, 29),
        "start": ("eng_unimog", 0.0, 2.2),
        "stop": ("eng_unimog", 60.6, 64.6),
    },
    # Three-wheeler: Piaggio Ape single-cylinder two-stroke, its own start and stop.
    "ape": {
        "ramps": [("eng_ape_drive", [(102.4, 134.5, 58)], True), ("eng_ape_drive", [(134.5, 143.0, 96)], False)],
        "idle": ("eng_ape_drive", 172.0, 178.0, 31),
        "start": ("eng_ape_drive", 4.1, 5.4),
        "stop": ("eng_ape_drive", 178.4, 179.8),
    },
}

# Tyres rolling on dry asphalt, from tyre-only microphones (no engine): the steadiest stretch.
TYRE_ROLL = ("tyre_ibiza", 64.0, 70.0)
# Air brakes and gear levers: separate events in each recording, the best few kept.
AIR_BRAKE = ("air_ural", 3)
GEAR_LEVER = ("gear_quattro", 4)


# ---- Building -----------------------------------------------------------------------------------

def source(src_dir, name):
    path = os.path.join(src_dir, name + ".wav")
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    return path


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x.astype(np.float64) ** 2)) + 1e-12)


def firing(x, f_guess):
    """
    The firing frequency of a steady stretch: the strongest line within 15% of the guess in its
    averaged spectrum. (Tracking frame by frame, as for a ramp, can wander onto a neighbouring
    order when nothing is changing to hold it.)
    """
    win = 1 << 16
    acc = np.zeros(win // 2 + 1)
    for start in range(0, max(1, len(x) - win), win // 4):
        piece = x[start:start + win]
        acc += np.abs(np.fft.rfft(piece * np.hanning(len(piece)), n=win))
    freqs = np.fft.rfftfreq(win, 1 / SR)
    band = np.where((freqs > f_guess * 0.85) & (freqs < f_guess * 1.15))[0]
    return round(float(freqs[band[np.argmax(acc[band])]]), 2)


def steady_loop(path, start, end, f_guess, db, crossfade=0.35):
    """
    A steady stretch as a seamless loop at `db` RMS, its firing frequency, and the gain used.

    Evened out over a tenth of a second: a held note in a game has to be steady. The V8's idle
    take hunted 6 dB up and down every few tenths (the engine was close to stalling), and looped
    under a parked player that lumpiness was the most irritating thing in the mix.
    """
    x = ps.read(path, 1, start, end, ENGINE_SOFTEN)
    hz = firing(x, f_guess)
    x = ps.even_out(ps.highpass(x, 22), window=0.12, strength=0.85)
    looped = ps.loop(x, crossfade)
    gain = 10 ** (db / 20) / max(np.sqrt(np.mean(looped.astype(np.float64) ** 2)), 1e-9)
    return np.clip(looped * gain, -1, 1), hz


def ramp(path, sections, loudest):
    """Like prepare-sounds' ramp, but each section only adds pitches above those before it."""
    audio, pitch_map, time_map = [], [], []
    offset = 0.0
    covered = 0.0
    for start, end, f_start in sections:
        x = ps.read(path, 1, start, end, ENGINE_SOFTEN)
        times, pitch, levels = ps.track(x, f_start)
        edges = np.exp(np.arange(np.log(pitch.min()), np.log(pitch.max()) + 0.012, 0.012))
        top = covered
        for lo, hi in zip(edges[:-1], edges[1:]):
            if hi <= covered:
                continue
            idx = np.where((pitch >= lo) & (pitch < hi) & (times > 0.15) & (times < times[-1] - 0.15))[0]
            if len(idx) == 0:
                continue
            pick = idx[np.argmax(levels[idx])] if loudest else idx[len(idx) // 2]
            if pitch[pick] <= covered:
                continue
            pitch_map.append(round(float(pitch[pick]), 2))
            time_map.append(round(float(times[pick]) + offset, 4))
            top = max(top, float(pitch[pick]))
        covered = top
        audio.append(x)
        offset += len(x) / SR
    order = np.argsort(pitch_map)
    return np.concatenate(audio), [pitch_map[i] for i in order], [time_map[i] for i in order]


def one_shot(path, start, end, gain, fade_in=0.004, fade_out=OVERLAP):
    x = ps.highpass(ps.read(path, 1, start, end, ENGINE_SOFTEN), 22) * gain
    n = len(x)
    a = min(n, int(fade_in * SR))
    b = min(n, int(fade_out * SR))
    if a > 0:
        x[:a] *= np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    if b > 0:
        x[n - b:] *= np.cos(np.linspace(0, np.pi / 2, b)) ** 2
    return np.clip(x, -1, 1)


def write(name, x, quality=5):
    return "vehicles/" + os.path.basename(ps.write(os.path.join("vehicles", name), x, quality))


def engines(src_dir):
    files, families = {}, {}
    for family, recipe in ENGINES.items():
        entry = {"idle": None, "ramps": [], "layers": [], "start": None, "stop": None}
        name, start, end, f_guess = recipe["idle"]
        idle_path = source(src_dir, name)
        idle, idle_hz = steady_loop(idle_path, start, end, f_guess, IDLE_DB)
        files[f"idle-{family}"] = [write(f"idle-{family}.ogg", idle)]
        entry["idle"] = {"sound": f"idle-{family}", "hz": idle_hz}
        print(f"{family}: idle {len(idle) / SR:.1f} s at {idle_hz} Hz")

        for index, (name, sections, loudest) in enumerate(recipe.get("ramps", [])):
            x, pitch, time = ramp(source(src_dir, name), sections, loudest)
            x = ps.normalise_rms(ps.highpass(x, 25), RAMP_DB)
            sound = f"engine-{family}-{index + 1}"
            files[sound] = [write(sound + ".ogg", np.clip(x, -1, 1))]
            entry["ramps"].append({"sound": sound, "pitch": pitch, "time": time})
            print(f"{family}: ramp {index + 1} {len(x) / SR:.1f} s, {min(pitch):.0f}-{max(pitch):.0f} Hz, {len(pitch)} points")

        for index, (name, start, end, f_guess) in enumerate(recipe.get("layers", [])):
            x, hz = steady_loop(source(src_dir, name), start, end, f_guess, LAYER_DB)
            sound = f"engine-{family}-layer-{index + 1}"
            files[sound] = [write(sound + ".ogg", x)]
            entry["layers"].append({"sound": sound, "hz": hz})
            print(f"{family}: layer {index + 1} {len(x) / SR:.1f} s at {hz} Hz")
        entry["layers"].sort(key=lambda layer: layer["hz"])

        for event in ("start", "stop"):
            spec = recipe.get(event)
            if not spec:
                continue
            name, start, end = spec[:3]
            path = source(src_dir, name)
            # Levelled so the idle in it matches the idle loop: the idle of the same take, raw,
            # brought to the loop's level.
            reference = spec[3] if len(spec) > 3 else (recipe["idle"][1], recipe["idle"][2]) if name == recipe["idle"][0] else None
            if reference is None:
                raise ValueError(f"{family} {event}: needs a reference idle in {name}")
            raw_idle = ps.highpass(ps.read(path, 1, reference[0], reference[1], ENGINE_SOFTEN), 22)
            gain = 10 ** ((IDLE_DB - rms_db(raw_idle)) / 20)
            if event == "start":
                x = one_shot(path, start, end, gain)
            else:
                x = one_shot(path, start, end, gain, fade_in=STOP_FADE_IN, fade_out=0.08)
            sound = f"{event}-{family}"
            files[sound] = [write(sound + ".ogg", x, 4)]
            entry[event] = {"sound": sound, "seconds": round(len(x) / SR, 3)}
            print(f"{family}: {event} {len(x) / SR:.2f} s")
        families[family] = entry
    return files, families


def events_of(path, count, max_len, centroid_from=0.0, on_db=-24, off_db=-46):
    """The `count` loudest separate events in a recording (optionally only bright ones: hiss)."""
    x = ps.read(path)
    found = ps.events(x, on_db=on_db, off_db=off_db, gap=0.15, max_len=max_len)
    keep = []
    for a, b in found:
        piece = x[a:b]
        if len(piece) < SR * 0.03:
            continue
        spectrum = np.abs(np.fft.rfft(piece * np.hanning(len(piece))))
        freqs = np.fft.rfftfreq(len(piece), 1 / SR)
        centroid = float((spectrum * freqs).sum() / (spectrum.sum() + 1e-9))
        if centroid >= centroid_from:
            keep.append((np.abs(piece).max(), a, b, centroid))
    keep = sorted(sorted(keep, reverse=True)[:count], key=lambda k: k[1])
    return x, keep


def extras(src_dir):
    files = {}
    name, start, end = TYRE_ROLL
    x = ps.read(source(src_dir, name), 1, start, end)
    x = ps.even_out(ps.highpass(x, 40), window=0.3, strength=0.7)
    x = ps.normalise_rms(ps.loop(x, 0.5), -20)
    files["tyre-roll"] = [write("tyre-roll.ogg", np.clip(x, -1, 1), 4)]
    print(f"tyre-roll: loop {len(x) / SR:.1f} s")

    # The gear lever is quiet against its room tone: a lower threshold finds its movements.
    for sound, (name, count), max_len, bright, on_db, off_db in (
        ("air-brake", AIR_BRAKE, 1.6, 1800.0, -24, -46),
        ("gear-lever", GEAR_LEVER, 0.6, 0.0, -30, -52),
    ):
        x, keep = events_of(source(src_dir, name), count, max_len, bright, on_db, off_db)
        takes = [ps.shape(ps.highpass(x[a:b + int(0.1 * SR)], 60), max_len, max_len * 0.4) for _, a, b, _ in keep]
        takes = ps.normalise_peak(takes)
        files[sound] = [write(f"{sound}-{k + 1}.ogg", t, 4) for k, t in enumerate(takes)]
        print(f"{sound}: {len(takes)} takes, centroids {[round(c) for *_, c in keep]}")
    return files


def main():
    src_dir = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    for stale in os.listdir(OUT):
        if stale.endswith(".ogg"):
            os.remove(os.path.join(OUT, stale))
    files, families = engines(src_dir)
    files.update(extras(src_dir))
    lines = [
        "// Generated by scripts/prepare-vehicle-sounds.py — don't edit by hand.",
        "",
        "/** Recorded vehicle sounds, by id: the files (under /audio/) holding its takes. */",
        "export const VEHICLE_SOUND_FILES: Readonly<Record<string, readonly string[]>> = " + json.dumps(files, indent="\t") + ";",
        "",
        "/** One recorded engine ramp: its sound, and its firing frequency (Hz) at times (s) along it. */",
        "export interface EngineRampMap {",
        "\tsound: string;",
        "\tpitch: readonly number[];",
        "\ttime: readonly number[];",
        "}",
        "",
        "/** A steady loop of an engine at one speed: its sound and firing frequency (Hz). */",
        "export interface EngineLoopMap {",
        "\tsound: string;",
        "\thz: number;",
        "}",
        "",
        "/** A start or stop: its sound and length (s). */",
        "export interface EngineEventMap {",
        "\tsound: string;",
        "\tseconds: number;",
        "}",
        "",
        "/**",
        " * A recorded engine: its idle loop, then either rev ramps (on the throttle first, then the",
        " * overrun) or RPM layers (lowest first), and its start and stop where recorded.",
        " */",
        "export interface EngineFamilyMap {",
        "\tidle: EngineLoopMap | null;",
        "\tramps: readonly EngineRampMap[];",
        "\tlayers: readonly EngineLoopMap[];",
        "\tstart: EngineEventMap | null;",
        "\tstop: EngineEventMap | null;",
        "}",
        "",
        "export const ENGINE_FAMILIES: Readonly<Record<string, EngineFamilyMap>> = " + json.dumps(families, separators=(", ", ": ")) + ";",
        "",
    ]
    open(MANIFEST, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f"wrote {MANIFEST} and {len(os.listdir(OUT))} files, {total / 1048576:.2f} MB")


if __name__ == "__main__":
    main()
