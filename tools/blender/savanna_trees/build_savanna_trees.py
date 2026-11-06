"""Savanna acacias: flat-topped umbrella thorn trees.

Run headless:
  "F:\\Blender 5.2\\blender.exe" -b --factory-startup --python tools/blender/savanna_trees/build_savanna_trees.py -- [--no-render] [--only acacia-01]

Writes one GLB per tree to assets/runtime-sources/trees/savanna/ (one bark mesh,
one leaf mesh, the two-material contract StylizedTreeView extracts) and preview
renders to tmp/savanna/blender/. Everything is seeded, so a rerun is identical.

The silhouette is the point: the 2026-11-06 savanna review read the biome as an
English park because every tree was a round oak. A short bole forks low into a
few limbs that climb at an angle to one crown height, then fan out almost flat,
so the crown is a wide, thin plate of layered leaf pads with sky under it.
"""
import math
import os
import random
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from tree_kit import (Branch, assemble, card, export, fbm, grow, jitter, material,  # noqa: E402
                      perpendicular, remove, save_image, setup_scene, tube_mesh)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'runtime-sources', 'trees', 'savanna')
PREVIEW = os.path.join(ROOT, 'tmp', 'savanna', 'blender')
TEX = os.path.join(ROOT, 'tmp', 'savanna', 'textures')

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = '--no-render' not in argv
ONLY = argv[argv.index('--only') + 1] if '--only' in argv else None

# name, seed, height, crown radius, base radius, limb count, bole share, lean.
# The runtime only takes a tree at least as tall as it is wide
# (StylizedTreePrototypes isUprightSize strict), so crowns stay just inside that.
TREES = [
    ('acacia-01', 101, 10.5, 2.5, 0.30, 2, 0.30, 0.06),
    ('acacia-02', 131, 11.5, 2.8, 0.36, 3, 0.24, 0.04),
    ('acacia-03', 167, 9.0, 2.0, 0.22, 2, 0.42, 0.16),
]

# Leaf atlas regions (u ranges): a dense leaflet pad, a sparser pad edge.
PAD_U = (0.0, 0.5)
EDGE_U = (0.5, 1.0)


# ---------------------------------------------------------------- textures

