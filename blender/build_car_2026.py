"""Builds the visual meshes of an Orion car in Blender from a design preset.

Presets: "sedan" (the fastback saloon, same as build_sedan_2026.py), "saloon" (a long-wheelbase
executive saloon) and "suv" (a full-size luxury SUV). Run inside Blender with the car's template
.glb imported (sedan/saloon: orion-sedan.glb, suv: orion-suv.glb). Every existing object keeps its
name, parent and pivot; only its mesh data is replaced (a preset's PIVOTS may move wheel and door
pivots first, for a different wheelbase). Set PRESET before exec'ing this file. Coordinates: +x = car's left, -y = front,
+z = up, metres.

    exec(open(r"C:\\oriongenix\\blender\\build_car_2026.py").read())
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix
from collections import defaultdict

PI = math.pi


def clamp(v, a, b):
    return a if v < a else b if v > b else v


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def spline(pts, x):
    """Cubic Hermite through (x, y) points, clamped at the ends."""
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    i = 0
    while pts[i + 1][0] < x:
        i += 1
    x0, y0 = pts[i]
    x1, y1 = pts[i + 1]

    def slope(j):
        a = pts[max(j - 1, 0)]
        b = pts[min(j + 1, len(pts) - 1)]
        return (b[1] - a[1]) / (b[0] - a[0])

    h = x1 - x0
    t = (x - x0) / h
    m0, m1 = slope(i) * h, slope(i + 1) * h
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1


# ---------------------------------------------------------------------------------------------
# Design
# ---------------------------------------------------------------------------------------------
Y_FRONT, Y_REAR, Y_MID = -2.425, 2.412, -0.05
W = 0.925
P_FRONT, P_REAR = 3.6, 3.4
Y_FS, Y_RS = -1.40, 1.35  # where the plan starts rounding into the nose and tail
WHEELS = [(-1.48, 0.345), (1.38, 0.345)]
WHEEL_X = 0.81
ARCH_R = 0.392
N_UP = 3.5  # squareness of the shoulder-to-deck curve
N_GH = 3.0  # squareness of the greenhouse

# Centreline deck height, shoulder (widest line) height, bottom edge of the skin.
ZT = [(-2.45, 0.700), (-2.40, 0.728), (-2.30, 0.772), (-2.0, 0.842), (-1.6, 0.905), (-1.12, 0.950),
      (-0.5, 0.962), (0.5, 0.982), (1.2, 1.012), (1.6, 1.030), (2.0, 1.044), (2.30, 1.046), (2.40, 1.032), (2.45, 1.0)]
ZS = [(-2.45, 0.665), (-2.3, 0.728), (-1.9, 0.795), (-1.0, 0.832), (0.5, 0.852), (1.6, 0.872), (2.2, 0.878), (2.45, 0.86)]
ZB = [(-2.45, 0.30), (-2.38, 0.235), (-2.1, 0.222), (-1.0, 0.232), (1.0, 0.238), (2.0, 0.27), (2.3, 0.31), (2.45, 0.36)]
# Roof centreline: windscreen, roof, fastback.
ZR = [(-1.12, 0.957), (-0.95, 1.075), (-0.70, 1.245), (-0.45, 1.365), (-0.30, 1.408), (-0.05, 1.440), (0.25, 1.447),
      (0.55, 1.426), (0.80, 1.365), (1.05, 1.262), (1.30, 1.150), (1.58, 1.034)]

Y_A, Y_C = -1.12, 1.58  # windscreen base, rear-glass base
Y_HEADER, Y_RG = -0.30, 0.62  # windscreen top, rear-glass top
GAP = 0.006
HOOD = (-2.28, -1.15)
TRUNK = (1.60, 2.36)
DOOR_F = (-0.986, 0.104)
DOOR_R = (0.110, 1.060)

Q = [0, .04, .10, .16, .175, .185, .23, .30, .38, .48, .58, .68, .78, .85, .87, .895, .92, .94, .97, 1.0]
TH = [0, .05, .10, .16, .23, .30, .37, .44, .50, .515, .57, .64, .72, .80, .88, .95, 1.0]
HALF = [("q", v) for v in Q] + [("th", v) for v in TH[1:]]
NQ = len(Q)  # bands 0..NQ-2 are side wall
BELT_H = NQ - 1 + TH.index(0.50)  # half index of the belt / shut-line column
NH = len(HALF)
GJ = [0, .0015, .04, .12, .22, .32, .42, .50, .55, .585, .62, .66, .72, .80, .88, .95, 1.0]

# Side windows and pillars along the greenhouse, front to back: (ends at y, object, material).
DLO = [(0.075, "window", "glass"), (0.14, "B", "trim_gloss"), (0.98, "rear-window", "glass"),
       (1.03, "rear-door", "trim_gloss"), (1.25, "side-glass", "glass"), (9.0, "body", "carpaint")]
REAR_GLASS_NODE = "rear-glass"
TAILGATE = None  # SUVs: (row where the tailgate's sides are cut, lowest side-wall band it covers)
ROOF_MAT, RAIL_MAT, CHROME_DLO = "carpaint", "trim_gloss", False
ROOF_RAILS = False
FENDER_BULGE = 0.032
LAMP_F_Y, LAMP_R_Y = -2.16, 2.08
INTAKE_Y, INTAKE_Q = -2.34, (.10, .30)
BLADES = (0.15, 0.205, 0.255)
CURTAIN = (-2.29, -2.21)
ROCKER = (-1.08, 0.98)
CHIN_Y, DIFF_Y = -2.0, 2.15
TYRE_SCALE = (1.0, 1.0)  # radial, axial, against the sedan's 0.345 m x 0.258 m wheel
SPOKES = (5, 0.13)  # spoke groups, half-angle between a pair's spokes (0 = single spokes)
INT_DZ = 0.0  # cabin raised by this much (SUVs sit higher)
PAINT = (0.034, 0.072, 0.145)
BLADE_MAT = "trim_gloss"
INT_REAR_DY = 0.0  # rear bench moved back (long wheelbase)
# Box bodies (vans, ambulances): side-wall columns are absolute heights in metres (Q ends with 9.0,
# "up to the shoulder"), windows are cut straight into the skin, and there's no glasshouse.
BOX = False
WINDOWS = []  # (y from, y to, z from, z to, object, material) cut into the side wall
WS = (0.0, 0.0)  # box: windscreen rows on the roof surface
DOOR_Z = (0.46, 1.95)  # box: door bottom and top (each a column with a gap band above it)
SIDE_DOOR_NODE = None  # box: {side: object or None} for the second door on each side
BUMPER = None  # box: (front depth, front top z, rear depth, rear top z) split off as bumper parts
ROCKER_Z = 0.0  # box: below this the skin is black trim
BAND = None  # box livery: (z from, z to) painted "paint_band"
WIDTH_STEP = None  # box: (y where the body widens, wider half-width, blend length) — an ambulance's box
DOOR_R_Z = None  # box: the second door's own bottom and top, when it differs from the cab doors'
BAND_COLOUR = (0.05, 0.18, 0.55)
DUAL_REAR = 0.0  # trucks: a second rear wheel this far inboard of the first, on the same pivot
PAINT2 = None  # (y from, material): behind this the body takes a second paint (a lorry's box)
PANES = []  # (y, width, z from, z to, object): flush windows facing backwards across the body
REAR_SEAM = False  # box: the rear doors' centre seam, without a rear window
FINE_TO = None  # long bodies: fine 5 cm rows up to here (the cab), ROW_STEP behind it
ROW_STEP = 0.05  # spacing of the evenly spaced rows (long trucks use more)
WHEEL_STYLE = "car"  # "truck": polished disc wheels with hand-holes and a deep dish
CAB_LEAN = 0.0  # cab-overs: the front leans back this much per metre above 1.4 m (a raked windscreen)
REAR_LEAN = 0.0  # refuse hopper: the back leans out this much per metre above 1.3 m
FRONT_DARK = None  # (depth from the nose, top z): the lower front in dark gloss, lamps and grille set into it
TRUCK_MIRRORS = False
CAB_DETAILS = None  # dict(steps=[y...], step_z=[z...], visor=(y, z, width), markers=(y, z, width))
BONNET_FRONT = None  # dict(grille=(width, z0, z1), lamps=(x, z, w, h)): a conventional truck's face
FENDERS = None  # (x inner, x outer, radius pad): black flares over the front wheels
EXHAUST = None  # (x, y, z top): a chrome stack behind the cab
CHASSIS_GUARDS = True
REAR_SECTION = None  # box: (y from, object, material): everything behind it is one part (a refuse hopper)
PAINT2_COLOUR = None
EXTRAS = ()  # names of extra builders to run (truck chassis, equipment)
REAR_PANE = None  # box: (width, z from, z to) flush rear window on the back face
LAMP_BANDS = (.87, .895, .92)
LAMP_MODULE_Q = 0.9075
HANDLE_Q = 0.88
PLATE_Q = 0.48
FINS = True
SENSOR_Q = (None, 0.33)
MIRROR_AT = None  # (y, z) for mirrors not on a belt line
WIPER_Y = None
INT_DY = None
INT_DASH_DY = 0.0  # box cabs: the dashboard sits this much closer to the seats
TAIL_FLUSH = False  # hatches/SUVs: the shoulder sharpens toward the tail so the glasshouse meets it flush
CLADDING = False  # crossover: unpainted black round the wheel arches and along the sills
LIVERY = None  # "taxi" or "police": the civic paint schemes on the sedan body
VLAMP = None  # vertical light blades at the front corners: (row from, row to, band from, band to)
PIVOTS = {}  # object -> new world location, for a different wheelbase
# Premium bodies (2026-10-25): a two-door is DOOR_R past the tail (no rear doors); OPEN_TOP drops the roof.
OPEN_TOP = False  # roadster: no roof or side glass, the windscreen in a black frame over an open cockpit
REAR_SEATS = True  # two-seaters have none
VBARS = None  # (count, half-width): vertical chrome bars across the intake instead of horizontal blades
TWO_TONE = None  # side-wall q below which the paint is the second colour ("paint_band"); chrome coach line on the seam
ROLL_HOOPS = False  # roadster: painted fairings behind the seats with chrome hoops
REAR_WING = None  # (y, z, span): a fixed wing on two stalks over the tail (hypercar)
# Faces, tails and wheels of their own, so no two cars share the city fleet's light-bar face.
LAMP_SPLIT = None  # x: front lamps only outboard of this (two separate headlamps); inboard is LAMP_CENTRE_MAT
LAMP_SPLIT_R = None  # the same for the tail lamps
LAMP_CENTRE_MAT, TAIL_CENTRE_MAT = "carpaint", "carpaint"
INTAKE_X = None  # the intake only inboard of this x: a grille of its own shape rather than the full width
SPOKE_TWIST = 0.0  # radians from hub to rim: curved (turbine) spokes; SPOKE_CROSS crosses them into a mesh
SPOKE_CROSS = False
AERO_DISC = None  # material of a flat aero cover behind the spokes (EV wheels)
RIM = None  # (rgb, metallic, roughness) for the wheels instead of the fleet's satin grey
INTERIOR_COLOUR = None  # leather colour instead of the fleet's dark brown
ENGINE = None  # "v12", "v8", "i6" or "ev": an engine bay under the bonnet (build_engine_bay)
ENGINE_ACCENT = "engine_red"  # cam covers / inverter lid
ENGINE_REAR = False  # hypercar: a rear drive unit and battery under the glass tail
EVEN_RIMS = True  # panel-gap rims at even thickness (off for the premium line: it spiked there)
FOLD_ROOF = None  # convertible: dict(joint=y) — a two-panel soft top and door panes the game folds

PRESET = globals().get("PRESET", "sedan")
PRESETS = {}


def apply_preset(name):
    global HALF, NQ, BELT_H, NH
    if name != "sedan":
        globals().update(PRESETS[name])
    HALF = [("q", v) for v in Q] + [("th", v) for v in TH[1:]]
    NQ = len(Q)
    BELT_H = NQ - 1 + TH.index(0.50)
    NH = len(HALF)


def half_width(y):
    if y < Y_FS:
        t, p = (Y_FS - y) / (Y_FS - Y_FRONT), P_FRONT
    elif y > Y_RS:
        t, p = (y - Y_RS) / (Y_REAR - Y_RS), P_REAR
    else:
        t, p = 0.0, 2.0
    t = clamp(t, 0.0, 1.0)
    w = W * max(0.0, 1 - t ** p) ** (1 / p)
    if WIDTH_STEP:
        y0, wide, blend = WIDTH_STEP
        w += (wide - W) * smoothstep(y0, y0 + blend, y) * max(0.0, 1 - t ** p) ** (1 / p)
    for wy, _ in WHEELS:
        w += FENDER_BULGE * math.exp(-((y - wy) / 0.45) ** 2)
    return w


def arch_ness(y):
    return max(smoothstep(ARCH_R + 0.08, ARCH_R - 0.02, abs(y - wy)) for wy, _ in WHEELS)


def z_bottom(y):
    z = spline(ZB, y)
    for wy, wz in WHEELS:
        d = y - wy
        if abs(d) < ARCH_R:
            z = max(z, wz + math.sqrt(ARCH_R * ARCH_R - d * d))
    return z


def end_t(y):
    if y < Y_MID:
        return clamp((Y_MID - y) / (Y_MID - Y_FRONT), 0, 1)
    return clamp((y - Y_MID) / (Y_REAR - Y_MID), 0, 1)


def y_shift(yr, z):
    if yr < Y_FS:
        w = ((Y_FS - yr) / (Y_FS - Y_FRONT)) ** 6
        lean = CAB_LEAN * max(0.0, z - 1.4)
        return (0.11 * min(1.6, ((min(z, 0.69) - 0.50) / 0.28) ** 2) + lean) * w
    if yr > Y_RS:
        w = ((yr - Y_RS) / (Y_REAR - Y_RS)) ** 6
        lean = REAR_LEAN * max(0.0, z - 1.3)
        return (-0.10 * min(1.8, ((z - 0.62) / 0.30) ** 2) + lean) * w
    return 0.0


def body_point(yr, kind, val):
    w = half_width(yr)
    zs, zt, zb = spline(ZS, yr), spline(ZT, yr), z_bottom(yr)
    if kind == "q":
        if BOX:
            z = clamp(val, zb, zs) if val > 0 else zb
            val = (z - zb) / max(zs - zb, 1e-6)
        else:
            z = zb + (zs - zb) * val
        a = arch_ness(yr)
        x = w - 0.045 * (1 - a) * (1 - val) ** 2 * (w / W)
        # Sculpting: a crisp feature line under the shoulder and a soft hollow in the doors.
        k = (w / W) ** 2
        if not BOX:
            x += k * (0.010 * smoothstep(0.70, 0.80, val) - 0.010 - 0.008 * math.sin(PI * clamp((val - 0.2) / 0.5, 0, 1)))
        else:
            x -= k * 0.006 * math.sin(PI * clamp((val - 0.15) / 0.7, 0, 1))
        if a > 0:
            x += 0.013 * a * math.exp(-((z - zb) / 0.05) ** 2)
    else:
        th = val * PI / 2
        c, s = max(math.cos(th), 0.0), max(math.sin(th), 0.0)
        n = N_UP + (12.0 - N_UP) * smoothstep(Y_RS, Y_REAR - 0.25, yr) if TAIL_FLUSH else N_UP
        x = w * c ** (2 / n)
        z = zs + (zt - zs) * s ** (2 / n)
    return Vector((x, yr + y_shift(yr, z), z))


def gh_point(yr, f):
    b = body_point(yr, "th", 0.50)
    th = f * PI / 2
    c, s = max(math.cos(th), 0.0), max(math.sin(th), 0.0)
    zr = spline(ZR, yr)
    # y follows the belt below it: where the tail curves forward, the glasshouse curves with it
    # instead of overhanging the body as a cap.
    r = Vector((b.x * c ** (2 / N_GH), b.y, b.z + (zr - b.z) * s ** (2 / N_GH)))
    d = body_point(yr, "th", 0.50 + 0.5 * f)
    lam = smoothstep(Y_A, Y_A + 0.10, yr) * smoothstep(Y_C, Y_C - 0.12, yr)
    return d.lerp(r, lam)


def make_rows():
    ys = set()
    n = 46
    for k in range(n + 1):
        ph = k / n * PI / 2
        ys.add(Y_FS - math.sin(ph) ** (2 / P_FRONT) * (Y_FS - Y_FRONT))
        ys.add(Y_RS + math.sin(ph) ** (2 / P_REAR) * (Y_REAR - Y_RS))
    y = Y_FRONT
    while y < Y_REAR:
        ys.add(y)
        y += 0.05 if FINE_TO is not None and y < FINE_TO else ROW_STEP
    # Round the arches, rows evenly spaced by angle so the steep ends of the arch get the most.
    for wy, _ in WHEELS:
        for k in range(-18, 19):
            ys.add(wy + ARCH_R * math.sin(k / 18 * PI / 2 * 0.97))
        for d in (-1, 1):
            ys.add(wy + d * (ARCH_R + 0.03))
    gaps = [HOOD[0], HOOD[1], TRUNK[0], TRUNK[1], DOOR_F[0], DOOR_F[1], DOOR_R[1]]
    breaks = set()
    for g in gaps:
        if Y_FRONT < g < Y_REAR - GAP:
            breaks.add(round(g, 4))
            breaks.add(round(g + GAP, 4))
    if BOX and Y_FRONT < DOOR_R[0] < Y_REAR:
        breaks.add(round(DOOR_R[0], 4))
        breaks.add(round(DOOR_R[0] + GAP, 4))
    if PAINT2 and Y_FRONT < PAINT2[0] < Y_REAR:
        breaks.add(round(PAINT2[0], 4))
    if REAR_SECTION:
        breaks.add(round(REAR_SECTION[0], 4))
        breaks.add(round(REAR_SECTION[0] + GAP, 4))
    if TAILGATE:
        breaks.add(round(TAILGATE[0], 4))
        breaks.add(round(TAILGATE[0] + GAP, 4))
    if VLAMP:
        breaks.add(round(VLAMP[0], 4))
        breaks.add(round(VLAMP[1], 4))
    for b in [Y_A, Y_C, Y_HEADER, Y_RG, LAMP_F_Y, INTAKE_Y, LAMP_R_Y, DIFF_Y, CHIN_Y, CURTAIN[0], CURTAIN[1],
              ROCKER[0], ROCKER[1]] + [d[0] for d in DLO[:-1]]:
        if Y_FRONT < b < Y_REAR:
            breaks.add(round(b, 4))
    out = sorted(breaks)
    for y in sorted(ys):
        if all(abs(y - b) > 0.012 for b in breaks):
            out.append(y)
    out = sorted(out)
    clean = [out[0]]
    for y in out[1:]:
        if y - clean[-1] > 0.003 or round(y, 4) in breaks:
            clean.append(y)
    clean[0], clean[-1] = Y_FRONT, Y_REAR
    return clean


# ---------------------------------------------------------------------------------------------
# Mesh assembly
# ---------------------------------------------------------------------------------------------
class MB:
    def __init__(self):
        self.v, self.idx, self.f, self.fm, self.sm = [], {}, [], [], []

    def vert(self, key, co):
        if key is None:
            self.v.append(tuple(co))
            return len(self.v) - 1
        i = self.idx.get(key)
        if i is None:
            i = len(self.v)
            self.v.append(tuple(co))
            self.idx[key] = i
        return i

    def face(self, ids, mat, smooth=True):
        if len(set(ids)) < 3:
            return
        self.f.append(list(ids))
        self.fm.append(mat)
        self.sm.append(smooth)

    def raw(self, verts, faces, mat, smooth=True, mats=None, smooths=None):
        base = len(self.v)
        self.v.extend(tuple(v) for v in verts)
        for k, f in enumerate(faces):
            self.face([base + i for i in f], mats[k] if mats else mat, smooths[k] if smooths else smooth)


OUT = defaultdict(MB)


def side_name(base, side):
    return f"{base}-{'left' if side > 0 else 'right'}"


# ---------------------------------------------------------------------------------------------
# Primitives (world space, appended to a builder)
# ---------------------------------------------------------------------------------------------
def frame(origin, x_axis, y_axis):
    """Matrix whose local x/y/z map to the given world axes, located at origin."""
    xa = Vector(x_axis).normalized()
    ya = Vector(y_axis)
    ya = (ya - xa * ya.dot(xa)).normalized()
    za = xa.cross(ya)
    m = Matrix.Identity(4)
    for r in range(3):
        m[r][0], m[r][1], m[r][2], m[r][3] = xa[r], ya[r], za[r], origin[r]
    return m


def add_bm(mb, bm, mat, matrix=Matrix.Identity(4), smooth=True, flip=False):
    bm.verts.ensure_lookup_table()
    verts = [matrix @ v.co for v in bm.verts]
    faces = []
    for f in bm.faces:
        ids = [v.index for v in f.verts]
        faces.append(ids[::-1] if flip else ids)
    mb.raw(verts, faces, mat, smooth)
    bm.free()


def rbox(mb, size, mat, matrix, radius=0.01, segments=2, smooth=True):
    """Rounded box of `size` centred at the matrix origin."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if radius > 0:
        r = min(radius, min(size) * 0.49)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=r, segments=segments, profile=0.5, affect="EDGES",
                        clamp_overlap=True)
    add_bm(mb, bm, mat, matrix, smooth)


def cylinder(mb, matrix, radius, length, mat, seg=16, caps=True, smooth=True, r2=None):
    """Cylinder along local +x from 0 to length."""
    r2 = radius if r2 is None else r2
    verts, faces = [], []
    for k in range(seg):
        a = 2 * PI * k / seg
        verts.append((0.0, radius * math.cos(a), radius * math.sin(a)))
        verts.append((length, r2 * math.cos(a), r2 * math.sin(a)))
    for k in range(seg):
        a0, b0 = 2 * k, 2 * k + 1
        a1, b1 = 2 * ((k + 1) % seg), 2 * ((k + 1) % seg) + 1
        faces.append([a0, a1, b1, b0])
    smooths = [smooth] * len(faces)
    if caps:
        faces.append([2 * k + 1 for k in range(seg)])
        faces.append([2 * k for k in range(seg)][::-1])
        smooths += [False, False]
    mb.raw([matrix @ Vector(v) for v in verts], faces, mat, smooths=smooths)


def lathe(mb, profile, seg, mat, matrix, smooth=True, flat_from=None, mods=None):
    """Revolve (axial, radius) points about local +x. Profile order sets which side faces out:
    walking the profile with the axis on your right... see wheel profiles for examples."""
    verts, faces, smooths = [], [], []
    n = len(profile)
    for s in range(seg):
        a = 2 * PI * s / seg
        for k, (ax, r) in enumerate(profile):
            if mods:
                r = mods(k, s, ax, r)
            verts.append(Vector((ax, r * math.sin(a), r * math.cos(a))))
    for s in range(seg):
        s1 = (s + 1) % seg
        for k in range(n - 1):
            faces.append([s * n + k, s * n + k + 1, s1 * n + k + 1, s1 * n + k])
            smooths.append(smooth if flat_from is None or not flat_from(k) else False)
    mb.raw([matrix @ v for v in verts], faces, mat, smooths=smooths)


# ---------------------------------------------------------------------------------------------
# Body skin, greenhouse, lamps
# ---------------------------------------------------------------------------------------------
def in_gap(y, starts):
    return any(s <= y <= s + GAP for s in starts)


