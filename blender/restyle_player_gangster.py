"""Restyle the player body (player-casual.glb) as a Vice City-style gangster.

Run inside Blender with player-casual.glb imported (see export_player_gangster.py). Repaints the
shared 2048 atlas per part, using each mesh's own UV islands as the mask:

- shirt   -> black satin, keeping the fabric's folds
- shorts  -> cream trousers: cut above their hem and carried down to the shoes as one mesh
            (make_trousers), with the bare shins under them removed
- sneakers-> dark brown leather shoes
- chain + watch -> gold
- plus a pair of gold-rimmed aviators, skinned to the head bone

The masks come from the meshes, so nothing here depends on pixel positions in the atlas.
"""
import bpy
import numpy as np

SIZE = 2048
SHIRT, SHORTS, SHOES, CHAIN, WATCH, BODY = "Object_17", "Object_9", "Object_15", "Object_13", "Object_25", "Object_29"
# Standing height (metres) where the shorts are cut, just above their rolled hem.
TROUSER_TOP = 0.64
# Height of the trouser hem, tucked a little into the shoe tops (which reach 0.145).
TROUSER_END = 0.115
# Trouser leg radius at the hem, and rows between the cut and the hem.
TROUSER_HEM_R = 0.066
TROUSER_ROWS = 15
# A free block of the atlas for the trouser legs' cloth: x, y, size in texels.
PATCH = (0, 336, 192)

CREAM = np.array([0.80, 0.74, 0.62])
BLACK_SATIN = np.array([0.030, 0.030, 0.036])
LEATHER = np.array([0.16, 0.085, 0.045])
GOLD = np.array([1.00, 0.70, 0.26])


def raster(obj, values=None):
	"""Mask of the atlas texels covered by obj's UV triangles.

	Given a value per vertex, also returns those values interpolated over the texels (NaN where
	nothing is mapped).
	"""
	me = obj.data
	uv = me.uv_layers.active.data
	me.calc_loop_triangles()
	mask = np.zeros((SIZE, SIZE), bool)
	field = np.full((SIZE, SIZE), np.nan, np.float32)
	for tri in me.loop_triangles:
		p = np.array([uv[l].uv[:] for l in tri.loops]) * SIZE
		x0, y0 = np.maximum(np.floor(p.min(0)).astype(int) - 1, 0)
		x1, y1 = np.minimum(np.ceil(p.max(0)).astype(int) + 1, SIZE - 1)
		if x1 < x0 or y1 < y0:
			continue
		a, b, c = p
		d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
		if abs(d) < 1e-9:
			continue
		xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
		l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
		l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
		tol = -0.04
		inside = (l1 >= tol) & (l2 >= tol) & (1 - l1 - l2 >= tol)
		mask[y0:y1 + 1, x0:x1 + 1] |= inside
		if values is not None:
			va, vb, vc = values[list(tri.vertices)]
			field[y0:y1 + 1, x0:x1 + 1][inside] = (l1 * va + l2 * vb + (1 - l1 - l2) * vc)[inside]
	return mask if values is None else (mask, field)


def dilate(mask, blocked, steps=3):
	"""Grow a mask a few texels into empty gutter (never into another part) to hide UV seams."""
	m = mask.copy()
	for _ in range(steps):
		g = m.copy()
		g[1:] |= m[:-1]; g[:-1] |= m[1:]; g[:, 1:] |= m[:, :-1]; g[:, :-1] |= m[:, 1:]
		m = g & ~blocked | m
	return m


def blur(a, r=6):
	"""Cheap box blur (separable, repeated) for low-frequency shading."""
	out = a.copy()
	for _ in range(3):
		c = np.cumsum(np.pad(out, ((r + 1, r), (0, 0)), mode="edge"), 0)
		out = (c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)
		c = np.cumsum(np.pad(out, ((0, 0), (r + 1, r)), mode="edge"), 1)
		out = (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
	return out


def luminance(rgb):
	return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def recolor(rgb, mask, target, contrast=1.0, floor=0.35, ceil=1.6):
	"""Paint mask with target, keeping the original's light and dark (folds, stitching, wear)."""
	lum = luminance(rgb)
	ref = np.median(lum[mask])
	rel = np.clip((lum[mask] / max(ref, 1e-4)) ** contrast, floor, ceil)
	rgb[mask] = np.clip(target[None, :] * rel[:, None], 0, 1)


def posed_world(obj):
	"""Each vertex's posed (standing) world position."""
	posed = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
	co = np.empty(len(posed.vertices) * 3, np.float32)
	posed.vertices.foreach_get("co", co)
	mw = np.array(obj.matrix_world)
	return co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]


