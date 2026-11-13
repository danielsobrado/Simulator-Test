"""Grukmar swamp trees: gnarled, buttressed giants and dead snags.

Run headless:
  "F:\\Blender 5.2\\blender.exe" -b --factory-startup --python tools/blender/swamp_trees/build_swamp_trees.py -- [--no-render] [--only swamp-giant-01]

Writes one GLB per tree to assets/runtime-sources/trees/swamp/ (one bark mesh, one
leaf mesh, the two-material contract StylizedTreeView extracts) and preview
renders to tmp/swamp/blender/. Everything is seeded, so a rerun is identical.

The silhouette is the point (docs/plans/swamp-aaa-plan-2026-10-21.md §4): a fluted,
flaring bole on buttress roots, a twisting trunk that forks into a lattice of
bare branches, sparse dark leaf clusters at the tips and moss hanging off the
limbs.
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
from tree_kit import (Branch, add_root_spurs, assemble, card, card_uv, export, fbm, grow, jitter, material,  # noqa: E402
                      oriented_card, perpendicular, remove, render_preview, save_image, setup_scene,
                      tube_mesh, weld_skeleton_junctions)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'runtime-sources', 'trees', 'swamp')
PREVIEW = os.path.join(ROOT, 'tmp', 'swamp', 'blender')
TEX = os.path.join(ROOT, 'tmp', 'swamp', 'textures')

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = '--no-render' not in argv
ONLY = argv[argv.index('--only') + 1] if '--only' in argv else None

# name, seed, kind, height, base radius, fork count, lean
TREES = [
    ('swamp-giant-01', 11, 'giant', 20.0, 1.45, 3, 0.10),
    ('swamp-giant-02', 23, 'giant', 23.0, 1.6, 2, 0.18),
    ('swamp-giant-03', 37, 'giant', 17.0, 1.2, 3, 0.28),
    ('swamp-snag-01', 53, 'snag', 11.0, 0.85, 2, 0.15),
]

# Leaf atlas regions (u ranges): leaves, bare twig sprays, hanging moss.
LEAF_U = (0.0, 0.4)
TWIG_U = (0.4, 0.7)
MOSS_U = (0.7, 1.0)


# ---------------------------------------------------------------- textures

def bark_texture():
    """Wet, stringy swamp bark: long vertical fissures, grey-brown plates and
    green-black algae streaks running down the grain. Tiles in both axes."""
    rng = np.random.default_rng(7)
    w = h = 512
    streak = fbm(w, h, (24, 2), rng, 4)  # long vertical grain
    plates = fbm(w, h, (10, 4), rng, 3)
    fissure = np.clip((np.abs(streak - 0.5) * 2) ** 0.6, 0, 1)
    algae = np.clip((fbm(w, h, (6, 3), rng, 4) - 0.45) * 3.5, 0, 1)
    base = np.stack([0.20, 0.17, 0.13])[None, None, :] * (0.65 + 0.5 * plates[..., None])
    deep = np.array([0.035, 0.032, 0.026])
    col = deep + (base - deep) * fissure[..., None]
    moss = np.array([0.12, 0.16, 0.07]) * (0.7 + 0.5 * plates[..., None])
    col = col * (1 - 0.65 * algae[..., None]) + moss * 0.65 * algae[..., None]
    rgba = np.concatenate([np.clip(col, 0, 1), np.ones((h, w, 1))], axis=2)
    return save_image('swamp_bark', rgba, os.path.join(TEX, 'swamp-bark.png'))


def leaf_atlas():
    """1024x512 RGBA in three regions (LEAF_U, TWIG_U, MOSS_U): a cluster of small
    dark olive leaves, a spray of bare forking twigs, and hanging moss strands."""
    rng = np.random.default_rng(19)
    w, h = 1024, 512
    rgba = np.zeros((h, w, 4))

    def region(u):
        return int(u[0] * w), int(u[1] * w)

    # Leaves
    x0, x1 = region(LEAF_U)
    rw = x1 - x0
    ys, xs = np.mgrid[0:h, 0:rw].astype(np.float32)
    sub = rgba[:, x0:x1]
    for _ in range(60):
        cx, cy = rng.uniform(40, rw - 40), rng.uniform(40, h - 40)
        if ((cx - rw / 2) / (rw / 2)) ** 2 + ((cy - h / 2) / (h / 2)) ** 2 > 0.8:
            continue
        ang = rng.uniform(0, math.pi)
        a, b = rng.uniform(24, 40), rng.uniform(9, 15)
        dx, dy = xs - cx, ys - cy
        u = dx * math.cos(ang) + dy * math.sin(ang)
        v = -dx * math.sin(ang) + dy * math.cos(ang)
        inside = (u / a) ** 2 + (v / (b * np.clip(1 - np.abs(u / a) ** 1.6, 0, 1) + 1e-3)) ** 2 < 1
        tone = np.array([0.27, 0.34, 0.13]) * rng.uniform(0.6, 1.05)
        shade = 0.85 + 0.25 * np.clip(u / a, -1, 1)
        sub[inside, :3] = tone[None, :] * shade[inside][:, None]
        sub[inside, 3] = 1

    def stroke(target, p0, p1, width, tone):
        n = int(max(abs(p1[0] - p0[0]), abs(p1[1] - p0[1])) * 1.5) + 1
        for i in range(n + 1):
            t = i / n
            x, y = p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t
            half = width[0] + (width[1] - width[0]) * t
            for py in range(int(y - half - 1), int(y + half + 2)):
                for px in range(int(x - half - 1), int(x + half + 2)):
                    if 0 <= py < target.shape[0] and 0 <= px < target.shape[1]:
                        cover = min(1.0, max(0.0, half + 0.5 - math.hypot(px - x, py - y)))
                        if cover > target[py, px, 3]:
                            target[py, px, :3] = tone
                            target[py, px, 3] = cover

    # Twigs: a fan of forking dark sticks rising from the bottom centre.
    x0, x1 = region(TWIG_U)
    twigs = rgba[:, x0:x1]
    tw = x1 - x0

    def twig(p, ang, length, width, depth):
        end = (p[0] + math.cos(ang) * length, p[1] - math.sin(ang) * length)
        stroke(twigs, p, end, (width, width * 0.6), np.array([0.07, 0.06, 0.05]) * rng.uniform(0.8, 1.2))
        if depth < 4:
            for _ in range(2 if depth < 3 else 3):
                twig(end, ang + rng.uniform(-0.75, 0.75), length * rng.uniform(0.55, 0.75), max(0.6, width * 0.65), depth + 1)

    for _ in range(3):
        twig((tw / 2 + rng.uniform(-20, 20), h - 4), math.pi / 2 + rng.uniform(-0.45, 0.45), h * 0.32, 3.2, 0)

    # Moss: thin wavy strands tapering downward from the top edge.
    x0, x1 = region(MOSS_U)
    moss = rgba[:, x0:x1]
    mw = x1 - x0
    # Clumped, with clear gaps: at a distance the mip chain averages coverage, and
    # an even curtain of strands would cross the alpha cutoff as a solid sheet.
    clumps = [rng.uniform(14, mw / 2 - 14) for _ in range(3)] + [rng.uniform(mw / 2 + 14, mw - 14) for _ in range(3)]
    for k in range(48):
        xs0 = clumps[k % len(clumps)] + rng.normal(0, 4)
        length = rng.uniform(0.3, 0.95) * h
        phase, freq, amp = rng.uniform(0, 6.28), rng.uniform(0.01, 0.03), rng.uniform(2, 7)
        width = rng.uniform(1.2, 2.4)
        tone = np.array([0.42, 0.43, 0.33]) * rng.uniform(0.7, 1.1)
        for y in range(int(length)):
            t = y / length
            x = xs0 + amp * math.sin(phase + y * freq)
            half = width * (1 - 0.7 * t)
            for px in range(int(max(0, x - half - 1)), int(min(mw - 1, x + half + 1)) + 1):
                cover = min(1.0, max(0.0, half + 0.5 - abs(px - x)))
                if cover > moss[y, px, 3]:
                    moss[y, px, :3] = tone * (1 - t * 0.3)
                    moss[y, px, 3] = cover
    return save_image('swamp_leaves', rgba, os.path.join(TEX, 'swamp-leaves.png'))


# ---------------------------------------------------------------- skeleton

def build_skeleton(seed, kind, height, base_radius, forks, lean):
    rng = random.Random(seed)
    spec = {
        'taper': 0.62, 'max_depth': 4 if kind == 'giant' else 3, 'min_radius': 0.035,
        'phototropism': [0.35, 0.25, 0.12, 0.05, 0.02],
        'gnarl': [0.05, 0.12, 0.18, 0.22, 0.25], 'droop': 0.35,
        'children': [0, 4, 3, 3, 0] if kind == 'giant' else [0, 2, 3, 2, 0],
        'child_start': [0.5, 0.25, 0.2, 0.15, 0.1],
        'angle': [(20, 35), (35, 60), (35, 70), (30, 70), (25, 60)],
        'ratio': (0.45, 0.72),
    }
    branches = []
    bole_height = height * (0.48 if kind == 'giant' else 0.75)
    heading = rng.uniform(0, 6.28)
    lean_dir = Vector((math.cos(heading), math.sin(heading), 0))
    # The bole: an S-bent, slowly twisting trunk with denser rings near the ground flare.
    steps = 16
    points, radii = [], []
    bend_phase = rng.uniform(0, 6.28)
    ts = [-0.14 / max(bole_height, 1.0), 0.0, 0.03, 0.07, 0.13, 0.21] + [0.21 + 0.79 * i / (steps - 5) for i in range(1, steps - 4)]
    for t in ts:
        tc = max(0.0, t)
        z = t * bole_height
        offset = lean_dir * (lean * tc * bole_height) + Vector((math.sin(bend_phase + tc * 3.1), math.cos(bend_phase * 1.3 + tc * 2.4), 0)) * 0.45 * tc
        points.append(Vector((offset.x, offset.y, z)))
        radii.append(base_radius * (1 - 0.45 * tc))
    trunk = Branch(points, radii, 0, kind='trunk')
    branches.append(trunk)
    top = points[-1]
    top_dir = (points[-1] - points[-2]).normalized()
    if kind == 'snag':
        # Broken off: a jagged stub, a couple of dead limbs.
        for k in range(forks):
            ang = heading + k * math.pi + rng.uniform(-0.6, 0.6)
            d = (top_dir * 0.6 + Vector((math.cos(ang), math.sin(ang), 0)) * 0.8).normalized()
            idx = int(len(points) * rng.uniform(0.58, 0.90))
            grow(rng, points[idx], d, height * rng.uniform(0.3, 0.45), radii[idx] * 0.52, 1, spec, branches, parent=trunk)
    else:
        for k in range(forks):
            ang = heading + k * 6.28 / forks + rng.uniform(-0.4, 0.4)
            d = (top_dir * 1.0 + Vector((math.cos(ang), math.sin(ang), 0)) * rng.uniform(0.45, 0.8)).normalized()
            grow(rng, top, d, (height - bole_height) * rng.uniform(0.75, 0.95), radii[-1] * rng.uniform(0.65, 0.78), 1, spec, branches, parent=trunk)
        # Low side limbs and dead stubs along the bole.
        for k in range(rng.randint(2, 4)):
            t = rng.uniform(0.45, 0.88)
            i = max(2, min(len(points) - 2, int(t * len(points))))
            ang = rng.uniform(0, 6.28)
            d = Vector((math.cos(ang), math.sin(ang), rng.uniform(0.12, 0.48))).normalized()
            grow(rng, points[i], d, height * rng.uniform(0.18, 0.32), radii[i] * rng.uniform(0.26, 0.40), 1, spec, branches, parent=trunk)
    # Buttress roots: smooth arched cypress flanges emerging tangentially from the fluted bole.
    root_count = rng.randint(5, 7)
    spurs = []
    for k in range(root_count):
        ang = heading + k * 6.28318 / root_count + rng.uniform(-0.22, 0.22)
        spurs.append({
            'angle': ang,
            'up': base_radius * rng.uniform(1.55, 2.15),
            'out': base_radius * rng.uniform(1.35, 1.95),
            'crest_width': base_radius * rng.uniform(0.14, 0.19),
            'foot_width': base_radius * rng.uniform(0.38, 0.48),
            'curve': rng.uniform(-0.15, 0.15),
            'steps': 5,
        })
    weld_skeleton_junctions(branches, add_collars=True, snag=(kind == 'snag'))
    return branches, spurs


def fluted_radius(base_radius, z, theta, phase, spur_angles=()):
    """Wider at the foot (flare) and fluted into lobes aligned with the buttress roots."""
    zc = max(z, 0.0)
    flare = 1 + 0.58 * math.exp(-zc / (0.95 * base_radius + 0.35))
    lobe_sum = sum(math.exp(-((math.atan2(math.sin(theta - a), math.cos(theta - a)) / 0.44) ** 2)) for a in spur_angles)
    flute = 1 + 0.16 * math.exp(-zc / 3.8) * lobe_sum + 0.08 * math.exp(-zc / 4.2) * math.sin(5 * theta + phase)
    return flare * flute


# ---------------------------------------------------------------- mesh

def foliage(bm, uv_layer, branches, seed, kind):
    rng = random.Random(seed * 7 + 1)
    for b in branches:
        tip, prev = b.points[-1], b.points[-2]
        d = (tip - prev).normalized()
        # Twig sprays carry the fine lattice the mesh cannot afford: a crossed
        # pair at the end of every fine branch, continuing its direction.
        if b.depth >= (2 if kind == 'snag' else 3):
            size = rng.uniform(1.6, 2.6) * (0.6 if kind == 'snag' else 1)
            roll = rng.uniform(0, 3.14)
            for twist in (0.0, math.pi / 2):
                oriented_card(bm, uv_layer, tip - d * 0.15, d, size, size * 1.1, card_uv(TWIG_U), roll + twist)
        # Sparse leaf clusters on the giants only: the crown stays see-through.
        if kind == 'giant' and b.depth >= 3 and rng.random() < 0.3:
            size = rng.uniform(0.8, 1.3)
            n = jitter(rng, 1).normalized()
            u = perpendicular(n) * size
            v = n.cross(u).normalized() * size * 1.25
            c = tip + d * 0.6 + jitter(rng, 0.3)
            card(bm, uv_layer, [c - u - v, c + u - v, c + u + v, c - u + v], card_uv(LEAF_U))
        # Hanging moss from the middle of near-horizontal limbs.
        if 1 <= b.depth <= 3 and abs(d.z) < 0.65 and rng.random() < (0.75 if kind == 'giant' else 0.9):
            for _ in range(rng.randint(1, 3)):
                p = b.points[rng.randint(len(b.points) // 3, len(b.points) - 1)]
                length = rng.uniform(1.2, 3.4)
                width = rng.uniform(0.35, 0.7)
                yaw = rng.uniform(0, 3.14)
                span = (MOSS_U[1] - MOSS_U[0]) / 2
                u0 = MOSS_U[0] + rng.choice([0.0, span])
                for twist in (0.0, math.pi / 2):
                    side = Vector((math.cos(yaw + twist), math.sin(yaw + twist), 0)) * width / 2
                    uvs = [(u0, 1.0), (u0 + span, 1.0), (u0 + span, 1 - length / 3.6), (u0, 1 - length / 3.6)]
                    top = p + Vector((0, 0, 0.05))
                    card(bm, uv_layer, [top - side, top + side, top + side - Vector((0, 0, length)),
                                        top - side - Vector((0, 0, length))], uvs)


def build_tree(name, seed, kind, height, base_radius, forks, lean, bark_mat, leaf_mat):
    branches, spurs = build_skeleton(seed, kind, height, base_radius, forks, lean)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    phase = random.Random(seed).uniform(0, 6.28)
    spur_angles = [s['angle'] for s in spurs]
    trunk_scale = lambda z, theta: fluted_radius(base_radius, z, theta, phase, spur_angles)  # noqa: E731
    for b in branches:
        tube_mesh(bm, uv, b, trunk_scale if b.depth == 0 else None)
    add_root_spurs(bm, uv, branches[0], spurs, trunk_scale=trunk_scale, steps=5)
    trunk_mesh = bpy.data.meshes.new(f'{name}-bark')
    bm.to_mesh(trunk_mesh)
    bm.free()
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    foliage(bm, uv, branches, seed, kind)
    leaf_mesh = bpy.data.meshes.new(f'{name}-leaves')
    bm.to_mesh(leaf_mesh)
    bm.free()
    return assemble(name, trunk_mesh, leaf_mesh, bark_mat, leaf_mat, seed)


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(TEX, exist_ok=True)
    os.makedirs(PREVIEW, exist_ok=True)
    setup_scene()
    bark = material('Swamp bark', None, alpha=False, color=(0.045, 0.047, 0.034))
    leaves = material('Swamp leaves', leaf_atlas(), alpha=True)
    for spec in TREES:
        if ONLY and spec[0] != ONLY:
            continue
        root = build_tree(*spec, bark, leaves)
        export(root, os.path.join(OUT, f'{spec[0]}.glb'))
        if RENDER:
            render_preview(root, os.path.join(PREVIEW, f'{spec[0]}.png'))
        remove(root)


main()
