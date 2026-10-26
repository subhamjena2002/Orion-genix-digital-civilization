"""Renders preview shots of the weapon models to blender/renders/ (side and three-quarter views).

    blender -b -P blender/present_weapons.py -- pistol shotgun
"""
import importlib.util
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("build_weapons", os.path.join(HERE, "build_weapons.py"))
weapons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(weapons)
OUT = os.path.join(HERE, "renders")

VIEWS = {
	"front": Vector((0, -1, 0.1)),
	"side": Vector((1, 0, 0)),
	"three_quarter": Vector((0.75, -0.55, 0.45)),
	"rear_quarter": Vector((-0.7, 0.6, 0.35)),
}


def setup(scene):
	for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
		try:
			scene.render.engine = engine
			break
		except TypeError:
			continue
	scene.render.resolution_x = 1400
	scene.render.resolution_y = 800
	scene.render.film_transparent = False
	world = bpy.data.worlds.new("preview") if scene.world is None else scene.world
	scene.world = world
	world.use_nodes = True
	bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
	bg.inputs["Color"].default_value = (0.32, 0.33, 0.35, 1)
	bg.inputs["Strength"].default_value = 0.7
	for name, rot, energy in (("key", (50, 0, 35), 3.5), ("fill", (60, 0, -140), 1.2), ("rim", (20, 0, 180), 2.0)):
		light = bpy.data.lights.new(name, "SUN")
		light.energy = energy
		ob = bpy.data.objects.new(name, light)
		ob.rotation_euler = [math.radians(a) for a in rot]
		scene.collection.objects.link(ob)
	cam = bpy.data.cameras.new("preview")
	cam.type = "ORTHO"
	ob = bpy.data.objects.new("preview-camera", cam)
	scene.collection.objects.link(ob)
	scene.camera = ob
	return ob


def world_bounds(kit):
	deps = bpy.context.evaluated_depsgraph_get()
	lo = Vector((1e9, 1e9, 1e9))
	hi = -lo
	for part in kit.parts():
		if part.type != "MESH":
			continue
		ev = part.evaluated_get(deps)
		for v in ev.to_mesh().vertices:
			p = part.matrix_world @ v.co
			lo = Vector(map(min, lo, p))
			hi = Vector(map(max, hi, p))
		ev.to_mesh_clear()
	return lo, hi


def shoot(kit, camera, scene, suffix=""):
	lo, hi = world_bounds(kit)
	centre = (lo + hi) / 2
	size = hi - lo
	for view, direction in VIEWS.items():
		direction = direction.normalized()
		camera.location = centre + direction * 3
		camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
		camera.data.ortho_scale = max(size.y, size.z * 1.75, size.x) * (1.6 if kit.name == "armour_vest" else 1.15)
		camera.data.clip_end = 10
		scene.render.filepath = os.path.join(OUT, f"weapon-{kit.name}{suffix}-{view}.png")
		bpy.ops.render.render(write_still=True)
		print("rendered", scene.render.filepath)


def main(names):
	scene = bpy.context.scene
	weapons.SCENE = scene.name
	for obj in list(scene.objects):
		bpy.data.objects.remove(obj, do_unlink=True)
	camera = setup(scene)
	for name in names:
		kit = weapons.BUILDERS[name]()
		for coll in bpy.data.collections:
			if coll.name.startswith("cutters-"):
				coll.hide_render = True
		for other in bpy.data.collections:
			if other.name.startswith("model-"):
				other.hide_render = other.name != f"model-{name}"
		reference = bpy.data.collections.get("vest-reference")
		if reference:
			# The vest is shown on the body it was fitted to.
			reference.hide_render = name != "armour_vest"
		shoot(kit, camera, scene)


args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else list(weapons.BUILDERS)
main(args)