def leaf_atlas():
    """1024x512 RGBA: two pads of tiny bipinnate leaflets, dusty olive, seen
    from above. The dense pad fills the crown, the ragged one breaks its rim."""
    rng = np.random.default_rng(29)
    w, h = 1024, 512
    rgba = np.zeros((h, w, 4))
    ys, xs = np.mgrid[0:h, 0:w // 2].astype(np.float32)
    for (u0, u1), count, reach in ((PAD_U, 2600, 0.86), (EDGE_U, 1300, 0.95)):
        x0 = int(u0 * w)
        sub = rgba[:, x0:x0 + w // 2]
        rw = w // 2
        for _ in range(count):
            # Leaflets cluster toward the pad's middle; the rim thins to gaps.
            r = reach * math.sqrt(rng.uniform(0, 1)) ** 0.8
            a = rng.uniform(0, 2 * math.pi)
            cx, cy = rw / 2 + math.cos(a) * r * rw / 2, h / 2 + math.sin(a) * r * h / 2
            ang = rng.uniform(0, math.pi)
            la, lb = rng.uniform(4, 7), rng.uniform(1.6, 2.6)
            ix0, ix1 = int(max(0, cx - 8)), int(min(rw, cx + 9))
            iy0, iy1 = int(max(0, cy - 8)), int(min(h, cy + 9))
            dx, dy = xs[iy0:iy1, ix0:ix1] - cx, ys[iy0:iy1, ix0:ix1] - cy
            u = dx * math.cos(ang) + dy * math.sin(ang)
            v = -dx * math.sin(ang) + dy * math.cos(ang)
            inside = (u / la) ** 2 + (v / lb) ** 2 < 1
            # Dusty sage olive: at 0.36/0.42/0.18 the painted crown read near black in the world.
            tone = np.array([0.58, 0.62, 0.32]) * rng.uniform(0.72, 1.1)
            region = sub[iy0:iy1, ix0:ix1]
            region[inside, :3] = tone
            region[inside, 3] = 1
    return save_image('acacia_leaves', rgba, os.path.join(TEX, 'acacia-leaves.png'))


def bark_texture():
    """Grey-brown furrowed bark; only for the preview, the runtime synthesises its own."""
    rng = np.random.default_rng(31)
    w = h = 256
    streak = fbm(w, h, (16, 2), rng, 4)
    fissure = np.clip((np.abs(streak - 0.5) * 2) ** 0.5, 0, 1)
    col = np.array([0.03, 0.026, 0.022]) + (np.array([0.16, 0.13, 0.10]) - 0.03) * fissure[..., None]
    rgba = np.concatenate([np.clip(col, 0, 1), np.ones((h, w, 1))], axis=2)
    return save_image('acacia_bark', rgba, os.path.join(TEX, 'acacia-bark.png'))


# ---------------------------------------------------------------- skeleton

# Fine branches: nearly flat, zig-zagging, few levels.
FAN = {
    'taper': 0.5, 'max_depth': 3, 'min_radius': 0.02,
    'phototropism': [0.0, 0.04, 0.02, 0.0, 0.0],
    'gnarl': [0.0, 0.10, 0.16, 0.2, 0.2], 'droop': 0.0,
    'children': [0, 0, 3, 2, 0],
    'child_start': [0.5, 0.4, 0.35, 0.3, 0.3],
    'angle': [(0, 0), (0, 0), (30, 55), (30, 60), (30, 60)],
    'ratio': (0.45, 0.7),
}


def limb(rng, start, end, radius, end_radius, steps=10, wander=0.18):
    """A zig-zag limb from `start` to `end`: acacia wood bends at every node."""
    points, radii = [], []
    side = perpendicular((end - start).normalized())
    for i in range(steps + 1):
        t = i / steps
        bend = math.sin(t * math.pi) * wander
        p = start.lerp(end, t) + side * bend * rng.uniform(-1, 1) + jitter(rng, 0.05) * (0 < i < steps)
        points.append(p)
        radii.append(radius + (end_radius - radius) * t ** 0.9)
    return Branch(points, radii, 1)


def build_skeleton(seed, height, crown, base_radius, limbs, bole_share, lean):
    rng = random.Random(seed)
    heading = rng.uniform(0, 6.28)
    lean_dir = Vector((math.cos(heading), math.sin(heading), 0))
    bole_h = height * bole_share
    plane = height * 0.86
    branches = []
    # The bole: short and leaning, slightly flared at the foot.
    pts, rr = [], []
    for i in range(7):
        t = i / 6
        pts.append(lean_dir * lean * bole_h * t + Vector((0, 0, bole_h * t)) + jitter(rng, 0.03) * (0 < i < 6))
        rr.append(base_radius * (1 - 0.25 * t))
    branches.append(Branch(pts, rr, 0))
    top = pts[-1]
    # Primary limbs climb at an angle to the crown plane, spread round the bole.
    tips = []
    for k in range(limbs):
        ang = heading + k * 6.28 / limbs + rng.uniform(-0.5, 0.5)
        reach = crown * rng.uniform(0.5, 0.75)
        end = Vector((math.cos(ang) * reach, math.sin(ang) * reach, plane - rng.uniform(0.3, 0.9))) + lean_dir * lean * bole_h
        r0 = rr[-1] * rng.uniform(0.62, 0.78)
        branches.append(limb(rng, top, end, r0, r0 * 0.45))
        tips.append((end, ang, r0 * 0.45))
    # From each limb head a fan of boughs out to the crown's rim, mostly outward
    # but some back over the bole so the plate closes over the trunk.
    for end, ang, r in tips:
        fan = []
        for j in range(rng.randint(5, 7)):
            a = ang + rng.uniform(-2.0, 2.0)
            d = Vector((math.cos(a), math.sin(a), rng.uniform(0.0, 0.18))).normalized()
            length = crown * rng.uniform(0.3, 0.6)
            grow(rng, end, d, length, r * rng.uniform(0.5, 0.75), 2, FAN, fan)
        # Squash the fan about its head: twigs that climbed or drooped out of the
        # plate read as sticks above it and as pads hanging under it. One mapping
        # for the whole fan keeps every child joined to its parent.
        for b in fan:
            b.points = [Vector((p.x, p.y, end.z + (p.z - end.z) * 0.25)) for p in b.points]
        branches.extend(fan)
    # Roots: a short flare into the ground.
    for k in range(4):
        ang = heading + k * 1.57 + rng.uniform(-0.3, 0.3)
        out = Vector((math.cos(ang), math.sin(ang), 0))
        # Starts inside the bole and sinks below grade: a flared foot, not legs.
        rp = [out * base_radius * (0.2 + 1.3 * t) + Vector((0, 0, base_radius * 0.7 * (1 - t) - 0.25 * t)) for t in (0, 0.5, 1)]
        branches.append(Branch(rp, [base_radius * 0.75, base_radius * 0.45, base_radius * 0.15], 0))
    return branches, plane


def pads(bm, uv_layer, branches, seed, plane):
    """Flat leaf pads at the bough tips, two or three layers each, so the crown
    reads as a thin plate from the side and a ragged disc from above."""
    rng = random.Random(seed * 7 + 1)
    anchors = [(b.points[-1], 3 if b.depth == 2 else 2, 1.0 if b.depth == 2 else 0.8) for b in branches if b.depth >= 2]
    # Mid-bough and limb-head pads fill the plate between the tips.
    anchors += [(b.points[len(b.points) // 2], 2, 0.9) for b in branches if b.depth == 2]
    anchors += [(b.points[-1], 2, 1.1) for b in branches if b.depth == 1]
    for tip, layers, scale in anchors:
        for layer in range(layers):
            size = rng.uniform(0.75, 1.25) * scale
            yaw = rng.uniform(0, math.pi)
            u = Vector((math.cos(yaw), math.sin(yaw), 0)) * size
            v = Vector((-math.sin(yaw), math.cos(yaw), 0)) * size * rng.uniform(0.7, 1.0)
            # Pads sit on the plane, the lower layers a little under and tilted.
            z = tip.z + 0.15 - layer * rng.uniform(0.16, 0.28) + rng.uniform(-0.08, 0.08)
            c = Vector((tip.x, tip.y, z)) + jitter(rng, 0.25) * Vector((1, 1, 0))
            tilt = Vector((0, 0, rng.uniform(-0.18, 0.18)))
            uvs = [(PAD_U[0], 0), (PAD_U[1], 0), (PAD_U[1], 1), (PAD_U[0], 1)] if layer == 0 \
                else [(EDGE_U[0], 0), (EDGE_U[1], 0), (EDGE_U[1], 1), (EDGE_U[0], 1)]
            card(bm, uv_layer, [c - u - v - tilt, c + u - v + tilt, c + u + v + tilt, c - u + v - tilt], uvs)


def preview(root, path, crown, height):
    """Side and top views: the stock preview frames a tall tree and crops a wide crown."""
    scene = bpy.context.scene
    for o in scene.objects:
        o.hide_render = not (o == root or o.parent == root or o.type in {'CAMERA', 'LIGHT'} or o.name == 'Ground')
    cam = scene.camera
    scene.render.resolution_x, scene.render.resolution_y = 960, 540
    target = Vector((0, 0, height * 0.5))
    span = max(height, crown * 2)
    for suffix, location in (('side', Vector((span * 1.5, -span * 0.35, height * 0.45))),
                             ('top', Vector((span * 0.8, -span * 0.8, height + span * 1.0)))):
        cam.location = location
        cam.rotation_euler = (target - location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = path.replace('.png', f'-{suffix}.png')
        bpy.ops.render.render(write_still=True)


def build_tree(name, seed, height, crown, base_radius, limbs, bole_share, lean, bark_mat, leaf_mat):
    branches, plane = build_skeleton(seed, height, crown, base_radius, limbs, bole_share, lean)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    for b in branches:
        tube_mesh(bm, uv, b)
    trunk_mesh = bpy.data.meshes.new(f'{name}-bark')
    bm.to_mesh(trunk_mesh)
    bm.free()
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    pads(bm, uv, branches, seed, plane)
    leaf_mesh = bpy.data.meshes.new(f'{name}-leaves')
    bm.to_mesh(leaf_mesh)
    bm.free()
    root = assemble(name, trunk_mesh, leaf_mesh, bark_mat, leaf_mat, seed)
    lo = [min(v.co[i] for m in (trunk_mesh, leaf_mesh) for v in m.vertices) for i in range(3)]
    hi = [max(v.co[i] for m in (trunk_mesh, leaf_mesh) for v in m.vertices) for i in range(3)]
    size = [hi[i] - lo[i] for i in range(3)]
    print(f'{name}: {size[0]:.2f} x {size[1]:.2f} wide, {size[2]:.2f} tall')
    if size[2] < max(size[0], size[1]):
        raise SystemExit(f'{name} is wider than tall; the runtime would reject it as a tree.')
    return root


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(TEX, exist_ok=True)
    os.makedirs(PREVIEW, exist_ok=True)
    setup_scene(sky=(0.55, 0.65, 0.8), ground=(0.36, 0.28, 0.16))
    bark_texture()
    bark = material('Acacia bark', None, alpha=False, color=(0.075, 0.062, 0.05))
    leaves = material('Acacia leaves', leaf_atlas(), alpha=True)
    for spec in TREES:
        if ONLY and spec[0] != ONLY:
            continue
        root = build_tree(*spec, bark, leaves)
        export(root, os.path.join(OUT, f'{spec[0]}.glb'))
        if RENDER:
            preview(root, os.path.join(PREVIEW, f'{spec[0]}.png'), spec[3], spec[2])
        remove(root)


main()