def classify_body(ym, h):
    """(object, material) for a skin face, ('region', tag) for recess regions, or None (removed)."""
    deck = h >= BELT_H
    if deck:
        if Y_A <= ym <= Y_C:
            return None
        if in_gap(ym, [HOOD[0], HOOD[1], TRUNK[0], TRUNK[1]]):
            return None
        hood = HOOD[0] + GAP < ym < HOOD[1]
        trunk = TRUNK[0] + GAP < ym < TRUNK[1]
        if TAILGATE and ym > TAILGATE[0]:
            return None if ym < TAILGATE[0] + GAP else ("trunk", "carpaint")
        if h == BELT_H:
            return None if hood or trunk else ("body", "carpaint")
        if hood:
            return ("hood", "carpaint")
        if trunk:
            return ("trunk", "carpaint")
        if HOOD[1] + GAP < ym < Y_A:
            return ("body", "trim_black")
        return ("body", "carpaint")
    q0 = Q[h] if h < NQ - 1 else 2.0  # shoulder bands below the belt aren't side-wall bands
    door_rows = DOOR_F[0] <= ym <= (DOOR_R[1] if DOOR_R[0] < Y_REAR else DOOR_F[1]) + GAP
    if h >= 4 and in_gap(ym, [DOOR_F[0], DOOR_F[1], DOOR_R[1]]):
        return None
    if h == 4 and door_rows:
        return None
    if TAILGATE and q0 > TAILGATE[1] - 1e-6 and ym > TAILGATE[0]:
        if ym < TAILGATE[0] + GAP or abs(q0 - TAILGATE[1]) < 1e-6:
            return None
        if not (q0 in (.87, .895, .92) and ym > LAMP_R_Y):
            return ("trunk", "carpaint")
    if h >= 5:
        if DOOR_F[0] + GAP < ym < DOOR_F[1]:
            return ("door", "carpaint")
        if DOOR_R[0] < ym < DOOR_R[1]:
            return ("rear-door", "carpaint")
    if ym < LAMP_F_Y and q0 in LAMP_BANDS:
        return ("region", "lampF")
    if ym > LAMP_R_Y and q0 in LAMP_BANDS:
        return ("region", "lampR")
    if VLAMP and VLAMP[0] < ym < VLAMP[1] and VLAMP[2] <= q0 < VLAMP[3]:
        return ("region", "vlamp")
    if ym < INTAKE_Y and INTAKE_Q[0] <= q0 < INTAKE_Q[1]:
        return ("region", "intake")
    if CURTAIN[0] < ym < CURTAIN[1] and .23 <= q0 < .58:
        return ("region", "curtain")
    if q0 < .10 and ROCKER[0] < ym < ROCKER[1]:
        return ("body", "trim_black")
    if q0 < .10 and ym < CHIN_Y:
        return ("body", "trim_black")
    if q0 < .23 and ym > DIFF_Y:
        return ("body", "trim_black")
    return ("body", "carpaint")


def classify_box(ym, h, zc, side):
    """Box bodies: the roof carries the bonnet and windscreen; doors and windows are cut by height."""
    q0 = Q[h] if h < NQ - 1 else 9.0
    if REAR_SECTION and ym > REAR_SECTION[0]:
        if ym < REAR_SECTION[0] + GAP:
            return None
        if not (ym > LAMP_R_Y and q0 in LAMP_BANDS):
            return (REAR_SECTION[1], REAR_SECTION[2])
    if h >= BELT_H:
        if HOOD[0] <= ym <= HOOD[1] + GAP:
            if in_gap(ym, [HOOD[0], HOOD[1]]) or h == BELT_H:
                return None
            return ("hood", "carpaint")
        if WS[0] < ym < WS[1]:
            return ("windscreen-glass", "glass") if h > BELT_H + 1 else ("body", "trim_gloss")
        return ("body", ROOF_MAT if ym > WS[1] else "carpaint")
    q0 = Q[h] if h < NQ - 1 else 9.0
    for y0, y1, z0, z1, part, mat in WINDOWS:
        if y0 < ym < y1 and z0 < zc < z1:
            return (part, mat)
    for (a, b), part in ((DOOR_F, "door"), (DOOR_R, "rear-door")):
        if part == "rear-door" and SIDE_DOOR_NODE is not None and not SIDE_DOOR_NODE.get(side):
            continue
        dz = DOOR_R_Z if part == "rear-door" and DOOR_R_Z else DOOR_Z
        if a <= ym <= b + GAP and dz[0] - 0.02 < zc < dz[1] + 0.03:
            if in_gap(ym, [a, b]) or abs(q0 - dz[0]) < 1e-6 or abs(q0 - dz[1]) < 1e-6:
                return None
            if dz[0] < zc < dz[1]:
                return (part, "carpaint")
    if ym < LAMP_F_Y and q0 in LAMP_BANDS:
        return ("region", "lampF")
    if ym > LAMP_R_Y and q0 in LAMP_BANDS:
        return ("region", "lampR")
    if ym < INTAKE_Y and INTAKE_Q[0] <= q0 < INTAKE_Q[1]:
        return ("region", "intake")
    if BUMPER:
        fd, ft, rd, rt = BUMPER
        if ym < Y_FRONT + fd and zc < ft:
            return ("bumper-front", "trim_black")
        if ym > Y_REAR - rd and zc < rt:
            return ("bumper-rear", "trim_black")
    if zc < ROCKER_Z:
        return ("body", "trim_black")
    return ("body", "carpaint")


def build_rear_pane():
    """Box bodies: flush rear window on the back face, in a black frame, and the doors' centre seam."""
    for y, width, z0, z1, node in PANES:
        zc = 0.5 * (z0 + z1)
        m = frame(Vector((0, y, zc)), Vector((1, 0, 0)), Vector((0, 0, 1)))
        rbox(OUT["trim"], (width + 0.05, z1 - z0 + 0.05, 0.008), "trim_gloss", m, radius=0.02, segments=2)
        rbox(OUT[node], (width, z1 - z0, 0.006), "glass", m @ Matrix.Translation((0, 0, -0.004)), radius=0.015, segments=2)
    if REAR_SEAM and not REAR_PANE:
        seam = body_point(Y_REAR, "q", 2.0)
        top = spline(ZS, Y_REAR - 0.05)
        bottom = z_bottom(Y_REAR - 0.05)
        rbox(OUT["trim"], (0.010, top - bottom - 0.1, 0.006), "trim_gloss",
             frame(Vector((0, seam.y + 0.002, 0.5 * (top + bottom))), Vector((1, 0, 0)), Vector((0, 0, 1))), radius=0.0)
        for x in (-0.12, 0.12):
            for z in (bottom + 0.5, top - 0.5):
                rbox(OUT["trim"], (0.04, 0.10, 0.03), "chrome", Matrix.Translation((x, seam.y + 0.015, z)), radius=0.008)
    if not REAR_PANE:
        return
    width, z0, z1 = REAR_PANE
    zc = 0.5 * (z0 + z1)
    p = body_point(Y_REAR, "q", zc)
    m = frame(Vector((0, p.y + 0.004, zc)), Vector((1, 0, 0)), Vector((0, 0, 1)))
    rbox(OUT["trim"], (width + 0.05, z1 - z0 + 0.05, 0.008), "trim_gloss", m, radius=0.02, segments=2)
    rbox(OUT["rear-glass"], (width, z1 - z0, 0.006), "glass", m @ Matrix.Translation((0, 0, -0.004)), radius=0.015,
         segments=2)
    seam = body_point(Y_REAR, "q", 1.2)
    rbox(OUT["trim"], (0.008, 2.0, 0.006), "trim_gloss", frame(Vector((0, seam.y + 0.002, 1.45)), Vector((1, 0, 0)),
                                                                Vector((0, 0, 1))), radius=0.0)


def classify_gh(ym, jb):
    f0 = GJ[jb]
    if OPEN_TOP and jb > 0:
        # Only the windscreen and its frame: behind its top edge the cockpit is open.
        if ym > Y_HEADER:
            return None
        if f0 < .62:
            return ("body", "trim_gloss")
        return ("windscreen-glass", "glass")
    if jb == 0:  # the slim bright strip along the window line
        if DOOR_F[0] < ym < DOOR_F[1]:
            return ("door", "chrome")
        if DOOR_R[0] < ym < DOOR_R[1]:
            return ("rear-door", "chrome")
        if in_gap(ym, [DOOR_F[1]]):
            return None
        return ("chrome-parts", "chrome")
    if f0 < .50:
        for end, part, mat in DLO:
            if ym < end:
                if part == "B":
                    if in_gap(ym, [DOOR_F[1]]):
                        return None
                    return ("door", mat) if ym < DOOR_F[1] else ("rear-door", mat)
                return (part, mat)
    if f0 < .66:
        if CHROME_DLO and f0 < .55:
            return ("chrome-parts", "chrome")
        return ("body", RAIL_MAT)
    if ym < Y_HEADER:
        return ("windscreen-glass", "glass")
    if ym > Y_RG:
        return (REAR_GLASS_NODE, "glass")
    return ("body", ROOF_MAT)


def object_for(part, side):
    if part == "rear-door" and SIDE_DOOR_NODE is not None:
        return SIDE_DOOR_NODE.get(side) or "body"
    if part in ("door", "rear-door", "window", "rear-window"):
        return side_name(part, side)
    return part


def grid(rows, half_fn, nh):
    """Full-width grid: P[i][c], c = 0..2nh-2 from left bottom over the top to right bottom."""
    P = []
    for yr in rows:
        half = [half_fn(yr, h) for h in range(nh)]
        row = half + [Vector((-p.x, p.y, p.z)) for p in reversed(half[:-1])]
        P.append(row)
    return P


def normals(P):
    ni, nc = len(P), len(P[0])
    N = []
    for i in range(ni):
        row = []
        for c in range(nc):
            a, b = P[min(i + 1, ni - 1)][c] - P[max(i - 1, 0)][c], P[i][min(c + 1, nc - 1)] - P[i][max(c - 1, 0)]
            n = a.cross(b)
            row.append(n.normalized() if n.length > 1e-12 else Vector((0, 0, 1)))
        N.append(row)
    return N


def band_of(c, nh):
    """Half band index and side for full-grid face column c."""
    if c < nh - 1:
        return c, 1
    return 2 * nh - 3 - c, -1


LAST_ROW = [0]


def K(k):
    """Grid vertex key; the end rows collapse onto the centreline, so both halves share them."""
    i, c = k
    if i == 0 or i == LAST_ROW[0]:
        return (i, c if c <= NH - 1 else 2 * (NH - 1) - c)
    return k


def build_skin():
    rows = make_rows()
    LAST_ROW[0] = len(rows) - 1
    P = grid(rows, lambda yr, h: body_point(yr, *HALF[h]), NH)
    N = normals(P)
    regions = defaultdict(list)
    nc = len(P[0])
    for i in range(len(rows) - 1):
        ym = 0.5 * (rows[i] + rows[i + 1])
        for c in range(nc - 1):
            h, side = band_of(c, NH)
            quad = [(i, c), (i + 1, c), (i + 1, c + 1), (i, c + 1)]
            if BOX:
                pts = [P[a][b] for a, b in quad]
                if (pts[2] - pts[0]).cross(pts[3] - pts[1]).length < 1e-7:
                    continue  # columns clamped together where the wall is lower than them
                zc = sum(p.z for p in pts) / 4
                cls = classify_box(ym, h, zc, side)
            else:
                zc = 0.0
                cls = classify_body(ym, h)
            if cls is None:
                continue
            if cls[0] == "region":
                xc = abs(sum(P[a][b].x for a, b in quad) / 4)
                split = {"lampF": LAMP_SPLIT, "lampR": LAMP_SPLIT_R}.get(cls[1])
                if split is not None and xc < split:
                    cls = ("body", LAMP_CENTRE_MAT if cls[1] == "lampF" else TAIL_CENTRE_MAT)
                elif cls[1] == "intake" and INTAKE_X is not None and xc > INTAKE_X:
                    cls = ("body", "carpaint")
                else:
                    regions[cls[1]].append((quad, side, h, ym))
                    continue
            mat = cls[1]
            if CLADDING and mat == "carpaint" and h < NQ - 1 and cls[0] in ("body", "door", "rear-door"):
                if Q[h] < .16 or (Q[h] < .30 and arch_ness(ym) > 0.2):
                    mat = "trim_black"
            if LIVERY == "police" and cls[0] in ("door", "rear-door") and mat == "carpaint":
                mat = "paint_white"
            if BOX and BAND and mat == "carpaint" and h < NQ - 1 and BAND[0] <= Q[h] < BAND[1]:
                mat = "paint_band"
            if TWO_TONE and mat == "carpaint" and h < NQ - 1 and Q[h] < TWO_TONE:
                mat = "paint_band"
            if PAINT2 and mat == "carpaint" and ym > PAINT2[0]:
                mat = PAINT2[1]
            if BOX and FRONT_DARK and mat == "carpaint" and ym < Y_FRONT + FRONT_DARK[0] and zc < FRONT_DARK[1]:
                mat = "trim_gloss"
            mb = OUT[object_for(cls[0], side)]
            mb.face([mb.vert(("s",) + K(k), P[k[0]][k[1]]) for k in quad], mat)
    return rows, P, N, regions


def build_greenhouse(rows):
    grows = [y for y in rows if Y_A - 1e-6 <= y <= Y_C + 1e-6]
    if len(grows) < 2:
        return grows, []
    G = grid(grows, lambda yr, j: gh_point(yr, GJ[j]), len(GJ))
    nc = len(G[0])
    for i in range(len(grows) - 1):
        ym = 0.5 * (grows[i] + grows[i + 1])
        for c in range(nc - 1):
            jb, side = band_of(c, len(GJ))
            cls = classify_gh(ym, jb)
            if cls is None:
                continue
            mb = OUT[object_for(cls[0], side)]
            # glass gets its own vertices so its normals don't blend with the trims around it
            tag = "g" if cls[1] == "glass" else "h"
            last = len(grows) - 1
            key = lambda a, b: (a, b if a not in (0, last) or b <= len(GJ) - 1 else 2 * (len(GJ) - 1) - b)
            mb.face([mb.vert((tag,) + key(a, b), G[a][b]) for a, b in [(i, c), (i + 1, c), (i + 1, c + 1), (i, c + 1)]],
                    cls[1])
    if OPEN_TOP:
        # The windscreen's top rail, gloss black, across the header.
        line = [gh_point(Y_HEADER, GJ[j]) for j in range(len(GJ)) if GJ[j] >= .50]
        line = [Vector((-p.x, p.y, p.z)) for p in reversed(line[1:])] + line
        line = [p + Vector((0, -0.01, 0.012)) for p in line]
        ribbon(OUT["body"], line, 0.03, 0.05, "trim_gloss", "header")
        return grows, G
    # Headliner: the roof and rails, offset inward and facing down into the cabin.
    NG = normals(G)
    cab = OUT["cabin"]
    for i in range(len(grows) - 1):
        ym = 0.5 * (grows[i] + grows[i + 1])
        if not (Y_HEADER - 0.03 < ym < Y_RG + 0.05):
            continue
        for c in range(nc - 1):
            jb, side = band_of(c, len(GJ))
            if GJ[jb] < .55:
                continue
            quad = [(i, c), (i, c + 1), (i + 1, c + 1), (i + 1, c)]
            cab.face([cab.vert(("hl", a, b), G[a][b] - NG[a][b] * 0.035) for a, b in quad], "headliner")
    return grows, G


def recess(mb, P, N, faces, depth, back_mat, wall_mat, tag, lens_mb=None, lens_mat=None):
    """Sinks a region of skin faces: back wall offset inward, side walls, optional flush lens."""
    count = defaultdict(int)
    for quad in faces:
        for e in zip(quad, quad[1:] + quad[:1]):
            count[tuple(sorted(e))] += 1
    inner = lambda k: P[k[0]][k[1]] - N[k[0]][k[1]] * depth
    for quad in faces:
        mb.face([mb.vert((tag, "b") + K(k), inner(k)) for k in quad], back_mat)
        if lens_mb is not None:
            lens_mb.face([lens_mb.vert((tag, "l") + K(k), P[k[0]][k[1]]) for k in quad], lens_mat)
        for a, b in zip(quad, quad[1:] + quad[:1]):
            if count[tuple(sorted((a, b)))] == 1:
                mb.face([mb.vert((tag, "w") + a, P[a[0]][a[1]]), mb.vert((tag, "w") + b, P[b[0]][b[1]]),
                         mb.vert((tag, "wb") + b, inner(b)), mb.vert((tag, "wb") + a, inner(a))], wall_mat, False)


def inset_strip(mb, P, N, faces, depth, mat, tag, pick=lambda quad, side, h, ym, x: True):
    for quad, side, h, ym in faces:
        x = abs(P[quad[0][0]][quad[0][1]].x)
        if pick(quad, side, h, ym, x):
            mb.face([mb.vert((tag,) + K(k), P[k[0]][k[1]] - N[k[0]][k[1]] * depth) for k in quad], mat)


def build_lamps(P, N, regions):
    front = regions["lampF"]
    lf = OUT["lights-front"]
    recess(lf, P, N, [r[0] for r in front], 0.045, "lamp_housing", "lamp_housing", "lf", lf, "lamp_lens")
    # Full-width daytime light blade along the top of the band.
    inset_strip(lf, P, N, front, 0.008, "headlight", "drl", lambda q, s, h, ym, x: Q[h] == LAMP_BANDS[2])
    # Indicators: outer ends of the lower strip.
    for side, mat in ((1, "indicator_left"), (-1, "indicator_right")):
        inset_strip(lf, P, N, front, 0.010, mat, f"ind{side}", lambda q, s, h, ym, x, side=side: Q[h] == LAMP_BANDS[0] and s == side and x > 0.56)
    # Black reflector in the middle strip inboard of the projectors.
    inset_strip(lf, P, N, front, 0.03, "trim_gloss", "lfmid", lambda q, s, h, ym, x: Q[h] == LAMP_BANDS[1] and x < 0.50)

    # Projector modules, three per side, sitting in the middle strip.
    # Main-beam LED modules: a row of small lit cubes in black bezels at each corner.
    for side in ((1, -1) if not BOX else ()):
        for yr in [Y_FRONT + d for d in (0.055, 0.09, 0.125, 0.163, 0.203)]:
            p = body_point(yr, "q", LAMP_MODULE_Q)
            p.x *= side
            n = surface_normal(yr, LAMP_MODULE_Q, side)
            m = frame(p - n * 0.026, n, Vector((0, 0, 1)))
            rbox(lf, (0.016, 0.030, 0.019), "trim_gloss", m, radius=0.003, segments=1)
            rbox(lf, (0.004, 0.022, 0.012), "headlight", m @ Matrix.Translation((0.008, 0, 0)), radius=0.002, segments=1)

    if regions.get("vlamp"):
        blades = regions["vlamp"]
        recess(lf, P, N, [r[0] for r in blades], 0.03, "lamp_housing", "lamp_housing", "vl", lf, "lamp_lens")
        inset_strip(lf, P, N, blades, 0.006, "headlight", "vls")

    rear = regions["lampR"]
    lr = OUT["lights-rear"]
    recess(lr, P, N, [r[0] for r in rear], 0.04, "lamp_housing", "lamp_housing", "lr", lr, "tail_lens")
    inset_strip(lr, P, N, rear, 0.008, "tail_light", "tl", lambda q, s, h, ym, x: Q[h] in LAMP_BANDS[1:])
    for side, mat in ((1, "indicator_left"), (-1, "indicator_right")):
        inset_strip(lr, P, N, rear, 0.010, mat, f"rind{side}", lambda q, s, h, ym, x, side=side: Q[h] == LAMP_BANDS[0] and s == side and x > 0.62)
    inset_strip(lr, P, N, rear, 0.010, "reverse_lamp", "rev", lambda q, s, h, ym, x: Q[h] == LAMP_BANDS[0] and 0.30 < x < 0.62)


def surface_normal(yr, q, side):
    e = 0.004
    a = body_point(yr + e, "q", q) - body_point(yr - e, "q", q)
    step = 0.03 if BOX else 0.01
    b = body_point(yr, "q", min(q + step, 9.0 if BOX else 1)) - body_point(yr, "q", max(q - step, 0.001 if BOX else 0))
    n = a.cross(b).normalized()
    if side < 0:
        n.x = -n.x
    return n


def surface_at(yr, q, side, out=0.0):
    p = body_point(yr, "q", q)
    p.x *= side
    return p + surface_normal(yr, q, side) * out


def build_intake_plate(P, N, regions):
    trim = OUT["trim"]
    intake = regions["intake"]
    recess(trim, P, N, [r[0] for r in intake], 0.06, "trim_black", "trim_black", "in")
    # Horizontal blades across the opening, following its curve, set back behind the bumper face.
    rows = [y for y in make_rows() if y < INTAKE_Y]
    if VBARS:
        # Vertical bars, each standing where the opening's surface reaches its x, set back a little.
        count, gw = VBARS
        q0, q1 = INTAKE_Q
        for k in range(count):
            x = -gw + 2 * gw * k / (count - 1)
            best = min((abs(abs(body_point(y, "q", 0.5 * (q0 + q1)).x) - abs(x)), y) for y in frange(Y_FRONT, INTAKE_Y, 0.002))[1]
            a, b = body_point(best, "q", q0 + 0.02), body_point(best, "q", q1 - 0.02)
            n = surface_normal(best, 0.5 * (q0 + q1), 1)
            c = (a + b) * 0.5 - n * 0.022
            c.x = x
            rbox(trim, (0.014, 0.03, (b.z - a.z)), BLADE_MAT, Matrix.Translation(c), radius=0.004, segments=1)
    for k, zq in enumerate(BLADES):
        line = []
        for yr in rows:
            p = body_point(yr, "q", zq)
            n = surface_normal(yr, zq, 1)
            line.append(p - n * 0.028)
        if INTAKE_X is not None:
            line = [p for p in line if abs(p.x) < INTAKE_X - 0.02]
            if len(line) < 2:
                continue
        line = [Vector((-p.x, p.y, p.z)) for p in reversed(line[1:])] + line
        ribbon(trim, line, 0.009, 0.014, BLADE_MAT, f"blade{k}")

    # Air curtains: tall black slots at the front corners.
    recess(trim, P, N, [r[0] for r in regions["curtain"]], 0.035, "trim_black", "trim_black", "cu")
    # Diffuser fins across the black lower rear.
    for x in ((-0.42, -0.14, 0.14, 0.42) if FINS else ()):
        best = min((abs(abs(body_point(y, "q", 0.12).x) - abs(x)), y) for y in frange(Y_REAR - 0.41, Y_REAR, 0.002))[1]
        p = body_point(best, "q", 0.12)
        rbox(trim, (0.010, 0.05, 0.075), "trim_black", Matrix.Translation((x, p.y - 0.006, p.z)), radius=0.003, segments=1)

    # Plate on a slim black holder standing proud of the flat tail.
    p = body_point(Y_REAR, "q", PLATE_Q)
    hold = frame(Vector((0, p.y + 0.002, p.z)), Vector((1, 0, 0)), Vector((0, 0, 1)))
    rbox(OUT["trim"], (0.545, 0.128, 0.016), "trim_gloss", hold, radius=0.006, segments=2)
    rbox(OUT["trim"], (0.52, 0.112, 0.006), "plate_blank", hold @ Matrix.Translation((0, 0, -0.0085)),
         radius=0.004, segments=1)
    # Rear camera just above the plate.
    cam = body_point(Y_REAR, "q", PLATE_Q + (0.12 if not BOX else 0.13))
    cylinder(OUT["trim"], frame(Vector((0, cam.y - 0.01, cam.z)), Vector((0, 1, -0.25)), Vector((1, 0, 0))), 0.011, 0.016,
             "trim_gloss", seg=12)


def build_sensors():
    trim = OUT["body"]
    front_q = SENSOR_Q[0] if SENSOR_Q[0] is not None else (0.40 if INTAKE_Q[1] < 0.4 else 0.06)
    for yr, q, xs in ((Y_FRONT + 0.03, front_q, (0.18, 0.46)), (Y_REAR - 0.022, SENSOR_Q[1], (0.40, 0.62))):
        for x0 in xs:
            for side in (1, -1):
                # find the row where the surface reaches this x
                best = min((abs(abs(body_point(y, "q", q).x) - x0), y) for y in frange(yr - 0.25, yr + 0.25, 0.002)
                           if (y < 0) == (yr < 0))[1]
                p = surface_at(best, q, side, -0.002)
                n = surface_normal(best, q, side)
                m = frame(p, n, Vector((0, 0, 1)))
                cylinder(trim, m, 0.0105, 0.0035, "carpaint", seg=12)
                cylinder(OUT["trim"], m @ Matrix.Translation((-0.001, 0, 0)), 0.0125, 0.0028, "trim_black", seg=12, caps=False)


def frange(a, b, s):
    out, v = [], a
    while v <= b:
        out.append(v)
        v += s
    return out