def skin_matrices(obj):
	"""Per vertex group, the object-space map from bind to posed that the armature applies."""
	arm = bpy.data.objects[ARMATURE]
	mw = obj.matrix_world
	out = {}
	for g in obj.vertex_groups:
		pb = arm.pose.bones.get(g.name)
		if pb:
			out[g.index] = np.array(mw.inverted() @ arm.matrix_world @ pb.matrix
				@ pb.bone.matrix_local.inverted() @ arm.matrix_world.inverted() @ mw)
	return out


def cut_rings(bm, z):
	"""The boundary loops a cut left at height z, each ordered the way the faces above run."""
	cut = {e for e in bm.edges if e.is_boundary and all(abs(v.co.z - z) < 1e-5 for v in e.verts)}
	rings, seen = [], set()
	for e0 in cut:
		if e0 in seen:
			continue
		loop = e0.link_loops[0]
		ring = [loop.vert]
		v, e = loop.link_loop_next.vert, e0
		while v is not ring[0]:
			seen.add(e)
			ring.append(v)
			e = next(x for x in v.link_edges if x in cut and x is not e)
			v = e.other_vert(v)
		seen.add(e)
		rings.append(ring)
	return rings


def make_trousers(shorts, body):
	"""Turn the shorts into full-length trousers: one mesh from the waist to the shoes.

	The shorts are cut above their rolled hem and each leg's ring is carried straight down,
	narrowing to the ankle, so the leg is one surface with no seam where the hem was. The new
	rings are skinned like the shins they cover, and those shins are deleted from the body so
	nothing pokes through. Everything is built in the standing (posed) shape, then each vertex
	goes back to bind space through its own skinning.
	"""
	import bmesh
	shins = posed_world(body)
	body_w = np.zeros((len(body.data.vertices), len(body.vertex_groups)), np.float32)
	for v in body.data.vertices:
		for ge in v.groups:
			body_w[v.index, ge.group] = ge.weight
	# The shorts' group for each body group, adding any the shorts lack.
	to_shorts = [(shorts.vertex_groups.get(g.name) or shorts.vertex_groups.new(name=g.name)).index
		for g in body.vertex_groups]

	bm = bmesh.new()
	bm.from_mesh(shorts.data)
	for v, p in zip(bm.verts, posed_world(shorts)):
		v.co = p
	# The glTF import splits vertices along UV seams: weld them, so the cut leaves closed rings
	# and the legs shade as one surface.
	bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
	bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
		plane_co=(0, 0, TROUSER_TOP), plane_no=(0, 0, 1), clear_inner=True)
	deform = bm.verts.layers.deform.verify()
	uv = bm.loops.layers.uv.active
	px, py, size = PATCH
	u0, v0, span = (px + 16) / SIZE, (py + 16) / SIZE, (size - 32) / SIZE
	cut_uvs = []

	for leg_no, ring in enumerate(cut_rings(bm, TROUSER_TOP)):
		# Where each point of the cut sits on the shorts' texture, so the legs can carry it down.
		cut_uvs.append(np.array([v.link_loops[0][uv].uv[:] for v in ring]))
		top = np.array([v.co[:] for v in ring])
		side = 1 if top[:, 0].mean() > 0 else -1
		leg = np.nonzero((shins[:, 0] * side > 0.005) & (shins[:, 2] < TROUSER_TOP + 0.1))[0]
		ankle = shins[leg][np.abs(shins[leg, 2] - TROUSER_END - 0.03) < 0.03]
		c0, c1 = top[:, :2].mean(0), ankle[:, :2].mean(0)
		# Rows down to the hem, then a short turn-up inside it so the edge has some thickness.
		heights = [TROUSER_TOP + (TROUSER_END - TROUSER_TOP) * k / TROUSER_ROWS for k in range(1, TROUSER_ROWS + 1)]
		rows = [ring]
		for k, z in enumerate(heights + [TROUSER_END + 0.012], 1):
			t = min(k / TROUSER_ROWS, 1.0)
			c = c0 + (c1 - c0) * t
			row = []
			for v in ring:
				d = np.array(v.co[:2]) - c0
				r = float(np.linalg.norm(d))
				r += (TROUSER_HEM_R - r) * t - (0.010 if k > TROUSER_ROWS else 0.0)
				p = np.array([*(c + d / max(np.linalg.norm(d), 1e-6) * r), z])
				nv = bm.verts.new(p)
				# Skinned like the nearest shins, easing in from the cut's own weights.
				near = leg[np.argsort(np.linalg.norm(shins[leg] - p, axis=1))[:4]]
				inv = 1 / (np.linalg.norm(shins[near] - p, axis=1) + 1e-4)
				w = (body_w[near] * inv[:, None]).sum(0) / inv.sum()
				blend = min(t * 3, 1.0)
				weights = {g: x * (1 - blend) for g, x in v[deform].items()}
				for g in np.nonzero(w > 1e-3)[0]:
					weights[to_shorts[g]] = weights.get(to_shorts[g], 0) + float(w[g]) * blend
				for g, x in sorted(weights.items(), key=lambda gx: -gx[1])[:4]:
					nv[deform][g] = x
				row.append(nv)
			rows.append(row)
		n = len(ring)
		for k in range(len(rows) - 1):
			a, b = rows[k], rows[k + 1]
			for i in range(n):
				j = (i + 1) % n
				f = bm.faces.new((a[j], a[i], b[i], b[j]))
				# Each leg takes half the patch, a column per point of the cut, top row at v0.
				for loop, (col, row) in zip(f.loops, ((i + 1, k), (i, k), (i, k + 1), (i + 1, k + 1))):
					loop[uv].uv = (u0 + span * (leg_no + col / n) / 2, v0 + span * row / (len(rows) - 1))

	for f in bm.faces:
		f.smooth = True
	# Back to bind space, through each vertex's own skinning.
	mats = skin_matrices(shorts)
	to_local = np.linalg.inv(np.array(shorts.matrix_world))
	for v in bm.verts:
		ws = [(mats[g], x) for g, x in v[deform].items() if g in mats]
		m = sum(mat * x for mat, x in ws) / sum(x for _, x in ws)
		v.co = (np.linalg.inv(m) @ to_local @ np.array([*v.co, 1.0]))[:3]
	me = shorts.data
	bm.to_mesh(me)
	bm.free()
	# The imported normals were per split vertex; the welded surface shades smoothly on its own.
	if "custom_normal" in me.attributes:
		me.attributes.remove(me.attributes["custom_normal"])
	me.update()

	# The shins are inside the trousers now.
	bm = bmesh.new()
	bm.from_mesh(body.data)
	hidden = []
	for f in bm.faces:
		x, _, z = shins[[v.index for v in f.verts]].mean(0)
		if abs(x) > 0.01 and 0.13 < z < TROUSER_TOP - 0.01:
			hidden.append(f)
	bmesh.ops.delete(bm, geom=hidden, context="FACES")
	bm.to_mesh(body.data)
	bm.free()
	body.data.update()
	return cut_uvs, len(hidden)


