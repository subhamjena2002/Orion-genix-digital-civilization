"""One-call build of a car from its template: new .blend, import, generate, studio, renders.

    PRESET, TEMPLATE, NAME = "taxi", "orion-taxi", "taxi2026"
    exec(open(r"C:\\oriongenix\\blender\\make_car_2026.py").read())

Saves blender/<TEMPLATE>-2026.blend and renders blender/renders/<NAME>_<view>.png.
"""
import bpy, os

ROOT = r"C:\oriongenix"
win = bpy.context.window_manager.windows[0]
with bpy.context.temp_override(window=win, screen=win.screen):
    if bpy.data.is_dirty and bpy.data.filepath:
        bpy.ops.wm.save_mainfile()
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "public", "models", "vehicles", TEMPLATE + ".glb"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", TEMPLATE + "-2026.blend"))
    exec(open(os.path.join(ROOT, "blender", "build_car_2026.py")).read())
    exec(open(os.path.join(ROOT, "blender", "present_sedan_2026.py")).read())
    # Bigger vehicles: pull the studio cameras back and up in proportion.
    root = next(o for o in bpy.data.objects if o.parent is None and o.type == "EMPTY")
    from mathutils import Vector
    meshes = [o for o in root.children_recursive if o.type == "MESH"]
    span = max((o.dimensions.y for o in meshes), default=4.9)
    height = max(((o.matrix_world @ Vector(c)).z for o in meshes for c in o.bound_box), default=1.45)
    k = max(1.0, span / 4.9, height / 1.6)
    if k > 1.0:
        old, new = Vector((0, 0, 0.62)), Vector((0, 0, height * 0.42))
        for cam in [o for o in bpy.data.objects if o.name.startswith("present_cam_") and "detail" not in o.name]:
            cam.location = new + (cam.location - old) * k
            cam.rotation_euler = (new - cam.location).to_track_quat("-Z", "Y").to_euler()
    out = []
    for view in VIEWS if "VIEWS" in globals() else ("front_three_quarter", "side", "rear_three_quarter"):
        scene.camera = bpy.data.objects["present_cam_" + view]
        scene.render.filepath = os.path.join(ROOT, "blender", "renders", f"{NAME}_{view}.png")
        bpy.ops.render.render(write_still=True)
        out.append(scene.render.filepath)
    bpy.ops.wm.save_mainfile()
print(out)
