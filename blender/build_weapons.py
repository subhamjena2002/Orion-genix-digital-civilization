"""Builds the game's weapons, grenade and armour vest from code and exports them for the game.

    blender -b -P blender/build_weapons.py            (everything)
    blender -b -P blender/build_weapons.py -- pistol  (one model)

Each model is built in its own collection of the "Weapons" scene under a root empty named after
it, in metres, muzzle along +Y and top along +Z (the glTF export turns that into -Z forward, +Y
up, which is what WeaponModels expects with `muzzleAxis: "-z"`). Designs are generic: no maker's
marks or logos.

Writes public/models/weapons/{pistol,shotgun,rocket_launcher,rocket,grenade}.glb and
public/models/props/armour-vest.glb, and saves the source to blender/orion-weapons.blend.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else r"C:\oriongenix\blender"
ROOT = os.path.dirname(HERE)
WEAPONS_OUT = os.path.join(ROOT, "public", "models", "weapons")
PROPS_OUT = os.path.join(ROOT, "public", "models", "props")
MM = 0.001
SCENE = "Weapons"


# --- scene and materials -------------------------------------------------------------------

def scene():
	sc = bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)
	if bpy.context.window:
		bpy.context.window.scene = sc
	return sc


def fresh_collection(name):
	"""An empty collection for one model (anything built there before is removed)."""
	sc = scene()
	coll = bpy.data.collections.get(name)
	if coll:
		for obj in list(coll.all_objects):
			bpy.data.objects.remove(obj, do_unlink=True)
	else:
		coll = bpy.data.collections.new(name)
		sc.collection.children.link(coll)
	for sub in list(coll.children):
		coll.children.unlink(sub)
	return coll


def material(name, colour, metal=0.0, rough=0.5, emission=None):
	mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
	mat.use_nodes = True
	bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
	bsdf.inputs["Base Color"].default_value = (*colour, 1)
	bsdf.inputs["Metallic"].default_value = metal
	bsdf.inputs["Roughness"].default_value = rough
	if emission:
		bsdf.inputs["Emission Color"].default_value = (*emission[0], 1)
		bsdf.inputs["Emission Strength"].default_value = emission[1]
	mat.diffuse_color = (*colour, 1)
	return mat


class Kit:
	"""Builds parts of one model into its collection, parented to its root empty."""

	def __init__(self, name, offset=(0, 0, 0)):
		self.name = name
		self.coll = fresh_collection(f"model-{name}")
		self.cutters = fresh_collection(f"cutters-{name}")
		self.cutters.hide_render = True
		self.root = bpy.data.objects.new(name, None)
		self.root.empty_display_size = 0.05
		self.root.location = offset
		self.coll.objects.link(self.root)

	def _object(self, name, bm, mat, sharp_angle=30, smooth=True, coll=None):
		if sharp_angle is not None:
			limit = math.radians(sharp_angle)
			for edge in bm.edges:
				if edge.is_manifold and edge.calc_face_angle(0) > limit:
					edge.smooth = False
		for face in bm.faces:
			face.smooth = smooth
		me = bpy.data.meshes.new(name)
		bm.to_mesh(me)
		bm.free()
		ob = bpy.data.objects.new(name, me)
		(coll or self.coll).objects.link(ob)
		ob.parent = self.root
		if mat:
			me.materials.append(mat)
		return ob

	def prism(self, name, pts, width, mat, x=0.0, bevel=0.0, segments=2, axis="x", coll=None):
		"""A side profile (points in mm: (y, z) for axis x) extruded `width` mm across, centred on `x` mm."""
		bm = bmesh.new()
		def place(a, b, c):
			if axis == "x":
				return Vector((c, a, b)) * MM
			if axis == "y":  # profile in (x, z), extruded along y
				return Vector((a, c, b)) * MM
			return Vector((a, b, c)) * MM  # profile in (x, y), extruded along z
		verts = [bm.verts.new(place(a, b, x - width / 2)) for a, b in pts]
		face = bm.faces.new(verts)
		result = bmesh.ops.extrude_face_region(bm, geom=[face])
		moved = [g for g in result["geom"] if isinstance(g, bmesh.types.BMVert)]
		step = place(0, 0, width) - place(0, 0, 0)
		bmesh.ops.translate(bm, vec=step, verts=moved)
		bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
		ob = self._object(name, bm, mat, coll=coll)
		if bevel > 0:
			self.bevel(ob, bevel, segments)
		return ob

	def box(self, name, size, centre, mat, bevel=0.0, segments=2, coll=None, rotation=None):
		"""A box `size` mm (x, y, z) centred at `centre` mm."""
		bm = bmesh.new()
		bmesh.ops.create_cube(bm, size=1.0)
		m = Matrix.Diagonal((size[0] * MM, size[1] * MM, size[2] * MM, 1))
		if rotation:
			m = rotation.to_4x4() @ m
		bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(centre) * MM) @ m, verts=bm.verts)
		ob = self._object(name, bm, mat, coll=coll)
		if bevel > 0:
			self.bevel(ob, bevel, segments)
		return ob

	def cylinder(self, name, radius, length, centre, mat, axis="y", segments=24, radius2=None, bevel=0.0, coll=None, cap=True):
		"""A cylinder (or cone, with radius2 at the far end) `length` mm along `axis`, centred at `centre` mm."""
		bm = bmesh.new()
		bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segments,
			radius1=radius * MM, radius2=(radius if radius2 is None else radius2) * MM, depth=length * MM)
		turn = {"x": Matrix.Rotation(math.radians(90), 4, "Y"), "y": Matrix.Rotation(math.radians(-90), 4, "X"), "z": Matrix.Identity(4)}[axis]
		bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(centre) * MM) @ turn, verts=bm.verts)
		ob = self._object(name, bm, mat, coll=coll)
		if bevel > 0:
			self.bevel(ob, bevel, 2)
		return ob

	def lathe(self, name, profile, mat, axis="y", centre=(0, 0, 0), segments=32, sharp_angle=40):
		"""A turned part: profile points (r, along) in mm, spun about `axis` through `centre`."""
		bm = bmesh.new()
		place = {"y": lambda r, t: (r, t, 0), "z": lambda r, t: (r, 0, t), "x": lambda r, t: (t, r, 0)}[axis]
		verts = [bm.verts.new(Vector(place(r, t)) * MM) for r, t in profile]
		edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
		spin_axis = {"y": (0, 1, 0), "z": (0, 0, 1), "x": (1, 0, 0)}[axis]
		bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=spin_axis, angle=2 * math.pi, steps=segments, use_merge=True)
		bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
		bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
		bmesh.ops.translate(bm, vec=Vector(centre) * MM, verts=bm.verts)
		bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
		return self._object(name, bm, mat, sharp_angle=sharp_angle)

	def bevel(self, ob, width_mm, segments=2, angle=30):
		mod = ob.modifiers.new("bevel", "BEVEL")
		mod.width = width_mm * MM
		mod.segments = segments
		mod.limit_method = "ANGLE"
		mod.angle_limit = math.radians(angle)
		mod.harden_normals = True
		mod.use_clamp_overlap = True
		# Bevel comes last: move it below any booleans added before it.
		return mod

	def cut(self, ob, cutter):
		"""Subtracts `cutter` (a part built into the cutters collection) from `ob`, before its bevel."""
		cutter.display_type = "WIRE"
		cutter.hide_render = True
		mod = ob.modifiers.new(f"cut-{cutter.name}", "BOOLEAN")
		mod.operation = "DIFFERENCE"
		mod.solver = "EXACT"
		mod.object = cutter
		bevels = [i for i, m in enumerate(ob.modifiers) if m.type == "BEVEL"]
		if bevels:
			with bpy.context.temp_override(object=ob):
				bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=bevels[0])
		return mod

	def array(self, ob, count, offset_mm):
		mod = ob.modifiers.new("array", "ARRAY")
		mod.count = count
		mod.use_relative_offset = False
		mod.use_constant_offset = True
		mod.constant_offset_displacement = Vector(offset_mm) * MM
		return mod

	def mirror_x(self, ob):
		mod = ob.modifiers.new("mirror", "MIRROR")
		mod.use_axis = (True, False, False)
		mod.mirror_object = self.root
		return mod

	def point(self, name, at):
		"""An empty marking a spot (mm), exported as a node the game looks up by name."""
		ob = bpy.data.objects.new(name, None)
		ob.empty_display_size = 0.01
		ob.location = Vector(at) * MM
		self.coll.objects.link(ob)
		ob.parent = self.root
		return ob

	def parts(self):
		return [o for o in self.coll.objects if o is not self.root]


def export(kit, path):
	"""Writes the model as a GLB with its root at the origin."""
	# A model built in a bone's space (the vest) keeps its root there; the rest export from the origin.
	offset = kit.root.location.copy()
	if not hasattr(kit, "frame"):
		kit.root.location = (0, 0, 0)
	bpy.context.view_layer.update()
	for obj in bpy.context.view_layer.objects:
		obj.select_set(False)
	kit.root.select_set(True)
	for part in kit.parts():
		part.select_set(True)
	bpy.ops.export_scene.gltf(
		filepath=path,
		export_format="GLB",
		use_selection=True,
		export_apply=True,
		export_yup=True,
		export_animations=False,
		export_materials="EXPORT",
		use_active_scene=True,
	)
	if not hasattr(kit, "frame"):
		kit.root.location = offset
	print("wrote", path, os.path.getsize(path))


def bounds(kit):
	"""Overall bounds of the model's evaluated meshes, in mm, in the root's space."""
	deps = bpy.context.evaluated_depsgraph_get()
	inv = kit.root.matrix_world.inverted()
	lo = Vector((1e9, 1e9, 1e9))
	hi = -lo
	for part in kit.parts():
		if part.type != "MESH":
			continue
		ev = part.evaluated_get(deps)
		for v in ev.to_mesh().vertices:
			p = inv @ (part.matrix_world @ v.co) / MM
			lo = Vector(map(min, lo, p))
			hi = Vector(map(max, hi, p))
		ev.to_mesh_clear()
	return lo, hi


def grip_spec(kit, grip_mm, hands_mm):
	"""
	WeaponModels' numbers for this model: where the grip is (as fractions of the bounds) and where
	the hands go (metres, fitted space: +x right, +y up, -z forward, grip at the origin).
	"""
	lo, hi = bounds(kit)
	length = hi.y - lo.y
	along = (grip_mm[1] - lo.y) / length
	centre_z = (lo.z + hi.z) / 2
	below = (centre_z - grip_mm[2]) / ((hi.z - lo.z) / 2)
	hands = {}
	for key, (x, y, z) in hands_mm.items():
		hands[key] = [round((x - grip_mm[0]) * MM, 3), round((z - grip_mm[2]) * MM, 3), round(-(y - grip_mm[1]) * MM, 3)]
	print(kit.name, "length", round(length * MM, 3), "grip", {"along": round(along, 3), "below": round(below, 3)}, "hands", hands,
		"size mm", [round(v, 1) for v in (hi - lo)])
	return along, below, hands


# --- the models -----------------------------------------------------------------------------

def build_pistol(offset=(0, 0, 0)):
	"""A full-size striker-fired polymer service pistol: boxy slide, 22° grip, square trigger guard."""
	k = Kit("pistol", offset)
	slide_mat = material("pistol-slide", (0.042, 0.044, 0.048), 0.85, 0.36)
	frame_mat = material("pistol-frame", (0.026, 0.026, 0.028), 0.0, 0.62)
	steel_mat = material("pistol-steel", (0.09, 0.09, 0.095), 1.0, 0.3)
	dot_mat = material("pistol-dot", (0.92, 0.92, 0.88), 0.0, 0.4)

	# Slide: a block with a chamfered nose, rear and front cocking serrations, the ejection port.
	slide = k.prism("slide", [(-32, 0), (152, 0), (155, 3), (155, 20), (148, 28), (-31, 28), (-32, 27)], 25.5, slide_mat, bevel=1.1, segments=2)
	for i in range(8):
		for side in (-1, 1):
			k.cut(slide, k.box(f"serration-r{i}-{side}", (1.6, 1.3, 21), (side * 12.9, -27 + i * 2.7, 13), None, coll=k.cutters))
	for i in range(6):
		for side in (-1, 1):
			k.cut(slide, k.box(f"serration-f{i}-{side}", (1.6, 1.3, 15), (side * 12.9, 112 + i * 2.7, 15), None, coll=k.cutters))
	k.cut(slide, k.box("port", (12, 44, 14), (8.5, 49, 25), None, coll=k.cutters))
	k.cut(slide, k.cylinder("muzzle-bore", 6.6, 14, (0, 152, 13), None, coll=k.cutters))
	k.cut(slide, k.box("slide-channel", (19, 190, 13), (0, 60, 3.5), None, coll=k.cutters))
	# Barrel and its squared hood, seen through the port and at the muzzle.
	barrel = k.cylinder("barrel", 6.2, 116, (0, 94, 13), steel_mat, segments=20)
	k.cut(barrel, k.cylinder("bore", 4.5, 20, (0, 152, 13), None, segments=16, coll=k.cutters))
	k.box("barrel-hood", (12.4, 46, 17), (0, 49, 17.5), steel_mat, bevel=0.6)
	k.box("extractor", (1.2, 10, 3), (12.9, 23, 21), steel_mat, bevel=0.3)
	# Sights: a post with a dot up front, a notched rear with two.
	k.box("front-sight", (3.4, 5.5, 5.5), (0, 145, 30.5), steel_mat, bevel=0.4)
	k.cylinder("front-dot", 1.0, 0.6, (0, 142.2, 31.3), dot_mat, segments=10)
	rear = k.box("rear-sight", (14, 8, 6), (0, -23, 30.5), steel_mat, bevel=0.5)
	k.cut(rear, k.box("rear-notch", (3.6, 12, 4), (0, -23, 32.5), None, coll=k.cutters))
	for side in (-1, 1):
		k.cylinder(f"rear-dot-{side}", 0.9, 0.6, (side * 4.5, -27.2, 31.5), dot_mat, segments=10)

	# Frame: the grip, its beavertail and the trigger guard as one profile, the opening cut through.
	frame = k.prism("frame", [
		(-41, -0.5), (-41, -5.5), (-35, -10.5), (-31, -16), (-36, -30), (-46.4, -47.5), (-53.5, -71.6), (-60.3, -88.3), (-62, -91.5),
		(-17.5, -109.5), (-15, -102), (-9.5, -88), (-2.4, -70.7), (5.1, -52.1), (10.5, -40), (14, -36.5),
		(47, -36.5), (52, -35), (54.5, -30), (55, -20), (55, -11), (58, -10), (58, -0.5)], 29, frame_mat, bevel=2.4, segments=3)
	k.cut(frame, k.prism("guard-opening", [(19, -9), (47, -9), (50.5, -12), (50.5, -29), (46.5, -32.6), (21, -32.6), (17.5, -28), (17.5, -12)], 40, None, coll=k.cutters))
	k.cut(frame, k.box("frame-channel", (20.5, 110, 6), (0, 4, -1.5), None, coll=k.cutters))
	# Stippled panels, raised a hair from the grip each side.
	for side in (-1, 1):
		k.prism(f"grip-texture-{side}", [(-31.8, -37.9), (5.9, -39.5), (-12.1, -84), (-52.1, -78.7)], 0.8, frame_mat, x=side * 14.5, bevel=0.3)
	# Dust cover with its accessory rail and one cross slot.
	k.prism("dust-cover", [(50, -0.5), (151, -0.5), (151, -7), (149, -12), (60, -13.5), (54, -13)], 23.5, frame_mat, bevel=1.6, segments=3)
	rail = k.prism("rail", [(78, -12), (140, -12), (140, -17.5), (80, -17.5)], 21, frame_mat, bevel=0.4)
	k.cut(rail, k.box("rail-slot", (30, 3.5, 3), (0, 112, -17), None, coll=k.cutters))
	k.prism("rail-lip", [(141, -12), (148, -11), (147, -15), (140, -15)], 20, frame_mat, bevel=0.6)
	# Magazine floor plate, below the grip.
	k.prism("mag-base", [(-62, -91.5), (-17.5, -109.5), (-16.5, -113), (-19, -114.8), (-62.5, -97), (-63.8, -94)], 31, frame_mat, bevel=1.4, segments=2)
	# Trigger with its centre safety blade, and the controls.
	k.prism("trigger", [(26, -8), (30, -8), (29.5, -16), (28, -23), (25, -28.5), (23, -27.5), (25.6, -21), (26.5, -14)], 6, frame_mat, bevel=0.8)
	k.prism("trigger-safety", [(25.2, -17), (26.6, -17), (25.2, -25), (23.8, -25.6)], 1.6, steel_mat)
	k.prism("slide-stop", [(28, -3.5), (44, -3.5), (46, -1.2), (44, 0.5), (30, 0.5)], 1.6, steel_mat, x=-15.2, bevel=0.3)
	for side in (-1, 1):
		k.prism(f"takedown-{side}", [(57, -7), (63, -7), (63, -2), (57, -2)], 1.0, steel_mat, x=side * 12.2, bevel=0.3)
	k.prism("mag-release", [(9, -42), (14, -40), (15.5, -34), (10.5, -35)], 2.2, frame_mat, x=-14.8, bevel=0.6)
	k.point("muzzle-point", (0, 156, 13))
	return k


def wood_material(name, colour, dark):
	"""Varnished wood with a grain running along the part (box-projected UVs, see wood_uv)."""
	mat = material(name, colour, 0.0, 0.42)
	image_name = f"{name}-grain"
	image = bpy.data.images.get(image_name)
	if image is None:
		import random
		size = 256
		image = bpy.data.images.new(image_name, size, size)
		rng = random.Random(7)
		waves = [(rng.randint(1, 3), rng.uniform(0, 6.28), rng.uniform(0.003, 0.012)) for _ in range(5)]
		pixels = []
		for v in range(size):
			for u in range(size):
				# Fine grain lines run along u, wandering a little and varying in darkness.
				t = v / size + sum(a * math.sin(f * 6.283 * u / size + p) for f, p, a in waves)
				line = (0.5 + 0.5 * math.sin(t * 6.283 * 36 + 1.6 * math.sin(t * 6.283 * 5))) ** 2
				mix = min(1.0, line * 0.32 + rng.random() * 0.05)
				pixels.extend([colour[i] * (1 - mix) + dark[i] * mix for i in range(3)] + [1.0])
		image.pixels.foreach_set(pixels)
		image.pack()
	nodes = mat.node_tree.nodes
	bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
	tex = next((n for n in nodes if n.type == "TEX_IMAGE"), None) or nodes.new("ShaderNodeTexImage")
	tex.image = image
	mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
	return mat


def wood_uv(ob, scale_mm=180.0):
	"""Box-projected UVs with the grain (u) along the part's length (y)."""
	me = ob.data
	bm = bmesh.new()
	bm.from_mesh(me)
	uv = bm.loops.layers.uv.verify()
	for face in bm.faces:
		n = face.normal
		for loop in face.loops:
			co = loop.vert.co / MM
			if abs(n.x) >= max(abs(n.y), abs(n.z)):
				loop[uv].uv = (co.y / scale_mm, co.z / scale_mm)
			elif abs(n.z) >= abs(n.y):
				loop[uv].uv = (co.y / scale_mm, co.x / scale_mm)
			else:
				loop[uv].uv = (co.x / scale_mm, co.z / scale_mm)
	bm.to_mesh(me)
	bm.free()