def ribbon(mb, line, height, depth, mat, tag):
    """A thin bar of the given height and depth swept along a polyline (front face toward -y)."""
    for k in range(len(line) - 1):
        a, b = line[k], line[k + 1]
        corners = lambda p: [p + Vector((0, 0, height / 2)), p + Vector((0, depth, height / 2)),
                             p + Vector((0, depth, -height / 2)), p + Vector((0, 0, -height / 2))]
        ca, cb = corners(a), corners(b)
        for m in range(4):
            m1 = (m + 1) % 4
            mb.face([mb.vert((tag, k, m), ca[m]), mb.vert((tag, k, m1), ca[m1]),
                     mb.vert((tag, k + 1, m1), cb[m1]), mb.vert((tag, k + 1, m), cb[m])], mat, False)


# ---------------------------------------------------------------------------------------------
# Under the car: floor, wheel tubs
# ---------------------------------------------------------------------------------------------
def build_underbody(rows):
    ub = OUT["underbody"]
    z = min(z_bottom(y) for y in frange(-1.0, 1.0, 0.1)) - 0.004
    pts = []
    for yr in rows:
        w = body_point(yr, "q", 0.0).x - 0.01
        if arch_ness(yr) > 0.02:
            w = min(w, WHEEL_X - 0.16)
        pts.append((yr, max(w, 0.0)))
    for k in range(len(pts) - 1):
        (y0, w0), (y1, w1) = pts[k], pts[k + 1]
        ub.face([ub.vert(("fl", k, 0), (-w0, y0, z)), ub.vert(("fl", k, 1), (w0, y0, z)),
                 ub.vert(("fl", k + 1, 1), (w1, y1, z)), ub.vert(("fl", k + 1, 0), (-w1, y1, z))], "underbody", False)
    # Wheel tubs: part drums inside each arch so the arch never shows the inside of the body.
    seg = 48
    for wy, wz in WHEELS:
        for side in (1, -1):
            ox = side * (WHEEL_X - 0.17)
            angles = [-PI / 2 - 0.15 + (PI + 0.3) * s / seg for s in range(seg + 1)]
            outer = [Vector((ox + side * 0.27, wy + (ARCH_R + 0.012) * math.sin(a), wz + (ARCH_R + 0.012) * math.cos(a)))
                     for a in angles]
            inner = [Vector((ox, wy + (ARCH_R + 0.012) * math.sin(a), wz + (ARCH_R + 0.012) * math.cos(a))) for a in angles]
            back = [Vector((ox, wy + 0.30 * math.sin(a), wz + 0.30 * math.cos(a))) for a in angles]
            verts = outer + inner + back
            n = seg + 1
            faces = []
            for s in range(seg):
                # drum: faces look toward the wheel (inward)
                f = [s, s + 1, n + s + 1, n + s]
                faces.append(f if side < 0 else f[::-1])
                # back ring: faces look outboard toward the wheel
                g = [n + s, n + s + 1, 2 * n + s + 1, 2 * n + s]
                faces.append(g if side < 0 else g[::-1])
            ub.raw(verts, faces, "underbody", True)


# ---------------------------------------------------------------------------------------------
# Wheels: tyre, 19-inch twin-spoke alloy, disc, hub, nuts; calipers separate
# ---------------------------------------------------------------------------------------------
R_TYRE, HALF_TYRE, R_RIM = 0.345, 0.128, 0.241


def tyre_profile():
    p = [(-0.104, 0.250), (-0.117, 0.263), (-0.126, 0.282), (-0.129, 0.300), (-0.126, 0.320), (-0.117, 0.334),
         (-0.103, 0.3425), (-0.086, R_TYRE)]
    tread = []
    for g in (-0.054, -0.016, 0.022, 0.060):
        tread += [(g - 0.006, R_TYRE), (g - 0.004, R_TYRE - 0.008), (g + 0.004, R_TYRE - 0.008), (g + 0.006, R_TYRE)]
    tail = [(0.086, R_TYRE), (0.103, 0.3425), (0.117, 0.334), (0.126, 0.320), (0.129, 0.300), (0.126, 0.279),
            (0.117, 0.263), (0.104, 0.250)]
    return p + tread + tail


def truck_tyre_profile():
    p = [(-0.104, 0.212), (-0.117, 0.226), (-0.126, 0.255), (-0.129, 0.290), (-0.126, 0.320), (-0.117, 0.334),
         (-0.103, 0.3425), (-0.086, R_TYRE)]
    tread = []
    for g in (-0.054, -0.016, 0.022, 0.060):
        tread += [(g - 0.006, R_TYRE), (g - 0.004, R_TYRE - 0.010), (g + 0.004, R_TYRE - 0.010), (g + 0.006, R_TYRE)]
    tail = [(0.086, R_TYRE), (0.103, 0.3425), (0.117, 0.334), (0.126, 0.320), (0.129, 0.290), (0.126, 0.255),
            (0.117, 0.226), (0.104, 0.212)]
    return p + tread + tail


