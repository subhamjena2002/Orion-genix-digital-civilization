"""Studio presentation for the rebuilt sedan: its own collection, cameras and lights only.

Nothing here touches the car or the game objects. Renders land in blender/renders/.
    exec(open(r"C:\oriongenix\blender\present_sedan_2026.py").read())
"""
import bpy, math, os
from mathutils import Vector

COLL = "_Presentation (not game)"
OUT_DIR = r"C:\oriongenix\blender\renders"
os.makedirs(OUT_DIR, exist_ok=True)
scene = bpy.context.scene

coll = bpy.data.collections.get(COLL)
if coll is None:
    coll = bpy.data.collections.new(COLL)
    scene.collection.children.link(coll)
for o in list(coll.objects):
    bpy.data.objects.remove(o, do_unlink=True)


def link(o):
    coll.objects.link(o)
    return o


# Floor: a large soft-grey cyclorama so contact shadows and reflections read.
me = bpy.data.meshes.new("present_floor")
r = 30.0
me.from_pydata([(-r, -r, 0), (r, -r, 0), (r, r, 0), (-r, r, 0)], [], [(0, 1, 2, 3)])
floor = link(bpy.data.objects.new("present_floor", me))
fm = bpy.data.materials.get("present_floor") or bpy.data.materials.new("present_floor")
fm.use_nodes = True
b = next(n for n in fm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
b.inputs["Base Color"].default_value = (0.32, 0.32, 0.33, 1)
b.inputs["Roughness"].default_value = 0.55
floor.data.materials.append(fm)


def area(name, loc, size, energy, look_at=(0, 0, 0.6), color=(1, 1, 1), shape="RECTANGLE", size_y=None):
    d = bpy.data.lights.new(name, "AREA")
    d.shape = shape
    d.size = size
    d.size_y = size_y or size
    d.energy = energy
    d.color = color
    o = link(bpy.data.objects.new(name, d))
    o.location = loc
    o.rotation_euler = (Vector(look_at) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return o


# Big overhead softbox (draws the long highlight down the body), two strip lights, warm fill.
area("present_key", (0, 0, 6.0), 7.0, 3200, size_y=4.0)
area("present_strip_l", (5.5, -1.0, 2.4), 6.0, 1100, size_y=0.6)
area("present_strip_r", (-5.5, 1.0, 2.4), 6.0, 1100, size_y=0.6)
area("present_front", (-2.5, -7.0, 2.0), 3.0, 900, color=(1.0, 0.95, 0.9))
area("present_rear", (2.5, 7.0, 2.2), 3.0, 900, color=(0.9, 0.95, 1.0))

# Studio sky: a bright soft dome over a darker horizon, so paint has something broad to reflect.
world = bpy.data.worlds.get("present_world") or bpy.data.worlds.new("present_world")
world.use_nodes = True
wn = world.node_tree.nodes
wn.clear()
tc = wn.new("ShaderNodeTexCoord")
sep = wn.new("ShaderNodeSeparateXYZ")
ramp = wn.new("ShaderNodeValToRGB")
bg = wn.new("ShaderNodeBackground")
wo = wn.new("ShaderNodeOutputWorld")
wl = world.node_tree.links
wl.new(tc.outputs["Generated"], sep.inputs[0])
wl.new(sep.outputs["Z"], ramp.inputs["Fac"])
wl.new(ramp.outputs["Color"], bg.inputs["Color"])
wl.new(bg.outputs[0], wo.inputs[0])
ramp.color_ramp.elements[0].position = 0.48
ramp.color_ramp.elements[0].color = (0.035, 0.037, 0.042, 1)
ramp.color_ramp.elements[1].position = 0.75
ramp.color_ramp.elements[1].color = (0.55, 0.57, 0.60, 1)
mid = ramp.color_ramp.elements.new(0.53)
mid.color = (0.20, 0.205, 0.215, 1)
bg.inputs["Strength"].default_value = 2.2
scene.world = world

CAMS = {
    "front_three_quarter": ((-4.9, -6.3, 1.55), (0.0, -0.35, 0.62), 50),
    "side": ((-8.6, 0.0, 1.05), (0.0, 0.0, 0.66), 55),
    "rear_three_quarter": ((4.9, 6.2, 1.7), (0.0, 0.35, 0.62), 50),
    "front": ((0.0, -8.0, 1.0), (0.0, 0.0, 0.62), 70),
    "wheel_detail": ((-2.2, -2.9, 0.55), (-0.85, -1.48, 0.38), 60),
    "front_detail": ((-1.9, -4.0, 1.05), (-0.25, -2.25, 0.62), 55),
    "rear_detail": ((1.6, 4.1, 1.1), (0.1, 2.25, 0.72), 55),
    "interior": ((-1.75, 0.55, 1.75), (0.15, -0.45, 0.82), 32),
}
for name, (loc, target, lens) in CAMS.items():
    cd = bpy.data.cameras.new("present_cam_" + name)
    cd.lens = lens
    o = link(bpy.data.objects.new("present_cam_" + name, cd))
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()

scene.render.engine = "BLENDER_EEVEE"
scene.eevee.use_raytracing = False
scene.eevee.use_shadows = True
scene.eevee.taa_render_samples = 64
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.film_transparent = False
scene.view_settings.view_transform = "AgX"
try:
    scene.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    pass


def render(names):
    prev = scene.camera
    out = []
    for n in names:
        scene.camera = bpy.data.objects["present_cam_" + n]
        scene.render.filepath = os.path.join(OUT_DIR, f"sedan2026_{n}.png")
        bpy.ops.render.render(write_still=True)
        out.append(scene.render.filepath)
    scene.camera = prev
    return out
