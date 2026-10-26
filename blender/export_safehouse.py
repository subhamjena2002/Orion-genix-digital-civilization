# Exports the built safehouse (build_safehouse.py) to the game as one GLB, textures embedded as JPG.
#   exec(open(r"C:\oriongenix\blender\export_safehouse.py").read())
import os
import subprocess

import bpy

GLB = r"C:\oriongenix\public\models\buildings\safehouse\orion-safehouse.glb"

os.makedirs(os.path.dirname(GLB), exist_ok=True)
house = bpy.data.objects["safehouse"]
for obj in bpy.context.view_layer.objects:
    obj.select_set(obj == house)
bpy.context.view_layer.objects.active = house
with bpy.context.temp_override(active_object=house, selected_objects=[house], selected_editable_objects=[house]):
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
# One texture per image: the game closes an image once its first texture is uploaded, so a
# second texture over it would draw black (see scripts/dedupe-glb-textures.mjs).
subprocess.run(["node", "scripts/dedupe-glb-textures.mjs", GLB], cwd=r"C:\oriongenix", check=True)
print("exported", GLB, os.path.getsize(GLB) // 1024, "KB")
