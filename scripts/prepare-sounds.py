"""
Builds the game's recorded sound set from studio source recordings:

    python scripts/prepare-sounds.py SOURCE_DIR

SOURCE_DIR holds the original WAVs (scripts/fetch-sounds.py fetches them), from the Sonniss
GameAudioGDC bundles (2015 and 2024; royalty-free, commercial use, no attribution needed,
https://sonniss.com/gdc-bundle-license/ — see CREDITS.md for each file's library and
publisher). They are not kept in the repository: the licence allows them inside the game, not
redistributed as a sound library.

Writes public/audio/*.ogg and src/engine/orion/audio/SoundManifest.ts. For each sound:

- one-shots: the separate events in a recording (each shot, hit or horn blast) are found from
  its level, the best few kept as takes, trimmed, faded out, and levelled together (one gain for
  the group, so a quieter take stays quieter);
- loops (sirens, ambience, the rotor): a stretch cut so its end crossfades into its start;
- engine ramps: a recorded rev-up (or overrun), with its firing frequency tracked along one
  harmonic line, for the granular engine (EngineGrainWorklet). The ramp's pitch map goes into
  the manifest.

Needs ffmpeg (with libvorbis), numpy and scipy.
"""
import json
import os
import subprocess
import sys

import numpy as np
from scipy.signal import lfilter

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "audio")
MANIFEST = os.path.join(ROOT, "src", "engine", "orion", "audio", "SoundManifest.ts")


def read(src, channels=1, start=None, end=None, filters=None):
    args = ["ffmpeg", "-v", "quiet"]
    if start is not None:
        args += ["-ss", str(start)]
    if end is not None:
        args += ["-to", str(end)]
    args += ["-i", src] + (["-af", filters] if filters else []) + ["-ac", str(channels), "-ar", str(SR), "-f", "f32le", "-"]
    x = np.frombuffer(subprocess.run(args, capture_output=True, check=True).stdout, dtype=np.float32).copy()
    return x.reshape(-1, channels) if channels > 1 else x


def write(name, x, quality=4):
    channels = x.shape[1] if x.ndim > 1 else 1
    path = os.path.join(OUT, name)
    subprocess.run(
        ["ffmpeg", "-v", "quiet", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(channels), "-i", "-", "-c:a", "libvorbis", "-q:a", str(quality), path],
        input=np.ascontiguousarray(x, dtype=np.float32).tobytes(), check=True,
    )
    return name


def events(x, on_db=-26, off_db=-55, gap=0.3, max_len=4.0):
    """(start, end) sample ranges of the separate events in a mono signal."""
    hop = 480
    rms = np.sqrt(np.convolve(x.astype(np.float64) ** 2, np.ones(hop) / hop, mode="valid")[::hop]) + 1e-9
    db = 20 * np.log10(rms)
    db -= db.max()
    found = []
    quiet = gap
    i = 0
    while i < len(db):
        if db[i] > on_db and quiet >= gap:
            start = i
            while start > 0 and db[start - 1] > off_db + 10 and i - start < 30:
                start -= 1
            j = i
            below = 0
            while j < len(db) and (j - start) * hop / SR < max_len:
                below = below + 1 if db[j] < off_db else 0
                if below * hop / SR > 0.15:
                    break
                j += 1
            found.append((start * hop, min(len(x), j * hop)))
            i = j
            quiet = 0
        else:
            quiet = quiet + hop / SR if db[i] < off_db + 15 else 0
            i += 1
    return found


