"""Rebuilds the visual meshes of orion-sedan in Blender as a modern (2026+) fastback saloon.

Run inside Blender with orion-sedan.glb imported. Every existing object keeps its name, parent,
transform and pivot; only its mesh data is replaced. Coordinates: +x = car's left, -y = front,
+z = up, metres.

    exec(open(r"C:\\oriongenix\\blender\\build_sedan_2026.py").read())
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
GJ = [0, .04, .12, .22, .32, .42, .50, .55, .585, .62, .66, .72, .80, .88, .95, 1.0]


def half_width(y):
    if y < Y_FS:
        t, p = (Y_FS - y) / (Y_FS - Y_FRONT), P_FRONT
    elif y > Y_RS:
        t, p = (y - Y_RS) / (Y_REAR - Y_RS), P_REAR
    else:
        t, p = 0.0, 2.0
    t = clamp(t, 0.0, 1.0)
    w = W * max(0.0, 1 - t ** p) ** (1 / p)
    for wy, _ in WHEELS:
        w += 0.032 * math.exp(-((y - wy) / 0.45) ** 2)
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
        return 0.11 * min(1.6, ((min(z, 0.69) - 0.50) / 0.28) ** 2) * w
    if yr > Y_RS:
        w = ((yr - Y_RS) / (Y_REAR - Y_RS)) ** 6
        return -0.10 * min(1.8, ((z - 0.62) / 0.30) ** 2) * w
    return 0.0


def body_point(yr, kind, val):
    w = half_width(yr)
    zs, zt, zb = spline(ZS, yr), spline(ZT, yr), z_bottom(yr)
    if kind == "q":
        z = zb + (zs - zb) * val
        a = arch_ness(yr)
        x = w - 0.045 * (1 - a) * (1 - val) ** 2 * (w / W)
        # Sculpting: a crisp feature line under the shoulder and a soft hollow in the doors.
        k = (w / W) ** 2
        x += k * (0.010 * smoothstep(0.70, 0.80, val) - 0.010 - 0.008 * math.sin(PI * clamp((val - 0.2) / 0.5, 0, 1)))
        if a > 0:
            x += 0.013 * a * math.exp(-((z - zb) / 0.05) ** 2)
    else:
        th = val * PI / 2
        c, s = max(math.cos(th), 0.0), max(math.sin(th), 0.0)
        x = w * c ** (2 / N_UP)
        z = zs + (zt - zs) * s ** (2 / N_UP)
    return Vector((x, yr + y_shift(yr, z), z))


def gh_point(yr, f):
    b = body_point(yr, "th", 0.50)
    th = f * PI / 2
    c, s = max(math.cos(th), 0.0), max(math.sin(th), 0.0)
    zr = spline(ZR, yr)
    r = Vector((b.x * c ** (2 / N_GH), yr, b.z + (zr - b.z) * s ** (2 / N_GH)))
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
        y += 0.05
    # Round the arches, rows evenly spaced by angle so the steep ends of the arch get the most.
    for wy, _ in WHEELS:
        for k in range(-18, 19):
            ys.add(wy + ARCH_R * math.sin(k / 18 * PI / 2 * 0.97))
        for d in (-1, 1):
            ys.add(wy + d * (ARCH_R + 0.03))
    gaps = [HOOD[0], HOOD[1], TRUNK[0], TRUNK[1], DOOR_F[0], DOOR_F[1], DOOR_R[1]]
    breaks = set()
    for g in gaps:
        breaks.add(round(g, 4))
        breaks.add(round(g + GAP, 4))
    for b in [Y_A, Y_C, Y_HEADER, Y_RG, 0.075, 0.14, 0.98, 1.03, 1.25, -2.16, -2.34, 2.08, 2.405, 2.15, -2.0, -2.29, -2.21,
              -1.08, -1.02, -0.9, -0.8]:
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
    door_rows = DOOR_F[0] <= ym <= DOOR_R[1] + GAP
    if h >= 4 and in_gap(ym, [DOOR_F[0], DOOR_F[1], DOOR_R[1]]):
        return None
    if h == 4 and door_rows:
        return None
    if h >= 5:
        if DOOR_F[0] + GAP < ym < DOOR_F[1]:
            return ("door", "carpaint")
        if DOOR_R[0] < ym < DOOR_R[1]:
            return ("rear-door", "carpaint")
    if ym < -2.16 and q0 in (.87, .895, .92):
        return ("region", "lampF")
    if ym > 2.08 and q0 in (.87, .895, .92):
        return ("region", "lampR")
    if ym < -2.34 and .10 <= q0 < .30:
        return ("region", "intake")
    if -2.29 < ym < -2.21 and .23 <= q0 < .58:
        return ("region", "curtain")
    if q0 < .10 and -1.08 < ym < 0.98:
        return ("body", "trim_black")
    if q0 < .10 and ym < -2.0:
        return ("body", "trim_black")
    if q0 < .23 and ym > 2.15:
        return ("body", "trim_black")
    return ("body", "carpaint")


def classify_gh(ym, jb):
    f0 = GJ[jb]
    if f0 < .04:
        if DOOR_F[0] < ym < DOOR_F[1]:
            return ("door", "chrome")
        if DOOR_R[0] < ym < DOOR_R[1]:
            return ("rear-door", "chrome")
        if in_gap(ym, [DOOR_F[1]]):
            return None
        return ("chrome-parts", "chrome")
    if f0 < .50:
        if ym < 0.075:
            return ("window", "glass")
        if ym < 0.14:
            if in_gap(ym, [DOOR_F[1]]):
                return None
            return ("door", "trim_gloss") if ym < DOOR_F[1] else ("rear-door", "trim_gloss")
        if ym < 0.98:
            return ("rear-window", "glass")
        if ym < 1.03:
            return ("rear-door", "trim_gloss")
        if ym < 1.25:
            return ("side-glass", "glass")
        return ("body", "carpaint")
    if f0 < .66:
        return ("body", "trim_gloss")
    if ym < Y_HEADER:
        return ("windscreen-glass", "glass")
    if ym > Y_RG:
        return ("rear-glass", "glass")
    return ("body", "carpaint")


def object_for(part, side):
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
            cls = classify_body(ym, h)
            if cls is None:
                continue
            quad = [(i, c), (i + 1, c), (i + 1, c + 1), (i, c + 1)]
            if cls[0] == "region":
                regions[cls[1]].append((quad, side, h, ym))
                continue
            mb = OUT[object_for(cls[0], side)]
            mb.face([mb.vert(("s",) + K(k), P[k[0]][k[1]]) for k in quad], cls[1])
    return rows, P, N, regions


def build_greenhouse(rows):
    grows = [y for y in rows if Y_A - 1e-6 <= y <= Y_C + 1e-6]
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
            mb.face([mb.vert((tag, a, b), G[a][b]) for a, b in [(i, c), (i + 1, c), (i + 1, c + 1), (i, c + 1)]],
                    cls[1])
    # Headliner: the roof and rails, offset inward and facing down into the cabin.
    NG = normals(G)
    cab = OUT["cabin"]
    for i in range(len(grows) - 1):
        ym = 0.5 * (grows[i] + grows[i + 1])
        if not (Y_HEADER - 0.03 < ym < Y_RG + 0.05):
            continue
        for c in range(nc - 1):
            jb, side = band_of(c, len(GJ))
            if jb < 7:
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
    inset_strip(lf, P, N, front, 0.008, "headlight", "drl", lambda q, s, h, ym, x: Q[h] == .92)
    # Indicators: outer ends of the lower strip.
    for side, mat in ((1, "indicator_left"), (-1, "indicator_right")):
        inset_strip(lf, P, N, front, 0.010, mat, f"ind{side}", lambda q, s, h, ym, x, side=side: Q[h] == .87 and s == side and x > 0.56)
    # Black reflector in the middle strip inboard of the projectors.
    inset_strip(lf, P, N, front, 0.03, "trim_gloss", "lfmid", lambda q, s, h, ym, x: Q[h] == .895 and x < 0.50)

    # Projector modules, three per side, sitting in the middle strip.
    # Main-beam LED modules: a row of small lit cubes in black bezels at each corner.
    for side in (1, -1):
        for yr in (-2.37, -2.335, -2.30, -2.262, -2.222):
            p = body_point(yr, "q", 0.9075)
            p.x *= side
            n = surface_normal(yr, 0.9075, side)
            m = frame(p - n * 0.026, n, Vector((0, 0, 1)))
            rbox(lf, (0.016, 0.030, 0.019), "trim_gloss", m, radius=0.003, segments=1)
            rbox(lf, (0.004, 0.022, 0.012), "headlight", m @ Matrix.Translation((0.008, 0, 0)), radius=0.002, segments=1)

    rear = regions["lampR"]
    lr = OUT["lights-rear"]
    recess(lr, P, N, [r[0] for r in rear], 0.04, "lamp_housing", "lamp_housing", "lr", lr, "tail_lens")
    inset_strip(lr, P, N, rear, 0.008, "tail_light", "tl", lambda q, s, h, ym, x: Q[h] in (.895, .92))
    for side, mat in ((1, "indicator_left"), (-1, "indicator_right")):
        inset_strip(lr, P, N, rear, 0.010, mat, f"rind{side}", lambda q, s, h, ym, x, side=side: Q[h] == .87 and s == side and x > 0.62)
    inset_strip(lr, P, N, rear, 0.010, "reverse_lamp", "rev", lambda q, s, h, ym, x: Q[h] == .87 and 0.30 < x < 0.62)


def surface_normal(yr, q, side):
    e = 0.004
    a = body_point(yr + e, "q", q) - body_point(yr - e, "q", q)
    b = body_point(yr, "q", min(q + 0.01, 1)) - body_point(yr, "q", max(q - 0.01, 0))
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
    rows = [y for y in make_rows() if y < -2.34]
    for k, zq in enumerate((0.15, 0.205, 0.255)):
        line = []
        for yr in rows:
            p = body_point(yr, "q", zq)
            n = surface_normal(yr, zq, 1)
            line.append(p - n * 0.028)
        line = [Vector((-p.x, p.y, p.z)) for p in reversed(line[1:])] + line
        ribbon(trim, line, 0.009, 0.014, "trim_gloss", f"blade{k}")
    # Radar panel: flat smooth plate in the middle of the opening.
    p = surface_at(-2.42, 0.2, 1, -0.012)
    rbox(trim, (0.16, 0.085, 0.012), "trim_gloss", frame(Vector((0, p.y, p.z)), Vector((1, 0, 0)), Vector((0, 0, 1))),
         radius=0.008, segments=2)

    # Air curtains: tall black slots at the front corners.
    recess(trim, P, N, [r[0] for r in regions["curtain"]], 0.035, "trim_black", "trim_black", "cu")
    # Diffuser fins across the black lower rear.
    for x in (-0.42, -0.14, 0.14, 0.42):
        best = min((abs(abs(body_point(y, "q", 0.12).x) - abs(x)), y) for y in frange(2.0, 2.412, 0.002))[1]
        p = body_point(best, "q", 0.12)
        rbox(trim, (0.010, 0.05, 0.075), "trim_black", Matrix.Translation((x, p.y - 0.006, p.z)), radius=0.003, segments=1)

    # Plate on a slim black holder standing proud of the flat tail.
    p = body_point(Y_REAR, "q", 0.48)
    hold = frame(Vector((0, p.y + 0.002, p.z)), Vector((1, 0, 0)), Vector((0, 0, 1)))
    rbox(OUT["trim"], (0.545, 0.128, 0.016), "trim_gloss", hold, radius=0.006, segments=2)
    rbox(OUT["trim"], (0.52, 0.112, 0.006), "plate_blank", hold @ Matrix.Translation((0, 0, -0.0085)),
         radius=0.004, segments=1)
    # Rear camera just above the plate.
    cam = body_point(Y_REAR, "q", 0.60)
    cylinder(OUT["trim"], frame(Vector((0, cam.y - 0.01, cam.z)), Vector((0, 1, -0.25)), Vector((1, 0, 0))), 0.011, 0.016,
             "trim_gloss", seg=12)


def build_sensors():
    trim = OUT["body"]
    for yr, q, xs in ((-2.395, 0.40, (0.18, 0.46)), (2.39, 0.33, (0.40, 0.62))):
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
    z = 0.228
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


def build_wheel_local():
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
    for k in range(5):
        for off in (-0.13, 0.13):
            spoke(mb, 2 * PI * k / 5 + off)
    # Brake disc with its hat.
    disc = [(-0.036, 0.097), (-0.036, 0.190), (-0.008, 0.190), (-0.008, 0.100), (0.012, 0.086), (0.020, 0.080),
            (0.020, 0.030)]
    lathe(mb, disc, 64, "brake_disc", I)
    return mb


def spoke(mb, phi):
    stations = [0.070, 0.098, 0.130, 0.162, 0.194, 0.222, 0.244]
    rad = Vector((0, math.sin(phi), math.cos(phi)))
    tan = Vector((0, math.cos(phi), -math.sin(phi)))
    ring = []
    for r in stations:
        u = (r - 0.07) / 0.174
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
    for v in local.v:
        mb.v.append((origin[0] + side * v[0], origin[1] + v[1], origin[2] + v[2]))
    for f, m, s in zip(local.f, local.fm, local.sm):
        ids = [base + i for i in f]
        mb.face(ids if side > 0 else ids[::-1], m, s)


def build_wheels():
    wheel = build_wheel_local()
    cal = build_caliper_local()
    for (wy, wz), axle in zip(WHEELS, ("front", "rear")):
        for side in (1, -1):
            place_local(wheel, f"wheel-{axle}-{'left' if side > 0 else 'right'}", (side * WHEEL_X, wy, wz), side)
            place_local(cal, f"brake-caliper-{axle}-{'left' if side > 0 else 'right'}", (side * WHEEL_X, wy, wz), side)


# ---------------------------------------------------------------------------------------------
# Mirrors, handles, wipers
# ---------------------------------------------------------------------------------------------
def build_mirrors():
    for side in (1, -1):
        mb = OUT[side_name("mirror", side)]
        belt = body_point(-0.86, "th", 0.50)
        base = Vector((side * (belt.x + 0.005), -0.86, belt.z + 0.012))
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
        for part, yr in (("door", -0.16), ("rear-door", 0.86)):
            mb = OUT[side_name(part, side)]
            q = 0.88
            p = surface_at(yr, q, side, 0.0)
            n = surface_normal(yr, q, side)
            # Flush handle: chrome blade in a gloss-black pocket.
            pocket = frame(p - n * 0.001, n, Vector((0, 1, 0)))
            rbox(mb, (0.006, 0.20, 0.034), "trim_gloss", pocket, radius=0.002, segments=1)
            rbox(mb, (0.006, 0.17, 0.016), "chrome", pocket @ Matrix.Translation((0.003, 0, 0)), radius=0.003, segments=2)


def build_wipers():
    trim = OUT["trim"]
    for x0, x1 in ((0.58, -0.02), (-0.05, -0.52)):
        y = Y_A + 0.055
        pa = gh_point(y, 1.0)
        z = pa.z + 0.012
        a, b = Vector((x0, y + 0.01, z)), Vector((x1, y + 0.05, z + 0.02))
        d = b - a
        m = frame(a, d, Vector((0, 0, 1)))
        rbox(trim, (d.length, 0.018, 0.012), "trim_black", m @ Matrix.Translation((d.length / 2, 0, 0)), radius=0.004, segments=1)
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

    # Floor and firewall.
    rbox(cab, (1.52, 2.55, 0.03), "interior_dark", Matrix.Translation((0, 0.25, 0.30)), radius=0.0)
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
    rbox(cab, (1.30, 0.50, 0.13), "interior", frame(Vector((0, 0.90, 0.42)), Vector((1, 0, 0)), Vector((0, 1, 0.12))),
         radius=0.05, segments=3)
    rbox(cab, (1.30, 0.12, 0.52), "interior", frame(Vector((0, 1.20, 0.72)), Vector((1, 0, 0)), Vector((0, 1, -0.45))),
         radius=0.05, segments=3)
    for x in (0.38, -0.38):
        rbox(cab, (0.24, 0.07, 0.15), "interior", Matrix.Translation((x, 1.32, 1.04)), radius=0.03, segments=2)


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
    "carpaint": ((0.034, 0.072, 0.145), 0.70, 0.36, {"coat": 1.0, "coat_rough": 0.03}),
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
    return report


def add_panel_rims(mats):
    for name in ["body", "hood", "trunk", "door-left", "door-right", "rear-door-left", "rear-door-right"]:
        ob = bpy.data.objects[name]
        # the rim (the panel's edge seen down a gap) takes the last slot: a dark gap material
        ob.data.materials.append(mats["panel_gap"])
        mod = ob.modifiers.get("PanelGapRim") or ob.modifiers.new("PanelGapRim", "SOLIDIFY")
        mod.thickness = 0.018
        mod.offset = -1.0
        mod.use_rim = True
        mod.use_rim_only = True
        mod.use_even_offset = True
        mod.material_offset_rim = len(ob.data.materials)


def main():
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
    build_interior(rows, P, N)
    mats = setup_materials()
    report = commit(mats)
    add_panel_rims(mats)
    return report


REPORT = main()
print("triangles per object:", REPORT, "total:", sum(REPORT.values()))