def build_shotgun(offset=(0, 0, 0)):
	"""A pump-action twelve-bore: blued receiver, vent-rib barrel over the magazine tube, walnut furniture."""
	k = Kit("shotgun", offset)
	blued = material("shotgun-blued", (0.034, 0.036, 0.04), 0.9, 0.32)
	steel = material("shotgun-steel", (0.11, 0.11, 0.115), 1.0, 0.36)
	rubber = material("shotgun-rubber", (0.02, 0.02, 0.022), 0.0, 0.8)
	brass = material("shotgun-bead", (0.85, 0.7, 0.35), 1.0, 0.3)
	walnut = wood_material("shotgun-walnut", (0.30, 0.135, 0.055), (0.12, 0.05, 0.02))

	receiver = k.prism("receiver", [(-10, -36), (-10, 12), (2, 20), (188, 20), (194, 15), (194, -32), (186, -38), (-2, -38)], 30, blued, bevel=2.0, segments=3)
	k.cut(receiver, k.box("ejection-port", (8, 78, 22), (15, 105, 1), None, coll=k.cutters))
	k.cut(receiver, k.box("loading-port", (20, 90, 10), (0, 120, -39), None, coll=k.cutters))
	k.box("bolt", (3, 74, 18), (12.2, 105, 1), steel, bevel=0.5)
	k.cylinder("barrel", 11, 470, (0, 425, 0), blued, segments=28)
	muzzle = k.cylinder("muzzle", 11.6, 6, (0, 658, 0), blued, segments=28)
	k.cut(muzzle, k.cylinder("bore", 9.2, 30, (0, 660, 0), None, segments=20, coll=k.cutters))
	k.cylinder("barrel-ring", 13, 22, (0, 206, 0), blued, segments=28, bevel=1)
	# Vent rib: a flat rib on posts along the barrel, a brass bead at the end.
	k.box("rib", (7, 452, 2.2), (0, 432, 14.6), blued, bevel=0.4)
	for i in range(14):
		k.box(f"rib-post-{i}", (4, 6, 4), (0, 222 + i * 31, 12), blued)
	k.lathe("bead", [(0, -2.2), (1.6, -1.6), (2.2, 0), (1.6, 1.6), (0, 2.2)], brass, axis="z", centre=(0, 650, 18), segments=12)
	k.cylinder("magazine", 10.5, 395, (0, 395, -24), blued, segments=24)
	k.cylinder("magazine-cap", 12, 22, (0, 600, -24), steel, segments=24, bevel=1.5)
	k.box("barrel-clamp", (24, 14, 44), (0, 574, -12), blued, bevel=2)
	# The pump: a ribbed walnut fore-end on the magazine tube, bars running back into the receiver.
	fore = k.prism("fore-end", [(250, -6), (450, -6), (456, -16), (456, -40), (448, -50), (258, -50), (250, -40)], 44, walnut, bevel=5, segments=4)
	wood_uv(fore)
	for i in range(9):
		for side in (-1, 1):
			k.cut(fore, k.box(f"pump-groove-{i}-{side}", (4, 3.5, 30), (side * 22.5, 288 + i * 16, -30), None, coll=k.cutters))
	for side in (-1, 1):
		k.box(f"action-bar-{side}", (2, 64, 5), (side * 13, 220, -24), steel)
	# Trigger group under the back of the receiver.
	guard = k.prism("trigger-guard", [(0, -36), (62, -36), (64, -46), (54, -63), (12, -66), (0, -58), (-3, -46)], 14, blued, bevel=1.5)
	k.cut(guard, k.prism("guard-opening", [(9, -43), (55, -43), (51, -56), (16, -58.5), (7, -52)], 30, None, coll=k.cutters))
	k.prism("trigger", [(24, -38), (30, -38), (28.5, -50), (23, -58), (20.5, -56.5), (25, -49)], 6, steel, bevel=0.8)
	k.cylinder("safety", 4, 22, (0, 3, -43), steel, axis="x", segments=12)
	k.cylinder("slide-release", 3.5, 4, (-15, 66, -30), steel, axis="x", segments=12)
	# Walnut stock with a dropped comb, a rubber recoil pad behind it.
	stock = k.prism("stock", [(-8, 14), (-40, 3), (-80, -12), (-150, -20), (-360, -40), (-372, -42), (-372, -176), (-362, -177),
		(-220, -118), (-90, -64), (-45, -50), (-8, -38)], 38, walnut, bevel=7, segments=4)
	wood_uv(stock)
	k.prism("recoil-pad", [(-371, -40), (-392, -42), (-394, -46), (-394, -172), (-392, -178), (-371, -178)], 41, rubber, bevel=4, segments=3)
	k.point("muzzle-point", (0, 662, 0))
	return k


