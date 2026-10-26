# Preview lighting and camera shots for the safehouse (nothing here is exported).
#   exec(open(r"C:\oriongenix\blender\present_safehouse.py").read()); shot("street")
# shot(name, render=True) also writes blender/renders/safehouse-<name>.png.
import math
import os

import bpy
from mathutils import Vector

RENDERS = r"C:\oriongenix\blender\renders"
# Game-frame eye and target (x right, y up, z toward the road), lens in mm.
SHOTS = {
    "street": ((-8.0, 1.7, 24.0), (0.0, 4.5, 0.0), 24),
    "aerial": ((22.0, 18.0, 30.0), (0.0, 3.0, -6.0), 30),
    "lounge": ((-3.6, 5.9, -5.0), (-11.0, 5.4, -10.0), 20),
    "kitchen": ((-8.0, 6.0, -3.0), (2.0, 4.8, -13.0), 18),
    "garage": ((0.0, 1.6, 3.0), (0.0, 1.4, -16.0), 16),
    "pool": ((10.5, 6.2, 3.6), (7.0, 4.8, -14.0), 20),
}


def g2b(x, y, z):
    return Vector((x, -z, y))


def setup():
    scene = bpy.context.scene
    if "preview_sun" not in bpy.data.objects:
        sun = bpy.data.lights.new("preview_sun", "SUN")
        sun.energy = 4.0
        sun.angle = 0.05
        obj = bpy.data.objects.new("preview_sun", sun)
        scene.collection.objects.link(obj)
        obj.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    if "preview_cam" not in bpy.data.objects:
        cam = bpy.data.objects.new("preview_cam", bpy.data.cameras.new("preview_cam"))
        scene.collection.objects.link(cam)
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.55, 0.7, 0.95, 1)
    bg.inputs[1].default_value = 1.2
    scene.camera = bpy.data.objects["preview_cam"]
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.view_settings.view_transform = "AgX"


def shot(name, render=False):
    setup()
    eye, target, lens = SHOTS[name]
    cam = bpy.data.objects["preview_cam"]
    cam.data.lens = lens
    cam.data.clip_start = 0.05
    cam.location = g2b(*eye)
    cam.rotation_euler = (g2b(*target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    if render:
        os.makedirs(RENDERS, exist_ok=True)
        scene = bpy.context.scene
        scene.render.filepath = os.path.join(RENDERS, f"safehouse-{name}.png")
        bpy.ops.render.render(write_still=True)
