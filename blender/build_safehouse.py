# The player's safehouse: a three-level modern villa on Hillcrest lot hillcrest-58.
#
#   Level 0  a stone podium holding the garage (ten bays off a central aisle, open to the
#            driveway at the front), with a stair up at the back.
#   Level 1  the glass living floor on the podium: lounge with a sofa facing a 100" TV on a stone
#            feature wall, dining, kitchen island; terraces front and right, a raised pool.
#   Level 2  a teak-clad box cantilevered over the front terrace (seen, not entered).
#
# Everything is laid out in the GAME's frame — x right, y up, z toward the road (the lot's local
# frame, origin at the lot centre on the land) — and converted to Blender's (x, -z, y) here, so
# the numbers match world/Safehouse.ts, which holds the colliders, bays and sofa for the game.
#
# Run inside Blender (after safehouse_textures.py has painted the maps):
#   exec(open(r"C:\oriongenix\blender\build_safehouse.py").read())
# then export with export_safehouse.py.
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

TEX = r"C:\oriongenix\blender\safehouse_tex"
TILE = {"stone": 2.0, "wood": 2.0, "floor": 2.4, "epoxy": 4.0, "lawn": 4.0, "plaster": 3.0, "drive": 2.4}

# ---- Layout (keep in step with src/engine/orion/world/Safehouse.ts) ----------------------------
PX = 11.5          # podium half-width
PZF = 4.0          # podium front face
PZB = -18.5        # podium back face
WALL = 0.4
F1 = 4.3           # living floor level
CEIL0 = 3.9        # garage ceiling
CEIL1 = 7.7        # living ceiling
DOOR_HALF = 3.5    # garage door: x -3.5..3.5
DOOR_TOP = 2.4
STAIR_IN = dict(x_low=2.0, x_high=-7.2, z0=-18.1, z1=-16.1)   # rises toward -x
STAIR_OUT = dict(x0=7.0, x1=10.0, z_low=13.6, z_high=PZF)     # rises toward -z
BOX = dict(x0=-11.5, x1=5.0, z0=-18.5, z1=0.0)                  # the living glass box
POOL = dict(x0=6.0, x1=11.0, z0=-16.5, z1=-3.0, top=5.28, water=5.1)
BAY_Z = [1.6, -1.8, -5.2, -8.6, -12.0]
BAY_X = 8.4
SOFA = dict(x=-6.6, z=-9.0)
TV = dict(x=-11.1, z=-9.0, y=5.85, width=2.2, height=1.24)

random.seed(58)


# ---- Scene ---------------------------------------------------------------------------------
def clear_scene():
    for obj in list(bpy.data.objects):
        if not obj.name.startswith("preview_"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)


def g2b(x, y, z):
    return Vector((x, -z, y))


# ---- Materials -----------------------------------------------------------------------------
MATS = {}


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def image(name, colour=True):
    path = os.path.join(TEX, name + ".jpg")
    img = bpy.data.images.get(name + ".jpg") or bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    return img


def make_mat(name, colour=(0.8, 0.8, 0.8), rough=0.5, metal=0.0, diff=None, nor=None, nor_strength=1.0,
             alpha=1.0, emit=None, emit_strength=1.0, double=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = principled(mat)
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if diff:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image(diff)
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if nor:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image(nor, colour=False)
        nm = nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = nor_strength
        links.new(tex.outputs["Color"], nm.inputs["Color"])
        links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
        try:
            mat.surface_render_method = "BLENDED"
        except (AttributeError, TypeError):
            pass
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    mat.use_backface_culling = not double
    MATS[name] = mat
    return mat


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def build_materials():
    make_mat("sh_stone", rough=0.85, diff="sh_stone_diff", nor="sh_stone_nor", nor_strength=1.0)
    make_mat("sh_plaster", rough=0.8, diff="sh_plaster_diff")
    make_mat("sh_wood", rough=0.55, diff="sh_wood_diff", nor="sh_wood_nor", nor_strength=0.8)
    make_mat("sh_floor", rough=0.3, diff="sh_floor_diff", nor="sh_floor_nor", nor_strength=0.4)
    make_mat("sh_epoxy", rough=0.22, diff="sh_epoxy_diff")
    make_mat("sh_lawn", rough=0.95, diff="sh_lawn_diff", nor="sh_lawn_nor", nor_strength=0.6)
    make_mat("sh_drive", colour=srgb("#4a4c4f"), rough=0.6, nor="sh_floor_nor", nor_strength=1.0)
    # Indoor twins of the walls and floors: the game lights these softly (out of the sun, a room
    # would otherwise go black); the names ending "_in" are how it knows them.
    make_mat("sh_stone_in", rough=0.85, diff="sh_stone_diff", nor="sh_stone_nor", nor_strength=1.0)
    make_mat("sh_plaster_in", rough=0.8, diff="sh_plaster_diff")
    make_mat("sh_wood_in", rough=0.55, diff="sh_wood_diff", nor="sh_wood_nor", nor_strength=0.8)
    make_mat("sh_floor_in", rough=0.3, diff="sh_floor_diff", nor="sh_floor_nor", nor_strength=0.4)
    make_mat("sh_metal", colour=srgb("#24221f"), rough=0.35, metal=0.7)
    make_mat("sh_dark", colour=srgb("#151617"), rough=0.25, metal=0.1)
    make_mat("sh_glass", colour=srgb("#a8c4cc"), rough=0.04, metal=0.2, alpha=0.26, double=True)
    make_mat("sh_water", colour=srgb("#2fa7c4"), rough=0.03, alpha=0.78)
    make_mat("sh_pool_tile", colour=srgb("#3d9fb8"), rough=0.2)
    make_mat("sh_fabric", colour=srgb("#d9d2c6"), rough=0.92)
    make_mat("sh_accent", colour=srgb("#b26b45"), rough=0.85)
    make_mat("sh_rug", colour=srgb("#6f675f"), rough=0.97)
    make_mat("sh_leaves", colour=srgb("#3f6d2b"), rough=0.75, double=True)
    make_mat("sh_bark", colour=srgb("#7a6650"), rough=0.9)
    make_mat("sh_light", colour=srgb("#fff2dc"), rough=0.4, emit=srgb("#ffd9a8"), emit_strength=6.0)
    make_mat("sh_room", colour=srgb("#3b3029"), rough=0.9, emit=srgb("#6b4a2e"), emit_strength=0.6)
    make_mat("tv_screen", colour=srgb("#050607"), rough=0.08)


# ---- Geometry helpers (game frame in, Blender out) ----------------------------------------
PARTS = []

# Face directions in the game frame, the box corners on each, and which game axes map to u, v.
FACES = {
    "+x": ((1, 0, 0), [(1, 0, 0), (1, 0, 1), (1, 1, 1), (1, 1, 0)], ("z", "y")),
    "-x": ((-1, 0, 0), [(0, 0, 1), (0, 0, 0), (0, 1, 0), (0, 1, 1)], ("z", "y")),
    "+y": ((0, 1, 0), [(0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)], ("x", "z")),
    "-y": ((0, -1, 0), [(0, 0, 1), (1, 0, 1), (1, 0, 0), (0, 0, 0)], ("x", "z")),
    "+z": ((0, 0, 1), [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)], ("x", "y")),
    "-z": ((0, 0, -1), [(1, 0, 0), (0, 0, 0), (0, 1, 0), (1, 1, 0)], ("x", "y")),
}