WARHEAD = [(0, 470), (19, 470), (19, 520), (24, 528), (36, 552), (42, 580), (42.5, 610), (40, 640), (32, 680), (22, 730), (12, 770), (7, 788), (0, 790)]
FUZE = [(0, 784), (7, 786), (8, 792), (5.5, 818), (2, 826), (0, 827)]


def build_rocket_launcher(offset=(0, 0, 0)):
	"""A shoulder-fired rocket launcher: steel tube, flared exhaust, wooden heat shields, two grips, a side optic, a rocket loaded."""
	k = Kit("rocket_launcher", offset)
	steel = material("launcher-steel", (0.06, 0.065, 0.062), 0.85, 0.42)
	dark = material("launcher-dark", (0.025, 0.025, 0.027), 0.3, 0.6)
	glass = material("launcher-glass", (0.05, 0.12, 0.1), 0.2, 0.08)
	rubber = material("launcher-rubber", (0.015, 0.015, 0.016), 0.0, 0.85)
	wood = wood_material("launcher-wood", (0.36, 0.19, 0.08), (0.17, 0.08, 0.03))
	olive = material("rocket-olive", (0.16, 0.19, 0.1), 0.25, 0.55)
	tip = material("rocket-fuze", (0.42, 0.4, 0.34), 0.8, 0.35)

	# Tube with its muzzle ring; the exhaust flares out behind the shooter.
	k.lathe("tube", [(0, -380), (20, -380), (20, 466), (24, 466), (24, 482), (19, 482), (19, 470), (0, 470)], steel, segments=28)
	k.lathe("exhaust", [(19, -372), (21, -380), (24, -400), (32, -440), (41, -478), (44, -488), (40, -490), (37, -480), (28, -440), (19, -400), (19, -372)], steel, segments=28)
	k.lathe("exhaust-ring", [(21, -382), (25, -382), (25, -368), (21, -368), (21, -382)], dark, segments=28)
	# Heat shields where the hands and shoulder go, split by the grips.
	for name, a, b in (("shield-rear", -250, -60), ("shield-front", 30, 150)):
		shield = k.lathe(name, [(20, a), (27, a + 4), (30, a + 14), (30, b - 14), (27, b - 4), (20, b)], wood, segments=24, sharp_angle=60)
		wood_uv(shield, 140)
		for t in (a + 2, b - 2):
			k.lathe(f"{name}-band-{t}", [(29, t - 4), (31.5, t - 3), (31.5, t + 3), (29, t + 4)], steel, segments=24)
	# Trigger grip with its guard, a front grip further up.
	k.prism("grip", [(-50, -18), (-20, -18), (-24, -60), (-28, -112), (-36, -118), (-58, -114), (-58, -100), (-56, -58)], 30, dark, bevel=4, segments=3)
	k.prism("grip-mount", [(-70, -16), (10, -16), (10, -28), (-70, -28)], 24, steel, bevel=1.5)
	guard = k.prism("trigger-guard", [(-22, -24), (20, -24), (22, -36), (10, -58), (-20, -56), (-24, -40)], 10, steel, bevel=1)
	k.cut(guard, k.prism("guard-opening", [(-16, -30), (14, -30), (14, -38), (6, -50), (-18, -50)], 20, None, coll=k.cutters))
	k.prism("trigger", [(-10, -26), (-5, -26), (-6, -38), (-12, -46), (-14, -44), (-9, -37)], 5, steel, bevel=0.6)
	k.prism("foregrip", [(158, -18), (186, -18), (182, -60), (180, -100), (172, -106), (160, -104), (160, -60)], 28, dark, bevel=4, segments=3)
	k.prism("foregrip-mount", [(150, -14), (196, -14), (196, -26), (150, -26)], 24, steel, bevel=1.5)
	# Iron sights on top, an optic on the left side.
	k.prism("front-sight", [(392, 18), (402, 18), (400, 44), (396, 44)], 4, steel)
	k.prism("rear-sight", [(10, 18), (26, 18), (24, 40), (12, 40)], 14, steel, bevel=0.5)
	k.box("optic-mount", (20, 70, 18), (-26, -10, 16), steel, bevel=1.5)
	k.box("optic", (26, 150, 32), (-42, -20, 40), dark, bevel=4)
	k.cylinder("optic-objective", 13, 22, (-42, 64, 40), dark, segments=20, bevel=1)
	k.cylinder("optic-lens", 11, 2, (-42, 75.5, 40), glass, segments=20)
	k.lathe("optic-eyecup", [(10, -95), (15, -96), (17, -120), (13, -122), (9, -100), (10, -95)], rubber, centre=(-42, 0, 40), segments=20)
	# The rocket loaded in the muzzle: motor sleeve, the bulb of the warhead, the fuze at the point.
	k.lathe("warhead", WARHEAD, olive, segments=32)
	k.lathe("warhead-fuze", FUZE, tip, segments=16)
	# Where the rocket leaves: the mouth of the tube, the round's middle just ahead of it.
	k.point("muzzle-point", (0, 520, 0))
	return k