def build_truck_wheel_local():
    """Polished disc wheel: a deep dish with a ring of hand-holes, a hub boss, ten nuts, a hub cap."""
    mb = MB()
    I = Matrix.Identity(4)
    prof = truck_tyre_profile()
    tread_idx = {k for k, (ax, r) in enumerate(prof) if r >= R_TYRE - 0.0105 and abs(ax) < 0.09}

    def lugs(k, s, ax, r):
        if r >= R_TYRE - 0.0001 and abs(ax) < 0.085 and (s // 2) % 2 == 1:
            return r - 0.005
        return r

    lathe(mb, prof, 72, "tyre", I, smooth=True, flat_from=lambda k: k in tread_idx and (k + 1) in tread_idx, mods=lugs)
    disc = [(0.106, 0.220), (0.110, 0.214), (0.104, 0.206), (0.070, 0.196), (0.052, 0.160), (0.046, 0.118),
            (0.072, 0.100), (0.088, 0.084), (0.092, 0.056), (0.112, 0.046), (0.118, 0.020), (0.119, 0.0)]
    lathe(mb, disc, 64, "chrome", I)
    barrel = [(0.100, 0.205), (-0.092, 0.200), (-0.100, 0.212), (-0.106, 0.220)]
    lathe(mb, barrel, 48, "rim", I)
    for k in range(10):
        a = 2 * PI * k / 10
        rad = Vector((0, math.sin(a), math.cos(a)))
        tan = Vector((0, math.cos(a), -math.sin(a)))
        c = Vector((0.0585, 0, 0)) + rad * 0.168
        m = frame(c, Vector((1, 0, 0)).lerp(rad, 0.35), tan)
        rbox(mb, (0.006, 0.042, 0.026), "trim_gloss", m, radius=0.012, segments=2)
        n = Vector((0.090, 0, 0)) + rad * 0.070
        cylinder(mb, Matrix.Translation(n), 0.0075, 0.012, "chrome", seg=6, smooth=False)
    return mb


def build_wheel_local():
    if WHEEL_STYLE == "truck":
        return build_truck_wheel_local()
    mb = MB()
    I = Matrix.Identity(4)
    prof = tyre_profile()
    tread_idx = {k for k, (ax, r) in enumerate(prof) if r >= R_TYRE - 0.0085 and abs(ax) < 0.09}

    def sipes(k, s, ax, r):
        # Tread blocks: alternate segments sit a little lower between the grooves.
        if r >= R_TYRE - 0.0001 and abs(ax) < 0.085 and (s // 2) % 2 == 1:
            return r - 0.0035
        return r

    lathe(mb, prof, 72, "tyre", I, smooth=True, flat_from=lambda k: k in tread_idx and (k + 1) in tread_idx, mods=sipes)

    # Rim: outer lip, barrel (seen between spokes), inner flange.
    rim = [(0.108, 0.261), (0.116, 0.257), (0.117, 0.248), (0.110, 0.241), (0.096, 0.236), (-0.092, 0.232),
           (-0.100, 0.244), (-0.106, 0.256)]
    lathe(mb, rim, 72, "rim", I)
    # Hub boss with a flat face for the nuts and a plain centre cap.
    hub = [(0.050, 0.082), (0.088, 0.080), (0.095, 0.073), (0.097, 0.040), (0.100, 0.036), (0.101, 0.024), (0.1015, 0.0)]
    lathe(mb, hub, 40, "rim", I)
    for k in range(5):
        a = 2 * PI * k / 5 + PI / 5
        c = Vector((0.096, 0.056 * math.sin(a), 0.056 * math.cos(a)))
        cylinder(mb, Matrix.Translation(c), 0.0075, 0.009, "chrome", seg=6, smooth=False)
    # Ten spokes in five pairs, dished toward the centre.
    groups, half = SPOKES
    for k in range(groups):
        for off in ((-half, half) if half > 0 else (0.0,)):
            spoke(mb, 2 * PI * k / groups + off, SPOKE_TWIST)
            if SPOKE_CROSS:
                spoke(mb, 2 * PI * k / groups + off, -SPOKE_TWIST)
    if AERO_DISC:
        lathe(mb, [(0.080, 0.098), (0.084, 0.150), (0.086, 0.205), (0.090, 0.234), (0.084, 0.237)], 64, AERO_DISC, I)
    # Brake disc with its hat.
    disc = [(-0.036, 0.097), (-0.036, 0.190), (-0.008, 0.190), (-0.008, 0.100), (0.012, 0.086), (0.020, 0.080),
            (0.020, 0.030)]
    lathe(mb, disc, 64, "brake_disc", I)
    return mb


def spoke(mb, phi0, twist=0.0):
    stations = [0.070, 0.098, 0.130, 0.162, 0.194, 0.222, 0.244]
    ring = []
    for r in stations:
        u = (r - 0.07) / 0.174
        phi = phi0 + twist * u
        rad = Vector((0, math.sin(phi), math.cos(phi)))
        tan = Vector((0, math.cos(phi), -math.sin(phi)))
        w = 0.040 - 0.012 * u
        front = 0.098 - 0.010 * math.sin(PI * min(u, 1)) + 0.010 * u * u
        depth = 0.026 - 0.010 * u
        back = front - depth
        sec = [(-w / 2, back), (-w / 2, front - 0.005), (-w / 2 + 0.005, front), (w / 2 - 0.005, front),
               (w / 2, front - 0.005), (w / 2, back)]
        ring.append([Vector((ax, 0, 0)) + rad * r + tan * t for t, ax in sec])
    for m in range(5):
        base = len(mb.v)
        for pts in ring:
            mb.v.append(tuple(pts[m]))
            mb.v.append(tuple(pts[m + 1]))
        for s in range(len(stations) - 1):
            a, b = base + 2 * s, base + 2 * s + 1
            mb.face([a, b, b + 2, a + 2], "rim", True)


def build_caliper_local():
    mb = MB()
    # Swept block hugging the disc rim, rear-upper quadrant.
    prof = [(-0.050, 0.146), (0.024, 0.146), (0.028, 0.154), (0.028, 0.214), (0.020, 0.221), (-0.046, 0.221),
            (-0.054, 0.214), (-0.054, 0.154)]
    seg = 10
    a0, a1 = 0.35, 1.25
    verts = []
    for s in range(seg + 1):
        a = a0 + (a1 - a0) * s / seg
        for ax, r in prof:
            verts.append(Vector((ax, r * math.sin(a), r * math.cos(a))))
    n = len(prof)
    faces = []
    for s in range(seg):
        for k in range(n):
            k1 = (k + 1) % n
            faces.append([s * n + k, (s + 1) * n + k, (s + 1) * n + k1, s * n + k1])
    faces.append(list(range(n))[::-1])
    faces.append([seg * n + k for k in range(n)])
    mb.raw(verts, faces, "caliper", False)
    return mb


def place_local(local, target, origin, side):
    """Copy a left-hand local mesh into a world builder, mirrored for the right side."""
    mb = OUT[target]
    base = len(mb.v)
    kr, ka = TYRE_SCALE
    for v in local.v:
        mb.v.append((origin[0] + side * v[0] * ka, origin[1] + v[1] * kr, origin[2] + v[2] * kr))
    for f, m, s in zip(local.f, local.fm, local.sm):
        ids = [base + i for i in f]
        mb.face(ids if side > 0 else ids[::-1], m, s)


def build_wheels():
    wheel = build_wheel_local()
    cal = build_caliper_local()
    for (wy, wz), axle in zip(WHEELS, ("front", "rear")):
        for side in (1, -1):
            place_local(wheel, f"wheel-{axle}-{'left' if side > 0 else 'right'}", (side * WHEEL_X, wy, wz), side)
            if DUAL_REAR and axle == "rear":
                place_local(wheel, f"wheel-{axle}-{'left' if side > 0 else 'right'}",
                            (side * (WHEEL_X - DUAL_REAR), wy, wz), side)
            place_local(cal, f"brake-caliper-{axle}-{'left' if side > 0 else 'right'}", (side * WHEEL_X, wy, wz), side)


# ---------------------------------------------------------------------------------------------
# Mirrors, handles, wipers
# ---------------------------------------------------------------------------------------------
def build_mirrors():
    if TRUCK_MIRRORS:
        for side in (1, -1):
            mb = OUT[side_name("mirror", side)]
            my, mz = MIRROR_AT
            p = body_point(my, "q", mz)
            base = Vector((side * (p.x + 0.01), my, mz))
            arm_end = base + Vector((side * 0.26, -0.10, 0.10))
            d = arm_end - base
            rbox(mb, (d.length, 0.035, 0.035), "trim_gloss", frame(base + d * 0.5, d, Vector((0, 0, 1))), radius=0.01)
            for dz in (0.30, -0.22):
                rbox(mb, (0.03, 0.03, abs(dz)), "trim_gloss", Matrix.Translation(arm_end + Vector((0, 0, dz / 2))), radius=0.0)
            head = arm_end + Vector((side * 0.06, 0.0, 0.10))
            rbox(mb, (0.20, 0.09, 0.40), "trim_gloss", Matrix.Translation(head), radius=0.03, segments=2)
            rbox(mb, (0.17, 0.006, 0.34), "mirror_face", Matrix.Translation(head + Vector((0, 0.048, 0))), radius=0.02)
            low = arm_end + Vector((side * 0.06, 0.0, -0.26))
            rbox(mb, (0.18, 0.08, 0.15), "trim_gloss", Matrix.Translation(low), radius=0.03, segments=2)
            rbox(mb, (0.15, 0.006, 0.11), "mirror_face", Matrix.Translation(low + Vector((0, 0.043, 0))), radius=0.02)
            rbox(mb, (0.03, 0.10, 0.03), "indicator_left" if side > 0 else "indicator_right",
                 Matrix.Translation(head + Vector((side * 0.085, -0.02, -0.16))), radius=0.008)
        return
    for side in (1, -1):
        mb = OUT[side_name("mirror", side)]
        if MIRROR_AT:
            my, mz = MIRROR_AT
            belt = body_point(my, "q", mz)
        else:
            my = Y_A + 0.26
            belt = body_point(my, "th", 0.50)
        base = Vector((side * (belt.x + 0.005), my, belt.z + 0.012))
        # Stalk from the door top out to the housing.
        m = frame(base, Vector((side, 0, 0.18)), Vector((0, 1, 0)))
        rbox(mb, (0.09, 0.035, 0.022), "trim_gloss", m @ Matrix.Translation((0.04, 0, 0)), radius=0.008)
        # Housing: rounded, slightly toed-in, painted shell.
        hc = base + Vector((side * 0.12, 0.005, 0.055))
        hm = frame(hc, Vector((side, -0.08, 0)), Vector((0, 1, 0)))
        rbox(mb, (0.19, 0.08, 0.108), "carpaint", hm, radius=0.038, segments=4)
        # Glass on the rear face.
        gm = hm @ Matrix.Translation((0.0, 0.041, 0.0))
        rbox(mb, (0.162, 0.004, 0.084), "mirror_face", gm, radius=0.02, segments=3)
        # Turn-signal repeater along the lower front edge.
        im = hm @ Matrix.Translation((0.03, -0.035, -0.04))
        rbox(mb, (0.12, 0.022, 0.012), "indicator_left" if side > 0 else "indicator_right", im, radius=0.005)


def build_handles():
    for side in (1, -1):
        for part, yr in (("door", DOOR_F[1] - 0.26), ("rear-door", DOOR_R[1] - 0.20)):
            if not Y_FRONT < yr < Y_REAR:
                continue  # no second door on this model
            mb = OUT[object_for(part, side)]
            q = HANDLE_Q
            p = surface_at(yr, q, side, 0.0)
            n = surface_normal(yr, q, side)
            # Flush handle: chrome blade in a gloss-black pocket.
            pocket = frame(p - n * 0.001, n, Vector((0, 1, 0)))
            rbox(mb, (0.006, 0.20, 0.034), "trim_gloss", pocket, radius=0.002, segments=1)
            rbox(mb, (0.006, 0.17, 0.016), "chrome", pocket @ Matrix.Translation((0.003, 0, 0)), radius=0.003, segments=2)


def build_wipers():
    if BOX and WIPER_Y is None:
        return
    trim = OUT["trim"]
    for x0, x1 in ((0.58, -0.02), (-0.05, -0.52)):
        y = WIPER_Y if WIPER_Y is not None else Y_A + 0.055
        pa = body_point(y, "th", 1.0) if BOX else gh_point(y, 1.0)
        z = pa.z + 0.012
        a, b = Vector((x0, y + 0.01, z)), Vector((x1, y + 0.05, z + 0.02))
        d = b - a
        m = frame(a, d, Vector((0, 0, 1)))
        rbox(trim, (d.length, 0.018, 0.012), "trim_black", m @ Matrix.Translation((d.length / 2, 0, 0)), radius=0.004, segments=1)
    if BOX:
        return
    # Driver-assistance camera housing behind the top of the windscreen.
    p = gh_point(Y_HEADER - 0.06, 1.0)
    rbox(OUT["cabin"], (0.16, 0.10, 0.05), "trim_black", Matrix.Translation(p + Vector((0, 0.04, -0.045))), radius=0.012)


# ---------------------------------------------------------------------------------------------
# Interior
# ---------------------------------------------------------------------------------------------
def build_interior(rows, P, N):
    cab = OUT["cabin"]
    # Door cards and side trims: the side wall inside the cabin, offset inward and facing in.
    nc = len(P[0])
    for i in range(len(rows) - 1):
        ym = 0.5 * (rows[i] + rows[i + 1])
        if not (Y_A + 0.05 < ym < Y_C - 0.05):
            continue
        for c in range(nc - 1):
            h, side = band_of(c, NH)
            if h < 6 or h >= BELT_H:
                continue
            cls = classify_body(ym, h)
            part = cls[0] if cls else "body"
            target = OUT[object_for(part, side)] if part in ("door", "rear-door") else cab
            quad = [(i, c), (i, c + 1), (i + 1, c + 1), (i + 1, c)]
            d = 0.07 if h < 20 else 0.05
            mat = "interior" if h > 15 else "interior_dark"
            target.face([target.vert(("card",) + k, P[k[0]][k[1]] - N[k[0]][k[1]] * d) for k in quad], mat)

    first = len(cab.v)
    # Floor and firewall.
    rbox(cab, (1.52, 2.55 if REAR_SEATS else 1.55, 0.03), "interior_dark",
         Matrix.Translation((0, 0.25 if REAR_SEATS else -0.25, 0.30 - min(0.0, INT_DZ))), radius=0.0)
    rbox(cab, (1.50, 0.04, 0.42), "interior_dark", Matrix.Translation((0, -1.05, 0.52)), radius=0.0)
    # Dashboard: long slim upper, lower knee panel, wide floating screen, driver display.
    rbox(cab, (1.52, 0.34, 0.12), "interior", frame(Vector((0, -0.86, 0.88)), Vector((1, 0, 0)), Vector((0, 1, -0.25))),
         radius=0.04, segments=3)
    rbox(cab, (1.48, 0.20, 0.20), "interior_dark", Matrix.Translation((0, -0.80, 0.70)), radius=0.03, segments=2)
    rbox(cab, (1.40, 0.03, 0.03), "chrome", Matrix.Translation((0, -0.69, 0.81)), radius=0.01, segments=2)
    rbox(cab, (0.36, 0.15, 0.02), "screen", frame(Vector((0.02, -0.70, 0.98)), Vector((1, 0, 0)), Vector((0, 0.3, 1))),
         radius=0.012, segments=2)
    rbox(cab, (0.26, 0.09, 0.02), "screen", frame(Vector((0.38, -0.74, 0.97)), Vector((1, 0, 0)), Vector((0, 0.3, 1))),
         radius=0.01, segments=2)
    # Steering wheel: rim, hub, three spokes, column.
    sw_c = Vector((0.38, -0.56, 0.92))
    sw = frame(sw_c, Vector((0, -0.94, 0.34)), Vector((1, 0, 0)))
    torus(cab, sw, 0.18, 0.016, "interior_dark")
    cylinder(cab, sw @ Matrix.Translation((-0.02, 0, 0)), 0.05, 0.035, "interior_dark", seg=20)
    rot = sw.to_3x3()
    for a in (PI / 2, -PI / 2, PI):
        d = rot @ Vector((0, math.cos(a), math.sin(a)))
        m = frame(sw_c + d * 0.10, d, rot @ Vector((1, 0, 0)))
        rbox(cab, (0.14, 0.012, 0.035), "interior_dark", m, radius=0.005, segments=1)
    cylinder(cab, sw @ Matrix.Translation((-0.25, 0, 0)), 0.035, 0.24, "interior_dark", seg=12)
    # Centre console.
    rbox(cab, (0.22, 0.95, 0.24), "interior_dark", Matrix.Translation((0, -0.20, 0.44)), radius=0.03, segments=2)
    rbox(cab, (0.20, 0.30, 0.06), "interior", Matrix.Translation((0, 0.10, 0.60)), radius=0.025, segments=2)
    rbox(cab, (0.14, 0.18, 0.012), "screen", frame(Vector((0, -0.45, 0.575)), Vector((1, 0, 0)), Vector((0, 1, 0.3))),
         radius=0.006, segments=1)
    for x in (0.38, -0.38):
        seat(cab, x, 0.02, 0.44)
    # Rear bench: cushion, back and two headrests.
    rear_from = len(cab.v)
    rbox(cab, (1.30, 0.50, 0.13), "interior", frame(Vector((0, 0.90, 0.42)), Vector((1, 0, 0)), Vector((0, 1, 0.12))),
         radius=0.05, segments=3)
    rbox(cab, (1.30, 0.12, 0.52), "interior", frame(Vector((0, 1.20, 0.72)), Vector((1, 0, 0)), Vector((0, 1, -0.45))),
         radius=0.05, segments=3)
    for x in (0.38, -0.38):
        rbox(cab, (0.24, 0.07, 0.15), "interior", Matrix.Translation((x, 1.32, 1.04)), radius=0.03, segments=2)
    if not REAR_SEATS:
        # Two-seaters: the bench goes; a parcel shelf closes the cabin behind the seats.
        del cab.v[rear_from:]
        keep = [k for k, f in enumerate(cab.f) if max(f) < rear_from]
        cab.f, cab.fm, cab.sm = [cab.f[k] for k in keep], [cab.fm[k] for k in keep], [cab.sm[k] for k in keep]
        rbox(cab, (1.40, 0.30, 0.30), "interior_dark", Matrix.Translation((0, 0.52, 0.50)), radius=0.03, segments=2)
    dy = INT_DY if INT_DY is not None else Y_A + 1.12
    for k in range(first, len(cab.v)):
        x, y, z = cab.v[k]
        y2 = y + (INT_REAR_DY if y > 0.55 else 0.0) + (INT_DASH_DY if y < -0.62 else 0.0)
        cab.v[k] = (x, y2 + dy, z + INT_DZ)
    if OPEN_TOP:
        # The cockpit's edge: a leather cap from the outer belt over to the door cards inside.
        for side in (1, -1):
            for i in range(len(rows) - 1):
                ya, yb = rows[i], rows[i + 1]
                ym = 0.5 * (ya + yb)
                if not (Y_A + 0.02 < ym < Y_C - 0.02):
                    continue
                if in_gap(ym, [DOOR_F[0], DOOR_F[1]]):
                    continue
                # On the door, in its window part (a child of the door, so it swings with it, and
                # without the panel-gap modifier, which spikes on this fold); elsewhere in the cabin.
                mb = OUT[side_name("window", side)] if DOOR_F[0] + GAP < ym < DOOR_F[1] else OUT["cabin"]
                pa, pb = body_point(ya, "th", 0.50), body_point(yb, "th", 0.50)
                quad = []
                for p, inset in ((pa, 0.0), (pa, 0.075), (pb, 0.075), (pb, 0.0)):
                    quad.append(Vector((side * (p.x - inset), p.y, p.z + 0.004 - inset * 0.05)))
                ids = [mb.vert(None, v) for v in quad]
                mb.face(ids if side < 0 else ids[::-1], "interior")


def seat(cab, x, y, z):
    rbox(cab, (0.50, 0.52, 0.12), "interior", frame(Vector((x, y, z)), Vector((1, 0, 0)), Vector((0, 1, 0.10))),
         radius=0.045, segments=3)
    rbox(cab, (0.50, 0.11, 0.62), "interior", frame(Vector((x, y + 0.30, z + 0.33)), Vector((1, 0, 0)), Vector((0, 1, -0.32))),
         radius=0.05, segments=3)
    for s in (1, -1):
        rbox(cab, (0.06, 0.10, 0.50), "interior_dark", frame(Vector((x + s * 0.23, y + 0.27, z + 0.32)), Vector((1, 0, 0)),
                                                             Vector((0, 1, -0.32))), radius=0.025, segments=2)
    rbox(cab, (0.26, 0.08, 0.17), "interior", Matrix.Translation((x, y + 0.42, z + 0.74)), radius=0.035, segments=2)
    rbox(cab, (0.30, 0.42, 0.18), "interior_dark", Matrix.Translation((x, y, z - 0.14)), radius=0.01, segments=1)


def torus(mb, m, R, r, mat, seg=40, tseg=10):
    verts, faces = [], []
    for s in range(seg):
        a = 2 * PI * s / seg
        for t in range(tseg):
            b = 2 * PI * t / tseg
            rr = R + r * math.cos(b)
            verts.append(m @ Vector((r * math.sin(b), rr * math.cos(a), rr * math.sin(a))))
    for s in range(seg):
        for t in range(tseg):
            s1, t1 = (s + 1) % seg, (t + 1) % tseg
            faces.append([s * tseg + t, s1 * tseg + t, s1 * tseg + t1, s * tseg + t1])
    mb.raw(verts, faces, mat, True)


# ---------------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------------
MATS = {
    # name: (base rgb, metallic, roughness, extras)
    "carpaint": (PAINT, 0.70, 0.36, {"coat": 1.0, "coat_rough": 0.03}),
    "glass": ((0.012, 0.016, 0.02), 0.0, 0.02, {"alpha": 0.68}),
    "headlight": ((1, 1, 1), 0.0, 0.1, {"emit": (1.0, 0.97, 0.92), "emit_strength": 6.0}),
    "lamp_lens": ((0.9, 0.93, 1.0), 0.0, 0.0, {"alpha": 0.12}),
    "tail_light": ((0.5, 0.01, 0.01), 0.0, 0.15, {"emit": (1.0, 0.02, 0.01), "emit_strength": 4.0}),
    "tail_lens": ((0.35, 0.005, 0.005), 0.0, 0.02, {"alpha": 0.55}),
    "indicator_left": ((0.95, 0.42, 0.04), 0.0, 0.15, {"emit": (1.0, 0.35, 0.02), "emit_strength": 0.3}),
    "indicator_right": ((0.95, 0.42, 0.04), 0.0, 0.15, {"emit": (1.0, 0.35, 0.02), "emit_strength": 0.3}),
    "reverse_lamp": ((0.85, 0.85, 0.85), 0.0, 0.1, {}),
    "lamp_housing": ((0.10, 0.105, 0.11), 1.0, 0.25, {}),
    "panel_gap": ((0.012, 0.012, 0.014), 0.0, 0.6, {}),
    "paint_white": ((0.86, 0.87, 0.88), 0.2, 0.30, {"coat": 1.0, "coat_rough": 0.03}),
    "taxi_check": ((0.90, 0.90, 0.88), 0.0, 0.35, {}),
    "paint_band": ((0.05, 0.18, 0.55), 0.3, 0.32, {"coat": 1.0, "coat_rough": 0.03}),
    "paint_box": ((0.92, 0.92, 0.91), 0.0, 0.40, {"coat": 0.6, "coat_rough": 0.05}),
    "paint_body": ((0.13, 0.42, 0.20), 0.3, 0.35, {"coat": 0.8, "coat_rough": 0.05}),
    "marker_amber": ((0.95, 0.45, 0.04), 0.0, 0.2, {"emit": (0.6, 0.25, 0.0), "emit_strength": 1.0}),
    "beacon-amber": ((0.95, 0.5, 0.05), 0.0, 0.1, {"emit": (0.25, 0.1, 0.0), "emit_strength": 1.0, "alpha": 0.85}),
    "glass_frosted": ((0.82, 0.86, 0.88), 0.0, 0.45, {"alpha": 0.9}),
    "taxi_sign": ((1.0, 0.92, 0.6), 0.0, 0.3, {"emit": (0.55, 0.45, 0.2), "emit_strength": 1.0}),
    "siren-red": ((0.55, 0.03, 0.03), 0.0, 0.1, {"emit": (0.08, 0.0, 0.0), "emit_strength": 1.0, "alpha": 0.85}),
    "siren-blue": ((0.03, 0.1, 0.6), 0.0, 0.1, {"emit": (0.0, 0.01, 0.1), "emit_strength": 1.0, "alpha": 0.85}),
    "trim_black": ((0.022, 0.022, 0.024), 0.0, 0.55, {}),
    "trim_gloss": ((0.008, 0.008, 0.009), 0.0, 0.07, {"coat": 0.6, "coat_rough": 0.02}),
    "chrome": ((0.78, 0.79, 0.80), 1.0, 0.18, {}),
    "rim": ((0.30, 0.31, 0.33), 1.0, 0.30, {"coat": 0.5, "coat_rough": 0.05}),
    "tyre": ((0.028, 0.028, 0.03), 0.0, 0.82, {}),
    "brake_disc": ((0.42, 0.42, 0.43), 1.0, 0.42, {}),
    "caliper": ((0.06, 0.062, 0.066), 0.2, 0.35, {"coat": 0.5, "coat_rough": 0.1}),
    "mirror_face": ((0.9, 0.9, 0.92), 1.0, 0.02, {}),
    "plate_blank": ((0.82, 0.82, 0.80), 0.0, 0.4, {}),
    "underbody": ((0.018, 0.018, 0.02), 0.0, 0.9, {}),
    "interior": ((0.055, 0.045, 0.040), 0.0, 0.6, {}),
    "interior_dark": ((0.022, 0.022, 0.024), 0.0, 0.7, {}),
    "headliner": ((0.11, 0.105, 0.10), 0.0, 0.92, {}),
    "screen": ((0.004, 0.006, 0.01), 0.0, 0.05, {"emit": (0.10, 0.16, 0.25), "emit_strength": 0.6}),
}


def setup_materials():
    out = {}
    for name, (rgb, metal, rough, ex) in MATS.items():
        if name == "carpaint":
            rgb = PAINT  # the preset's colour (MATS was filled in before the preset applied)
        if name == "paint_band":
            rgb = BAND_COLOUR
        if name == "rim" and RIM:
            rgb, metal, rough = RIM
        if name == "interior" and INTERIOR_COLOUR:
            rgb = INTERIOR_COLOUR
        if name == "paint_body" and PAINT2_COLOUR:
            rgb = PAINT2_COLOUR
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        outn = nt.nodes.new("ShaderNodeOutputMaterial")
        outn.location = (300, 0)
        nt.links.new(bsdf.outputs[0], outn.inputs[0])
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough
        if "coat" in ex:
            bsdf.inputs["Coat Weight"].default_value = ex["coat"]
            bsdf.inputs["Coat Roughness"].default_value = ex["coat_rough"]
        if "emit" in ex:
            bsdf.inputs["Emission Color"].default_value = (*ex["emit"], 1)
            bsdf.inputs["Emission Strength"].default_value = ex["emit_strength"]
        alpha = ex.get("alpha", 1.0)
        bsdf.inputs["Alpha"].default_value = alpha
        if alpha < 1:
            m.surface_render_method = "BLENDED"
            m.use_backface_culling = False
        else:
            m.surface_render_method = "DITHERED"
        m.diffuse_color = (*rgb, alpha)
        m.metallic, m.roughness = metal, rough
        out[name] = m
    # Paint: fine metallic flake through a tiny bump under the clearcoat (render only).
    nt = out["carpaint"].node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 2500.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.04
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return out


# ---------------------------------------------------------------------------------------------
# Commit into the existing objects
# ---------------------------------------------------------------------------------------------
def commit(mats):
    report = {}
    for name, mb in OUT.items():
        ob = bpy.data.objects.get(name)
        if ob is None and name.startswith("brake-caliper"):
            continue  # some models (the police car's steel wheels) have no separate calipers
        if ob is None:
            raise KeyError(f"no object {name}")
        inv = ob.matrix_world.inverted()
        me = bpy.data.meshes.new(name + "_2026")
        me.from_pydata([inv @ Vector(v) for v in mb.v], [], mb.f)
        names = sorted(set(mb.fm))
        for n in names:
            me.materials.append(mats[n])
        idx = {n: k for k, n in enumerate(names)}
        me.polygons.foreach_set("material_index", [idx[n] for n in mb.fm])
        me.polygons.foreach_set("use_smooth", mb.sm)
        me.validate(clean_customdata=False)
        me.update()
        old = ob.data
        ob.data = me
        if old.users == 0:
            bpy.data.meshes.remove(old)
        report[name] = sum(len(p.vertices) - 2 for p in me.polygons)
    # Template parts this design doesn't fill would otherwise keep the old model's geometry.
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob.name not in OUT and not ob.name.startswith("present") and not ob.data.name.endswith("_2026"):
            old = ob.data
            ob.data = bpy.data.meshes.new(ob.name + "_2026")
            if old.users == 0:
                bpy.data.meshes.remove(old)
            report[ob.name] = 0
    return report


def add_panel_rims(mats):
    for name in ["body", "hood", "trunk", "door-left", "door-right", "rear-door-left", "rear-door-right",
                 "side-door-right", "side-door-left", "tailgate"]:
        ob = bpy.data.objects.get(name)
        if ob is None or ob.type != "MESH":
            continue
        # the rim (the panel's edge seen down a gap) takes the last slot: a dark gap material
        ob.data.materials.append(mats["panel_gap"])
        mod = ob.modifiers.get("PanelGapRim") or ob.modifiers.new("PanelGapRim", "SOLIDIFY")
        mod.thickness = 0.018
        mod.offset = -1.0
        mod.use_rim = True
        mod.use_rim_only = True
        # Even thickness spikes on the premium bodies' sharper folds (a cockpit edge, a haunch).
        mod.use_even_offset = EVEN_RIMS
        mod.material_offset_rim = len(ob.data.materials)


def move_pivots():
    """A different wheelbase: wheels, calipers and doors move before anything is built."""
    for name, loc in PIVOTS.items():
        bpy.data.objects[name].location = loc
    bpy.context.view_layer.update()


def build_roof_rails():
    if not ROOF_RAILS:
        return
    trim = OUT["trim"]
    for side in (1, -1):
        pts = []
        for y in frange(Y_HEADER + 0.10, Y_RG - 0.05, 0.08):
            p = gh_point(y, 0.70)
            pts.append(Vector((side * p.x, y, p.z + 0.035)))
        ring = lambda p: [p + Vector((-0.013, 0, 0.011)), p + Vector((0.013, 0, 0.011)),
                          p + Vector((0.013, 0, -0.011)), p + Vector((-0.013, 0, -0.011))]
        for k in range(len(pts) - 1):
            ca, cb = ring(pts[k]), ring(pts[k + 1])
            for m in range(4):
                m1 = (m + 1) % 4
                ids = [trim.vert(("rail", side, k, m), ca[m]), trim.vert(("rail", side, k + 1, m), cb[m]),
                       trim.vert(("rail", side, k + 1, m1), cb[m1]), trim.vert(("rail", side, k, m1), ca[m1])]
                trim.face(ids if side > 0 else ids[::-1], "chrome", False)
        for p in (pts[0], pts[-1]):
            rbox(trim, (0.06, 0.03, 0.04), "trim_gloss", Matrix.Translation(p + Vector((0, 0, -0.015))), radius=0.008)


def build_truck_chassis():
    """Ladder-frame rails under the body, side guards between the axles, a fuel tank, mud flaps."""
    trim, ub = OUT["trim"], OUT["underbody"]
    (fy, fz), (ry, rz) = WHEELS
    r = R_TYRE * TYRE_SCALE[0]
    rail_top = min(z_bottom(y) for y in frange(fy + 0.8, ry - 0.8, 0.2)) - 0.02
    for x in (-0.45, 0.45):
        rbox(ub, (0.10, Y_REAR - fy - 0.3, 0.24), "underbody", Matrix.Translation((x, 0.5 * (fy + Y_REAR) + 0.1, rail_top - 0.12)),
             radius=0.0)
    for side in ((1, -1) if CHASSIS_GUARDS else ()):
        x = side * (W - 0.02)
        y0, y1 = fy + r + 0.25, ry - r - 0.25
        for z in (0.55, 0.78):
            rbox(trim, (0.04, y1 - y0, 0.07), "chrome", Matrix.Translation((x, 0.5 * (y0 + y1), z)), radius=0.01)
        for y in (y0, 0.5 * (y0 + y1), y1):
            rbox(trim, (0.05, 0.05, 0.30), "trim_black", Matrix.Translation((x - side * 0.03, y, 0.68)), radius=0.0)
    for side in (1, -1):
        rbox(trim, (0.03, 0.42, 0.40), "trim_black", Matrix.Translation((side * WHEEL_X, ry + r + 0.08, 0.32)), radius=0.0)
    tank = frame(Vector((0.70, fy + r + 0.45, 0.68)), Vector((0, 1, 0)), Vector((0, 0, 1)))
    cylinder(trim, tank, 0.24, 0.9, "chrome", seg=24)
    rbox(OUT["bumper-rear"], (2.05, 0.10, 0.12), "trim_black", Matrix.Translation((0, Y_REAR - 0.12, 0.62)), radius=0.02)
    for x in (-0.6, 0.6):
        rbox(OUT["bumper-rear"], (0.08, 0.08, 0.45), "trim_black", Matrix.Translation((x, Y_REAR - 0.15, 0.86)), radius=0.0)


def beacon_bar(node, y, z, width=1.2):
    """Amber work beacons on a black bar across the cab roof ("beacon-amber", which the game lights)."""
    bar = OUT[node]
    rbox(bar, (width, 0.18, 0.05), "trim_gloss", Matrix.Translation((0, y, z + 0.025)), radius=0.015)
    for x in (-width / 2 + 0.1, width / 2 - 0.1):
        rbox(bar, (0.16, 0.16, 0.10), "beacon-amber", Matrix.Translation((x, y, z + 0.10)), radius=0.05, segments=3)
    rbox(bar, (0.40, 0.14, 0.06), "beacon-amber", Matrix.Translation((0, y, z + 0.08)), radius=0.02, segments=2)


def build_service_gear():
    """Utility body lockers, the cab's beacon bar, an aluminium ladder on a rack, a rear step."""
    trim = OUT["trim"]
    top = spline(ZS, 1.6)
    for side in (1, -1):
        for y in (0.95, 1.55, 2.15):
            p = body_point(y, "q", 1.2)
            rbox(trim, (0.012, 0.010, top - 0.82), "trim_gloss", Matrix.Translation((side * (p.x + 0.001), y, 0.5 * (top + 0.78))),
                 radius=0.0)
        for y in (0.65, 1.25, 1.85, 2.45):
            p = body_point(y, "q", 1.30)
            rbox(trim, (0.03, 0.16, 0.04), "chrome", Matrix.Translation((side * (p.x + 0.012), y + 0.02, 1.30)), radius=0.01)
    roof = spline(ZT, 0.05)
    beacon_bar("beacons", 0.05, roof)
    lad = OUT["ladder"]
    y0, y1, z = 0.36, 2.87, 2.24
    for x in (-0.22, 0.22):
        rbox(lad, (0.04, y1 - y0, 0.06), "chrome", Matrix.Translation((x, 0.5 * (y0 + y1), z)), radius=0.008)
    y = y0 + 0.12
    while y < y1 - 0.05:
        cylinder(lad, frame(Vector((-0.22, y, z)), Vector((1, 0, 0)), Vector((0, 0, 1))), 0.012, 0.44, "chrome", seg=8)
        y += 0.28
    for y in (0.40, 2.70):
        base = spline(ZT, y)
        for x in (-0.55, 0.55):
            rbox(trim, (0.04, 0.04, z - base), "trim_black", Matrix.Translation((x, y, 0.5 * (z + base))), radius=0.0)
        rbox(trim, (1.14, 0.05, 0.04), "trim_black", Matrix.Translation((0, y, z - 0.04)), radius=0.0)
    rbox(OUT["bumper-rear"], (1.85, 0.16, 0.10), "trim_black", Matrix.Translation((0, Y_REAR + 0.06, 0.62)), radius=0.02)


def build_tow_gear():
    """Wrecker: frame rails, a headache rack, a boom with cable and hook, a wheel-lift, beacons."""
    trim, ub = OUT["trim"], OUT["underbody"]
    for x in (-0.45, 0.45):
        rbox(ub, (0.10, Y_REAR + 2.2, 0.22), "underbody", Matrix.Translation((x, 0.5 * (Y_REAR - 2.2), 0.80)), radius=0.0)
    deck = spline(ZT, 1.5)
    # Headache rack behind the cab.
    for x in (-0.80, 0.80):
        rbox(trim, (0.07, 0.07, 0.95), "chrome", Matrix.Translation((x, -0.30, deck + 0.47)), radius=0.01)
    rbox(trim, (1.70, 0.07, 0.07), "chrome", Matrix.Translation((0, -0.30, deck + 0.95)), radius=0.01)
    for z in (deck + 0.35, deck + 0.65):
        rbox(trim, (1.60, 0.03, 0.03), "chrome", Matrix.Translation((0, -0.30, z)), radius=0.0)
    # Boom: a base pedestal and two telescoping sections rising over the back.
    base = Vector((0, 0.55, deck))
    rbox(trim, (0.50, 0.50, 0.40), "carpaint", Matrix.Translation(base + Vector((0, 0, 0.20))), radius=0.03)
    root, tip = base + Vector((0, 0.1, 0.38)), Vector((0, 3.55, 2.75))
    d = tip - root
    rbox(trim, (d.length * 0.62, 0.30, 0.26), "carpaint", frame(root + d * 0.31, d, Vector((0, 0, 1))), radius=0.03)
    rbox(trim, (d.length * 0.45, 0.22, 0.19), "chrome", frame(root + d * 0.76, d, Vector((0, 0, 1))), radius=0.02)
    rbox(trim, (0.20, 0.10, 0.20), "trim_black", Matrix.Translation(tip), radius=0.03)
    hook_top = Vector((0, 3.55, 1.75))
    cylinder(trim, frame(tip, hook_top - tip, Vector((1, 0, 0))), 0.008, (hook_top - tip).length, "trim_black", seg=6)
    rbox(trim, (0.05, 0.10, 0.16), "chrome", Matrix.Translation(hook_top + Vector((0, 0, -0.08))), radius=0.02)
    torus(trim, frame(hook_top + Vector((0, 0.02, -0.22)), Vector((1, 0, 0)), Vector((0, 0, 1))), 0.06, 0.014, "chrome", seg=16, tseg=6)
    # Hydraulic ram under the boom.
    ram_a, ram_b = base + Vector((0, 0.25, 0.1)), root + d * 0.45
    cylinder(trim, frame(ram_a, ram_b - ram_a, Vector((1, 0, 0))), 0.05, (ram_b - ram_a).length, "chrome", seg=12)
    # Wheel-lift: an arm out of the back, a crossbar and two L-shaped forks.
    rbox(OUT["bumper-rear"], (0.16, 0.85, 0.12), "trim_black", Matrix.Translation((0, Y_REAR + 0.25, 0.52)), radius=0.02)
    rbox(OUT["bumper-rear"], (1.50, 0.12, 0.10), "carpaint", Matrix.Translation((0, Y_REAR + 0.66, 0.50)), radius=0.02)
    for x in (-0.55, 0.55):
        rbox(OUT["bumper-rear"], (0.10, 0.40, 0.07), "trim_black", Matrix.Translation((x, Y_REAR + 0.86, 0.47)), radius=0.01)
    beacon_bar("beacons", -1.00, spline(ZT, -1.0), width=1.3)


def build_garbage_gear():
    """Refuse truck: ribs down the compactor body, beacons, a bin lifter and riding steps at the back."""
    trim = OUT["trim"]
    for side in (1, -1):
        for y in (-1.6, -0.6, 0.4, 1.4, 2.4):
            p = body_point(y, "q", 2.0)
            rbox(trim, (0.03, 0.07, 3.15 - 1.20), "paint_body", Matrix.Translation((side * (p.x + 0.012), y, 2.17)), radius=0.01)
        p = body_point(0.5, "q", 1.6)
        rbox(trim, (0.025, 5.4, 0.05), "chrome", Matrix.Translation((side * (p.x + 0.02), 0.4, 1.60)), radius=0.01)
    beacon_bar("beacons", -2.75, spline(ZT, -2.9), width=1.6)
    for x in (-0.95, 0.95):
        rbox(OUT["beacons"], (0.16, 0.16, 0.12), "beacon-amber", Matrix.Translation((x, 4.0, spline(ZT, 4.0) + 0.07)),
             radius=0.05, segments=3)
    # Loading opening across the hopper, moving with it.
    back = body_point(Y_REAR - 0.01, "q", 2.0)
    m = frame(Vector((0, back.y - 0.02, 2.0)), Vector((1, 0, 0)), Vector((0, 0, 1)))
    rbox(OUT["tailgate"], (1.95, 0.62, 0.06), "chrome", m, radius=0.03, segments=2)
    rbox(OUT["tailgate"], (1.85, 0.52, 0.07), "trim_gloss", m @ Matrix.Translation((0, 0, -0.01)), radius=0.03, segments=2)
    rear = OUT["bumper-rear"]
    for x in (-0.85, 0.85):
        rbox(rear, (0.42, 0.30, 0.04), "chrome", Matrix.Translation((x, Y_REAR + 0.05, 0.62)), radius=0.01)
        rbox(rear, (0.03, 0.03, 0.75), "chrome", Matrix.Translation((x * 1.18, Y_REAR + 0.02, 1.35)), radius=0.0)
    rbox(rear, (1.20, 0.18, 0.30), "trim_black", Matrix.Translation((0, Y_REAR + 0.10, 0.95)), radius=0.03)
    for x in (-0.40, 0.40):
        rbox(rear, (0.10, 0.25, 0.10), "trim_black", Matrix.Translation((x, Y_REAR + 0.24, 1.10)), radius=0.01)


def build_fire_gear():
    """Fire engine: roller-shutter lockers, a rub rail, light bars, an aerial ladder on a turntable."""
    trim = OUT["trim"]
    for side in (1, -1):
        for y0, y1 in ((-1.85, -0.05), (0.05, 1.75), (3.05, 4.55)):
            p = body_point(0.5 * (y0 + y1), "q", 2.0)
            x = side * (p.x + 0.004)
            rbox(trim, (0.012, y1 - y0, 1.50), "chrome", Matrix.Translation((x, 0.5 * (y0 + y1), 1.92)), radius=0.0)
            z = 1.20
            while z < 2.64:
                rbox(trim, (0.016, y1 - y0 - 0.06, 0.012), "trim_gloss", Matrix.Translation((x + side * 0.004, 0.5 * (y0 + y1), z)),
                     radius=0.0)
                z += 0.075
        p = body_point(0.5, "q", 1.12)
        rbox(trim, (0.03, 6.6, 0.06), "chrome", Matrix.Translation((side * (p.x + 0.02), 1.2, 1.12)), radius=0.01)
    bar = OUT["lightbar"]
    top = spline(ZT, -4.3)
    rbox(bar, (1.90, 0.26, 0.06), "trim_gloss", Matrix.Translation((0, -4.30, top + 0.03)), radius=0.02)
    for k in range(7):
        x = -0.84 + k * 0.28
        rbox(bar, (0.24, 0.22, 0.09), "siren-red" if k % 2 == 0 else "siren-blue", Matrix.Translation((x, -4.30, top + 0.11)),
             radius=0.03, segments=2)
    for x, mat in ((-1.0, "siren-red"), (1.0, "siren-blue")):
        rbox(bar, (0.18, 0.14, 0.12), mat, Matrix.Translation((x, 4.62, spline(ZT, 4.6) + 0.06)), radius=0.04, segments=2)
    lad = OUT["ladder"]
    z = spline(ZT, 0.0) + 0.16
    for x in (-0.42, 0.42):
        rbox(lad, (0.06, 8.2, 0.16), "chrome", Matrix.Translation((x, 0.0, z)), radius=0.01)
        rbox(lad, (0.04, 8.0, 0.10), "chrome", Matrix.Translation((x * 0.82, 0.0, z + 0.14)), radius=0.01)
    y = -4.0
    while y < 4.05:
        cylinder(lad, frame(Vector((-0.42, y, z)), Vector((1, 0, 0)), Vector((0, 0, 1))), 0.015, 0.84, "chrome", seg=8)
        y += 0.32
    turn = Vector((0, 3.6, spline(ZT, 3.6)))
    cylinder(trim, frame(turn, Vector((0, 0, 1)), Vector((1, 0, 0))), 0.55, 0.14, "trim_gloss", seg=32)
    rbox(trim, (0.70, 0.60, 0.20), "carpaint", Matrix.Translation(turn + Vector((0, 0, 0.24))), radius=0.03)
    rbox(OUT["bumper-rear"], (2.10, 0.30, 0.08), "chrome", Matrix.Translation((0, Y_REAR + 0.12, 0.55)), radius=0.01)


def build_cab_details():
    """Truck cab dressing: boarding steps, a sun visor, roof marker lamps, bonnet face, fenders, exhaust."""
    trim = OUT["trim"]
    d = CAB_DETAILS or {}
    for y in d.get("steps", ()):
        for side in (1, -1):
            for z in d.get("step_z", ()):
                p = body_point(y, "q", 1.2)
                x = side * (p.x - 0.10)
                rbox(trim, (0.30, 0.42, 0.05), "trim_black", Matrix.Translation((x, y, z)), radius=0.01)
                rbox(trim, (0.30, 0.012, 0.012), "chrome", Matrix.Translation((x, y - 0.21, z + 0.02)), radius=0.0)
                rbox(trim, (0.03, 0.40, 0.18), "trim_black", Matrix.Translation((side * (p.x - 0.24), y, z + 0.08)), radius=0.0)
    if d.get("visor"):
        y, z, width = d["visor"]
        rbox(trim, (width, 0.32, 0.05), "trim_gloss", frame(Vector((0, y - 0.12, z)), Vector((1, 0, 0)), Vector((0, 1, 0.25))),
             radius=0.02, segments=2)
    if d.get("markers"):
        y, z, width = d["markers"]
        for k in range(5):
            x = -width / 2 + width * k / 4
            rbox(trim, (0.07, 0.05, 0.04), "marker_amber", Matrix.Translation((x, y, z + 0.02)), radius=0.015)
    if BONNET_FRONT:
        lf = OUT["lights-front"]
        gw, gz0, gz1 = BONNET_FRONT["grille"]
        g = body_point(Y_FRONT, "q", 0.5 * (gz0 + gz1))
        gy = g.y - 0.035
        frame_m = frame(Vector((0, gy, 0.5 * (gz0 + gz1))), Vector((1, 0, 0)), Vector((0, 0, 1)))
        rbox(trim, (gw + 0.10, gz1 - gz0 + 0.10, 0.07), "chrome", frame_m, radius=0.04, segments=2)
        rbox(trim, (gw, gz1 - gz0, 0.075), "trim_gloss", frame_m @ Matrix.Translation((0, 0, -0.004)), radius=0.03)
        z = gz0 + 0.05
        while z < gz1 - 0.03:
            rbox(trim, (gw - 0.04, 0.022, 0.03), "chrome", Matrix.Translation((0, gy - 0.045, z)), radius=0.006)
            z += 0.065
        lx, lz, lw, lh = BONNET_FRONT["lamps"]
        for side in (1, -1):
            p = body_point(Y_FRONT + 0.06, "q", lz)
            c = Vector((side * lx, min(p.y, gy + 0.02) - 0.02, lz))
            m = frame(c, Vector((1, 0, 0)), Vector((0, 0, 1)))
            rbox(lf, (lw, lh, 0.10), "lamp_housing", m, radius=0.03, segments=2)
            rbox(lf, (lw - 0.04, lh * 0.38, 0.03), "headlight", m @ Matrix.Translation((0, lh * 0.18, -0.05)), radius=0.012)
            rbox(lf, (lw - 0.04, lh * 0.22, 0.03), "indicator_left" if side > 0 else "indicator_right",
                 m @ Matrix.Translation((0, -lh * 0.26, -0.05)), radius=0.01)
            rbox(lf, (lw, lh, 0.012), "lamp_lens", m @ Matrix.Translation((0, 0, -0.06)), radius=0.03, segments=2)
        rbox(OUT["bumper-front"], (2.0 * W, 0.16, 0.22), "chrome", Matrix.Translation((0, Y_FRONT - 0.04, gz0 - 0.20)),
             radius=0.04, segments=2)
    if FENDERS:
        xi, xo, pad = FENDERS
        wy, wz = WHEELS[0]
        r = ARCH_R + pad
        for side in (1, -1):
            verts, faces = [], []
            seg = 20
            for k in range(seg + 1):
                a = -1.35 + 2.7 * k / seg
                for x, rr in ((xi, r), (xo, r), (xo, r - 0.07)):
                    verts.append(Vector((side * x, wy + rr * math.sin(a), wz + rr * math.cos(a))))
            for k in range(seg):
                for m in range(2):
                    f = [k * 3 + m, (k + 1) * 3 + m, (k + 1) * 3 + m + 1, k * 3 + m + 1]
                    faces.append(f if side < 0 else f[::-1])
            trim.raw(verts, faces, "trim_black", True)
    if EXHAUST:
        x, y, top = EXHAUST
        for side in (1,):
            m = frame(Vector((side * x, y, 1.0)), Vector((0, 0, 1)), Vector((1, 0, 0)))
            cylinder(trim, m, 0.06, top - 1.0, "chrome", seg=16)
            cylinder(trim, m @ Matrix.Translation((0.5, 0, 0)), 0.075, 0.6, "trim_gloss", seg=16, caps=False)


def build_box_details():
    """Box lorry: aluminium corner rails, a rear frame, side skirts and marker lamps."""
    trim = OUT["trim"]
    y0, y1 = PAINT2[0] + 0.08, Y_REAR - 0.02
    top, bottom = spline(ZT, 0.0) - 0.04, z_bottom(0.0) + 0.02
    half = W + (WIDTH_STEP[1] - W if WIDTH_STEP else 0) + 0.005
    for x in (-half, half):
        for z in (top - 0.02, bottom + 0.03):
            rbox(trim, (0.045, y1 - y0, 0.06), "chrome", Matrix.Translation((x, 0.5 * (y0 + y1), z)), radius=0.01)
        for y in (y0, y1 - 0.02):
            rbox(trim, (0.045, 0.06, top - bottom), "chrome", Matrix.Translation((x, y, 0.5 * (top + bottom))), radius=0.01)
        for k in range(5):
            y = y0 + 0.4 + k * (y1 - y0 - 0.8) / 4
            rbox(trim, (0.05, 0.05, 0.04), "marker_amber", Matrix.Translation((x * 1.01, y, bottom + 0.10)), radius=0.012)
    rbox(trim, (2 * half, 0.05, 0.08), "chrome", Matrix.Translation((0, Y_REAR + 0.01, top - 0.02)), radius=0.01)
    for x in (-0.8, -0.4, 0.4, 0.8):
        rbox(trim, (0.06, 0.04, 0.04), "marker_amber" if abs(x) > 0.6 else "tail_light", Matrix.Translation((x, Y_REAR + 0.03, top + 0.03)),
             radius=0.012)
    (fy, _), (ry, _) = WHEELS
    r = R_TYRE * TYRE_SCALE[0]
    for side in (1, -1):
        a, b = fy + r + 0.30, ry - r - 0.25
        rbox(trim, (0.03, b - a, 0.42), "paint_box", Matrix.Translation((side * (half - 0.02), 0.5 * (a + b), bottom - 0.21)),
             radius=0.01)


def build_livery():
    if LIVERY == "taxi":
        # Two rows of black-and-white checks along the flanks, on whichever panel they cross.
        size = 0.055
        for side in (1, -1):
            for row, q in enumerate((0.70, 0.70 + 0.075)):
                y = -1.02
                k = 0
                while y < WHEELS[1][0] - ARCH_R - 0.04:
                    yc = y + size / 2
                    if not any(s0 <= yc <= s0 + GAP + 0.01 for s0 in (DOOR_F[0], DOOR_F[1], DOOR_R[1])):
                        part = "door" if DOOR_F[0] < yc < DOOR_F[1] else "rear-door" if DOOR_R[0] < yc < DOOR_R[1] else "body"
                        mb = OUT[side_name(part, side) if part != "body" else "body"]
                        p = surface_at(yc, q, side, 0.0015)
                        n = surface_normal(yc, q, side)
                        m = frame(p, n, Vector((0, 1, 0)))
                        mat = "taxi_check" if (k + row) % 2 == 0 else "trim_gloss"
                        rbox(mb, (0.002, size, size * 0.98), mat, m, radius=0.0)
                    y += size
                    k += 1
        # Lit roof sign on a slim black base.
        top = gh_point(0.15, 1.0)
        rbox(OUT["trim"], (0.50, 0.16, 0.025), "trim_gloss", Matrix.Translation(top + Vector((0, 0, 0.012))), radius=0.008)
        rbox(OUT["trim"], (0.46, 0.13, 0.12), "taxi_sign", Matrix.Translation(top + Vector((0, 0, 0.085))), radius=0.03,
             segments=3)
    if LIVERY == "ambulance":
        bar = OUT["lightbar"]
        y0 = WIDTH_STEP[0] + 0.12
        top = spline(ZT, y0 + 0.2)
        # Light bar along the front of the box, red and blue segments, and a beacon at each rear corner.
        rbox(bar, (1.70, 0.22, 0.06), "trim_gloss", Matrix.Translation((0, y0, top + 0.03)), radius=0.02)
        for k in range(6):
            x = -0.70 + k * 0.28
            rbox(bar, (0.24, 0.18, 0.08), "siren-red" if k % 2 == 0 else "siren-blue",
                 Matrix.Translation((x, y0, top + 0.10)), radius=0.025, segments=2)
        for side in (1, -1):
            yb = Y_REAR - 0.12
            zb = spline(ZT, yb)
            rbox(bar, (0.18, 0.14, 0.10), "siren-red" if side > 0 else "siren-blue",
                 Matrix.Translation((side * 0.92, yb, zb + 0.05)), radius=0.03, segments=2)
    if LIVERY == "police":
        # Low, wide light bar: black base, red lens on the driver's side, blue on the other.
        top = gh_point(-0.05, 1.0)
        bar = OUT["lightbar"]
        rbox(bar, (1.22, 0.30, 0.05), "trim_gloss", Matrix.Translation(top + Vector((0, 0, 0.03))), radius=0.02, segments=2)
        for side, mat in ((1, "siren-red"), (-1, "siren-blue")):
            rbox(bar, (0.56, 0.26, 0.075), mat, Matrix.Translation(top + Vector((side * 0.30, 0, 0.09))), radius=0.03,
                 segments=3)
        rbox(bar, (0.05, 0.27, 0.07), "chrome", Matrix.Translation(top + Vector((0, 0, 0.09))), radius=0.01)
        # Push bar across the nose.
        trim = OUT["trim"]
        nose = body_point(Y_FRONT, "q", 0.45)
        for x in (-0.32, 0.32):
            rbox(trim, (0.05, 0.16, 0.36), "trim_black", Matrix.Translation((x, nose.y - 0.08, 0.50)), radius=0.015)
        for z in (0.40, 0.62):
            rbox(trim, (0.78, 0.05, 0.05), "trim_black", Matrix.Translation((0, nose.y - 0.14, z)), radius=0.015)


def build_premium_details():
    """Coach line on a two-tone body, a roadster's hoops, a hypercar's wing."""
    if TWO_TONE:
        # A thin chrome line along the colour seam, cut per panel so it opens with the doors.
        step = 0.06
        for side in (1, -1):
            y = WHEELS[0][0] + ARCH_R + 0.05
            while y < WHEELS[1][0] - ARCH_R - 0.05:
                yc = y + step / 2
                if not any(s0 - 0.004 <= yc <= s0 + GAP + 0.03 for s0 in (DOOR_F[0], DOOR_F[1], DOOR_R[1])):
                    part = ("door" if DOOR_F[0] < yc < DOOR_F[1] else
                            "rear-door" if DOOR_R[0] < yc < DOOR_R[1] else "body")
                    mb = OUT[side_name(part, side) if part != "body" else "body"]
                    p = surface_at(yc, TWO_TONE, side, 0.002)
                    n = surface_normal(yc, TWO_TONE, side)
                    rbox(mb, (0.006, step + 0.002, 0.012), "chrome", frame(p, n, Vector((0, 1, 0))), radius=0.0)
                y += step
    if ROLL_HOOPS:
        body = OUT["body"]
        for x in (0.38, -0.38):
            y0 = Y_C - 0.02
            deck = spline(ZT, y0 + 0.4)
            # A teardrop fairing from the hoop back along the deck.
            verts, faces = [], []
            n_ring, n_len = 14, 12
            for i in range(n_len + 1):
                t = i / n_len
                r_w = 0.17 * (1 - t ** 1.6)
                r_h = 0.22 * (1 - t) ** 0.8
                yy = y0 + t * 1.05
                zb = spline(ZT, yy) - 0.02
                for k in range(n_ring + 1):
                    a = PI * k / n_ring
                    verts.append(Vector((x + r_w * math.cos(a), yy, zb + max(r_h, 0.004) * math.sin(a))))
            for i in range(n_len):
                for k in range(n_ring):
                    a0, a1 = i * (n_ring + 1) + k, (i + 1) * (n_ring + 1) + k
                    faces.append([a0, a0 + 1, a1 + 1, a1])
            body.raw(verts, faces, "carpaint", True)
            hoop = frame(Vector((x, y0 + 0.02, deck + 0.02)), Vector((0, 1, 0)), Vector((1, 0, 0)))
            torus(body, hoop @ Matrix.Rotation(PI / 2, 4, "X"), 0.17, 0.018, "chrome", seg=24, tseg=8)
    if REAR_WING:
        wy, wz, span = REAR_WING
        trunk = OUT["trunk"]
        for x in (-span * 0.3, span * 0.3):
            base = Vector((x, wy - 0.05, spline(ZT, wy - 0.05)))
            rbox(trunk, (0.02, 0.16, wz - base.z), "trim_gloss", Matrix.Translation(base + Vector((0, 0.02, (wz - base.z) / 2))),
                 radius=0.005, segments=1)
        blade = frame(Vector((0, wy, wz)), Vector((1, 0, 0)), Vector((0, 1, 0.12)))
        rbox(trunk, (span, 0.30, 0.035), "trim_gloss", blade, radius=0.012, segments=2)
        for x in (-span / 2, span / 2):
            rbox(trunk, (0.012, 0.34, 0.12), "trim_gloss", Matrix.Translation((x, wy + 0.01, wz + 0.02)), radius=0.004, segments=1)


def main():
    apply_preset(PRESET)
    move_pivots()
    ensure_roof_objects()
    OUT.clear()
    rows, P, N, regions = build_skin()
    build_greenhouse(rows)
    build_lamps(P, N, regions)
    build_intake_plate(P, N, regions)
    build_sensors()
    build_underbody(rows)
    build_wheels()
    build_mirrors()
    build_handles()
    build_wipers()
    build_roof_rails()
    build_rear_pane()
    build_livery()
    build_premium_details()
    build_engine_bay()
    build_folding_roof()
    for extra in EXTRAS:
        globals()[extra]()
    build_interior(rows, P, N)
    mats = setup_materials()
    report = commit(mats)
    add_panel_rims(mats)
    return report


PRESETS["taxi"] = dict(LIVERY="taxi", PAINT=(0.86, 0.58, 0.04))
PRESETS["police"] = dict(LIVERY="police", PAINT=(0.012, 0.012, 0.014))

PRESETS["hatch"] = dict(
    Y_FRONT=-2.16, Y_REAR=2.07, Y_MID=0.0, W=0.915, FENDER_BULGE=0.026,
    P_FRONT=4.0, P_REAR=5.0, Y_FS=-1.30, Y_RS=1.30,
    WHEELS=[(-1.35, 0.35), (1.32, 0.35)], WHEEL_X=0.79, ARCH_R=0.40, TYRE_SCALE=(1.015, 1.0),
    N_UP=4.0, N_GH=3.2,
    ZT=[(-2.2, 0.78), (-2.16, 0.80), (-2.05, 0.86), (-1.8, 0.93), (-1.4, 0.98), (-1.05, 1.02), (0.0, 1.04),
        (1.0, 1.06), (1.7, 1.07), (2.0, 1.05), (2.1, 1.02)],
    ZS=[(-2.2, 0.74), (-2.05, 0.80), (-1.7, 0.88), (-1.0, 0.92), (0.5, 0.94), (1.5, 0.95), (2.0, 0.93), (2.1, 0.90)],
    ZB=[(-2.2, 0.40), (-2.12, 0.33), (-1.9, 0.31), (-1.0, 0.32), (1.0, 0.33), (1.8, 0.36), (2.0, 0.40), (2.1, 0.45)],
    ZR=[(-1.05, 1.03), (-0.85, 1.24), (-0.6, 1.43), (-0.42, 1.52), (0.0, 1.575), (0.8, 1.565), (1.4, 1.52),
        (1.75, 1.42), (2.07, 1.34)],
    Y_A=-1.05, Y_C=2.5, Y_HEADER=-0.42, Y_RG=1.40,
    HOOD=(-2.08, -1.09), TRUNK=(9.0, 9.5), DOOR_F=(-0.986, 0.104), DOOR_R=(0.110, 1.060),
    Q=[0, .04, .10, .16, .175, .185, .23, .30, .38, .48, .50, .51, .58, .68, .78, .85, .87, .895, .92, .94, .97, 1.0],
    TAILGATE=(2.00, .50),
    DLO=[(0.075, "window", "glass"), (0.14, "B", "trim_gloss"), (0.98, "rear-window", "glass"),
         (1.06, "rear-door", "trim_gloss"), (1.45, "side-glass", "glass"), (9.0, "body", "carpaint")],
    ROOF_MAT="trim_gloss", RAIL_MAT="trim_gloss", CLADDING=True, TAIL_FLUSH=True,
    LAMP_F_Y=-1.95, LAMP_R_Y=1.85, INTAKE_Y=-2.10, CURTAIN=(-2.06, -1.99),
    ROCKER=(-0.95, 0.92), CHIN_Y=-1.85, DIFF_Y=1.88,
    SPOKES=(6, 0.08), INT_DZ=0.08, INT_REAR_DY=-0.05, PAINT=(0.42, 0.05, 0.04),
)

PRESETS["van"] = dict(
    BOX=True, Y_FRONT=-2.53, Y_REAR=2.53, Y_MID=0.0, W=0.975, FENDER_BULGE=0.018,
    P_FRONT=2.6, P_REAR=10.0, Y_FS=-1.90, Y_RS=2.25,
    WHEELS=[(-1.66, 0.35), (1.62, 0.35)], WHEEL_X=0.86, ARCH_R=0.405, TYRE_SCALE=(1.015, 1.0),
    N_UP=6.0,
    ZT=[(-2.56, 1.06), (-2.50, 1.12), (-2.3, 1.20), (-2.0, 1.25), (-1.85, 1.27), (-1.80, 1.32), (-1.55, 1.80),
        (-1.30, 2.25), (-1.12, 2.42), (-0.95, 2.48), (0.0, 2.50), (2.42, 2.50), (2.53, 2.44)],
    ZS=[(-2.56, 1.00), (-2.50, 1.06), (-2.3, 1.13), (-2.0, 1.18), (-1.85, 1.20), (-1.80, 1.24), (-1.55, 1.70),
        (-1.30, 2.15), (-1.12, 2.32), (-0.95, 2.38), (2.42, 2.40), (2.53, 2.36)],
    ZB=[(-2.56, 0.62), (-2.50, 0.45), (-2.2, 0.42), (0.0, 0.42), (2.3, 0.43), (2.53, 0.52)],
    Q=[0, 0.44, 0.47, 0.48, 0.55, 0.65, 0.75, 0.85, 0.95, 0.985, 1.02, 1.055, 1.12, 1.19, 1.30, 1.45, 1.60, 1.75,
       1.85, 1.95, 1.96, 2.05, 2.15, 2.25, 2.32, 9.0],
    Y_A=9.0, Y_C=-9.0, Y_HEADER=-9.0, Y_RG=9.0, WS=(-1.82, -1.28),
    HOOD=(-2.48, -1.86), TRUNK=(9.0, 9.5), DOOR_F=(-1.86, -0.98), DOOR_R=(-0.94, 0.40), DOOR_Z=(0.47, 1.95),
    SIDE_DOOR_NODE={1: None, -1: "side-door-right"},
    WINDOWS=[(-1.80, -1.03, 1.19, 1.85, "window", "glass")],
    BUMPER=(0.12, 0.65, 0.12, 0.60), ROCKER_Z=0.55, BAND=(0.85, 0.95), REAR_PANE=(1.40, 1.62, 2.12),
    LAMP_BANDS=(0.95, 0.985, 1.02), LAMP_MODULE_Q=1.0, LAMP_F_Y=-2.30, LAMP_R_Y=2.30,
    INTAKE_Y=-2.40, INTAKE_Q=(0.65, 0.85), BLADES=(0.70, 0.78), CURTAIN=(9.0, 9.0),
    ROCKER=(9.0, 9.0), CHIN_Y=-9.0, DIFF_Y=9.0, FINS=False, PLATE_Q=0.72, SENSOR_Q=(0.58, 0.54),
    HANDLE_Q=1.08, MIRROR_AT=(-1.74, 1.30), WIPER_Y=-1.78, INT_DY=-1.12, INT_DZ=0.42, INT_DASH_DY=0.25,
    SPOKES=(6, 0.0), PAINT=(0.88, 0.88, 0.89), ROOF_MAT="carpaint",
)

PRESETS["ambulance"] = dict(
    BOX=True, LIVERY="ambulance", Y_FRONT=-3.27, Y_REAR=3.27, Y_MID=0.0, W=0.975, FENDER_BULGE=0.018,
    WIDTH_STEP=(-1.62, 1.12, 0.08),
    P_FRONT=2.6, P_REAR=10.0, Y_FS=-2.64, Y_RS=2.95,
    WHEELS=[(-2.42, 0.37), (1.75, 0.37)], WHEEL_X=0.88, ARCH_R=0.43, TYRE_SCALE=(1.072, 1.05),
    N_UP=6.0,
    ZT=[(-3.30, 1.06), (-3.24, 1.12), (-3.04, 1.20), (-2.74, 1.25), (-2.59, 1.27), (-2.54, 1.32), (-2.29, 1.80),
        (-2.04, 2.25), (-1.86, 2.42), (-1.70, 2.46), (-1.62, 2.47), (-1.55, 3.0), (-1.45, 3.05), (3.15, 3.05),
        (3.27, 3.0)],
    ZS=[(-3.30, 1.00), (-3.24, 1.06), (-3.04, 1.13), (-2.74, 1.18), (-2.59, 1.20), (-2.54, 1.24), (-2.29, 1.70),
        (-2.04, 2.15), (-1.86, 2.32), (-1.70, 2.37), (-1.62, 2.38), (-1.55, 2.92), (-1.45, 2.97), (3.15, 2.97),
        (3.27, 2.92)],
    ZB=[(-3.30, 0.62), (-3.24, 0.46), (-2.9, 0.43), (0.0, 0.45), (3.0, 0.50), (3.27, 0.58)],
    Q=[0, 0.44, 0.47, 0.48, 0.55, 0.65, 0.75, 0.78, 0.79, 0.85, 0.95, 0.985, 1.02, 1.055, 1.12, 1.19, 1.30, 1.45,
       1.60, 1.75, 1.85, 1.94, 1.95, 1.96, 2.05, 2.15, 2.25, 2.38, 2.45, 2.55, 2.64, 2.65, 2.75, 2.85, 9.0],
    Y_A=9.0, Y_C=-9.0, Y_HEADER=-9.0, Y_RG=9.0, WS=(-2.56, -2.02),
    HOOD=(-3.22, -2.60), TRUNK=(9.0, 9.5), DOOR_F=(-2.60, -1.72), DOOR_R=(-0.73, 0.13),
    DOOR_Z=(0.47, 1.95), DOOR_R_Z=(0.78, 2.64),
    SIDE_DOOR_NODE={1: None, -1: "side-door-right"},
    WINDOWS=[(-2.55, -1.78, 1.19, 1.85, "window", "glass"), (-0.55, 1.28, 1.94, 2.38, "side-glass", "glass_frosted")],
    BUMPER=(0.12, 0.65, 0.15, 0.62), ROCKER_Z=0.55, BAND=(1.12, 1.30), BAND_COLOUR=(0.62, 0.03, 0.03),
    REAR_PANE=(1.20, 2.05, 2.47),
    LAMP_BANDS=(0.95, 0.985, 1.02), LAMP_MODULE_Q=1.0, LAMP_F_Y=-3.04, LAMP_R_Y=3.04,
    INTAKE_Y=-3.14, INTAKE_Q=(0.65, 0.85), BLADES=(0.70, 0.78), CURTAIN=(9.0, 9.0),
    ROCKER=(9.0, 9.0), CHIN_Y=-9.0, DIFF_Y=9.0, FINS=False, PLATE_Q=0.72, SENSOR_Q=(0.58, 0.56),
    HANDLE_Q=1.08, MIRROR_AT=(-2.48, 1.30), WIPER_Y=-2.52, INT_DY=-1.86, INT_DZ=0.42, INT_DASH_DY=0.25,
    SPOKES=(6, 0.0), PAINT=(0.90, 0.90, 0.90), ROOF_MAT="carpaint",
)

PRESETS["truck"] = dict(
    BOX=True, Y_FRONT=-4.84, Y_REAR=4.84, Y_MID=0.0, W=1.05, FENDER_BULGE=0.0,
    WIDTH_STEP=(-3.0, 1.11, 0.05),
    P_FRONT=6.0, P_REAR=14.0, Y_FS=-4.40, Y_RS=4.60,
    WHEELS=[(-3.95, 0.5), (2.30, 0.5)], WHEEL_X=0.90, ARCH_R=0.56, TYRE_SCALE=(1.45, 1.24), DUAL_REAR=0.33,
    N_UP=6.0,
    ZT=[(-4.86, 2.80), (-4.80, 2.90), (-4.55, 2.97), (-4.0, 3.22), (-3.4, 3.52), (-3.0, 3.63), (-2.9, 3.66),
        (4.78, 3.66), (4.84, 3.60)],
    ZS=[(-4.86, 2.72), (-4.80, 2.82), (-4.55, 2.88), (-4.0, 3.12), (-3.4, 3.44), (-3.0, 3.56), (-2.9, 3.60),
        (4.78, 3.60), (4.84, 3.55)],
    ROW_STEP=0.12, FINE_TO=-2.8,
    ZB=[(-4.86, 0.95), (-4.80, 0.80), (-3.2, 0.80), (-3.05, 1.10), (4.84, 1.10)],
    Q=[0, 0.82, 0.90, 1.02, 1.03, 1.10, 1.14, 1.18, 1.22, 1.30, 1.40, 1.52, 1.64, 1.75, 1.85, 1.98, 2.10, 2.25,
       2.40, 2.52, 2.62, 2.70, 2.71, 2.80, 2.95, 3.10, 3.30, 3.45, 3.55, 9.0],
    Y_A=9.0, Y_C=-9.0, Y_HEADER=-9.0, Y_RG=9.0, WS=(9.0, 9.0),
    HOOD=(9.0, 9.5), TRUNK=(9.0, 9.5), DOOR_F=(-4.44, -2.90), DOOR_R=(9.0, 9.5), DOOR_Z=(1.02, 2.70),
    SIDE_DOOR_NODE={},
    WINDOWS=[(-9.0, -4.70, 1.98, 2.80, "windscreen-glass", "glass"), (-4.38, -2.96, 1.98, 2.62, "window", "glass")],
    BUMPER=(0.14, 1.02, 0.0, 0.0), ROCKER_Z=0.0, PAINT2=(-3.0, "paint_box"), REAR_SEAM=True,
    LAMP_BANDS=(1.10, 1.14, 1.18), LAMP_MODULE_Q=1.16, LAMP_F_Y=-4.62, LAMP_R_Y=4.70,
    INTAKE_Y=-4.76, INTAKE_Q=(1.30, 1.75), BLADES=(1.40, 1.52, 1.64), BLADE_MAT="chrome", CURTAIN=(9.0, 9.0),
    ROCKER=(9.0, 9.0), CHIN_Y=-9.0, DIFF_Y=9.0, FINS=False, PLATE_Q=1.30, SENSOR_Q=(0.95, 1.20),
    HANDLE_Q=1.60, MIRROR_AT=(-4.35, 2.10), WIPER_Y=None, INT_DY=-3.67, INT_DZ=0.95, INT_DASH_DY=0.25,
    SPOKES=(8, 0.0), PAINT=(0.08, 0.22, 0.50), ROOF_MAT="carpaint", EXTRAS=("build_truck_chassis",),
)

PRESETS["service"] = dict(
    BOX=True, Y_FRONT=-2.78, Y_REAR=2.73, Y_MID=0.0, W=1.0, FENDER_BULGE=0.0,
    P_FRONT=4.0, P_REAR=12.0, Y_FS=-2.30, Y_RS=2.50,
    WHEELS=[(-1.92, 0.40), (1.62, 0.40)], WHEEL_X=0.86, ARCH_R=0.46, TYRE_SCALE=(1.16, 1.08),
    N_UP=6.0,
    ZT=[(-2.80, 1.20), (-2.74, 1.30), (-2.5, 1.36), (-1.6, 1.40), (-1.55, 1.42), (-1.30, 1.75), (-1.10, 2.02),
        (-0.95, 2.08), (0.40, 2.09), (0.46, 2.06), (0.52, 1.78), (0.60, 1.75), (2.68, 1.75), (2.74, 1.70)],
    ZS=[(-2.80, 1.12), (-2.74, 1.22), (-2.5, 1.28), (-1.6, 1.32), (-1.55, 1.36), (-1.30, 1.68), (-1.10, 1.95),
        (-0.95, 2.00), (0.40, 2.01), (0.46, 1.98), (0.52, 1.70), (0.60, 1.68), (2.68, 1.68), (2.74, 1.63)],
    ZB=[(-2.80, 0.70), (-2.72, 0.55), (-2.3, 0.55), (0.4, 0.58), (0.6, 0.70), (2.73, 0.72)],
    Q=[0, 0.55, 0.65, 0.72, 0.76, 0.77, 0.85, 0.95, 1.00, 1.04, 1.08, 1.12, 1.20, 1.30, 1.38, 1.50, 1.62, 1.70,
       1.84, 1.89, 1.90, 1.95, 9.0],
    Y_A=9.0, Y_C=-9.0, Y_HEADER=-9.0, Y_RG=9.0, WS=(-1.56, -1.09),
    HOOD=(-2.72, -1.58), TRUNK=(9.0, 9.5), DOOR_F=(-1.58, -0.45), DOOR_R=(-0.43, 0.35), DOOR_Z=(0.76, 1.89),
    WINDOWS=[(-1.50, -0.50, 1.30, 1.84, "window", "glass"), (-0.38, 0.30, 1.38, 1.84, "rear-window", "glass")],
    PANES=[(0.47, 1.10, 1.80, 2.01, "rear-glass")],
    BUMPER=(0.10, 0.75, 0.0, 0.0), ROCKER_Z=0.62,
    LAMP_BANDS=(1.00, 1.04, 1.08), LAMP_MODULE_Q=1.06, LAMP_F_Y=-2.60, LAMP_R_Y=2.62,
    INTAKE_Y=-2.66, INTAKE_Q=(0.72, 0.95), BLADES=(0.78, 0.86), BLADE_MAT="chrome", CURTAIN=(9.0, 9.0),
    ROCKER=(9.0, 9.0), CHIN_Y=-9.0, DIFF_Y=9.0, FINS=False, PLATE_Q=0.95, SENSOR_Q=(0.65, 0.85),
    HANDLE_Q=1.30, MIRROR_AT=(-1.48, 1.50), WIPER_Y=-1.52, INT_DY=-0.82, INT_DZ=0.41, INT_DASH_DY=0.25,
    SPOKES=(6, 0.0), PAINT=(0.86, 0.48, 0.07), ROOF_MAT="carpaint", EXTRAS=("build_service_gear",),
)

PRESETS["tow"] = dict(
    BOX=True, Y_FRONT=-3.30, Y_REAR=3.22, Y_MID=0.0, W=1.10, FENDER_BULGE=0.0,
    P_FRONT=4.0, P_REAR=14.0, Y_FS=-2.80, Y_RS=3.00,
    WHEELS=[(-2.38, 0.45), (1.75, 0.45)], WHEEL_X=0.95, ARCH_R=0.50, TYRE_SCALE=(1.30, 1.16), DUAL_REAR=0.30,
    N_UP=6.0, ROW_STEP=0.08,
    ZT=[(-3.30, 1.42), (-3.24, 1.52), (-3.0, 1.60), (-1.85, 1.66), (-1.80, 1.70), (-1.55, 2.20), (-1.35, 2.55),
        (-1.15, 2.62), (-0.55, 2.63), (-0.48, 2.58), (-0.42, 1.52), (-0.35, 1.48), (3.15, 1.48), (3.22, 1.44)],
    ZS=[(-3.30, 1.34), (-3.24, 1.44), (-3.0, 1.52), (-1.85, 1.58), (-1.80, 1.62), (-1.55, 2.12), (-1.35, 2.46),
        (-1.15, 2.54), (-0.55, 2.55), (-0.48, 2.50), (-0.42, 1.44), (-0.35, 1.40), (3.15, 1.40), (3.22, 1.36)],
    ZB=[(-3.30, 0.95), (-3.22, 0.70), (-2.0, 0.70), (-0.4, 0.72), (-0.3, 0.95), (3.22, 0.95)],
    Q=[0, 0.70, 0.80, 0.89, 0.90, 0.95, 1.05, 1.20, 1.24, 1.28, 1.32, 1.40, 1.55, 1.70, 1.85, 2.00, 2.10, 2.25,
       2.32, 2.33, 2.45, 9.0],
    Y_A=9.0, Y_C=-9.0, Y_HEADER=-9.0, Y_RG=9.0, WS=(-1.80, -1.33),
    HOOD=(-3.22, -1.82), TRUNK=(9.0, 9.5), DOOR_F=(-1.81, -0.60), DOOR_R=(9.0, 9.5), DOOR_Z=(0.89, 2.32),
    SIDE_DOOR_NODE={},
    WINDOWS=[(-1.75, -0.66, 1.70, 2.25, "window", "glass")],
    PANES=[(-0.47, 1.20, 1.99, 2.43, "rear-glass")],
    BUMPER=(0.10, 0.95, 0.0, 0.0), ROCKER_Z=0.80,
    LAMP_BANDS=(1.20, 1.24, 1.28), LAMP_MODULE_Q=1.26, LAMP_F_Y=-3.08, LAMP_R_Y=3.10,
    INTAKE_Y=-3.15, INTAKE_Q=(0.80, 1.15), BLADES=(0.88, 0.98, 1.08), BLADE_MAT="chrome", CURTAIN=(9.0, 9.0),
    ROCKER=(9.0, 9.0), CHIN_Y=-9.0, DIFF_Y=9.0, FINS=False, PLATE_Q=1.05, SENSOR_Q=(0.85, 1.05),
    HANDLE_Q=1.55, MIRROR_AT=(-1.73, 1.80), WIPER_Y=-1.77, INT_DY=-0.97, INT_DZ=0.52, INT_DASH_DY=0.25,
    SPOKES=(8, 0.0), PAINT=(0.55, 0.06, 0.04), ROOF_MAT="carpaint", EXTRAS=("build_tow_gear",),
)

PRESETS["garbage"] = dict(
    BOX=True, Y_FRONT=-4.30, Y_REAR=4.40, Y_MID=0.0, W=1.20, FENDER_BULGE=0.0,
    WIDTH_STEP=(-2.45, 1.25, 0.05),
    P_FRONT=6.0, P_REAR=10.0, Y_FS=-3.90, Y_RS=4.05,
    WHEELS=[(-3.30, 0.5), (1.90, 0.5)], WHEEL_X=1.0, ARCH_R=0.56, TYRE_SCALE=(1.45, 1.24), DUAL_REAR=0.34,
    N_UP=6.0, ROW_STEP=0.12, FINE_TO=-2.3,
    ZT=[(-4.32, 2.62), (-4.26, 2.72), (-4.0, 2.78), (-2.55, 2.80), (-2.45, 3.28), (-2.35, 3.35), (3.10, 3.35),
        (3.25, 3.30), (4.10, 3.22), (4.40, 3.00)],
    ZS=[(-4.32, 2.55), (-4.26, 2.65), (-4.0, 2.70), (-2.55, 2.72), (-2.45, 3.20), (-2.35, 3.27), (3.10, 3.27),
        (3.25, 3.22), (4.10, 3.12), (4.40, 2.90)],
    ZB=[(-4.32, 0.80), (-4.26, 0.68), (-2.6, 0.70), (-2.45, 1.12), (3.20, 1.12), (3.35, 1.15), (4.40, 1.30)],
    Q=[0, 0.68, 0.75, 0.82, 0.83, 0.95, 1.02, 1.12, 1.22, 1.30, 1.36, 1.40, 1.44, 1.48, 1.62, 1.80, 2.00, 2.15,
       2.30, 2.47, 2.48, 2.60, 2.75, 2.95, 3.10, 3.20, 9.0],
    Y_A=9.0, Y_C=-9.0, Y_HEADER=-9.0, Y_RG=9.0, WS=(9.0, 9.0),
    HOOD=(9.0, 9.5), TRUNK=(9.0, 9.5), DOOR_F=(-3.89, -2.45), DOOR_R=(9.0, 9.5), DOOR_Z=(0.82, 2.47),
    SIDE_DOOR_NODE={},
    WINDOWS=[(-9.0, -4.12, 1.62, 2.60, "windscreen-glass", "glass"), (-3.83, -2.51, 1.62, 2.30, "window", "glass")],
    BUMPER=(0.12, 0.82, 0.0, 0.0), ROCKER_Z=0.0,
    PAINT2=(-2.45, "paint_body"), PAINT2_COLOUR=(0.06, 0.28, 0.12), REAR_SECTION=(3.22, "tailgate", "paint_body"),
    LAMP_BANDS=(1.36, 1.40, 1.44), LAMP_MODULE_Q=1.42, LAMP_F_Y=-4.12, LAMP_R_Y=4.30,
    INTAKE_Y=-4.22, INTAKE_Q=(0.95, 1.30), BLADES=(1.02, 1.12, 1.22), BLADE_MAT="chrome", CURTAIN=(9.0, 9.0),
    ROCKER=(9.0, 9.0), CHIN_Y=-9.0, DIFF_Y=9.0, FINS=False, PLATE_Q=1.62, SENSOR_Q=(0.75, 1.48),
    HANDLE_Q=1.40, MIRROR_AT=(-3.80, 1.75), WIPER_Y=None, INT_DY=-3.12, INT_DZ=0.48, INT_DASH_DY=0.25,
    SPOKES=(8, 0.0), PAINT=(0.90, 0.90, 0.88), ROOF_MAT="carpaint",
    EXTRAS=("build_truck_chassis", "build_garbage_gear"),
)

PRESETS["fire"] = dict(
    BOX=True, Y_FRONT=-4.79, Y_REAR=4.77, Y_MID=0.0, W=1.20, FENDER_BULGE=0.0,
    WIDTH_STEP=(-2.05, 1.24, 0.05),
    P_FRONT=6.0, P_REAR=14.0, Y_FS=-4.35, Y_RS=4.55,
    WHEELS=[(-3.85, 0.5), (2.40, 0.5)], WHEEL_X=1.0, ARCH_R=0.56, TYRE_SCALE=(1.45, 1.24), DUAL_REAR=0.34,
    N_UP=6.0, ROW_STEP=0.12, FINE_TO=-1.9,
    ZT=[(-4.79, 2.70), (-4.73, 2.80), (-4.5, 2.86), (4.70, 2.88), (4.77, 2.82)],
    ZS=[(-4.79, 2.62), (-4.73, 2.72), (-4.5, 2.78), (4.70, 2.80), (4.77, 2.74)],
    ZB=[(-4.79, 0.85), (-4.73, 0.72), (-2.12, 0.72), (-1.97, 1.05), (4.77, 1.05)],
    Q=[0, 0.72, 0.80, 0.87, 0.88, 1.00, 1.10, 1.14, 1.18, 1.22, 1.25, 1.35, 1.45, 1.55, 1.65, 1.70, 1.85, 2.00,
       2.15, 2.30, 2.42, 2.56, 2.57, 2.68, 9.0],
    Y_A=9.0, Y_C=-9.0, Y_HEADER=-9.0, Y_RG=9.0, WS=(9.0, 9.0),
    HOOD=(9.0, 9.5), TRUNK=(9.0, 9.5), DOOR_F=(-4.40, -3.34), DOOR_R=(-3.30, -2.09), DOOR_Z=(0.87, 2.56),
    WINDOWS=[(-9.0, -4.62, 1.70, 2.68, "windscreen-glass", "glass"), (-4.35, -3.40, 1.70, 2.42, "window", "glass"),
             (-3.24, -2.15, 1.70, 2.42, "rear-window", "glass")],
    BUMPER=(0.12, 0.87, 0.0, 0.0), ROCKER_Z=0.0,
    LAMP_BANDS=(1.10, 1.14, 1.18), LAMP_MODULE_Q=1.16, LAMP_F_Y=-4.60, LAMP_R_Y=4.65,
    INTAKE_Y=-4.68, INTAKE_Q=(1.25, 1.65), BLADES=(1.32, 1.42, 1.52), BLADE_MAT="chrome", CURTAIN=(9.0, 9.0),
    ROCKER=(9.0, 9.0), CHIN_Y=-9.0, DIFF_Y=9.0, FINS=False, PLATE_Q=1.30, SENSOR_Q=(0.80, 1.30),
    HANDLE_Q=1.45, MIRROR_AT=(-4.30, 1.80), WIPER_Y=None, INT_DY=-3.62, INT_DZ=0.51, INT_DASH_DY=0.25,
    SPOKES=(8, 0.0), PAINT=(0.62, 0.03, 0.03), ROOF_MAT="carpaint",
    EXTRAS=("build_truck_chassis", "build_fire_gear"),
)

PRESETS["suv"] = dict(
    Y_FRONT=-2.465, Y_REAR=2.41, Y_MID=0.0, W=0.962, FENDER_BULGE=0.024,
    P_FRONT=5.0, P_REAR=6.0, Y_FS=-1.62, Y_RS=1.80,
    WHEELS=[(-1.5, 0.385), (1.45, 0.385)], WHEEL_X=0.84, ARCH_R=0.432, TYRE_SCALE=(1.116, 1.085),
    N_UP=4.5, N_GH=3.6,
    ZT=[(-2.5, 1.05), (-2.44, 1.09), (-2.3, 1.125), (-2.0, 1.150), (-1.5, 1.170), (-1.12, 1.185), (0.0, 1.27),
        (1.0, 1.295), (2.0, 1.305), (2.38, 1.30), (2.45, 1.28)],
    ZS=[(-2.5, 0.99), (-2.3, 1.04), (-1.9, 1.08), (-1.12, 1.12), (0.0, 1.16), (1.0, 1.175), (2.2, 1.185), (2.45, 1.16)],
    ZB=[(-2.5, 0.43), (-2.42, 0.37), (-2.1, 0.335), (-1.0, 0.34), (1.0, 0.35), (2.0, 0.38), (2.3, 0.42), (2.45, 0.48)],
    ZR=[(-1.12, 1.19), (-0.95, 1.40), (-0.75, 1.61), (-0.55, 1.745), (-0.3, 1.79), (0.5, 1.80), (1.5, 1.797),
        (2.1, 1.79), (2.3, 1.785), (2.41, 1.77)],
    Y_A=-1.12, Y_C=2.7, Y_HEADER=-0.55, Y_RG=2.385,
    HOOD=(-2.33, -1.16), TRUNK=(9.0, 9.5), DOOR_F=(-0.986, 0.104), DOOR_R=(0.110, 1.070),
    Q=[0, .04, .10, .16, .175, .185, .23, .30, .38, .48, .50, .51, .58, .68, .78, .85, .87, .895, .92, .94, .97, 1.0],
    TAILGATE=(2.395, .50), REAR_GLASS_NODE="trunk",
    DLO=[(0.075, "window", "glass"), (0.14, "B", "trim_gloss"), (1.00, "rear-window", "glass"),
         (1.07, "rear-door", "trim_gloss"), (1.98, "side-glass", "glass"), (9.0, "body", "trim_gloss")],
    ROOF_MAT="carpaint", RAIL_MAT="trim_gloss", CHROME_DLO=True, ROOF_RAILS=True, TAIL_FLUSH=True,
    LAMP_F_Y=-2.20, LAMP_R_Y=2.20, INTAKE_Y=-2.42, INTAKE_Q=(.30, .85), VLAMP=(-2.42, -2.385, .48, .85),
    BLADES=(0.36, 0.43, 0.50, 0.57, 0.64, 0.71, 0.78), BLADE_MAT="chrome",
    CURTAIN=(9.0, 9.0), ROCKER=(-1.12, 1.02), CHIN_Y=-2.1, DIFF_Y=2.2,
    SPOKES=(6, 0.10), INT_DZ=0.17, PAINT=(0.010, 0.010, 0.012),
)

PRESETS["saloon"] = dict(
    Y_FRONT=-2.62, Y_REAR=2.66, Y_MID=0.05, W=0.945, FENDER_BULGE=0.020,
    P_FRONT=3.6, P_REAR=3.6, Y_FS=-1.58, Y_RS=1.70,
    WHEELS=[(-1.55, 0.36), (1.65, 0.36)], WHEEL_X=0.81, ARCH_R=0.405, TYRE_SCALE=(1.043, 1.0),
    ZT=[(-2.65, 0.73), (-2.6, 0.76), (-2.5, 0.80), (-2.2, 0.87), (-1.6, 0.93), (-1.05, 0.97), (0.0, 0.99),
        (1.0, 1.02), (1.75, 1.05), (2.3, 1.065), (2.58, 1.06), (2.65, 1.02)],
    ZS=[(-2.65, 0.69), (-2.5, 0.76), (-2.0, 0.82), (-1.0, 0.85), (0.5, 0.87), (1.75, 0.89), (2.4, 0.90), (2.65, 0.88)],
    ZB=[(-2.65, 0.30), (-2.58, 0.24), (-2.3, 0.225), (-1.0, 0.235), (1.0, 0.24), (2.2, 0.27), (2.5, 0.31), (2.65, 0.36)],
    ZR=[(-1.05, 0.975), (-0.85, 1.11), (-0.6, 1.28), (-0.35, 1.40), (-0.2, 1.44), (0.2, 1.475), (0.7, 1.48),
        (1.0, 1.46), (1.2, 1.40), (1.45, 1.26), (1.75, 1.06)],
    Y_A=-1.05, Y_C=1.75, Y_HEADER=-0.22, Y_RG=1.02,
    HOOD=(-2.48, -1.10), TRUNK=(1.78, 2.58), DOOR_F=(-1.02, 0.12), DOOR_R=(0.126, 1.25),
    DLO=[(0.09, "window", "glass"), (0.16, "B", "trim_gloss"), (1.18, "rear-window", "glass"),
         (1.24, "rear-door", "trim_gloss"), (1.50, "side-glass", "glass"), (9.0, "body", "carpaint")],
    ROOF_MAT="trim_gloss", RAIL_MAT="trim_gloss", CHROME_DLO=True,
    LAMP_F_Y=-2.36, LAMP_R_Y=2.32, INTAKE_Y=-2.54, CURTAIN=(-2.49, -2.41),
    ROCKER=(-1.13, 1.20), CHIN_Y=-2.2, DIFF_Y=2.38,
    SPOKES=(10, 0.0), INT_REAR_DY=0.25, PAINT=(0.010, 0.060, 0.042),
    PIVOTS={
        "wheel-front-left": (0.81, -1.55, 0.36), "wheel-front-right": (-0.81, -1.55, 0.36),
        "wheel-rear-left": (0.81, 1.65, 0.36), "wheel-rear-right": (-0.81, 1.65, 0.36),
        "brake-caliper-front-left": (0.793, -1.55, 0.36), "brake-caliper-front-right": (-0.793, -1.55, 0.36),
        "brake-caliper-rear-left": (0.793, 1.65, 0.36), "brake-caliper-rear-right": (-0.793, 1.65, 0.36),
        "door-left": (0.895, -0.45, 0.666), "door-right": (-0.895, -0.45, 0.666),
        "rear-door-left": (0.898, 0.69, 0.681), "rear-door-right": (-0.898, 0.69, 0.681),
        "hood": (0.0, -1.85, 0.86), "trunk": (0.0, 2.20, 1.05),
        "mirror-left": (0.943, -0.79, 1.048), "mirror-right": (-0.943, -0.79, 1.048),
    },
)

# ---------------------------------------------------------------------------------------------
# TRUCK REDESIGN (2026-10-25): modern truck design language from references: raked cab-over
# fronts with a dark lower band, truck wheels and mirrors, steps, visors and markers; a
# conventional face for the bonneted trucks; barrel refuse body; aluminium fire shutters; a
# modern wrecker with a low black boom and a light tower.
# ---------------------------------------------------------------------------------------------
def build_tow_gear():
    """Modern wrecker: frame, light tower behind the cab, black boom stowed low with winches,
    toolbox tops in tread plate, a heavy underlift and a chrome fuel tank."""
    trim, ub = OUT["trim"], OUT["underbody"]
    for x in (-0.45, 0.45):
        rbox(ub, (0.10, Y_REAR + 2.2, 0.22), "underbody", Matrix.Translation((x, 0.5 * (Y_REAR - 2.2), 0.80)), radius=0.0)
    deck = spline(ZT, 1.5)
    tower_y = -0.28
    for x in (-0.78, 0.78):
        rbox(trim, (0.10, 0.10, 1.10), "trim_gloss", Matrix.Translation((x, tower_y, deck + 0.55)), radius=0.015)
    rbox(trim, (1.66, 0.12, 0.10), "trim_gloss", Matrix.Translation((0, tower_y, deck + 1.10)), radius=0.015)
    for z in (deck + 0.35, deck + 0.70):
        rbox(trim, (1.56, 0.04, 0.04), "trim_gloss", Matrix.Translation((0, tower_y, z)), radius=0.0)
    beacon_bar("beacons", tower_y, deck + 1.15, width=1.5)
    # Boom: heavy black sections from a base behind the tower, stowed nearly flat over the bed.
    base = Vector((0, 0.55, deck))
    rbox(trim, (0.80, 0.70, 0.30), "trim_gloss", Matrix.Translation(base + Vector((0, 0, 0.15))), radius=0.03)
    for x in (-0.26, 0.26):
        drum = frame(base + Vector((x - 0.12, 0.10, 0.42)), Vector((1, 0, 0)), Vector((0, 0, 1)))
        cylinder(trim, drum, 0.13, 0.24, "trim_gloss", seg=20)
        cylinder(trim, drum @ Matrix.Translation((0.03, 0, 0)), 0.10, 0.18, "chrome", seg=20)
    root, tip = base + Vector((0, 0.30, 0.48)), Vector((0, Y_REAR + 0.25, deck + 0.78))
    d = tip - root
    rbox(trim, (d.length * 0.70, 0.40, 0.32), "trim_gloss", frame(root + d * 0.35, d, Vector((0, 0, 1))), radius=0.03)
    rbox(trim, (d.length * 0.45, 0.30, 0.24), "trim_black", frame(root + d * 0.78, d, Vector((0, 0, 1))), radius=0.02)
    rbox(trim, (0.34, 0.22, 0.30), "trim_gloss", Matrix.Translation(tip + Vector((0, 0.04, 0))), radius=0.03)
    for x in (-0.10, 0.10):
        hook_top = tip + Vector((x, 0.12, -0.55))
        cylinder(trim, frame(tip + Vector((x, 0.12, -0.12)), Vector((0, 0, -1)), Vector((1, 0, 0))), 0.008, 0.43, "trim_black", seg=6)
        torus(trim, frame(hook_top + Vector((0, 0, -0.06)), Vector((1, 0, 0)), Vector((0, 0, 1))), 0.05, 0.013, "chrome", seg=14, tseg=6)
    ram_a, ram_b = base + Vector((0, 0.40, 0.25)), root + d * 0.42
    cylinder(trim, frame(ram_a, ram_b - ram_a, Vector((1, 0, 0))), 0.06, (ram_b - ram_a).length, "chrome", seg=12)
    # Toolbox tops in tread plate along both sides of the bed.
    for side in (1, -1):
        p = body_point(1.5, "th", 0.5)
        rbox(trim, (0.34, Y_REAR + 0.10, 0.025), "chrome", Matrix.Translation((side * (p.x - 0.12), 0.5 * (Y_REAR - 0.25) + 0.05, deck + 0.012)),
             radius=0.005)
    # Underlift: a heavy black arm out of the back, a crossbar and wheel-grid forks.
    rear = OUT["bumper-rear"]
    rbox(rear, (0.26, 0.95, 0.20), "trim_gloss", Matrix.Translation((0, Y_REAR + 0.30, 0.55)), radius=0.03)
    rbox(rear, (1.70, 0.18, 0.16), "trim_gloss", Matrix.Translation((0, Y_REAR + 0.78, 0.52)), radius=0.03)
    for x in (-0.62, 0.62):
        rbox(rear, (0.12, 0.55, 0.10), "chrome", Matrix.Translation((x, Y_REAR + 1.05, 0.48)), radius=0.015)
        rbox(rear, (0.30, 0.10, 0.10), "chrome", Matrix.Translation((x * 0.86, Y_REAR + 1.28, 0.48)), radius=0.015)
    for x in (-0.72, 0.72):
        rbox(rear, (0.14, 0.05, 0.07), "tail_light", Matrix.Translation((x, Y_REAR + 0.88, 0.56)), radius=0.01)
    tank = frame(Vector((0.98, -0.50, 0.70)), Vector((0, 1, 0)), Vector((0, 0, 1)))
    cylinder(trim, tank, 0.22, 0.70, "chrome", seg=24)


def build_fire_gear():
    """Fire engine: bright aluminium roller shutters between red pillars, light bars, an aerial
    ladder on a turntable, a rear step."""
    trim = OUT["trim"]
    for side in (1, -1):
        for y0, y1 in ((-1.85, -0.95), (-0.85, 0.05), (0.15, 1.65), (3.15, 4.05)):
            p = body_point(0.5 * (y0 + y1), "q", 2.0)
            x = side * (p.x + 0.006)
            rbox(trim, (0.014, y1 - y0, 1.42), "chrome", Matrix.Translation((x, 0.5 * (y0 + y1), 1.90)), radius=0.008)
            z = 1.22
            while z < 2.60:
                rbox(trim, (0.018, y1 - y0 - 0.04, 0.005), "rim", Matrix.Translation((x + side * 0.002, 0.5 * (y0 + y1), z)), radius=0.0)
                z += 0.055
            rbox(trim, (0.022, y1 - y0 - 0.02, 0.05), "trim_gloss", Matrix.Translation((x + side * 0.004, 0.5 * (y0 + y1), 1.21)), radius=0.01)
        p = body_point(0.5, "q", 0.9)
        rbox(trim, (0.03, 6.4, 0.05), "chrome", Matrix.Translation((side * (p.x + 0.02), 1.3, 0.92)), radius=0.01)
    bar = OUT["lightbar"]
    top = spline(ZT, -4.2)
    rbox(bar, (1.90, 0.26, 0.06), "trim_gloss", Matrix.Translation((0, -4.20, top + 0.03)), radius=0.02)
    for k in range(7):
        x = -0.84 + k * 0.28
        rbox(bar, (0.24, 0.22, 0.09), "siren-red" if k % 2 == 0 else "siren-blue", Matrix.Translation((x, -4.20, top + 0.11)),
             radius=0.03, segments=2)
    for x, mat in ((-1.0, "siren-red"), (1.0, "siren-blue")):
        rbox(bar, (0.18, 0.14, 0.12), mat, Matrix.Translation((x, 4.62, spline(ZT, 4.6) + 0.06)), radius=0.04, segments=2)
    lad = OUT["ladder"]
    z = spline(ZT, 0.0) + 0.16
    for x in (-0.42, 0.42):
        rbox(lad, (0.06, 8.2, 0.16), "chrome", Matrix.Translation((x, 0.0, z)), radius=0.01)
        rbox(lad, (0.04, 8.0, 0.10), "chrome", Matrix.Translation((x * 0.82, 0.0, z + 0.14)), radius=0.01)
    y = -4.0
    while y < 4.05:
        cylinder(lad, frame(Vector((-0.42, y, z)), Vector((1, 0, 0)), Vector((0, 0, 1))), 0.015, 0.84, "chrome", seg=8)
        y += 0.32
    turn = Vector((0, 3.6, spline(ZT, 3.6)))
    cylinder(trim, frame(turn, Vector((0, 0, 1)), Vector((1, 0, 0))), 0.55, 0.14, "trim_gloss", seg=32)
    rbox(trim, (0.70, 0.60, 0.20), "carpaint", Matrix.Translation(turn + Vector((0, 0, 0.24))), radius=0.03)
    rbox(OUT["bumper-rear"], (2.10, 0.30, 0.08), "chrome", Matrix.Translation((0, Y_REAR + 0.12, 0.55)), radius=0.01)


TRUCK_COMMON = dict(WHEEL_STYLE="truck", TRUCK_MIRRORS=True)
PRESETS["truck"].update(TRUCK_COMMON, CAB_LEAN=0.12, FRONT_DARK=(0.30, 1.82), CHASSIS_GUARDS=False,
    WINDOWS=[(-9.0, -4.70, 1.85, 2.80, "windscreen-glass", "glass"), (-4.38, -2.96, 1.98, 2.62, "window", "glass")],
    CAB_DETAILS=dict(steps=[-3.15], step_z=[0.55, 0.85], visor=(-4.62, 2.86, 1.9), markers=(-4.50, 2.98, 1.4)),
    ZS=[(-4.86, 2.72), (-4.80, 2.82), (-4.55, 2.86), (-3.30, 2.88), (-3.05, 2.95), (-2.95, 3.56), (-2.9, 3.60),
        (4.78, 3.60), (4.84, 3.55)],
    EXTRAS=("build_truck_chassis", "build_box_details", "build_cab_details"))
PRESETS["garbage"].update(TRUCK_COMMON, CAB_LEAN=0.10, REAR_LEAN=0.15, FRONT_DARK=(0.30, 1.55),
    ZS=[(-4.32, 2.55), (-4.26, 2.65), (-4.0, 2.70), (-2.55, 2.72), (-2.45, 2.42), (-2.35, 2.45), (3.10, 2.45),
        (3.25, 2.42), (4.10, 2.38), (4.40, 2.30)],
    N_UP=3.0, PAINT2_COLOUR=(0.88, 0.89, 0.88), BAND=(1.30, 1.48), BAND_COLOUR=(0.06, 0.40, 0.18),
    WINDOWS=[(-9.0, -4.12, 1.62, 2.60, "windscreen-glass", "glass"), (-3.83, -2.51, 1.62, 2.30, "window", "glass"),
             (-3.70, -2.65, 0.95, 1.40, "window", "glass")],
    CAB_DETAILS=dict(steps=[-2.64], step_z=[0.45], markers=(-4.05, 2.80, 1.6)),
    EXTRAS=("build_truck_chassis", "build_garbage_gear", "build_cab_details"))
PRESETS["fire"].update(TRUCK_COMMON, CAB_LEAN=0.10, FRONT_DARK=(0.30, 1.62), BAND=(1.00, 1.10),
    BAND_COLOUR=(0.92, 0.92, 0.90),
    CAB_DETAILS=dict(steps=[-2.69], step_z=[0.45, 0.72], markers=(-4.55, 2.88, 1.3)),
    EXTRAS=("build_truck_chassis", "build_fire_gear", "build_cab_details"))
PRESETS["service"].update(TRUCK_COMMON, INTAKE_Y=-9.0, LAMP_F_Y=-9.0,
    BONNET_FRONT=dict(grille=(1.20, 0.72, 1.18), lamps=(0.80, 1.02, 0.28, 0.22)),
    FENDERS=(0.62, 1.04, 0.04),
    CAB_DETAILS=dict(steps=[-1.0, -0.04], step_z=[0.40], markers=(-0.95, 2.11, 1.2)),
    EXTRAS=("build_service_gear", "build_cab_details"))
PRESETS["tow"].update(TRUCK_COMMON, INTAKE_Y=-9.0, LAMP_F_Y=-9.0,
    BONNET_FRONT=dict(grille=(1.30, 0.86, 1.42), lamps=(0.86, 1.22, 0.28, 0.24)),
    FENDERS=(0.68, 1.16, 0.04), EXHAUST=(1.05, -0.40, 2.95),
    CAB_DETAILS=dict(steps=[-1.20], step_z=[0.45, 0.70], markers=(-1.15, 2.65, 1.3)),
    EXTRAS=("build_tow_gear", "build_cab_details"))

# ---------------------------------------------------------------------------------------------
# PREMIUM LINE (2026-10-25): five buy-only cars for the Kasper Motors showroom, on the sedan and
# SUV templates. Original designs: grand-tourer, flagship, grand-SUV, roadster and hypercar
# proportions from current premium cars, no maker's shapes, grilles or marks.
# ---------------------------------------------------------------------------------------------
def sedan_pivots(front, rear, r, x=0.81, door=-0.45, hood=-1.85, trunk=2.2, mirror=-0.79, mirror_z=1.048, rear_door=0.69):
    return {
        "wheel-front-left": (x, front, r), "wheel-front-right": (-x, front, r),
        "wheel-rear-left": (x, rear, r), "wheel-rear-right": (-x, rear, r),
        "brake-caliper-front-left": (x - 0.017, front, r), "brake-caliper-front-right": (-x + 0.017, front, r),
        "brake-caliper-rear-left": (x - 0.017, rear, r), "brake-caliper-rear-right": (-x + 0.017, rear, r),
        "door-left": (0.895, door, 0.666), "door-right": (-0.895, door, 0.666),
        "rear-door-left": (0.898, rear_door, 0.681), "rear-door-right": (-0.898, rear_door, 0.681),
        "hood": (0.0, hood, 0.86), "trunk": (0.0, trunk, 1.0),
        "mirror-left": (0.943, mirror, mirror_z), "mirror-right": (-0.943, mirror, mirror_z),
    }


def stretch(pts, k, dz=0.0):
    return [(y * k, z + dz) for y, z in pts]


# ---- Engines --------------------------------------------------------------------------------
# A closed bay under the bonnet (tray, body-colour inner wings, bulkhead, radiator, strut tops) and
# the engine in it: "v12", "v8", "i6", or "ev" (a drive unit, inverter and orange cables). The
# hypercar also shows its rear drive unit and battery under the glass tail (ENGINE_REAR).
def T(x, y, z):
    return Matrix.Translation((x, y, z))


def skin_z(y, x):
    """Height of the body's top surface at (y, x), from the shoulder over to the deck."""
    best = None
    for k in range(41):
        p = body_point(y, "th", k / 40)
        if best is None or abs(p.x - x) < abs(best.x - x):
            best = p
    return best.z


def bay_shell(mb, y0, y1, xi, floor, top):
    rbox(mb, (2 * xi, y1 - y0, 0.02), "underbody", T(0, 0.5 * (y0 + y1), floor), radius=0.0)
    for side in (1, -1):
        ys = frange(y0, y1, 0.05) + [y1]
        verts, faces = [], []
        for y in ys:
            # Kept under the skin: on a low car the wings fall away from the bonnet's middle.
            t = min(top(y), skin_z(y, xi) - 0.02) - 0.012
            t2 = min(t, skin_z(y, xi + 0.18) - 0.035)
            verts += [Vector((side * xi, y, floor)), Vector((side * xi, y, t)), Vector((side * (xi + 0.18), y, t2))]
        for k in range(len(ys) - 1):
            for m in range(2):
                f = [k * 3 + m, (k + 1) * 3 + m, (k + 1) * 3 + m + 1, k * 3 + m + 1]
                faces.append(f if side > 0 else f[::-1])
        mb.raw(verts, faces, "carpaint", False)
    rbox(mb, (2 * xi, 0.03, top(y1) - floor), "trim_black", T(0, y1, 0.5 * (top(y1) + floor)), radius=0.0)


def engine_parts(mb, kind, yc, floor, xi, accent, top):
    if kind == "ev":
        motor = frame(Vector((-0.27, yc, floor + 0.15)), Vector((1, 0, 0)), Vector((0, 0, 1)))
        cylinder(mb, motor, 0.13, 0.54, "engine_alloy", seg=24)
        for x in (-0.30, 0.30):
            cylinder(mb, frame(Vector((x, yc, floor + 0.15)), Vector((1, 0, 0)), Vector((0, 0, 1))), 0.07, 0.04, "rim", seg=16)
        rbox(mb, (0.46, 0.24, 0.10), accent, T(0, yc + 0.24, floor + 0.32), radius=0.02)
        rbox(mb, (0.30, 0.16, 0.012), "engine_alloy", T(0, yc + 0.24, floor + 0.376), radius=0.004)
        for x in (-0.14, 0.0, 0.14):
            a, b = Vector((x, yc + 0.12, floor + 0.30)), Vector((x * 1.4, yc - 0.02, floor + 0.20))
            cylinder(mb, frame(a, b - a, Vector((1, 0, 0))), 0.014, (b - a).length, "hv_orange", seg=8)
        return
    v = kind in ("v8", "v12")
    L = {"v12": 0.78, "v8": 0.58, "i6": 0.72}[kind]
    n = {"v12": 6, "v8": 4, "i6": 6}[kind]
    zb = floor + 0.20
    rbox(mb, (0.40 if v else 0.26, L, 0.24), "engine_alloy", T(0, yc, zb), radius=0.03)
    rbox(mb, (0.44 if v else 0.30, L * 0.9, 0.06), "engine_alloy", T(0, yc, floor + 0.07), radius=0.02)
    banks = ((1, 0.62), (-1, -0.62)) if v else ((0, 0.0),)
    for s, ang in banks:
        c = Vector((s * 0.15, yc, zb + 0.17))
        m = Matrix.Translation(c) @ Matrix.Rotation(ang, 4, "Y")
        rbox(mb, (0.15, L * 0.96, 0.07), accent, m, radius=0.025, segments=2)
        for k in range(n):
            y = yc - L * 0.42 + k * (L * 0.84) / (n - 1)
            rbox(mb, (0.03, 0.03, 0.02), "trim_gloss", m @ Matrix.Translation((0, y - yc, 0.04)), radius=0.006)
        # Exhaust headers down the outside of each bank.
        for k in range(n):
            y = yc - L * 0.40 + k * (L * 0.80) / (n - 1)
            sx = s if v else -1
            a = Vector((sx * (0.21 if v else 0.15), y, zb + 0.06))
            b = Vector((sx * min(xi - 0.03, 0.34), y + 0.04, floor + 0.06))
            cylinder(mb, frame(a, b - a, Vector((0, 1, 0))), 0.020, (b - a).length, "brake_disc", seg=8)
    # Intake: a plenum between the banks (or along the six) with chrome trumpets under a carbon lid.
    px = 0.0 if v else 0.12
    rbox(mb, (0.16, L * 0.8, 0.07), "engine_alloy", T(px, yc, zb + 0.24), radius=0.02)
    for k in range(n):
        y = yc - L * 0.36 + k * (L * 0.72) / (n - 1)
        for s in ((1, -1) if v else (1,)):
            cylinder(mb, frame(Vector((px + s * 0.045, y, zb + 0.27)), Vector((0, 0, 1)), Vector((1, 0, 0))), 0.022, 0.05,
                     "chrome", seg=10, caps=False)
    lid_top = min(zb + 0.33, top(yc) - 0.05)
    rbox(mb, (0.24 if v else 0.20, L * 0.55, 0.03), "engine_cover", T(px, yc + L * 0.1, lid_top), radius=0.012)
    cylinder(mb, frame(Vector((-0.10 if v else -0.06, yc - L * 0.38, zb + 0.24)), Vector((0, 0, 1)), Vector((1, 0, 0))),
             0.022, 0.02, "oil_cap", seg=12)


def build_engine_bay():
    if not ENGINE:
        return
    mb = OUT["body"]
    fy, wz = WHEELS[0]
    y0, y1 = HOOD[0] + 0.14, HOOD[1] + 0.02
    xi = WHEEL_X - 0.25
    floor = wz - 0.12
    top = lambda y: spline(ZT, y) - 0.035
    bay_shell(mb, y0, y1, xi, floor, top)
    # Radiator across the front, strut tops over the wheels, coolant bottle and battery.
    rbox(mb, (2 * xi - 0.06, 0.05, min(0.36, top(y0 + 0.05) - floor - 0.04)), "trim_black",
         T(0, y0 + 0.05, floor + 0.20), radius=0.01)
    for side in (1, -1):
        cylinder(mb, frame(Vector((side * (xi + 0.06), fy, min(top(fy), skin_z(fy, xi + 0.1)) - 0.10)), Vector((0, 0, 1)), Vector((1, 0, 0))), 0.07, 0.06,
                 "rim", seg=16)
    cylinder(mb, frame(Vector((xi - 0.10, y0 + 0.24, floor + 0.12)), Vector((0, 0, 1)), Vector((1, 0, 0))), 0.06, 0.16,
             "plate_blank", seg=12)
    rbox(mb, (0.18, 0.24, 0.16), "trim_black", T(-(xi - 0.13), y1 - 0.18, floor + 0.10), radius=0.01)
    L = {"v12": 0.78, "v8": 0.58, "i6": 0.72, "ev": 0.5}[ENGINE]
    yc = clamp(fy + 0.15, y0 + 0.18 + L / 2, y1 - 0.08 - L / 2)
    engine_parts(mb, ENGINE, yc, floor, xi, ENGINE_ACCENT, top)
    if ENGINE_REAR:
        # Under the glass tail: a tray, the rear drive unit on the axle and battery modules ahead of it.
        ry, rz = WHEELS[1]
        ya, yb = Y_RG + 0.35, min(Y_C + 0.25, Y_REAR - 0.3)
        rfloor = rz - 0.10
        rtop = lambda y: spline(ZT, y) - 0.03
        bay_shell(mb, ya, yb, xi, rfloor, rtop)
        rbox(mb, (2 * xi, 0.03, rtop(ya) - rfloor), "trim_black", T(0, ya, 0.5 * (rtop(ya) + rfloor)), radius=0.0)
        engine_parts(mb, "ev", ry, rfloor, xi, ENGINE_ACCENT, rtop)
        for k, y in enumerate(frange(ya + 0.12, ry - 0.30, 0.17)):
            rbox(mb, (0.62, 0.15, 0.14), "engine_cover", T(0, y, rfloor + 0.10), radius=0.015)
            rbox(mb, (0.64, 0.02, 0.02), "hv_orange", T(0, y + 0.07, rfloor + 0.18), radius=0.004)


MATS.update({
    "engine_alloy": ((0.50, 0.51, 0.53), 1.0, 0.40, {}),
    "engine_cover": ((0.025, 0.025, 0.028), 0.0, 0.25, {"coat": 0.8, "coat_rough": 0.05}),
    "engine_red": ((0.42, 0.025, 0.02), 0.0, 0.55, {}),
    "hv_orange": ((0.90, 0.33, 0.03), 0.0, 0.50, {}),
    "oil_cap": ((0.92, 0.74, 0.05), 0.0, 0.40, {}),
})


# ---- Folding roof ---------------------------------------------------------------------------
# A convertible's soft top in two panels that Z-fold back onto the rear deck, plus side windows
# that rise out of the doors. Each is its own node with its hinge as its pivot, built closed;
# the game folds them (OrionVehicleModel, VehicleModelSpec.foldingRoof): "roof-rear" turns about
# its hinge on the deck, "roof-front" (its child) about the joint between them, and the panes
# ("roof-pane-left/right", children of the doors) slide down into the doors.
ROOF_COLS = [0.0, .08, .16, .24, .32, .40, .48, .55, .62, .70, .80, .90, 1.0]


def roof_point(yr, f, inset=0.0):
    p = gh_point(yr, f)
    return Vector((p.x * (1.012 - inset), p.y, p.z + 0.012 - inset * 1.2))


def roof_pivots():
    joint = FOLD_ROOF["joint"]
    rear = Vector((0.0, Y_C - 0.02, spline(ZT, Y_C)))
    front = Vector((0.0, joint, roof_point(joint, 1.0).z))
    pane_y = 0.5 * (Y_A + 0.10 + DOOR_F[1] - 0.03)
    panes = {side: Vector((side * roof_point(pane_y, 0.25).x, pane_y, roof_point(pane_y, 0.25).z)) for side in (1, -1)}
    return rear, front, panes


def ensure_roof_objects():
    """The roof's nodes don't exist in the template: made here, parented and pivoted."""
    if not FOLD_ROOF:
        return
    root = next(o for o in bpy.data.objects if o.parent is None and o.type == "EMPTY" and o.name.startswith("orion"))
    rear, front, panes = roof_pivots()
    made = [("roof-rear", root, rear), ("roof-front", "roof-rear", front)]
    made += [(side_name("roof-pane", side), side_name("door", side), panes[side]) for side in (1, -1)]
    for name, parent, at in made:
        parent = bpy.data.objects[parent] if isinstance(parent, str) else parent
        ob = bpy.data.objects.get(name)
        if ob is None:
            ob = bpy.data.objects.new(name, bpy.data.meshes.new(name + "_init"))
            root.users_collection[0].objects.link(ob)
        ob.parent = parent
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.matrix_world = Matrix.Translation(at)
    bpy.context.view_layer.update()


def roof_panel(mb, ys, fmin, glass):
    """A lofted panel over rows ys, both sides, with a headliner under it."""
    cols = ROOF_COLS + [-f for f in reversed(ROOF_COLS[:-1])]  # left belt over the top to the right belt

    def at(yr, c, inset=0.0):
        f = cols[c]
        p = roof_point(yr, abs(f), inset)
        return p if f >= 0 and c < len(ROOF_COLS) else Vector((-p.x, p.y, p.z))

    for i in range(len(ys) - 1):
        ym = 0.5 * (ys[i] + ys[i + 1])
        for c in range(len(cols) - 1):
            if min(abs(cols[c]), abs(cols[c + 1])) < fmin(ym) - 1e-6:
                continue
            quad = [(i, c), (i + 1, c), (i + 1, c + 1), (i, c + 1)]
            f = min(abs(cols[c]), abs(cols[c + 1]))
            mat = "glass" if glass(ym, f) else "soft_top"
            outer = [mb.vert(("ro", a, b) if mat != "glass" else ("rg", a, b), at(ys[a], b)) for a, b in quad]
            mb.face(outer[::-1] if c >= len(ROOF_COLS) - 1 else outer, mat)
            if mat != "glass":
                inner = [mb.vert(("ri", a, b), at(ys[a], b, 0.03)) for a, b in quad]
                mb.face(inner if c >= len(ROOF_COLS) - 1 else inner[::-1], "headliner")


def build_folding_roof():
    if not FOLD_ROOF:
        return
    joint = FOLD_ROOF["joint"]
    lerp = lambda a, b, n: [a + (b - a) * k / n for k in range(n + 1)]
    front_rows = lerp(Y_HEADER + 0.004, joint - 0.003, 14)
    rear_rows = lerp(joint + 0.003, Y_C - 0.02, 16)
    roof_panel(OUT["roof-front"], front_rows, lambda ym: 0.48, lambda ym, f: False)
    roof_panel(OUT["roof-rear"], rear_rows, lambda ym: 0.0 if ym > DOOR_F[1] - 0.01 else 0.48,
               lambda ym, f: f >= 0.70 and joint + 0.12 < ym < Y_C - 0.16)
    # A bow along the front edge, where it latches to the windscreen's header.
    line = [roof_point(Y_HEADER + 0.01, f) for f in ROOF_COLS if f >= 0.48]
    line = [Vector((-p.x, p.y, p.z)) for p in reversed(line[1:])] + line
    ribbon(OUT["roof-front"], [p + Vector((0, 0, 0.006)) for p in line], 0.022, 0.05, "trim_gloss", "bow")
    # Side windows: frameless glass in each door, under the roof's edge.
    ys = lerp(Y_A + 0.12, DOOR_F[1] - 0.03, 12)
    fs = [0.02, 0.12, 0.24, 0.36, 0.465]
    for side in (1, -1):
        mb = OUT[side_name("roof-pane", side)]
        for i in range(len(ys) - 1):
            for j in range(len(fs) - 1):
                pts = [roof_point(ys[a], fs[b], 0.004) for a, b in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))]
                pts = [Vector((side * p.x, p.y, p.z)) for p in pts]
                ids = [mb.vert(None, p) for p in pts]
                mb.face(ids if side > 0 else ids[::-1], "glass")


