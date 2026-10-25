"""Exports the open car .blend to a game .glb with the game's own lamp glow values.

    GLB = r"C:\\oriongenix\\public\\models\\vehicles\\orion-suv-2026.glb"
    exec(open(r"C:\\oriongenix\\blender\\export_car_2026.py").read())

Renders use brighter lamps; the game drives brake, indicator and headlamp glow itself, so the
file carries the original values. Only the car's hierarchy is exported (not the studio).

Then flatten the plain materials (the game draws one call per material per car):
    node scripts/flatten-vehicle-materials.mjs public/models/vehicles/orion-suv-2026.glb
"""
import bpy, os

GAME_EMIT = {"headlight": ((1.0, 0.98, 0.94), 1.0), "tail_light": ((0.3, 0.01, 0.01), 1.0),
             "indicator_left": ((0.35, 0.15, 0.01), 1.0), "indicator_right": ((0.35, 0.15, 0.01), 1.0)}


def check_spikes(root, limit=0.25):
    """Every part's evaluated geometry (modifiers applied, as exported) stays near the car."""
    from mathutils import Vector
    dg = bpy.context.evaluated_depsgraph_get()
    bad = []
    for ob in root.children_recursive:
        if ob.type != "MESH":
            continue
        me = ob.evaluated_get(dg).to_mesh()
        for v in me.vertices:
            w = ob.matrix_world @ v.co
            if w.z < -limit or w.z > 4.5 or abs(w.x) > 2.0:
                bad.append((ob.name, tuple(round(c, 2) for c in w)))
                break
        ob.evaluated_get(dg).to_mesh_clear()
    if bad:
        raise RuntimeError(f"stray geometry: {bad}")


def export_car(glb):
    saved = {}
    for name, (col, strength) in GAME_EMIT.items():
        b = next(n for n in bpy.data.materials[name].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        saved[name] = (tuple(b.inputs["Emission Color"].default_value), b.inputs["Emission Strength"].default_value)
        b.inputs["Emission Color"].default_value = (*col, 1)
        b.inputs["Emission Strength"].default_value = strength
    root = next(o for o in bpy.data.objects if o.parent is None and o.type == "EMPTY" and o.name.startswith("orion"))
    check_spikes(root)
    win = bpy.context.window_manager.windows[0]
    with bpy.context.temp_override(window=win, screen=win.screen):
        layer = bpy.context.view_layer
        for o in layer.objects:
            o.select_set(False)
        car = [root] + list(root.children_recursive)
        for o in car:
            o.select_set(True)
        layer.objects.active = root
        try:
            bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_apply=True,
                                      export_yup=True, export_cameras=False, export_lights=False,
                                      export_draco_mesh_compression_enable=False, export_animations=False)
        finally:
            for name, (col, strength) in saved.items():
                b = next(n for n in bpy.data.materials[name].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
                b.inputs["Emission Color"].default_value = col
                b.inputs["Emission Strength"].default_value = strength
        for o in car:
            o.select_set(False)
        for m in list(bpy.data.meshes):
            if m.users == 0:
                bpy.data.meshes.remove(m)
        bpy.ops.wm.save_mainfile()
    return root.name, round(os.path.getsize(glb) / 1e6, 2)


print(export_car(GLB))