def build_rocket(offset=(0, 0, 0)):
	"""The rocket in flight: the warhead, its motor and four fins."""
	k = Kit("rocket", offset)
	olive = material("rocket-olive", (0.16, 0.19, 0.1), 0.25, 0.55)
	tip = material("rocket-fuze", (0.42, 0.4, 0.34), 0.8, 0.35)
	steel = material("launcher-steel", (0.06, 0.065, 0.062), 0.85, 0.42)
	k.lathe("motor", [(0, 230), (16, 230), (18, 260), (19, 470), (0, 470)], steel, segments=20)
	k.lathe("nozzle", [(0, 210), (12, 210), (16, 214), (16, 232), (0, 232)], steel, segments=16)
	k.lathe("warhead", WARHEAD, olive, segments=24)
	k.lathe("warhead-fuze", FUZE, tip, segments=12)
	for i in range(4):
		fin = k.prism(f"fin-{i}", [(0, 225), (32, 214), (32, 252), (2, 290)], 1.6, steel, x=0, axis="z")
		turn = Matrix.Rotation(math.radians(45 + 90 * i), 4, "Y")
		fin.data.transform(turn @ Matrix.Translation(Vector((16 * MM, 0, 0))))
	return k


def build_grenade(offset=(0, 0, 0)):
	"""A round fragmentation grenade: olive body, fuze on top, the spoon down its side and the pull ring."""
	k = Kit("grenade", offset)
	olive = material("grenade-olive", (0.15, 0.18, 0.1), 0.15, 0.6)
	metal = material("grenade-metal", (0.38, 0.38, 0.35), 0.85, 0.38)
	band = material("grenade-band", (0.55, 0.45, 0.12), 0.0, 0.6)
	# Body turned about z: a slightly squashed sphere with a neck for the fuze.
	body = [(0, -30)]
	for i in range(1, 22):
		a = -math.pi / 2 + math.pi * i / 22
		body.append((31.5 * math.cos(a), 30 * math.sin(a)))
	body += [(10, 30.5), (0, 30.5)]
	k.lathe("body", body, olive, axis="z", segments=36, sharp_angle=70)
	k.lathe("band", [(31.2, -2.2), (31.9, -1.5), (31.9, 1.5), (31.2, 2.2)], band, axis="z", segments=28)
	k.lathe("fuze", [(0, 30), (10.5, 30), (10.5, 41), (8.5, 43), (8.5, 50), (6, 52), (0, 52)], metal, axis="z", segments=20)
	# The spoon: over the top of the fuze and down the body's side, following its curve.
	spoon = [(-6, 52.6), (9, 52.6), (12, 50), (14, 44), (20, 28), (27, 14), (31, 0), (32, -9), (30.4, -10), (29.4, 0),
		(25.4, 13), (18.5, 27), (12.4, 43), (10.6, 49), (8, 51), (-6, 51)]
	k.prism("spoon", spoon, 9, metal, axis="y", bevel=0.4)
	# Pin through the fuze and its ring hanging off the other side.
	k.cylinder("pin", 1.2, 30, (0, 0, 46), metal, axis="y", segments=8)
	k.lathe("ring", [(12, -1.4), (13.4, 0), (12, 1.4), (10.6, 0), (12, -1.4)], metal, axis="x", centre=(-15, -14, 46), segments=24, sharp_angle=80)
	return k