MATS["soft_top"] = ((0.028, 0.03, 0.036), 0.0, 0.88, {})


# GT coupe: long bonnet, cabin set well back, two long frameless doors, fastback over muscular rear
# haunches. Two slim swept headlamps (no light bar), a wide egg-crate grille in chrome, separate tail
# lamps on a gloss-black panel, crossed-spoke mesh wheels in graphite, tan leather, a red-topped V8.
PRESETS["gt"] = dict(
    Y_FRONT=-2.52, Y_REAR=2.43, Y_MID=-0.05, W=0.955, FENDER_BULGE=0.040,
    P_FRONT=3.4, P_REAR=3.0, Y_FS=-1.55, Y_RS=1.45,
    WHEELS=[(-1.56, 0.36), (1.42, 0.36)], WHEEL_X=0.83, ARCH_R=0.405, TYRE_SCALE=(1.043, 1.04),
    N_UP=5.0, N_GH=3.4,
    ZT=[(-2.55, 0.64), (-2.50, 0.67), (-2.4, 0.71), (-2.1, 0.775), (-1.6, 0.83), (-1.0, 0.875), (-0.70, 0.89),
        (0.5, 0.90), (1.2, 0.93), (1.7, 0.95), (2.25, 0.955), (2.38, 0.94), (2.45, 0.90)],
    ZS=[(-2.55, 0.60), (-2.4, 0.67), (-1.9, 0.73), (-1.0, 0.755), (0.1, 0.765), (0.9, 0.80), (1.45, 0.835),
        (2.1, 0.83), (2.45, 0.80)],
    ZB=[(-2.55, 0.27), (-2.46, 0.21), (-2.2, 0.20), (-1.0, 0.21), (1.0, 0.215), (2.0, 0.25), (2.3, 0.29), (2.45, 0.34)],
    ZR=[(-0.70, 0.895), (-0.52, 1.03), (-0.32, 1.17), (-0.12, 1.265), (0.10, 1.305), (0.32, 1.30), (0.55, 1.255),
        (0.85, 1.16), (1.15, 1.06), (1.45, 0.975), (1.62, 0.95)],
    Y_A=-0.70, Y_C=1.62, Y_HEADER=-0.20, Y_RG=0.42,
    HOOD=(-2.40, -0.74), TRUNK=(1.66, 2.36), DOOR_F=(-0.76, 0.46), DOOR_R=(9.0, 9.5),
    DLO=[(0.44, "window", "glass"), (0.95, "side-glass", "glass"), (9.0, "body", "carpaint")],
    ROOF_MAT="carpaint", RAIL_MAT="carpaint", CHROME_DLO=True,
    LAMP_F_Y=-2.30, LAMP_R_Y=2.20, LAMP_SPLIT=0.50, LAMP_SPLIT_R=0.40, TAIL_CENTRE_MAT="trim_gloss",
    INTAKE_Y=-2.36, INTAKE_Q=(.10, .62), INTAKE_X=0.50, BLADES=(0.18, 0.26, 0.34, 0.42, 0.50),
    VBARS=(13, 0.45), BLADE_MAT="chrome",
    CURTAIN=(-2.40, -2.32), ROCKER=(-1.15, 1.0), CHIN_Y=-2.2, DIFF_Y=2.20,
    SPOKES=(10, 0.0), SPOKE_TWIST=0.32, SPOKE_CROSS=True, RIM=((0.10, 0.10, 0.11), 1.0, 0.22),
    REAR_SEATS=False, INT_DY=0.24, INT_DZ=-0.04, PAINT=(0.26, 0.016, 0.03), INTERIOR_COLOUR=(0.32, 0.16, 0.07),
    ENGINE="v8", ENGINE_ACCENT="engine_red",
    PIVOTS=sedan_pivots(-1.56, 1.42, 0.36, x=0.83, door=-0.15, hood=-1.9, trunk=2.05, mirror=-0.44, mirror_z=0.94),
)