def paint_trouser_cloth(px, nm, cut_uvs):
	"""Paint the trouser legs' patch: each column starts as the shorts' colour at its point of the
	cut, so the old hem line doesn't show, and settles towards the cloth's average further down."""
	x0, y0, size = PATCH
	inner = size - 32
	rgb = px[..., :3]
	soft = np.stack([blur(rgb[..., c], 2) for c in range(3)], -1)
	samples = [soft[np.clip((uvs[:, 1] * SIZE).astype(int), 0, SIZE - 1),
		np.clip((uvs[:, 0] * SIZE).astype(int), 0, SIZE - 1)] for uvs in cut_uvs]
	cloth = np.concatenate(samples).mean(0)
	half = inner / len(samples)
	block = np.empty((size, size, 3), np.float32)
	for x in range(size):
		leg = min(max(int((x - 16) // half), 0), len(samples) - 1)
		s = samples[leg]
		f = min(max((x - 16 - leg * half) / half, 0.0), 1.0) * len(s)
		i = int(f)
		col = s[i % len(s)] * (1 - (f - i)) + s[(i + 1) % len(s)] * (f - i)
		t = np.clip((np.arange(size) - 16) / inner, 0, 1)
		mix = (np.minimum(t * 2.5, 1) * 0.7)[:, None]
		block[:, x] = col * (1 - mix) + cloth * mix
	rng = np.random.default_rng(7)
	block *= 1 + rng.normal(0, 0.006, (size, size, 1))
	region = (slice(y0, y0 + size), slice(x0, x0 + size))
	rgb[region] = np.clip(block, 0, 1)
	px[region + (3,)] = 1.0
	# Plain cloth: flat normals.
	nm[region + (0,)] = 0.5
	nm[region + (1,)] = 0.5
	nm[region + (2,)] = 1.0


def run():
	objs = bpy.data.objects
	albedo = bpy.data.images["Image_0"]
	normal = bpy.data.images["Image_1"]
	px = np.array(albedo.pixels[:], np.float32).reshape(SIZE, SIZE, 4)
	nm = np.array(normal.pixels[:], np.float32).reshape(SIZE, SIZE, 4)
	rgb = px[..., :3]

	body = objs[BODY]
	masks = {name: raster(objs[name]) for name in (SHIRT, SHORTS, SHOES, CHAIN, WATCH)}
	everything = raster(body)
	for m in masks.values():
		everything |= m
	for name in masks:
		masks[name] = dilate(masks[name], everything & ~masks[name])

	recolor(rgb, masks[SHIRT], BLACK_SATIN, contrast=1.6, floor=0.25, ceil=3.0)
	recolor(rgb, masks[SHORTS], CREAM, contrast=0.3, floor=0.93, ceil=1.06)
	recolor(rgb, masks[SHOES], LEATHER, contrast=1.3, floor=0.3, ceil=2.2)
	recolor(rgb, masks[CHAIN], GOLD, contrast=1.2, floor=0.35, ceil=1.25)
	recolor(rgb, masks[WATCH], GOLD * 0.85, contrast=1.2, floor=0.3, ceil=1.3)

	# Standing height of every shorts texel, before the trousers reshape them.
	_, height = raster(objs[SHORTS], posed_world(objs[SHORTS])[:, 2])
	cut_uvs, shins = make_trousers(objs[SHORTS], body)
	paint_trouser_cloth(px, nm, cut_uvs)

	# The shorts' denim creases read as grime on pale cloth: keep half their depth, fading out
	# towards the cut so they meet the trouser legs' plain cloth without a line.
	sh = masks[SHORTS]
	depth = np.full(sh.sum(), 0.5, np.float32)
	near_cut = np.nan_to_num(height[sh], nan=1.0) - TROUSER_TOP
	depth *= np.clip(near_cut / 0.10, 0, 1)
	nm[sh, :2] = 0.5 + (nm[sh, :2] - 0.5) * depth[:, None]
	xy = nm[sh, :2] * 2 - 1
	nm[sh, 2] = (np.sqrt(np.clip(1 - (xy ** 2).sum(1), 0, 1)) + 1) / 2

	px[..., :3] = rgb
	albedo.pixels.foreach_set(px.ravel())
	normal.pixels.foreach_set(nm.ravel())
	albedo.update(); normal.update()
	albedo.pack(); normal.pack()
	print("repainted; trousers", len(objs[SHORTS].data.vertices), "verts, shin faces removed", shins, {k: int(m.sum()) for k, m in masks.items()})


HEAD_BONE = "CC_Base_Head_038"
OWN_GLASSES = "Object_7"
ARMATURE = "Object_4"


def _material(name, color, rough, metal):
	mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
	mat.use_nodes = True
	bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
	bsdf.inputs["Base Color"].default_value = (*color, 1)
	bsdf.inputs["Roughness"].default_value = rough
	bsdf.inputs["Metallic"].default_value = metal
	return mat


def add_sunglasses():
	"""Aviators in world metres, fitted to this head (front is -Y, eyes at x=+-0.033, z=1.615)."""
	import bmesh
	# The model's own clear, glitter-rimmed glasses would show through these.
	own = bpy.data.objects.get(OWN_GLASSES)
	if own:
		bpy.data.objects.remove(own)
	from math import cos, sin, pi
	bm = bmesh.new()
	lens_mat, frame_mat = 0, 1

	def wrap_y(x):
		# Lenses curve back round the face: flush in front of the eyes, tucked in at the sides.
		return -0.096 + 0.0105 * max(0.0, abs(x) - 0.02) / 0.045 * 2.2

	def lens_outline(side, scale=1.0):
		cx, cz, rx, rz = 0.035 * side, 1.611, 0.027 * scale, 0.0195 * scale
		pts = []
		for i in range(28):
			t = 2 * pi * i / 28
			# Aviator teardrop: fuller and lower towards the outside.
			x = cx + rx * cos(t)
			z = cz + rz * sin(t) * (1.0 if sin(t) > 0 else 1.18 + 0.18 * cos(t) * side)
			pts.append((x, z))
		return pts

	for side in (1, -1):
		inner = lens_outline(side)
		outer = lens_outline(side, 1.13)
		centre = bm.verts.new((0.035 * side, wrap_y(0.035) - 0.0008, 1.607))
		vi = [bm.verts.new((x, wrap_y(x), z)) for x, z in inner]
		vo = [bm.verts.new((x, wrap_y(x) + 0.0005, z)) for x, z in outer]
		n = len(vi)
		for i in range(n):
			j = (i + 1) % n
			f = bm.faces.new((centre, vi[i], vi[j]) if side > 0 else (centre, vi[j], vi[i]))
			f.material_index = lens_mat
			f.smooth = True
			f = bm.faces.new((vi[i], vo[i], vo[j], vi[j]) if side > 0 else (vi[j], vo[j], vo[i], vi[i]))
			f.material_index = frame_mat

	def bar(a, b, w=0.0024, h=0.0024):
		from mathutils import Vector
		a, b = Vector(a), Vector(b)
		d = (b - a).normalized()
		up = Vector((0, 0, 1))
		side = d.cross(up).normalized() * w / 2
		upv = side.cross(d).normalized() * h / 2
		corners = [bm.verts.new(p) for p in (a - side - upv, a + side - upv, a + side + upv, a - side + upv,
			b - side - upv, b + side - upv, b + side + upv, b - side + upv)]
		for q in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
			bm.faces.new([corners[k] for k in q]).material_index = frame_mat

	# Double bridge, then temples back over the ears.
	bar((-0.010, -0.0965, 1.621), (0.010, -0.0965, 1.621))
	bar((-0.009, -0.0962, 1.6255), (0.009, -0.0962, 1.6255), h=0.0016)
	for side in (1, -1):
		bar((0.0655 * side, wrap_y(0.0655) + 0.001, 1.621), (0.090 * side, -0.045, 1.624))
		bar((0.090 * side, -0.045, 1.624), (0.093 * side, 0.030, 1.618))

	me = bpy.data.meshes.new("Sunglasses")
	bm.to_mesh(me)
	bm.free()
	me.materials.append(_material("Sunglasses_Lens", (0.02, 0.025, 0.03), 0.05, 0.0))
	me.materials.append(_material("Sunglasses_Frame", (1.0, 0.74, 0.32), 0.25, 1.0))
	obj = bpy.data.objects.new("Sunglasses", me)
	bpy.data.objects[BODY].users_collection[0].objects.link(obj)
	arm = bpy.data.objects[ARMATURE]
	# Keep the world placement while parenting under the armature.
	obj.parent = arm
	obj.matrix_parent_inverse = arm.matrix_world.inverted()
	# The import leaves the rig posed, not at rest, so move the vertices back through the head
	# bone's pose: the armature modifier then carries them onto the face again.
	bpy.context.view_layer.update()
	bone = arm.pose.bones[HEAD_BONE]
	to_rest = obj.matrix_world.inverted() @ arm.matrix_world @ bone.bone.matrix_local @ bone.matrix.inverted() @ arm.matrix_world.inverted()
	for v in me.vertices:
		v.co = to_rest @ v.co
	group = obj.vertex_groups.new(name=HEAD_BONE)
	group.add(range(len(me.vertices)), 1.0, "REPLACE")
	obj.modifiers.new("Armature", "ARMATURE").object = arm
	return obj


if __name__ == "__main__":
	run()
	add_sunglasses()