def tile_of(mat_name):
    for key, size in TILE.items():
        if mat_name in (f"sh_{key}", f"sh_{key}_in"):
            return size
    return 1.0


def new_object(name, mesh):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    PARTS.append(obj)
    return obj


def box(mat, x0, x1, y0, y1, z0, z1, faces=None, skip=(), bevel=0.0, name="part"):
    """An axis-aligned box in the game frame. `faces` gives some sides another material."""
    lo = (min(x0, x1), min(y0, y1), min(z0, z1))
    hi = (max(x0, x1), max(y0, y1), max(z0, z1))
    faces = faces or {}
    names = [mat] + [m for m in faces.values() if m != mat]
    verts, polys, uvs, mats = [], [], [], []
    for key, (normal, corners, (ua, va)) in FACES.items():
        if key in skip:
            continue
        material = faces.get(key, mat)
        size = tile_of(material)
        start = len(verts)
        loop_uv = []
        for c in corners:
            p = [lo[i] if c[i] == 0 else hi[i] for i in range(3)]
            verts.append(tuple(g2b(*p)))
            axis = {"x": 0, "y": 1, "z": 2}
            u = p[axis[ua]] / size
            v = p[axis[va]] / size
            loop_uv.append((u, v))
        polys.append(tuple(range(start, start + 4)))
        uvs.append(loop_uv)
        mats.append(names.index(material))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], polys)
    uv = mesh.uv_layers.new(name="UVMap")
    for poly, loop_uv in zip(mesh.polygons, uvs):
        for li, (u, v) in zip(poly.loop_indices, loop_uv):
            uv.data[li].uv = (u, v)
    for m in names:
        mesh.materials.append(MATS[m])
    for poly, mi in zip(mesh.polygons, mats):
        poly.material_index = mi
    fix_normals(mesh, [FACES[k][0] for k in FACES if k not in skip])
    obj = new_object(name, mesh)
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    return obj


def fix_normals(mesh, wanted):
    """Flip any face whose normal points away from the game-frame direction it was built for."""
    for poly, n in zip(mesh.polygons, wanted):
        want = g2b(*n)
        if poly.normal.dot(want) < 0:
            poly.flip()
    mesh.update()


def quad(mat, a, b, c, d, uv=None, name="quad"):
    """A single face through four game-frame points (double-sided materials only, or facing out)."""
    pts = [g2b(*p) for p in (a, b, c, d)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(p) for p in pts], [], [(0, 1, 2, 3)])
    layer = mesh.uv_layers.new(name="UVMap")
    coords = uv or [(0, 0), (1, 0), (1, 1), (0, 1)]
    for li, (u, v) in zip(mesh.polygons[0].loop_indices, coords):
        layer.data[li].uv = (u, v)
    mesh.materials.append(MATS[mat])
    return new_object(name, mesh)


def cylinder(mat, x, z, y0, y1, r0, r1=None, segments=12, name="cyl"):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r0, radius2=r1 if r1 is not None else r0,
                          depth=y1 - y0, matrix=Matrix.Translation(g2b(x, (y0 + y1) / 2, z)), calc_uvs=True)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(MATS[mat])
    for poly in mesh.polygons:
        poly.use_smooth = True
    return new_object(name, mesh)