# Flagship saloon: long, formal and upright: a tall grille of vertical chrome bars between two
# separate lamps, two-tone (midnight over silver) parted by a chrome coach line, a broad body-colour
# rear pillar, separate tail lamps joined by a chrome bar, polished 12-spoke wheels, cream leather,
# a V12 under chrome cam covers.
_S, _K = PRESETS["saloon"], 1.035
PRESETS["flagship"] = dict(_S,
    Y_FRONT=-2.62 * _K, Y_REAR=2.66 * _K, Y_MID=0.05, W=0.96, FENDER_BULGE=0.018,
    Y_FS=-1.58 * _K, Y_RS=1.70 * _K, P_FRONT=4.4, P_REAR=3.8,
    WHEELS=[(-1.60, 0.37), (1.71, 0.37)], WHEEL_X=0.82, ARCH_R=0.415, TYRE_SCALE=(1.072, 1.04),
    N_UP=4.2, N_GH=3.6,
    ZT=stretch(_S["ZT"], _K, 0.02), ZS=stretch(_S["ZS"], _K, 0.02), ZB=stretch(_S["ZB"], _K),
    ZR=stretch(_S["ZR"], _K, 0.04),
    Y_A=-1.05 * _K, Y_C=1.75 * _K, Y_HEADER=-0.22 * _K, Y_RG=1.02 * _K,
    HOOD=(-2.50 * _K, -1.10 * _K), TRUNK=(1.78 * _K, 2.58 * _K), DOOR_F=(-1.02 * _K, 0.12 * _K),
    DOOR_R=(0.126 * _K + 0.006, 1.25 * _K),
    DLO=[(0.09 * _K, "window", "glass"), (0.16 * _K, "B", "trim_gloss"), (1.18 * _K, "rear-window", "glass"),
         (1.24 * _K, "rear-door", "trim_gloss"), (1.36 * _K, "side-glass", "glass"), (9.0, "body", "carpaint")],
    ROOF_MAT="carpaint", RAIL_MAT="carpaint",
    LAMP_F_Y=-2.42 * _K, LAMP_R_Y=2.32 * _K, LAMP_SPLIT=0.46, LAMP_SPLIT_R=0.34, TAIL_CENTRE_MAT="chrome",
    INTAKE_Y=-2.62 * _K + 0.07, INTAKE_Q=(.24, .80), BLADES=(),
    VBARS=(13, 0.36), BLADE_MAT="chrome", CURTAIN=(9.0, 9.0),
    ROCKER=(-1.13 * _K, 1.20 * _K), CHIN_Y=-2.2 * _K, DIFF_Y=2.38 * _K,
    TWO_TONE=0.45, BAND_COLOUR=(0.36, 0.37, 0.39), PAINT=(0.010, 0.018, 0.055),
    SPOKES=(12, 0.0), SPOKE_TWIST=0.12, RIM=((0.80, 0.81, 0.83), 1.0, 0.10),
    INT_REAR_DY=0.28, INTERIOR_COLOUR=(0.55, 0.47, 0.36),
    ENGINE="v12", ENGINE_ACCENT="chrome",
    PIVOTS=sedan_pivots(-1.60, 1.71, 0.37, x=0.82, door=-0.47, hood=-1.91, trunk=2.28, mirror=-0.82, rear_door=0.71),
)

