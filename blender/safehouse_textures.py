# Paints the safehouse's tiling textures with numpy (Blender's asset libraries are off, and the
# game wants plain image maps anyway). Every map tiles seamlessly: noise is built on a wrapping
# lattice and every pattern repeats exactly across the image.
#
# Run inside Blender:  exec(open(r"C:\oriongenix\blender\safehouse_textures.py").read())
# Writes JPGs to blender/safehouse_tex/. TILE_METRES says how many metres each image covers.
import os

import bpy
import numpy as np

OUT = r"C:\oriongenix\blender\safehouse_tex"
SIZE = 1024
TILE_METRES = {"stone": 2.0, "wood": 2.0, "floor": 2.4, "epoxy": 4.0, "lawn": 4.0, "plaster": 3.0}

os.makedirs(OUT, exist_ok=True)


def vnoise(size, cells, rng):
    """Smooth value noise on a cells x cells lattice that wraps, sampled size x size."""
    grid = rng.random((cells, cells))
    t = np.arange(size) * cells / size
    i0 = np.floor(t).astype(int)
    f = t - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    a = grid[np.ix_(i0, i0)]
    b = grid[np.ix_(i0, i1)]
    c = grid[np.ix_(i1, i0)]
    d = grid[np.ix_(i1, i1)]
    fy = f[:, None]
    fx = f[None, :]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def vnoise2(size, cells_y, cells_x, rng):
    """Value noise with its own lattice per axis (grain: few cells along, many across)."""
    grid = rng.random((cells_y, cells_x))

    def axis(cells):
        t = np.arange(size) * cells / size
        i0 = np.floor(t).astype(int)
        f = t - i0
        return i0, (i0 + 1) % cells, f * f * (3 - 2 * f)

    y0, y1, fy = axis(cells_y)
    x0, x1, fx = axis(cells_x)
    fy = fy[:, None]
    fx = fx[None, :]
    a = grid[np.ix_(y0, x0)]
    b = grid[np.ix_(y0, x1)]
    c = grid[np.ix_(y1, x0)]
    d = grid[np.ix_(y1, x1)]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(size, base, octaves, rng, gain=0.5):
    total = np.zeros((size, size))
    amp = 1.0
    norm = 0.0
    cells = base
    for _ in range(octaves):
        total += vnoise(size, cells, rng) * amp
        norm += amp
        amp *= gain
        cells *= 2
    return total / norm


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def normal_from_height(height, strength):
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * strength
    n = np.stack([-dx, -dy, np.ones_like(height)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def save(name, rgb):
    """rgb: (SIZE, SIZE, 3) in 0..1, row 0 at the bottom (Blender's pixel order)."""
    image = bpy.data.images.get(name) or bpy.data.images.new(name, SIZE, SIZE, alpha=False)
    if image.size[0] != SIZE:
        image.scale(SIZE, SIZE)
    rgba = np.concatenate([np.clip(rgb, 0, 1), np.ones((SIZE, SIZE, 1))], axis=-1).astype(np.float32)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = os.path.join(OUT, name + ".jpg")
    image.file_format = "JPEG"
    scene = bpy.context.scene
    # The default view transform (AgX) would grade the colours on the way out.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    image.save_render(image.filepath_raw, scene=scene)
    image.source = "FILE"
    image.reload()
    return image


def ledge_stone(rng):
    """Split-face ledgestone: long stones in courses of mixed height, thin dark joints."""
    px = SIZE / TILE_METRES["stone"]
    heights = []
    while sum(heights) < SIZE - 40:
        heights.append(int(rng.uniform(0.07, 0.17) * px))
    scale = SIZE / sum(heights)
    heights = [max(20, int(h * scale)) for h in heights]
    heights[-1] += SIZE - sum(heights)
    palette = [hexrgb(c) for c in ("#a59d90", "#b8ae9e", "#8c857b", "#c6bcaa", "#7b736a", "#9a8f7f", "#b0a491")]
    colour = np.zeros((SIZE, SIZE, 3))
    height = np.zeros((SIZE, SIZE))
    grain = fbm(SIZE, 16, 5, rng)
    pits = fbm(SIZE, 64, 3, rng)
    y = 0
    for h in heights:
        x = int(rng.integers(0, SIZE))
        start = x
        while x < start + SIZE:
            length = int(rng.uniform(0.25, 0.85) * px)
            length = min(length, start + SIZE - x)
            tone = palette[rng.integers(0, len(palette))] * rng.uniform(0.92, 1.06)
            bulge = rng.uniform(0.5, 1.0)
            cols = np.arange(x, x + length) % SIZE
            # A rounded face, highest mid-stone, so the joints read as shadowed grooves.
            u = np.linspace(0, np.pi, length)
            v = np.linspace(0, np.pi, h)
            face = np.outer(np.sin(v) ** 0.35, np.sin(u) ** 0.35) * bulge
            colour[y:y + h][:, cols] = tone
            height[y:y + h][:, cols] = face
            # The joint: a few pixels each side.
            height[y:y + h][:, cols[:3]] = 0
            colour[y:y + h][:, cols[:3]] = hexrgb("#4a443d")
            x += length
        height[y:y + 3, :] = 0
        colour[y:y + 3, :] = hexrgb("#4a443d")
        y += h
    rough = (grain - 0.5) * 0.5 + (pits - 0.5) * 0.35
    colour *= (1 + rough)[..., None] * 0.95
    height = height + rough * 0.6
    return colour, normal_from_height(height, 6.0)


def wood_slats(rng):
    """Vertical teak slats with dark shadow gaps and long grain."""
    px = SIZE / TILE_METRES["wood"]
    slat = int(0.12 * px)
    count = SIZE // slat
    slat = SIZE // count
    gap = max(4, int(0.014 * px))
    colour = np.zeros((SIZE, SIZE, 3))
    height = np.ones((SIZE, SIZE))
    # Grain: noise stretched along the slat (v), squeezed across it (u).
    stretched = sum(vnoise2(SIZE, 2 << o, 64 << o, rng) * 0.5 ** o for o in range(4)) / 1.875
    fine = fbm(SIZE, 32, 3, rng)
    for i in range(count):
        x0 = i * slat
        tone = hexrgb("#8a5634") * rng.uniform(0.82, 1.15)
        colour[:, x0:x0 + slat] = tone
        colour[:, x0:x0 + gap] = hexrgb("#2a1b12")
        height[:, x0:x0 + gap] = 0
    streak = (stretched - 0.5) * 0.45 + (fine - 0.5) * 0.12
    colour *= (1 + streak)[..., None]
    return colour, normal_from_height(height * 0.6 + streak * 0.3, 5.0)


def floor_tiles(rng):
    """Large-format honed limestone, 1.2 m tiles, faint veining and fine grout."""
    tiles = 2
    tile = SIZE // tiles
    base = hexrgb("#e9e2d6")
    cloud = fbm(SIZE, 6, 5, rng)
    warp = fbm(SIZE, 4, 3, rng)
    vein = np.abs(np.sin((cloud * 9 + warp * 6) * np.pi))
    vein = np.clip(1 - vein * 7, 0, 1)
    colour = base[None, None, :] * (0.94 + (cloud - 0.5) * 0.16)[..., None]
    colour -= vein[..., None] * hexrgb("#2a2015") * 0.35
    height = np.ones((SIZE, SIZE))
    for k in range(tiles):
        for offset in range(2):
            colour[k * tile + offset, :] = hexrgb("#bdb4a6")
            colour[:, k * tile + offset] = hexrgb("#bdb4a6")
            height[k * tile + offset, :] = 0
            height[:, k * tile + offset] = 0
    # Each tile a touch lighter or darker than its neighbours.
    for i in range(tiles):
        for j in range(tiles):
            colour[i * tile:(i + 1) * tile, j * tile:(j + 1) * tile] *= rng.uniform(0.97, 1.03)
    return colour, normal_from_height(height, 1.5)


def epoxy(rng):
    """Polished grey garage floor: mottled, with fine flecks."""
    mottle = fbm(SIZE, 4, 6, rng)
    fleck = (rng.random((SIZE, SIZE)) > 0.985).astype(float) * rng.uniform(-0.25, 0.3, (SIZE, SIZE))
    colour = hexrgb("#6f747a")[None, None, :] * (0.9 + (mottle - 0.5) * 0.3 + fleck)[..., None]
    return colour, None


def lawn(rng):
    """Mown lawn: broad tone drift, mowing stripes, blade speckle."""
    drift = fbm(SIZE, 4, 5, rng)
    blades = fbm(SIZE, 128, 2, rng)
    stripes = 0.5 + 0.5 * np.sin(np.arange(SIZE) / SIZE * 2 * np.pi * 4)[None, :]
    a = hexrgb("#4f7d2c")
    b = hexrgb("#6c9a3a")
    mix = np.clip(drift * 0.7 + stripes * 0.18 + (blades - 0.5) * 0.6, 0, 1)
    colour = a[None, None, :] * (1 - mix[..., None]) + b[None, None, :] * mix[..., None]
    return colour, normal_from_height(blades, 3.0)


def plaster(rng):
    """Smooth white render: barely-there trowel cloud."""
    cloud = fbm(SIZE, 8, 5, rng)
    colour = hexrgb("#efece6")[None, None, :] * (0.97 + (cloud - 0.5) * 0.06)[..., None]
    return colour, None


def paint_all():
    rng = np.random.default_rng(20261025)
    made = {}
    for name, painter in (("stone", ledge_stone), ("wood", wood_slats), ("floor", floor_tiles), ("epoxy", epoxy), ("lawn", lawn), ("plaster", plaster)):
        colour, normal = painter(rng)
        made[name] = save(f"sh_{name}_diff", colour)
        if normal is not None:
            made[name + "_nor"] = save(f"sh_{name}_nor", normal)
    return made


TEXTURES = paint_all()
print("painted", sorted(TEXTURES))