def blob(mat, x, y, z, sx, sy, sz, subdiv=2, jitter=0.12, name="blob"):
    """A leafy mass: a squashed, jittered icosphere."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        k = 1 + random.uniform(-jitter, jitter)
        v.co = Vector((v.co.x * sx * k, v.co.y * sz * k, v.co.z * sy * k)) + g2b(x, y, z)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(MATS[mat])
    for poly in mesh.polygons:
        poly.use_smooth = True
    return new_object(name, mesh)


def shrub(x, z, y=0.0, size=0.6):
    for _ in range(3):
        blob("sh_leaves", x + random.uniform(-0.25, 0.25) * size, y + size * random.uniform(0.6, 0.9),
             z + random.uniform(-0.25, 0.25) * size, size * 0.8, size * 0.7, size * 0.8, subdiv=1)


def palm(x, z, height=7.5, lean=(0.5, 0.2)):
    """A tall palm: a tapering, gently leaning trunk and a crown of drooping fronds."""
    rings = 7
    top = (x + lean[0], height, z + lean[1])
    for i in range(rings):
        t0, t1 = i / rings, (i + 1) / rings
        cx = x + lean[0] * (t0 ** 1.6)
        cz = z + lean[1] * (t0 ** 1.6)
        cylinder("sh_bark", cx, cz, height * t0, height * t1 + 0.02, 0.24 - 0.1 * t0, 0.24 - 0.1 * t1, segments=8, name="palm-trunk")
    fronds = 11
    for k in range(fronds):
        angle = k / fronds * math.tau + random.uniform(-0.2, 0.2)
        length = random.uniform(2.8, 3.6)
        dx, dz = math.cos(angle), math.sin(angle)
        px, pz = -dz, dx
        rows = []
        steps = 6
        for s in range(steps + 1):
            t = s / steps
            droop = -1.9 * t * t + 0.7 * t
            cx = top[0] + dx * length * t
            cz = top[2] + dz * length * t
            w = 0.62 * math.sin(math.pi * min(1.0, t * 0.95 + 0.05))
            # Leaflets fold down from the spine: a shallow V, so the frond has body from any side.
            mid = (cx, top[1] + droop, cz)
            rows.append(((cx - px * w, top[1] + droop - w * 0.45, cz - pz * w), mid, (cx + px * w, top[1] + droop - w * 0.45, cz + pz * w)))
        for s in range(steps):
            (a0, m0, b0), (a1, m1, b1) = rows[s], rows[s + 1]
            quad("sh_leaves", a0, m0, m1, a1, name="palm-frond")
            quad("sh_leaves", m0, b0, b1, m1, name="palm-frond")


def glass_panel(x0, x1, y0, y1, z0, z1, mullion=None):
    """A glazed wall between two points (one of x/z constant), with frames and optional mullions."""
    box("sh_glass", x0, x1, y0, y1, z0, z1, name="glass")
    along_x = abs(x1 - x0) > abs(z1 - z0)
    t = 0.07
    if along_x:
        zc = (z0 + z1) / 2
        box("sh_metal", x0, x1, y0, y0 + 0.08, zc - t, zc + t, name="frame")
        box("sh_metal", x0, x1, y1 - 0.08, y1, zc - t, zc + t, name="frame")
        if mullion:
            n = max(1, round(abs(x1 - x0) / mullion))
            for i in range(n + 1):
                xm = x0 + (x1 - x0) * i / n
                box("sh_metal", xm - 0.04, xm + 0.04, y0, y1, zc - t, zc + t, name="mullion")
    else:
        xc = (x0 + x1) / 2
        box("sh_metal", xc - t, xc + t, y0, y0 + 0.08, z0, z1, name="frame")
        box("sh_metal", xc - t, xc + t, y1 - 0.08, y1, z0, z1, name="frame")
        if mullion:
            n = max(1, round(abs(z1 - z0) / mullion))
            for i in range(n + 1):
                zm = z0 + (z1 - z0) * i / n
                box("sh_metal", xc - t, xc + t, y0, y1, zm - 0.04, zm + 0.04, name="mullion")


def balustrade(x0, z0, x1, z1, y=F1, height=1.1):
    """Frameless glass guard with a slim top rail."""
    if abs(x1 - x0) > abs(z1 - z0):
        box("sh_glass", x0, x1, y, y + height, z0 - 0.012, z0 + 0.012, name="guard")
        box("sh_metal", x0, x1, y + height, y + height + 0.04, z0 - 0.03, z0 + 0.03, name="rail")
    else:
        box("sh_glass", x0 - 0.012, x0 + 0.012, y, y + height, z0, z1, name="guard")
        box("sh_metal", x0 - 0.03, x0 + 0.03, y + height, y + height + 0.04, z0, z1, name="rail")


# ---- The house ----------------------------------------------------------------------------
def site():
    # Lawn over the whole lot, with cut-outs left to the driveway and the stair's foot path.
    box("sh_lawn", -17, 17, -0.05, 0.015, -25, PZB, name="lawn-back")
    box("sh_lawn", -17, -PX, -0.05, 0.015, PZB, 15, name="lawn-left")
    box("sh_lawn", PX, 17, -0.05, 0.015, PZB, STAIR_OUT["z_low"] + 1.2, name="lawn-right")
    box("sh_lawn", -PX, -DOOR_HALF - 0.3, -0.05, 0.015, PZF, 15, name="lawn-front-left")
    box("sh_lawn", DOOR_HALF + 0.3, STAIR_OUT["x0"] - 0.6, -0.05, 0.015, PZF, 15, name="lawn-front-mid")
    box("sh_lawn", STAIR_OUT["x1"] + 0.6, 17, -0.05, 0.015, STAIR_OUT["z_low"] + 1.2, 15, name="lawn-front-right")
    box("sh_lawn", STAIR_OUT["x0"] - 0.6, STAIR_OUT["x1"] + 0.6, -0.05, 0.015, PZF, STAIR_OUT["z_low"], name="lawn-under-stair")
    # Driveway: dark granite setts with a lighter border.
    box("sh_drive", -DOOR_HALF, DOOR_HALF, -0.05, 0.03, PZF, 15, name="driveway")
    box("sh_plaster", -DOOR_HALF - 0.3, -DOOR_HALF, -0.05, 0.05, PZF, 15, name="drive-edge")
    box("sh_plaster", DOOR_HALF, DOOR_HALF + 0.3, -0.05, 0.05, PZF, 15, name="drive-edge")
    # Path from the pavement to the front stair.
    box("sh_floor", STAIR_OUT["x0"] - 0.6, STAIR_OUT["x1"] + 0.6, -0.05, 0.03, STAIR_OUT["z_low"], 15, name="path")
    # Hedges round the lot, open at the front for the drive and the path.
    for (x0, x1, z0, z1) in ((-17, -16.3, -25, 14.6), (16.3, 17, -25, 14.6), (-17, 17, -25, -24.3),
                             (-16.3, -DOOR_HALF - 1.2, 14.0, 14.6), (DOOR_HALF + 1.2, STAIR_OUT["x0"] - 1.0, 14.0, 14.6),
                             (STAIR_OUT["x1"] + 1.0, 16.3, 14.0, 14.6)):
        box("sh_leaves", x0, x1, 0, 0.8 if z0 > 0 else 1.15, z0, z1, bevel=0.12, name="hedge")
    palm(-5.6, 12.6, 8.2, (0.6, 0.3))
    palm(5.4, 12.2, 7.4, (-0.4, 0.5))
    palm(-14.0, 9.0, 9.0, (0.3, -0.4))
    palm(14.2, -22.0, 8.5, (-0.5, 0.2))
    palm(-14.5, -21.5, 7.8, (0.4, 0.5))


def podium():
    # Stone walls, plaster-lined inside.
    inside = "sh_plaster_in"
    box("sh_stone", -PX, -DOOR_HALF, 0, CEIL0, PZF - WALL, PZF, faces={"-z": inside}, name="podium-front")
    box("sh_stone", DOOR_HALF, PX, 0, CEIL0, PZF - WALL, PZF, faces={"-z": inside}, name="podium-front")
    box("sh_stone", -DOOR_HALF, DOOR_HALF, DOOR_TOP, CEIL0, PZF - WALL, PZF, faces={"-z": inside, "-y": "sh_metal"}, name="door-header")
    box("sh_stone", -PX, -PX + WALL, 0, CEIL0, PZB, PZF, faces={"+x": inside}, name="podium-side")
    box("sh_stone", PX - WALL, PX, 0, CEIL0, PZB, PZF, faces={"-x": inside}, name="podium-side")
    box("sh_stone", -PX, PX, 0, CEIL0, PZB, PZB + WALL, faces={"+z": "sh_wood_in"}, name="podium-back")
    # Door reveal: a dark metal frame round the opening, a light line in the header.
    box("sh_metal", -DOOR_HALF - 0.12, -DOOR_HALF, 0, DOOR_TOP, PZF - WALL, PZF + 0.06, name="door-jamb")
    box("sh_metal", DOOR_HALF, DOOR_HALF + 0.12, 0, DOOR_TOP, PZF - WALL, PZF + 0.06, name="door-jamb")
    box("sh_light", -DOOR_HALF, DOOR_HALF, DOOR_TOP - 0.03, DOOR_TOP, PZF - 0.2, PZF - 0.12, name="door-light")

    # The slab over the garage: plaster edges and soffit, limestone on top. A hole for the stair.
    top = {"+y": "sh_floor", "-y": "sh_plaster_in"}
    over = 0.3
    sx0, sx1, sz0, sz1 = STAIR_IN["x_high"], STAIR_IN["x_low"], STAIR_IN["z0"], STAIR_IN["z1"]
    box("sh_plaster", -PX - over, PX + over, CEIL0, F1, sz1, PZF + over, faces=top, name="slab")
    box("sh_plaster", -PX - over, sx0, CEIL0, F1, PZB - over, sz1, faces=top, name="slab")
    box("sh_plaster", sx1, PX + over, CEIL0, F1, PZB - over, sz1, faces=top, name="slab")
    box("sh_plaster", sx0, sx1, CEIL0, F1, PZB - over, sz0, faces=top, name="slab")
    # A warm light line under the front overhang, and uplights washing the stone.
    box("sh_light", -PX, PX, CEIL0 - 0.02, CEIL0, PZF + 0.12, PZF + 0.2, name="soffit-light")
    for x in (-10.2, -7.6, -5.0, 5.0, 7.6, 10.2):
        if STAIR_OUT["x0"] - 0.3 < x < STAIR_OUT["x1"] + 0.3:
            continue
        box("sh_metal", x - 0.12, x + 0.12, 0, 0.08, PZF + 0.1, PZF + 0.3, name="uplight")
        box("sh_light", x - 0.08, x + 0.08, 0.08, 0.1, PZF + 0.14, PZF + 0.26, name="uplight-lens")
    # Stone planters along the podium front, either side of the door.
    for (x0, x1) in ((-PX + 0.2, -DOOR_HALF - 1.0), (DOOR_HALF + 1.0, STAIR_OUT["x0"] - 0.8)):
        box("sh_stone", x0, x1, 0, 0.7, PZF, PZF + 1.0, faces={"+y": "sh_plaster"}, name="planter")
        box("sh_lawn", x0 + 0.1, x1 - 0.1, 0.7, 0.72, PZF + 0.1, PZF + 0.9, name="planter-soil")
        n = max(2, int((x1 - x0) / 1.4))
        for i in range(n):
            shrub(x0 + (i + 0.5) * (x1 - x0) / n, PZF + 0.5, 0.65, 0.55)


def garage():
    box("sh_epoxy", -PX + WALL, PX - WALL, -0.05, 0.02, PZB + WALL, PZF, name="garage-floor")
    # Bay lines, wheel stops, and a number plate of light over each bay.
    for side in (-1, 1):
        for i in range(len(BAY_Z) + 1):
            z = BAY_Z[0] + 1.7 - i * 3.4
            box("sh_plaster", side * 5.8, side * (PX - WALL), 0.02, 0.026, z - 0.05, z + 0.05, name="bay-line")
        for z in BAY_Z:
            box("sh_dark", side * 10.25, side * 10.55, 0.02, 0.14, z - 0.8, z + 0.8, name="wheel-stop")
            box("sh_light", side * (PX - WALL - 0.02), side * (PX - WALL), 0.6, 2.6, z - 0.03, z + 0.03, name="bay-light")
    # Aisle markings toward the door.
    for z in range(2, -15, -3):
        box("sh_plaster", -0.08, 0.08, 0.02, 0.026, z - 0.9, z, name="aisle-dash")
    # Linear ceiling lights: two runs down the aisle, one over each row of bays. The span is clear
    # (no columns), so a car can swing out of its bay anywhere.
    for x in (-1.6, 1.6, -BAY_X, BAY_X):
        box("sh_light", x - 0.06, x + 0.06, CEIL0 - 0.04, CEIL0, PZB + 1.0, PZF - 1.0, name="ceiling-light")
    # The back wall's teak is lit from a cove along its foot.
    box("sh_light", -PX + WALL, PX - WALL, 0.02, 0.05, PZB + WALL, PZB + WALL + 0.06, name="cove")


def stairs():
    # Inside: from the garage's back aisle up along the back wall to the living floor.
    n = 24
    x_low, x_high, z0, z1 = STAIR_IN["x_low"], STAIR_IN["x_high"], STAIR_IN["z0"], STAIR_IN["z1"]
    run = (x_low - x_high) / n
    rise = F1 / n
    for i in range(n):
        xa = x_low - (i + 1) * run
        xb = x_low - i * run
        box("sh_plaster_in", xa, xb, 0, (i + 1) * rise, z0, z1, faces={"+y": "sh_floor_in"}, name="step")
    # Sloped glass guard on the open (aisle) side, then a guard round the hole upstairs.
    quad("sh_glass", (x_low, 0, z1), (x_high, F1, z1), (x_high, F1 + 1.0, z1), (x_low, 1.0, z1), name="stair-guard")
    box("sh_metal", x_high, x_low, 0.98, 1.02, z1 - 0.03, z1 + 0.03, name="stair-rail").rotation_euler = (0, 0, 0)
    balustrade(x_high, z1, x_low, z1)
    balustrade(x_low, z0, x_low, z1)

    # Outside: the front stair from the garden up to the terrace, between glass guards.
    n = 24
    x0, x1, z_low, z_high = STAIR_OUT["x0"], STAIR_OUT["x1"], STAIR_OUT["z_low"], STAIR_OUT["z_high"]
    run = (z_low - z_high) / n
    for i in range(n):
        za = z_low - (i + 1) * run
        zb = z_low - i * run
        box("sh_stone", x0, x1, 0, (i + 1) * rise, za, zb, faces={"+y": "sh_floor"}, name="front-step")
    for x in (x0, x1):
        quad("sh_glass", (x, 0.15, z_low), (x, F1 + 0.15, z_high), (x, F1 + 1.15, z_high), (x, 1.15, z_low), name="front-stair-guard")
        box("sh_light", x - 0.03, x + 0.03, 0.15, 0.2, z_high, z_low, name="step-light")


def living_box():
    x0, x1, z0, z1 = BOX["x0"], BOX["x1"], BOX["z0"], BOX["z1"]
    # Back wall (plaster), left wall (teak outside, ledgestone feature inside for the TV).
    box("sh_plaster", x0, x1, F1, CEIL1, z0, z0 + WALL, faces={"+z": "sh_plaster_in"}, name="back-wall")
    box("sh_wood", x0, x0 + WALL, F1, CEIL1, z0, z1, faces={"+x": "sh_stone_in"}, name="tv-wall")
    # The indoor floor laid over the slab's limestone, round the stair's hole.
    fy = F1 + 0.006
    sx0, sx1, sz0, sz1 = STAIR_IN["x_high"], STAIR_IN["x_low"], STAIR_IN["z0"], STAIR_IN["z1"]
    box("sh_floor_in", x0 + WALL, x1 - 0.1, F1, fy, sz1, z1 - 0.1, skip=("-y",), name="floor-in")
    box("sh_floor_in", x0 + WALL, sx0, F1, fy, z0 + WALL, sz1, skip=("-y",), name="floor-in")
    box("sh_floor_in", sx1, x1 - 0.1, F1, fy, z0 + WALL, sz1, skip=("-y",), name="floor-in")
    # Glazing: the front (with an opening to walk in at x 1.5..3.5) and the pool side.
    glass_panel(x0 + WALL, 1.5, F1, CEIL1, z1 - 0.1, z1, mullion=2.6)
    glass_panel(3.5, x1, F1, CEIL1, z1 - 0.1, z1, mullion=2.0)
    box("sh_metal", 1.42, 1.5, F1, CEIL1, z1 - 0.12, z1 + 0.02, name="door-post")
    box("sh_metal", 3.5, 3.58, F1, CEIL1, z1 - 0.12, z1 + 0.02, name="door-post")
    box("sh_metal", 1.5, 3.5, CEIL1 - 0.6, CEIL1, z1 - 0.12, z1, name="door-transom")
    glass_panel(x1 - 0.1, x1, F1, CEIL1, z0 + WALL, z1, mullion=2.3)
    # Ceiling slab (the top floor's), deep overhang to the front.
    box("sh_plaster", x0 - 0.3, x1 + 0.3, CEIL1, CEIL1 + 0.4, z0 - 0.3, z1 + 0.6, faces={"-y": "sh_plaster_in"}, name="ceiling-slab")
    # Downlights in a grid, and a cove line along the feature wall.
    for gx in (-9.0, -6.0, -3.0, 0.0, 3.0):
        for gz in (-16.0, -13.0, -10.0, -7.0, -4.0, -1.5):
            if gx < STAIR_IN["x_low"] and gz < -15.5:
                continue
            box("sh_light", gx - 0.09, gx + 0.09, CEIL1 - 0.012, CEIL1, gz - 0.09, gz + 0.09, name="downlight")
    box("sh_light", x0 + WALL, x0 + WALL + 0.05, CEIL1 - 0.05, CEIL1, z0 + WALL, z1 - 0.2, name="cove")
    # Front soffit line under the overhang.
    box("sh_light", x0, x1, CEIL1 - 0.02, CEIL1, z1 + 0.4, z1 + 0.48, name="soffit-light")


def top_floor():
    # Teak box cantilevered toward the street, a long ribbon window across its front.
    x0, x1, z0, z1 = -12.2, 1.5, -15.5, 2.2
    y0, y1 = CEIL1 + 0.4, CEIL1 + 3.6
    wy0, wy1 = y0 + 0.7, y1 - 0.6
    box("sh_wood", x0, x1, y0, y1, z0, z1 - 0.25, faces={"-y": "sh_plaster"}, name="top-box")
    # Front: frame around a recessed window band (warm room behind dark glass).
    box("sh_wood", x0, x1, y0, wy0, z1 - 0.25, z1, faces={"-y": "sh_plaster"}, name="top-front")
    box("sh_wood", x0, x1, wy1, y1, z1 - 0.25, z1, name="top-front")
    box("sh_wood", x0, x0 + 0.6, wy0, wy1, z1 - 0.25, z1, name="top-front")
    box("sh_wood", x1 - 0.6, x1, wy0, wy1, z1 - 0.25, z1, name="top-front")
    box("sh_room", x0 + 0.6, x1 - 0.6, wy0, wy1, z1 - 0.26, z1 - 0.24, name="top-room")
    glass_panel(x0 + 0.6, x1 - 0.6, wy0, wy1, z1 - 0.12, z1 - 0.08, mullion=3.0)
    # Side window on the right end, same treatment.
    box("sh_room", x1 + 0.001, x1 + 0.01, wy0, wy1, -10.0, -2.0, name="top-room")
    box("sh_glass", x1 + 0.01, x1 + 0.03, wy0, wy1, -10.0, -2.0, name="glass")
    # Thin roof plate, overhanging all round.
    box("sh_plaster", x0 - 0.35, x1 + 0.35, y1, y1 + 0.28, z0 - 0.35, z1 + 0.35, name="roof")
    box("sh_metal", x0 - 0.35, x1 + 0.35, y1 + 0.28, y1 + 0.32, z0 - 0.35, z1 + 0.35, name="roof-edge")
    # Roof of the part of the living floor the top box doesn't cover: a planted roof edge.
    box("sh_metal", 1.5, BOX["x1"] + 0.3, CEIL1 + 0.4, CEIL1 + 0.5, BOX["z0"] - 0.3, BOX["z1"] + 0.6, name="roof-edge")


def terraces():
    # Glass guards round the podium top, open where the front stair arrives.
    edge = PX + 0.3
    front = PZF + 0.3
    back = PZB - 0.3
    balustrade(-edge, front - 0.05, STAIR_OUT["x0"], front - 0.05)
    balustrade(STAIR_OUT["x1"], front - 0.05, edge, front - 0.05)
    balustrade(edge - 0.05, back, edge - 0.05, front)
    balustrade(BOX["x1"], back + 0.05, edge, back + 0.05)
    balustrade(-edge + 0.05, BOX["z1"], -edge + 0.05, front)
    # The raised pool: stone kerb, pale coping, tiled basin, water.
    p = POOL
    kerb = 0.3
    box("sh_stone", p["x0"], p["x1"], F1, p["top"], p["z0"], p["z0"] + kerb, faces={"+y": "sh_plaster", "+z": "sh_pool_tile"}, name="pool-kerb")
    box("sh_stone", p["x0"], p["x1"], F1, p["top"], p["z1"] - kerb, p["z1"], faces={"+y": "sh_plaster", "-z": "sh_pool_tile"}, name="pool-kerb")
    box("sh_stone", p["x0"], p["x0"] + kerb, F1, p["top"], p["z0"] + kerb, p["z1"] - kerb, faces={"+y": "sh_plaster", "+x": "sh_pool_tile"}, name="pool-kerb")
    box("sh_stone", p["x1"] - kerb, p["x1"], F1, p["top"], p["z0"] + kerb, p["z1"] - kerb, faces={"+y": "sh_plaster", "-x": "sh_pool_tile"}, name="pool-kerb")
    box("sh_pool_tile", p["x0"] + kerb, p["x1"] - kerb, F1, F1 + 0.1, p["z0"] + kerb, p["z1"] - kerb, name="pool-floor")
    box("sh_water", p["x0"] + kerb, p["x1"] - kerb, p["water"] - 0.02, p["water"], p["z0"] + kerb, p["z1"] - kerb, skip=("-y",), name="pool-water")
    box("sh_light", p["x0"] + kerb, p["x1"] - kerb, F1 + 0.1, F1 + 0.12, p["z0"] + kerb + 0.5, p["z0"] + kerb + 0.56, name="pool-light")
    # Sun loungers between the pool and the front guard.
    for x in (6.6, 9.0):
        z0, z1 = -2.3, -0.3
        box("sh_wood", x, x + 0.8, F1, F1 + 0.32, z0, z1, bevel=0.03, name="lounger")
        box("sh_fabric", x + 0.04, x + 0.76, F1 + 0.32, F1 + 0.42, z0 + 0.5, z1 - 0.02, bevel=0.04, name="lounger-pad")
        top = (x + 0.04, F1 + 0.42, z0 + 0.5)
        quad("sh_fabric", (x + 0.04, F1 + 0.4, z0 + 0.5), (x + 0.76, F1 + 0.4, z0 + 0.5), (x + 0.76, F1 + 0.95, z0 + 0.02), (x + 0.04, F1 + 0.95, z0 + 0.02), name="lounger-back")
    cylinder("sh_metal", 8.4, -1.3, F1, F1 + 2.4, 0.03, name="parasol-pole")
    cylinder("sh_fabric", 8.4, -1.3, F1 + 2.1, F1 + 2.45, 1.4, 0.05, segments=16, name="parasol")
    # Planters on the front terrace.
    for (x, z) in ((-10.2, 2.9), (-6.0, 2.9), (0.0, 2.9), (4.2, 2.9)):
        box("sh_stone", x - 0.45, x + 0.45, F1, F1 + 0.6, z - 0.45, z + 0.45, faces={"+y": "sh_lawn"}, name="pot")
        shrub(x, z, F1 + 0.55, 0.6)
    # Outdoor lounge chairs by the front door.
    for x in (-3.4, -1.6):
        box("sh_wood", x - 0.4, x + 0.4, F1, F1 + 0.38, 1.6, 2.4, bevel=0.03, name="chair")
        box("sh_fabric", x - 0.36, x + 0.36, F1 + 0.38, F1 + 0.48, 1.62, 2.38, bevel=0.04, name="chair-pad")
        box("sh_fabric", x - 0.36, x + 0.36, F1 + 0.38, F1 + 0.95, 2.3, 2.4, bevel=0.04, name="chair-back")


def interior():
    # Lounge: rug, sofa facing the TV wall, coffee table, floor lamp, plants.
    box("sh_rug", -10.2, -4.6, F1, F1 + 0.015, -12.0, -6.0, name="rug")
    sx, sz = SOFA["x"], SOFA["z"]
    half = 1.6
    box("sh_fabric", sx - 0.5, sx + 0.5, F1 + 0.08, F1 + 0.42, sz - half, sz + half, bevel=0.05, name="sofa-base")
    box("sh_dark", sx - 0.45, sx + 0.45, F1, F1 + 0.08, sz - half + 0.05, sz + half - 0.05, name="sofa-plinth")
    box("sh_fabric", sx + 0.25, sx + 0.5, F1 + 0.42, F1 + 0.88, sz - half, sz + half, bevel=0.06, name="sofa-back")
    for zc in (sz - 1.05, sz, sz + 1.05):
        box("sh_fabric", sx - 0.48, sx + 0.24, F1 + 0.42, F1 + 0.55, zc - 0.5, zc + 0.5, bevel=0.06, name="sofa-cushion")
        box("sh_fabric", sx + 0.08, sx + 0.26, F1 + 0.5, F1 + 0.85, zc - 0.48, zc + 0.48, bevel=0.07, name="sofa-back-cushion")
    for zc in (sz - half - 0.12, sz + half + 0.12):
        box("sh_fabric", sx - 0.5, sx + 0.5, F1 + 0.08, F1 + 0.68, zc - 0.13, zc + 0.13, bevel=0.06, name="sofa-arm")
    for zc in (sz - 1.25, sz + 1.25):
        box("sh_accent", sx + 0.0, sx + 0.12, F1 + 0.55, F1 + 0.95, zc - 0.22, zc + 0.22, bevel=0.05, name="pillow")
    # Coffee table: walnut top on a dark plinth.
    box("sh_dark", -9.0, -8.2, F1, F1 + 0.3, -9.6, -8.4, name="table-base")
    box("sh_wood_in", -9.3, -7.9, F1 + 0.3, F1 + 0.38, -9.9, -8.1, bevel=0.02, name="table-top")
    # TV: slim black frame on the stone, the screen its own material (lit by the game).
    tz, ty, w, h = TV["z"], TV["y"], TV["width"], TV["height"]
    tx = BOX["x0"] + WALL
    box("sh_dark", tx, tx + 0.05, ty - h / 2 - 0.03, ty + h / 2 + 0.03, tz - w / 2 - 0.03, tz + w / 2 + 0.03, name="tv-frame")
    # Facing +x: the viewer's right is -z, so u runs from +z to -z.
    quad("tv_screen", (tx + 0.052, ty - h / 2, tz + w / 2), (tx + 0.052, ty - h / 2, tz - w / 2),
         (tx + 0.052, ty + h / 2, tz - w / 2), (tx + 0.052, ty + h / 2, tz + w / 2), name="tv-screen")
    box("sh_wood_in", tx, tx + 0.45, F1 + 0.25, F1 + 0.6, tz - 2.4, tz + 2.4, bevel=0.02, name="tv-console")
    box("sh_light", tx + 0.42, tx + 0.45, F1 + 0.22, F1 + 0.25, tz - 2.3, tz + 2.3, name="console-glow")
    # Floor lamp arcing over the sofa's end.
    cylinder("sh_metal", -5.6, -11.4, F1, F1 + 0.04, 0.22, name="lamp-foot")
    cylinder("sh_metal", -5.6, -11.4, F1, F1 + 1.9, 0.02, name="lamp-stem")
    cylinder("sh_light", -5.6, -11.4, F1 + 1.75, F1 + 1.98, 0.22, 0.12, name="lamp-shade")
    # Plants.
    for (x, z, s) in ((-10.4, -1.2, 0.8), (-10.4, -14.6, 0.75), (4.0, -1.0, 0.7)):
        cylinder("sh_dark", x, z, F1, F1 + 0.6, 0.3, 0.24, segments=14, name="planter")
        shrub(x, z, F1 + 0.65, s)
        blob("sh_leaves", x, F1 + 1.6 * s + 0.4, z, 0.45 * s, 0.7 * s, 0.45 * s, subdiv=1)

    # Dining: walnut table, six chairs, a linear pendant.
    box("sh_wood_in", -0.8, 2.6, F1 + 0.72, F1 + 0.78, -6.8, -4.8, bevel=0.015, name="dining-top")
    # Two slim blade legs, set in from the ends.
    for x in (-0.2, 2.0):
        box("sh_metal", x - 0.025, x + 0.025, F1, F1 + 0.72, -6.3, -5.3, name="dining-leg")
        box("sh_metal", x - 0.03, x + 0.03, F1, F1 + 0.02, -6.5, -5.1, name="dining-foot")
    for x in (-0.2, 0.9, 2.0):
        for (z, back) in ((-7.3, -7.56), (-4.3, -4.04)):
            out = 1 if back > z else -1
            box("sh_fabric", x - 0.23, x + 0.23, F1 + 0.42, F1 + 0.48, z - 0.23, z + 0.23, bevel=0.025, name="chair-seat")
            box("sh_fabric", x - 0.22, x + 0.22, F1 + 0.55, F1 + 0.9, back - 0.03, back + 0.03, bevel=0.025, name="chair-back")
            # Thin steel legs, the back pair running on up to hold the back.
            for lx in (x - 0.19, x + 0.19):
                for lz in (z - 0.19, z + 0.19):
                    rear = (lz - z) * out > 0
                    top = F1 + (0.9 if rear else 0.42)
                    cylinder("sh_metal", lx, lz, F1, top, 0.014, segments=6, name="chair-leg")
    box("sh_metal", -0.4, 2.2, CEIL1 - 1.2, CEIL1 - 1.14, -5.86, -5.74, name="pendant")
    box("sh_light", -0.38, 2.18, CEIL1 - 1.215, CEIL1 - 1.2, -5.84, -5.76, name="pendant-light")
    for x in (-0.2, 2.0):
        box("sh_metal", x - 0.005, x + 0.005, CEIL1 - 1.14, CEIL1, -5.805, -5.795, name="pendant-wire")

    # Kitchen: island with a dark cooktop, bar stools, tall teak units on the back wall.
    box("sh_wood_in", -0.4, 3.4, F1, F1 + 0.88, -13.0, -11.8, name="island")
    box("sh_floor_in", -0.5, 3.5, F1 + 0.88, F1 + 0.94, -13.05, -11.6, name="island-top")
    box("sh_dark", 0.4, 1.4, F1 + 0.94, F1 + 0.945, -12.8, -12.2, name="cooktop")
    for x in (0.0, 1.4, 2.8):
        cylinder("sh_metal", x, -11.15, F1, F1 + 0.66, 0.03, segments=8, name="stool-leg")
        cylinder("sh_fabric", x, -11.15, F1 + 0.62, F1 + 0.72, 0.2, segments=14, name="stool-seat")
    kx0 = STAIR_IN["x_low"] + 0.2
    box("sh_wood_in", kx0, BOX["x1"] - 0.15, F1, CEIL1 - 0.6, BOX["z0"] + WALL, BOX["z0"] + WALL + 0.62, name="tall-units")
    box("sh_dark", kx0 + 0.6, kx0 + 1.5, F1 + 0.9, F1 + 1.5, BOX["z0"] + WALL + 0.62, BOX["z0"] + WALL + 0.64, name="oven")
    for x in (0.4, 1.4, 2.4):
        cylinder("sh_metal", x, -12.4, CEIL1 - 1.3, CEIL1, 0.006, segments=6, name="pendant-wire")
        cylinder("sh_light", x, -12.4, CEIL1 - 1.5, CEIL1 - 1.3, 0.14, 0.05, segments=14, name="pendant")

    # Art on the back wall over the stairwell.
    # A large abstract canvas: terracotta, sand and charcoal fields in a slim black frame.
    zf = BOX["z0"] + WALL
    box("sh_dark", -6.2, -2.6, F1 + 1.2, F1 + 2.8, zf, zf + 0.04, name="art-frame")
    box("sh_plaster_in", -6.12, -2.68, F1 + 1.28, F1 + 2.72, zf + 0.04, zf + 0.045, name="art-ground")
    box("sh_accent", -6.0, -4.3, F1 + 1.4, F1 + 2.6, zf + 0.045, zf + 0.05, name="art-field")
    box("sh_rug", -4.15, -2.8, F1 + 1.95, F1 + 2.6, zf + 0.045, zf + 0.05, name="art-field")
    box("sh_dark", -4.15, -3.3, F1 + 1.4, F1 + 1.8, zf + 0.045, zf + 0.05, name="art-field")


def finish():
    """Bake modifiers, join everything into one mesh, smooth only what's round."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in PARTS:
        if obj.modifiers:
            evaluated = obj.evaluated_get(depsgraph)
            mesh = bpy.data.meshes.new_from_object(evaluated)
            obj.modifiers.clear()
            old = obj.data
            obj.data = mesh
            bpy.data.meshes.remove(old)
    with bpy.context.temp_override(active_object=PARTS[0], selected_editable_objects=PARTS, selected_objects=PARTS):
        bpy.ops.object.join()
    house = PARTS[0]
    house.name = "safehouse"
    house.data.name = "safehouse"
    # Triangles, so the exporter can write tangents for the normal maps.
    bm = bmesh.new()
    bm.from_mesh(house.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(house.data)
    bm.free()
    return house


def build():
    clear_scene()
    PARTS.clear()
    build_materials()
    site()
    podium()
    garage()
    stairs()
    living_box()
    top_floor()
    terraces()
    interior()
    house = finish()
    tris = sum(len(p.vertices) - 2 for p in house.data.polygons)
    print("safehouse built:", len(house.data.polygons), "faces,", tris, "tris,", len(house.data.materials), "materials")
    return house


build()