PLAYER = os.path.join(ROOT, "public", "models", "characters", "player-gangster.glb")
#: The bone the vest rides on (OrionPlayerBody finds it by this name, without the file's numbering).
VEST_BONE = "CC_Base_Spine02"


def gltf_node_world(path, prefix):
	"""World matrix (glTF's Y-up space) of the first node whose name starts with `prefix`, read straight from the file."""
	import json
	import struct
	from mathutils import Quaternion
	data = open(path, "rb").read()
	length = struct.unpack("<I", data[12:16])[0]
	gltf = json.loads(data[20:20 + length])
	nodes = gltf["nodes"]
	parent = {child: i for i, node in enumerate(nodes) for child in node.get("children", [])}

	def local(node):
		if "matrix" in node:
			return Matrix([node["matrix"][i::4] for i in range(4)])
		q = node.get("rotation", [0, 0, 0, 1])
		return (Matrix.Translation(node.get("translation", [0, 0, 0])) @ Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
			@ Matrix.Diagonal((*node.get("scale", [1, 1, 1]), 1)))

	index = next(i for i, node in enumerate(nodes) if node.get("name", "").startswith(prefix) and "scaleCompensation" not in node["name"])
	world = local(nodes[index])
	while index in parent:
		index = parent[index]
		world = local(nodes[index]) @ world
	return world