# Grand SUV (on orion-suv): lower and longer than the city SUV, a coupe roof sloping to a fast
# tailgate, a floating gloss-black roof, two slim headlamps over a dark lattice grille, separate
# tail lamps on a black panel, 22-inch turbine wheels in dark bronze, champagne paint, a V8.
PRESETS["grandsuv"] = dict(
    Y_FRONT=-2.50, Y_REAR=2.45, Y_MID=0.0, W=0.975, FENDER_BULGE=0.034,
    P_FRONT=4.6, P_REAR=5.0, Y_FS=-1.62, Y_RS=1.80,
    WHEELS=[(-1.52, 0.40), (1.50, 0.40)], WHEEL_X=0.85, ARCH_R=0.45, TYRE_SCALE=(1.16, 1.10),
    N_UP=4.6, N_GH=3.4,
    ZT=[(-2.55, 1.02), (-2.48, 1.06), (-2.3, 1.11), (-2.0, 1.14), (-1.5, 1.16), (-1.10, 1.18), (0.0, 1.23),
        (1.0, 1.25), (2.0, 1.26), (2.40, 1.24), (2.48, 1.20)],
    ZS=[(-2.55, 0.96), (-2.3, 1.02), (-1.9, 1.06), (-1.10, 1.09), (0.0, 1.12), (1.0, 1.15), (1.6, 1.17), (2.2, 1.16),
        (2.48, 1.12)],
    ZB=[(-2.55, 0.42), (-2.45, 0.36), (-2.1, 0.33), (-1.0, 0.34), (1.0, 0.35), (2.0, 0.38), (2.3, 0.42), (2.48, 0.48)],
    ZR=[(-1.10, 1.19), (-0.92, 1.38), (-0.72, 1.55), (-0.50, 1.66), (-0.20, 1.715), (0.40, 1.725), (1.00, 1.71),
        (1.60, 1.675), (2.05, 1.61), (2.30, 1.54), (2.45, 1.48)],
    Y_A=-1.10, Y_C=2.7, Y_HEADER=-0.48, Y_RG=2.02,
    HOOD=(-2.38, -1.14), TRUNK=(9.0, 9.5), DOOR_F=(-0.986, 0.104), DOOR_R=(0.110, 1.070),
    Q=[0, .04, .10, .16, .175, .185, .23, .30, .38, .48, .50, .51, .58, .68, .78, .85, .87, .895, .92, .94, .97, 1.0],
    TAILGATE=(2.395, .50), REAR_GLASS_NODE="trunk",
    DLO=[(0.075, "window", "glass"), (0.14, "B", "trim_gloss"), (1.00, "rear-window", "glass"),
         (1.07, "rear-door", "trim_gloss"), (1.90, "side-glass", "glass"), (9.0, "body", "trim_gloss")],
    ROOF_MAT="trim_gloss", RAIL_MAT="trim_gloss", CHROME_DLO=True, TAIL_FLUSH=True,
    LAMP_F_Y=-2.26, LAMP_R_Y=2.22, LAMP_SPLIT=0.50, LAMP_SPLIT_R=0.52, TAIL_CENTRE_MAT="trim_gloss",
    INTAKE_Y=-2.44, INTAKE_Q=(.16, .84), INTAKE_X=0.62,
    BLADES=(0.24, 0.32, 0.40, 0.48, 0.56, 0.64, 0.72, 0.80), VBARS=(19, 0.58), BLADE_MAT="trim_gloss",
    CURTAIN=(9.0, 9.0), ROCKER=(-1.12, 1.02), CHIN_Y=-2.1, DIFF_Y=2.2,
    SPOKES=(6, 0.09), SPOKE_TWIST=0.5, RIM=((0.16, 0.12, 0.08), 1.0, 0.28),
    INT_DZ=0.12, PAINT=(0.30, 0.22, 0.13), INTERIOR_COLOUR=(0.20, 0.12, 0.07),
    ENGINE="v8", ENGINE_ACCENT="engine_cover",
    PIVOTS={
        "wheel-front-left": (0.85, -1.52, 0.40), "wheel-front-right": (-0.85, -1.52, 0.40),
        "wheel-rear-left": (0.85, 1.50, 0.40), "wheel-rear-right": (-0.85, 1.50, 0.40),
        "brake-caliper-front-left": (0.82, -1.52, 0.40), "brake-caliper-front-right": (-0.82, -1.52, 0.40),
        "brake-caliper-rear-left": (0.82, 1.50, 0.40), "brake-caliper-rear-right": (-0.82, 1.50, 0.40),
        "hood": (0.0, -1.80, 1.14), "trunk": (0.0, 2.25, 1.45),
    },
)