def shape(x, max_len, fade, pre=0.004):
    """Trim to the first sound, cap the length, fade the tail out; a tiny fade in kills clicks."""
    level = np.abs(x)
    first = np.argmax(level > level.max() * 0.02)
    x = x[max(0, first - int(pre * SR)):]
    x = x[: int(max_len * SR)].copy()
    n = len(x)
    f = min(n, int(fade * SR))
    if f > 0:
        x[n - f:] *= np.cos(np.linspace(0, np.pi / 2, f)) ** 2
    x[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    return x


def loop(x, crossfade):
    """A stretch whose end crossfades into its start (equal power), so it repeats seamlessly."""
    c = int(crossfade * SR)
    head, body, tail = x[:c], x[c:-c] if c else x, x[-c:]
    t = np.linspace(0, np.pi / 2, c)
    if x.ndim > 1:
        t = t[:, None]
    blend = head * np.sin(t) + tail * np.cos(t)
    return np.concatenate([blend, body]) if c else x


def track(x, f_start):
    """Firing-frequency track of one harmonic line: (times, pitch, level) per frame."""
    win, hop, pad = 8192, 1024, 4
    freqs = np.fft.rfftfreq(win * pad, 1 / SR)
    f = f_start
    rows = []
    for start in range(0, len(x) - win, hop):
        seg = x[start:start + win] * np.hanning(win)
        spec = np.abs(np.fft.rfft(seg, n=win * pad))
        band = np.where((freqs > f * 0.88) & (freqs < f * 1.12))[0]
        k = band[np.argmax(spec[band])]
        a, b, c = (np.log(spec[k + d] + 1e-12) for d in (-1, 0, 1))
        shift = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0
        f = (k + shift) * SR / (win * pad)
        rows.append(((start + win / 2) / SR, f, float(np.sqrt(np.mean(x[start:start + win] ** 2)))))
    rows = np.array(rows)
    pitch = np.convolve(rows[:, 1], np.ones(5) / 5, mode="same")
    pitch[:2], pitch[-2:] = rows[:2, 1], rows[-2:, 1]
    return rows[:, 0], pitch, rows[:, 2]


def ramp(src, sections, loudest=True):
    """Audio and pitch map for an engine ramp built from (start, end, f_start) sections."""
    audio, pitch_map, time_map = [], [], []
    offset = 0.0
    for start, end, f_start in sections:
        x = read(src, 1, start, end)
        times, pitch, levels = track(x, f_start)
        edges = np.exp(np.arange(np.log(pitch.min()), np.log(pitch.max()) + 0.012, 0.012))
        for lo, hi in zip(edges[:-1], edges[1:]):
            idx = np.where((pitch >= lo) & (pitch < hi) & (times > 0.15) & (times < times[-1] - 0.15))[0]
            if len(idx) == 0:
                continue
            pick = idx[np.argmax(levels[idx])] if loudest else idx[len(idx) // 2]
            pitch_map.append(round(float(pitch[pick]), 2))
            time_map.append(round(float(times[pick]) + offset, 4))
        audio.append(x)
        offset += len(x) / SR
    order = np.argsort(pitch_map)
    return np.concatenate(audio), [pitch_map[i] for i in order], [time_map[i] for i in order]


def normalise_peak(takes, db=-1.0):
    peak = max(np.abs(t).max() for t in takes)
    gain = 10 ** (db / 20) / max(peak, 1e-9)
    return [t * gain for t in takes]


def normalise_rms(x, db):
    rms = np.sqrt(np.mean(x.astype(np.float64) ** 2))
    return x * (10 ** (db / 20) / max(rms, 1e-9))


def highpass(x, hz):
    """A gentle first-order high-pass, to take rumble and handling noise out of one-shots."""
    if not hz:
        return x
    a = np.exp(-2 * np.pi * hz / SR)
    return lfilter([a, -a], [1, -a], x).astype(np.float32)


# ---- Recipes ------------------------------------------------------------------------------------

# One-shots: sound id → takes, each (source, how to find events, how many, max length, fade).
# "events" uses the level detector with the given thresholds; "whole" takes the recording from
# its first sound; "at" takes a stretch from a given second.
ONE_SHOTS = {
    "pistol-close": [("pistol_close", ("events", {}), 4, 1.4, 0.7), ("pistol_50cal", ("events", {}), 1, 0.6, 0.3), ("pistol_og", ("whole",), 1, 1.2, 0.6)],
    "pistol-far": [("pistol_far", ("events", {}), 4, 2.6, 1.4)],
    # The AK bursts: the last round of each, the only one with its own tail.
    "rifle-close": [("ak_close", ("at", 0.172), 1, 0.6, 0.35), ("rifle_m4", ("events", {"on_db": -14, "off_db": -34, "gap": 0.06, "max_len": 0.55}), 6, 0.55, 0.25)],
    "rifle-far": [("ak_far", ("at", 0.172), 1, 2.4, 1.2)],
    "gun-distant": [("ak_distant", ("at", 0.48), 1, 3.0, 1.6), ("ak_distant", ("at", 6.175), 1, 3.0, 1.6), ("mosin_distant", ("whole",), 1, 2.6, 1.4)],
    "whizz": [("whizz_pmsfx", ("events", {"on_db": -16, "off_db": -30, "gap": 0.04, "max_len": 0.6}), 8, 0.6, 0.2)],
    "crack": [("whip_og", ("whole",), 1, 0.45, 0.2)],
    # One impact each. Cut before the debris lands: several of these recordings have a second
    # hit 0.2-0.3 s in (hit_brick_16's is louder than its first, so it's gone), and a crack that
    # late after the shot is heard as another shot, not as the bullet landing.
    "hit-wall": [("hit_stone_53", ("whole",), 1, 0.24, 0.12), ("hit_stone_92", ("whole",), 1, 0.22, 0.12), ("hit_tile", ("whole",), 1, 0.3, 0.15), ("hit_rock_og", ("whole",), 1, 0.3, 0.15), ("hit_light_og", ("whole",), 1, 0.4, 0.2)],
    "hit-ground": [("hit_dirt", ("whole",), 1, 0.3, 0.15), ("hit_light_og", ("whole",), 1, 0.4, 0.2), ("hit_stone_92", ("whole",), 1, 0.22, 0.12)],
    "hit-glass": [("hit_glass", ("whole",), 1, 1.0, 0.5), ("glass_bz_3", ("whole",), 1, 0.9, 0.45)],
    "hit-flesh": [("hit_flesh", ("whole",), 1, 0.6, 0.3)],
    "casing": [("casings_concrete", ("events", {}), 6, 1.4, 0.6), ("cartridge_bz", ("whole",), 1, 0.6, 0.3)],
    "shotgun-close": [("shotgun_saiga", ("events", {}), 4, 1.1, 0.5)],
    "shotgun-far": [("shotgun_spas", ("events", {}), 4, 2.0, 1.0)],
    "shotgun-pump": [("shotgun_pump", ("events", {"on_db": -20, "off_db": -42, "gap": 0.12, "max_len": 0.6}), 2, 0.6, 0.15)],
    "rocket": [("rocket_rpg", ("at", 0.28), 1, 1.1, 0.5)],
    "explosion": [("explode_medium", ("whole",), 1, 2.4, 1.2), ("explode_mortar", ("at", 2.55), 1, 2.6, 1.3), ("explode_car", ("whole",), 1, 3.6, 1.6), ("explode_urban", ("whole",), 1, 3.0, 1.5), ("explode_mortar_bz", ("whole",), 1, 2.6, 1.3)],
    "explosion-far": [("explode_distant", ("events", {}), 1, 4.0, 2.2)],
    "crash-heavy": [("crash_smash", ("events", {}), 2, 1.6, 0.7), ("crash_drop", ("events", {}), 3, 1.5, 0.7)],
    "crash-light": [("crash_impacts", ("whole",), 1, 1.6, 0.8), ("impact_barrel", ("events", {}), 3, 0.6, 0.3)],
    "glass": [("glass_bz_1", ("whole",), 1, 1.6, 0.7), ("glass_bz_2", ("whole",), 1, 2.0, 0.9), ("glass_shatter", ("whole",), 1, 2.4, 1.0), ("glass_break", ("whole",), 1, 1.2, 0.5), ("glass_jol_1", ("whole",), 1, 2.0, 0.9), ("glass_jol_2", ("whole",), 1, 2.0, 0.9), ("glass_windshield", ("whole",), 1, 2.0, 0.9)],
    "impact": [("impact_barrel", ("events", {}), 4, 0.4, 0.25), ("impact_iron", ("events", {}), 3, 0.4, 0.25)],
    "punch": [("hit_hk_1", ("whole",), 1, 0.4, 0.15), ("hit_hk_2", ("whole",), 1, 0.4, 0.15), ("hit_hk_3", ("whole",), 1, 0.4, 0.15)],
    "whoosh": [("whoosh_hk_1", ("whole",), 1, 0.4, 0.15), ("whoosh_hk_2", ("whole",), 1, 0.4, 0.15), ("swish_action", ("whole",), 1, 0.6, 0.3)],
    "reload": [("reload_mag", ("events", {"on_db": -20, "off_db": -42, "gap": 0.12, "max_len": 1.0}), 3, 1.0, 0.25), ("reload_charge", ("events", {"on_db": -20, "off_db": -42, "gap": 0.12, "max_len": 1.0}), 2, 1.0, 0.25)],
    "equip": [("equip_hammer", ("events", {"on_db": -20, "off_db": -42, "gap": 0.12, "max_len": 0.6}), 4, 0.6, 0.2)],
    "empty": [("equip_hammer", ("events", {"on_db": -20, "off_db": -42, "gap": 0.12, "max_len": 0.6}), 2, 0.14, 0.06)],
    "horn-car": [("horn_q7", ("events", {}), 2, 1.6, 0.25), ("horn_r4", ("events", {}), 2, 1.6, 0.25)],
    "horn-heavy": [("horn_coach", ("events", {}), 2, 2.2, 0.35)],
    "door": [("door_corvette", ("events", {"on_db": -24, "off_db": -50, "gap": 0.2, "max_len": 1.2}), 2, 1.2, 0.4)],
}

# Steady tones in a recording that would drone on a loop: an idling engine and its harmonics
# under the street recording.
HUM = {
    # The skid loop: the tyres alone, the engine under them filtered off (it plays separately).
    "skid": "highpass=f=380,highpass=f=380",
    "amb-street": "bandreject=f=58:width_type=h:w=6,bandreject=f=104:width_type=h:w=7,bandreject=f=109.5:width_type=h:w=7,bandreject=f=208:width_type=h:w=10,bandreject=f=310:width_type=h:w=10,bandreject=f=420:width_type=h:w=10",
}

# Loops: id → (source, start, end, crossfade seconds, channels, quality, rms dB).
LOOPS = {
    "siren-wail": ("siren_doppler", None, None, 0.05, 1, 4, -16),
    "siren-hilo": ("siren_10", None, None, 0.25, 1, 4, -16),
    "amb-street": ("amb_street", 5, 55, 2.5, 2, 2, -24),
    "amb-waves": ("amb_waves", None, None, 2.0, 2, 2, -24),
    "rotor": ("heli_flyby", None, None, 0.08, 1, 4, -18),
    # A long, steady squeal (about 680 Hz): the old cut was 0.8 s of the car juddering to a stop,
    # its level swinging 15 dB every tenth of a second, and looped it was a rattle.
    "skid": ("skid_bmw", 96.62, 98.32, 0.4, 1, 4, -16),
}

# Engine families: ramps of (sections, loudest-per-pitch?), on-throttle first.
ENGINES = {
    "car": ("eng_q2_revs", [([(0.3, 7.2, 43)], True), ([(7.0, 20.5, 200)], False)]),
    "sport": ("eng_porsche_fast", [([(18.9, 26.8, 58), (29.15, 31.15, 400)], True)]),
    "diesel": ("eng_tractor_steady", [([(3, 67, 40)], False)]),
    "truck": ("eng_unimog", [([(14.0, 27.0, 36)], True), ([(27.2, 37.0, 150)], False)]),
}


def one_shots(src_dir):
    files = {}
    for sound, takes_spec in ONE_SHOTS.items():
        takes = []
        for source, how, count, max_len, fade in takes_spec:
            path = os.path.join(src_dir, source + ".wav")
            if not os.path.exists(path):
                print(f"  (missing {source}, skipped)")
                continue
            x = read(path)
            if how[0] == "events":
                found = events(x, **how[1])
                # The loudest `count`, then back in recorded order.
                found = sorted(sorted(found, key=lambda r: -np.abs(x[r[0]:r[1]]).max())[:count])
                pieces = [x[a:b + int(fade * SR)] for a, b in found]
            elif how[0] == "at":
                pieces = [x[int(how[1] * SR):]]
            else:
                pieces = [x]
            takes += [shape(highpass(p, 35), max_len, fade) for p in pieces]
        if not takes:
            continue
        takes = normalise_peak(takes)
        files[sound] = [write(f"{sound}-{k + 1}.ogg", t, 4) for k, t in enumerate(takes)]
        print(f"{sound}: {len(takes)} takes")
    return files


def loops(src_dir):
    files = {}
    for sound, (source, start, end, crossfade, channels, quality, rms) in LOOPS.items():
        path = os.path.join(src_dir, source + ".wav")
        if not os.path.exists(path):
            print(f"  (missing {source}, skipped)")
            continue
        x = read(path, channels, start, end, HUM.get(sound))
        if sound == "rotor":
            x = rotor_stretch(x)
        elif sound == "siren-wail":
            x = wail_cycles(x)
        elif sound == "skid":
            x = even_out(x)
        elif not sound.startswith("amb-"):
            x = trim_silence(x)
        x = normalise_rms(loop(x, crossfade), rms)
        files[sound] = [write(f"{sound}.ogg", np.clip(x, -1, 1), quality)]
        print(f"{sound}: loop {len(x) / SR:.1f} s")
    return files


def even_out(x, window=0.12, strength=0.8):
    """Takes most of the slow level wander out of a sustained sound, keeping its texture."""
    mono = x if x.ndim == 1 else x.mean(axis=1)
    n = max(1, int(window * SR))
    power = np.convolve(mono ** 2, np.ones(n) / n, mode="same")
    envelope = np.sqrt(np.maximum(power, 1e-10))
    gain = (np.median(envelope) / envelope) ** strength
    return x * (gain if x.ndim == 1 else gain[:, None])


def trim_silence(x):
    level = np.abs(x if x.ndim == 1 else x.mean(axis=1))
    loud = np.where(level > level.max() * 0.05)[0]
    return x[loud[0]:loud[-1]] if len(loud) else x


def wail_cycles(x):
    """Two whole sweeps of a wail siren, cut at the low point of each, from its loudest pass."""
    win, hop = 2048, 512
    freqs = np.fft.rfftfreq(win, 1 / SR)
    band = (freqs > 450) & (freqs < 2000)
    rows = []
    for start in range(0, len(x) - win, hop):
        spec = np.abs(np.fft.rfft(x[start:start + win] * np.hanning(win)))
        rows.append((start, freqs[band][np.argmax(spec[band])], np.sqrt(np.mean(x[start:start + win] ** 2))))
    rows = np.array(rows)
    pitch = np.convolve(rows[:, 1], np.ones(9) / 9, mode="same")
    level = rows[:, 2]
    # Low points of the sweep: local minima of the smoothed pitch, while the siren is loud.
    # (The tracker catches a harmonic now and then near the top of a sweep: a true low is low.)
    lows = [i for i in range(10, len(pitch) - 10) if pitch[i] == pitch[i - 10:i + 11].min() and level[i] > level.max() * 0.04 and pitch[i] < 900]
    best = None
    for a, b in zip(lows, lows[1:]):
        span = (rows[b, 0] - rows[a, 0]) / SR
        if 3 < span < 8 and abs(pitch[a] - pitch[b]) / pitch[a] < 0.04:
            score = level[a:b].mean()
            if best is None or score > best[0]:
                best = (score, int(rows[a, 0]), int(rows[b, 0]))
    if best is None:
        return trim_silence(x)
    cut = x[best[1]:best[2] + int(0.05 * SR)].astype(np.float64)
    # It was recorded driving past: flatten its swell, so the loop holds one level.
    env = np.sqrt(np.convolve(cut ** 2, np.ones(SR // 2) / (SR // 2), mode="same")) + 1e-6
    return (cut / env * env.mean()).astype(np.float32)


def rotor_stretch(x):
    """The steadiest 2.5 s of a helicopter fly-by: loud, before the pass shifts its pitch."""
    hop = SR // 10
    level = np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) for i in range(0, len(x) - hop, hop)])
    peak = int(np.argmax(level))
    # Ending a little before the loudest point, where it's near and still approaching.
    end = max(30, peak - 5) * hop
    return x[end - int(2.6 * SR):end]


def engines(src_dir):
    files, maps = {}, {}
    for family, (source, ramps) in ENGINES.items():
        path = os.path.join(src_dir, source + ".wav")
        if not os.path.exists(path):
            print(f"  (missing {source}, skipped)")
            continue
        maps[family] = []
        for index, (sections, loudest) in enumerate(ramps):
            x, pitch, time = ramp(path, sections, loudest)
            x = normalise_rms(highpass(x, 25), -18)
            name = write(f"engine-{family}-{index + 1}.ogg", np.clip(x, -1, 1), 5)
            files[f"engine-{family}-{index + 1}"] = [name]
            maps[family].append({"sound": f"engine-{family}-{index + 1}", "pitch": pitch, "time": time})
            print(f"engine {family} ramp {index + 1}: {len(x) / SR:.1f} s, {min(pitch):.0f}-{max(pitch):.0f} Hz")
    return files, maps


def main():
    src_dir = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    files = {}
    files.update(one_shots(src_dir))
    files.update(loops(src_dir))
    engine_files, maps = engines(src_dir)
    files.update(engine_files)
    lines = [
        "// Generated by scripts/prepare-sounds.py — don't edit by hand.",
        "",
        "/** Recorded sounds, by id: the files (under /audio/) holding its takes. */",
        "export const SOUND_FILES: Readonly<Record<string, readonly string[]>> = " + json.dumps(files, indent="\t").replace('"', '"') + ";",
        "",
        "/** One recorded engine ramp: its sound, and its firing frequency (Hz) at times (s) along it. */",
        "export interface EngineRampMap {",
        "\tsound: string;",
        "\tpitch: readonly number[];",
        "\ttime: readonly number[];",
        "}",
        "",
        "/** Engine families: ramps on the throttle first, then (where there is one) the overrun. */",
        "export const ENGINE_RAMPS: Readonly<Record<string, readonly EngineRampMap[]>> = " + json.dumps(maps, separators=(", ", ": ")) + ";",
        "",
    ]
    open(MANIFEST, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith(".ogg"))
    print(f"wrote {MANIFEST} and {len(os.listdir(OUT))} files, {total / 1048576:.1f} MB")


main()
