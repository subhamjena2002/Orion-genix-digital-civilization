"""Rebuild the gangster player body from the original casual model and export it for the game.

    blender -b -P blender/export_player_gangster.py

Reads the untouched casual model (public/models/characters/player-casual.glb), applies
restyle_player_gangster.py and writes public/models/characters/player-gangster.glb. Make the
1024 copy afterwards:

    node scripts/make-texture-variant.mjs public/models/characters/player-gangster.glb public/models/characters/player-gangster-1k.glb 1024
"""
import importlib.util
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCE = os.path.join(ROOT, "public", "models", "characters", "player-casual.glb")
OUT = os.path.join(ROOT, "public", "models", "characters", "player-gangster.glb")


def clear_scene():
	for obj in list(bpy.data.objects):
		bpy.data.objects.remove(obj, do_unlink=True)
	for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures):
		for item in list(coll):
			coll.remove(item)
	for coll in list(bpy.data.collections):
		bpy.data.collections.remove(coll)


def with_view3d(fn):
	"""Run an operator with a 3D view as context when there is one (the UI), plainly when not (-b)."""
	wm = bpy.context.window_manager
	for win in wm.windows:
		for area in win.screen.areas:
			if area.type == "VIEW_3D":
				region = next(r for r in area.regions if r.type == "WINDOW")
				with bpy.context.temp_override(window=win, area=area, region=region):
					return fn()
	return fn()


def main():
	clear_scene()
	with_view3d(lambda: bpy.ops.import_scene.gltf(filepath=SOURCE))
	spec = importlib.util.spec_from_file_location("restyle", os.path.join(HERE, "restyle_player_gangster.py"))
	restyle = importlib.util.module_from_spec(spec)
	spec.loader.exec_module(restyle)
	restyle.run()
	restyle.add_sunglasses()
	# Same as the source: the game turns the blend into an alpha cut-out (OrionPlayerBody).
	bpy.data.materials["Character"].surface_render_method = "BLENDED"
	with_view3d(lambda: bpy.ops.export_scene.gltf(
		filepath=OUT,
		export_format="GLB",
		export_image_format="AUTO",
		export_skins=True,
		# The source's bind pose lies on its back and its joint nodes stand it up; Blender holds
		# that standing pose as the pose, not the rest, so write the pose to keep it upright.
		export_rest_position_armature=False,
		export_animations=False,
		export_apply=False,
		export_yup=True,
	))
	print("wrote", OUT, os.path.getsize(OUT))


main()