# Open-roof grand roadster: the luxury convertible. Long bonnet, short tail, an open leather cockpit
# behind a raked windscreen. Small corner lamps, an oval chrome
# mesh grille, two tail lamps, polished five-spoke wheels, racing green over oxblood, a straight-six
# under body-colour cam covers. Its soft top folds away under the rear deck (FOLD_ROOF).
PRESETS["roadster"] = dict(
    Y_FRONT=-2.30, Y_REAR=2.25, Y_MID=-0.05, W=0.95, FENDER_BULGE=0.050,
    P_FRONT=3.0, P_REAR=3.2, Y_FS=-1.40, Y_RS=1.30,
    WHEELS=[(-1.38, 0.355), (1.24, 0.355)], WHEEL_X=0.82, ARCH_R=0.40, TYRE_SCALE=(1.03, 1.06),
    N_UP=4.5, N_GH=3.0,
    ZT=[(-2.33, 0.60), (-2.28, 0.63), (-2.15, 0.68), (-1.8, 0.75), (-1.2, 0.80), (-0.6, 0.83), (-0.45, 0.835),
        (0.5, 0.84), (1.2, 0.86), (1.9, 0.87), (2.15, 0.86), (2.25, 0.82)],
    ZS=[(-2.33, 0.57), (-2.15, 0.64), (-1.6, 0.71), (-0.8, 0.72), (0.2, 0.73), (0.9, 0.78), (1.3, 0.80), (2.0, 0.79),
        (2.25, 0.75)],
    ZB=[(-2.33, 0.26), (-2.25, 0.20), (-2.0, 0.19), (-1.0, 0.20), (1.0, 0.205), (1.8, 0.24), (2.1, 0.28), (2.25, 0.33)],
    ZR=[(-0.45, 0.83), (-0.32, 0.98), (-0.18, 1.10), (-0.04, 1.18), (0.25, 1.21), (0.60, 1.19), (0.85, 1.12),
        (1.00, 1.00), (1.10, 0.88)],
    Y_A=-0.45, Y_C=1.10, Y_HEADER=-0.04, Y_RG=1.05,
    HOOD=(-2.18, -0.49), TRUNK=(9.0, 9.5), DOOR_F=(-0.52, 0.60), DOOR_R=(9.0, 9.5),
    DLO=[(9.0, "body", "carpaint")], OPEN_TOP=True, FOLD_ROOF=dict(joint=0.42),
    LAMP_F_Y=-2.08, LAMP_R_Y=2.04, LAMP_SPLIT=0.56, LAMP_SPLIT_R=0.46,
    INTAKE_Y=-2.21, INTAKE_Q=(.10, .62), INTAKE_X=0.40,
    BLADES=(0.20, 0.26, 0.32, 0.38, 0.44, 0.50, 0.56), VBARS=(13, 0.37), BLADE_MAT="chrome",
    CURTAIN=(9.0, 9.0), ROCKER=(-0.95, 0.85), CHIN_Y=-2.05, DIFF_Y=2.02,
    SPOKES=(5, 0.0), RIM=((0.82, 0.82, 0.84), 1.0, 0.10),
    REAR_SEATS=False, INT_DY=0.42, INT_DZ=-0.16, PAINT=(0.012, 0.11, 0.06), INTERIOR_COLOUR=(0.15, 0.028, 0.018),
    ENGINE="i6", ENGINE_ACCENT="carpaint",
    PIVOTS=sedan_pivots(-1.38, 1.24, 0.355, x=0.82, door=0.04, hood=-1.80, trunk=1.9, mirror=-0.19, mirror_z=0.86),
)

# Electric hypercar: very low and wide, cab pushed forward under a black glass canopy, a long glass
# tail over the rear drive unit and battery, a ducktail. A closed nose with blade lamps at the
# corners, a full-width tail light, aero turbine wheels; pearl white over black, midnight-blue cabin.
PRESETS["hyper"] = dict(
    Y_FRONT=-2.40, Y_REAR=2.36, Y_MID=-0.1, W=1.0, FENDER_BULGE=0.065,
    P_FRONT=2.8, P_REAR=3.4, Y_FS=-1.45, Y_RS=1.50,
    WHEELS=[(-1.45, 0.355), (1.42, 0.36)], WHEEL_X=0.86, ARCH_R=0.40, TYRE_SCALE=(1.04, 1.12),
    N_UP=4.0, N_GH=2.4,
    ZT=[(-2.43, 0.44), (-2.38, 0.48), (-2.25, 0.55), (-1.9, 0.68), (-1.45, 0.77), (-0.95, 0.78),
        (0.5, 0.80), (1.42, 0.89), (2.0, 0.89), (2.28, 0.88), (2.36, 0.84)],
    # The wings stand over the wheels, the bonnet dips between them.
    ZS=[(-2.43, 0.45), (-2.25, 0.57), (-1.9, 0.77), (-1.45, 0.87), (-1.0, 0.81), (-0.3, 0.69), (0.5, 0.72),
        (1.0, 0.85), (1.42, 0.91), (1.9, 0.87), (2.36, 0.77)],
    ZB=[(-2.43, 0.20), (-2.35, 0.15), (-2.0, 0.13), (-1.0, 0.14), (1.0, 0.145), (2.0, 0.18), (2.25, 0.22), (2.36, 0.28)],
    ZR=[(-0.95, 0.74), (-0.75, 0.88), (-0.52, 1.01), (-0.28, 1.10), (-0.05, 1.135), (0.25, 1.12), (0.65, 1.04),
        (1.05, 0.95), (1.45, 0.87), (1.75, 0.835)],
    Y_A=-0.95, Y_C=1.75, Y_HEADER=-0.30, Y_RG=0.30,
    HOOD=(-2.28, -0.98), TRUNK=(1.80, 2.30), DOOR_F=(-1.02, 0.40), DOOR_R=(9.0, 9.5),
    DLO=[(0.36, "window", "glass"), (0.95, "side-glass", "glass"), (9.0, "body", "trim_gloss")],
    ROOF_MAT="trim_gloss", RAIL_MAT="trim_gloss",
    LAMP_F_Y=-2.16, LAMP_R_Y=2.12, LAMP_SPLIT=0.62,
    INTAKE_Y=-2.34, INTAKE_Q=(.04, .26), INTAKE_X=0.55, BLADES=(0.15,), BLADE_MAT="trim_gloss",
    CURTAIN=(-2.30, -2.20), ROCKER=(-1.05, 0.95), CHIN_Y=-2.1, DIFF_Y=1.95,
    SPOKES=(5, 0.0), SPOKE_TWIST=0.6, AERO_DISC="trim_gloss", RIM=((0.05, 0.05, 0.055), 1.0, 0.2),
    REAR_SEATS=False, INT_DY=0.20, INT_DZ=-0.22,
    PAINT=(0.80, 0.81, 0.82), INTERIOR_COLOUR=(0.03, 0.06, 0.14),
    ENGINE="ev", ENGINE_REAR=True, ENGINE_ACCENT="engine_cover",
    PIVOTS=sedan_pivots(-1.45, 1.42, 0.36, x=0.86, door=-0.30, hood=-1.75, trunk=2.05, mirror=-0.69, mirror_z=0.80),
)

for _name in ("gt", "flagship", "grandsuv", "roadster", "hyper"):
    PRESETS[_name]["EVEN_RIMS"] = False

REPORT = main()
print("triangles per object:", REPORT, "total:", sum(REPORT.values()))