#: glTF's Y-up axes to Blender's Z-up ones, as the importer turns them.
Y_UP_TO_Z_UP = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def convex_hull(points):
	pts = sorted(set(points))
	if len(pts) < 3:
		return pts
	def cross(o, a, b):
		return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
	lower, upper = [], []
	for p in pts:
		while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
			lower.pop()
		lower.append(p)
	for p in reversed(pts):
		while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
			upper.pop()
		upper.append(p)
	return lower[:-1] + upper[:-1]


def ray_to_hull(hull, cx, cy, angle):
	"""Distance from (cx, cy) along `angle` to the hull's edge."""
	dx, dy = math.cos(angle), math.sin(angle)
	best = 0.0
	for i in range(len(hull)):
		ax, ay = hull[i]
		bx, by = hull[(i + 1) % len(hull)]
		ex, ey = bx - ax, by - ay
		den = dx * ey - dy * ex
		if abs(den) < 1e-12:
			continue
		t = ((ax - cx) * ey - (ay - cy) * ex) / den
		s = ((ax - cx) * dy - (ay - cy) * dx) / den
		if t > 0 and -1e-6 <= s <= 1 + 1e-6:
			best = max(best, t)
	return best


def build_armour_vest(offset=(0, 0, 0)):
	"""
	A plate carrier fitted to the player's own torso: a shell lofted round the body's chest (from
	the vertices its spine bones carry), plates front and back, webbing, magazine pouches and
	shoulder straps. Built in the body's space, then expressed in its chest bone's, so the game
	can hang it on that bone (see components/world/... WornVest).
	"""
	k = Kit("armour_vest")
	nylon = material("vest-nylon", (0.03, 0.036, 0.048), 0.0, 0.88)
	webbing = material("vest-webbing", (0.045, 0.052, 0.066), 0.0, 0.82)
	patch = material("vest-patch", (0.14, 0.14, 0.14), 0.0, 0.95)
	plastic = material("vest-buckle", (0.012, 0.012, 0.013), 0.0, 0.5)

	# The body, for reference: its posed vertices, and which of them the spine carries.
	ref = fresh_collection("vest-reference")
	before = set(bpy.data.objects)
	bpy.ops.import_scene.gltf(filepath=PLAYER)
	imported = [o for o in bpy.data.objects if o not in before]
	for obj in imported:
		for coll in list(obj.users_collection):
			coll.objects.unlink(obj)
		ref.objects.link(obj)
	deps = bpy.context.evaluated_depsgraph_get()
	torso, everything, glasses = [], [], []
	for obj in imported:
		if obj.type != "MESH":
			continue
		names = {g.index: g.name for g in obj.vertex_groups}
		ev = obj.evaluated_get(deps)
		mesh = ev.to_mesh()
		for v_orig, v in zip(obj.data.vertices, mesh.vertices):
			p = obj.matrix_world @ v.co
			if obj.name.startswith("Sunglasses"):
				glasses.append(p)
				continue
			everything.append(p)
			carried = sum(g.weight for g in v_orig.groups if any(b in names.get(g.group, "") for b in ("Spine", "Waist", "Pectoral", "Breast", "Ribs")))
			if carried >= 0.5:
				torso.append(p)
		ev.to_mesh_clear()
	ref.hide_render = True
	for obj in imported:
		obj.hide_set(True)
	centre_y = sum(p.y for p in torso) / len(torso)
	front = 1.0 if sum(p.y for p in glasses) / len(glasses) > centre_y else -1.0
	print("vest: torso verts", len(torso), "front", front)

	# Cross-sections of the torso every 2 cm, as hulls in (x, forward).
	bottom, chest_top, side_top = 0.985, 1.425, 1.27
	heights = [bottom - 0.02 + 0.02 * i for i in range(int((chest_top - bottom) / 0.02) + 3)]
	ANGLES = 48
	sections = []
	print("vest: torso from", round(min(p.z for p in torso), 3), "to", round(max(p.z for p in torso), 3))
	for h in heights:
		# The body's mesh is sparse in places: widen the slice until it has a shape.
		for reach in (0.016, 0.03, 0.05, 0.08):
			band = [(p.x, front * p.y) for p in torso if abs(p.z - h) < reach]
			if len(band) >= 12:
				break
		hull = convex_hull(band)
		cx = sum(p[0] for p in hull) / len(hull)
		cy = sum(p[1] for p in hull) / len(hull)
		radii = [ray_to_hull(hull, cx, cy, 2 * math.pi * j / ANGLES) for j in range(ANGLES)]
		sections.append((cx, cy, radii))
	# Smoothed up and down, so the shell doesn't follow every fold of the shirt.
	for _ in range(3):
		sections = [(
			(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4,
			[(ra + 2 * rb + rc) / 4 for ra, rb, rc in zip(a[2], b[2], c[2])],
		) for a, b, c in zip([sections[0]] + sections[:-1], sections, sections[1:] + [sections[-1]])]

	def surface(angle_index, z, out=0.02):
		f = max(0.0, min(len(heights) - 1.001, (z - heights[0]) / 0.02))
		i = int(f)
		t = f - i
		a, b = sections[i], sections[i + 1]
		cx = a[0] + (b[0] - a[0]) * t
		cy = a[1] + (b[1] - a[1]) * t
		r = a[2][angle_index % ANGLES] + (b[2][angle_index % ANGLES] - a[2][angle_index % ANGLES]) * t + out
		angle = 2 * math.pi * angle_index / ANGLES
		return Vector((cx + r * math.cos(angle), front * (cy + r * math.sin(angle)), z))

	def top_at(angle_index):
		# High over the chest and back, cut low under the arms.
		facing = abs(math.sin(2 * math.pi * angle_index / ANGLES))
		s = max(0.0, min(1.0, (facing - 0.55) / 0.3))
		return side_top + (chest_top - side_top) * s * s * (3 - 2 * s)

	ROWS = 16
	bm = bmesh.new()
	grid = [[bm.verts.new(surface(j, bottom + (top_at(j) - bottom) * i / ROWS)) for i in range(ROWS + 1)] for j in range(ANGLES)]
	for j in range(ANGLES):
		for i in range(ROWS):
			a, b = grid[j], grid[(j + 1) % ANGLES]
			bm.faces.new((a[i], b[i], b[i + 1], a[i + 1]))
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	shell = k._object("shell", bm, nylon, sharp_angle=None)
	solid = shell.modifiers.new("thickness", "SOLIDIFY")
	solid.thickness = 0.014
	solid.offset = 1
	solid.use_even_offset = True
	k.bevel(shell, 2.5, 2, angle=50)

	front_y = surface(ANGLES // 4, 1.24, 0.034).y
	back_y = surface(3 * ANGLES // 4, 1.26, 0.034).y
	mm = lambda v: v / MM
	# Plates: the slabs that make it armour, front and back.
	k.box("front-plate", (265, 22, 300), (0, mm(front_y), mm(1.245)), nylon, bevel=5, segments=3)
	k.box("back-plate", (285, 22, 330), (0, mm(back_y), mm(1.26)), nylon, bevel=5, segments=3)
	face = front_y + front * 0.011
	# Webbing rows across the front, three magazine pouches low down, a blank patch up top.
	for row in range(4):
		k.box(f"webbing-{row}", (255, 4, 22), (0, mm(face), mm(1.16 + row * 0.042)), webbing, bevel=1)
	for i, x in enumerate((-0.083, 0, 0.083)):
		k.box(f"pouch-{i}", (74, 44, 108), (mm(x), mm(face + front * 0.022), mm(1.12)), webbing, bevel=6, segments=3)
		k.box(f"pouch-flap-{i}", (78, 48, 34), (mm(x), mm(face + front * 0.024), mm(1.18)), nylon, bevel=5, segments=3)
		k.box(f"pouch-snap-{i}", (18, 6, 10), (mm(x), mm(face + front * 0.048), mm(1.172)), plastic, bevel=1.5)
	k.box("patch", (120, 4, 50), (0, mm(face), mm(1.365)), patch, bevel=1.5)
	back_face = back_y - front * 0.011
	for row in range(5):
		k.box(f"back-webbing-{row}", (270, 4, 22), (0, mm(back_face), mm(1.12 + row * 0.045)), webbing, bevel=1)
	k.box("drag-handle", (90, 14, 34), (0, mm(back_face - front * 0.006), mm(1.395)), webbing, bevel=4, segments=2)
	# Side buckles where the cummerbund closes.
	for side in (-1, 1):
		p = surface(0 if side > 0 else ANGLES // 2, 1.13, 0.036)
		k.box(f"buckle-{side}", (14, 46, 30), (mm(p.x), mm(p.y), mm(1.13)), plastic, bevel=2)

	# Shoulder straps, front plate to back plate over the top of each shoulder.
	for side in (-1, 1):
		x0 = side * 0.09
		# The top of the shoulder there: the highest of the chest's own vertices (not the neck's or head's).
		near = [p for p in torso if abs(p.x - x0) < 0.025 and p.z > 1.38]
		crest = min(1.5, max(p.z for p in near)) + 0.016
		f_top = surface(ANGLES // 4, chest_top, 0.03)
		b_top = surface(3 * ANGLES // 4, chest_top, 0.03)
		mid = (f_top.y + b_top.y) / 2
		path = [Vector((x0, f_top.y - front * 0.004, chest_top - 0.03)), Vector((x0, f_top.y, chest_top + 0.01)),
			Vector((x0, (f_top.y + mid) / 2 + front * 0.01, crest - 0.012)), Vector((x0, mid, crest)),
			Vector((x0, (b_top.y + mid) / 2 - front * 0.01, crest - 0.012)), Vector((x0, b_top.y, chest_top + 0.01)),
			Vector((x0, b_top.y + front * 0.004, chest_top - 0.03))]
		sb = bmesh.new()
		rings = []
		for i, p in enumerate(path):
			ahead = path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]
			normal = Vector((0, -ahead.z, ahead.y)).normalized()
			if normal.z < 0:
				normal = -normal
			rings.append([sb.verts.new(p + Vector((dx, 0, 0)) + normal * dn) for dx, dn in ((-0.028, 0), (0.028, 0), (0.028, 0.012), (-0.028, 0.012))])
		for a, b in zip(rings, rings[1:]):
			for q in range(4):
				sb.faces.new((a[q], a[(q + 1) % 4], b[(q + 1) % 4], b[q]))
		sb.faces.new(rings[0][::-1])
		sb.faces.new(rings[-1])
		bmesh.ops.recalc_face_normals(sb, faces=sb.faces)
		k._object(f"strap-{side}", sb, nylon, sharp_angle=50)

	# Into the chest bone's space: the root becomes the bone, the parts its children.
	frame = Y_UP_TO_Z_UP @ gltf_node_world(PLAYER, VEST_BONE) @ Y_UP_TO_Z_UP.inverted()
	bake_into_frame(k, frame)
	return k


def bake_into_frame(kit, frame):
	"""Applies each part's modifiers, then moves the root to `frame` with the parts staying where they are."""
	deps = bpy.context.evaluated_depsgraph_get()
	inverse = frame.inverted()
	for part in kit.parts():
		if part.type != "MESH":
			continue
		baked = bpy.data.meshes.new_from_object(part.evaluated_get(deps), preserve_all_data_layers=True, depsgraph=deps)
		part.modifiers.clear()
		old = part.data
		part.data = baked
		bpy.data.meshes.remove(old)
		baked.transform(inverse @ part.matrix_world)
		part.matrix_basis = Matrix.Identity(4)
	kit.root.matrix_world = frame
	kit.frame = frame


BUILDERS = {
	"pistol": build_pistol,
	"shotgun": build_shotgun,
	"rocket_launcher": build_rocket_launcher,
	"rocket": build_rocket,
	"grenade": build_grenade,
	"armour_vest": build_armour_vest,
}
OUTPUTS = {name: os.path.join(WEAPONS_OUT, f"{name}.glb") for name in BUILDERS}
OUTPUTS["armour_vest"] = os.path.join(PROPS_OUT, "armour-vest.glb")


#: Where each gun is held, in mm in its build space: the origin the game holds it by, and the hands.
#: The origin sits 2 cm ahead of and 3 cm above the firing hand, as the hold styles were tuned for;
#: the launcher's sits low so its tube rides on the shoulder at the height those styles expect.
GRIPS = {
	"pistol": ((0, -2, -25), {"main": (0, -22, -55)}),
	"shotgun": ((0, -25, 2), {"main": (0, -45, -28), "off": (0, 320, -28)}),
	"rocket_launcher": ((0, -42, -155), {"main": (0, -42, -65), "off": (0, 172, -60)}),
}


def main(names):
	for i, name in enumerate(names):
		kit = BUILDERS[name]((i * 0.6, 0, 0))
		if name in GRIPS:
			grip_spec(kit, *GRIPS[name])
		elif name == "grenade":
			lo, hi = bounds(kit)
			print("grenade length", round((hi.z - lo.z) * MM, 3), "along", round(-lo.z / (hi.z - lo.z), 3))
		export(kit, OUTPUTS[name])
	path = os.path.join(HERE, "orion-weapons.blend")
	bpy.data.libraries.write(path, {o for o in bpy.data.objects if any(c.name.startswith("model-") for c in o.users_collection)}, fake_user=True, compress=True)
	print("saved", path)


if __name__ == "__main__" and bpy.app.background:
	# Run without a window, the file's own scene is the only one there is: build in it, emptied of
	# the startup cube, camera and light, so only the models are in what's exported.
	SCENE = bpy.context.scene.name
	for obj in list(bpy.context.scene.objects):
		bpy.data.objects.remove(obj, do_unlink=True)
	args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else list(BUILDERS)
	main(args)
