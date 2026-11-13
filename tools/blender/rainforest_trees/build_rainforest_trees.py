"""Rainforest emergents, a mid-storey tree and two palms.

Run headless:
  "F:\\Blender 5.2\\blender.exe" -b --factory-startup --python tools/blender/rainforest_trees/build_rainforest_trees.py -- [--no-render] [--only emergent-01]

Needs the scanned leaf atlases (`npm run fetch:tree-sources`). Writes
rainforest.glb and palms.glb to assets/runtime-sources/trees/rainforest/ (each
tree its own root empty with one bark mesh and one leaf mesh) and previews plus
a contact sheet to tmp/rainforest/blender/. `--only` builds and previews one
tree and exports nothing. Everything is seeded, so a rerun is identical.

docs/plans/trees-aaa-plan-2026-11-10.md §5.6: a straight fluted bole on plank
buttresses under a domed crown of baked broadleaf sprays, with lianas in the
bark mesh and epiphytes in the leaf mesh (triangles, no extra draws); a slender
tree of jacaranda fronds; palms with baked fronds. A liana hangs free here: the
plan's loose turn round the bole is not modelled.
"""
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from tree_kit import (Branch, add_root_spurs, assemble, card, grow, material,  # noqa: E402
                      remove, render_preview, setup_scene, tube_mesh, weld_skeleton_junctions)
from tree_kit_scans import (contact_sheet, export_group, join_atlases, leaf_atlas_from_scan,  # noqa: E402
                            region_card, source_path, triangles)
from tree_sprays import bake_sprays, broadleaf_spray, palm_frond, upright  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'runtime-sources', 'trees', 'rainforest')
PREVIEW = os.path.join(ROOT, 'tmp', 'rainforest', 'blender')
TEX = os.path.join(ROOT, 'tmp', 'rainforest', 'textures')

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = '--no-render' not in argv
ONLY = argv[argv.index('--only') + 1] if '--only' in argv else None

# name: kind, seed, height, crown radius, base radius, trunk and card triangle limits, extras.
TREES = {
    'emergent-01': ('emergent', 401, 26, 6.5, 0.75, 3600, 7600, {'buttresses': 5, 'up': 2.2, 'out': 2.4, 'lianas': 4}),
    'emergent-02': ('emergent', 421, 22, 5.5, 0.6, 3200, 6800, {'buttresses': 4, 'up': 1.8, 'out': 1.9, 'lianas': 3}),
    'midstorey-01': ('midstorey', 443, 12, 3.4, 0.24, 1600, 4000, {}),
    'palm-01': ('palm', 457, 12, 3.4, 0.24, 500, 400, {'lean': 0.12, 'fronds': 16, 'frond': 3.4, 'rings': 10}),
    'palm-02': ('palm', 461, 9, 3.0, 0.22, 420, 360, {'lean': 0.2, 'fronds': 14, 'frond': 3.0, 'rings': 9}),
}
GROUPS = [
    ('rainforest', ['emergent-01', 'emergent-02', 'midstorey-01'], 'Rainforest bark', (0.24, 0.22, 0.19), 'Rainforest leaves'),
    ('palms', ['palm-01', 'palm-02'], 'Palm bark', (0.30, 0.28, 0.25), 'Palm fronds'),
]
REFERENCES = ['island_tree_02', 'jacaranda_tree']

CROWN = {
    'taper': 0.6, 'max_depth': 3, 'min_radius': 0.03, 'droop': 0.15, 'ratio': (0.5, 0.72),
    'phototropism': [0.1, 0.1, 0.06, 0.03, 0.0], 'gnarl': [0.03, 0.08, 0.12, 0.15, 0.15],
    'children': [0, 4, 5, 0, 0], 'child_start': [0.5, 0.35, 0.3, 0.2, 0.1],
    'angle': [(20, 35), (35, 60), (35, 65), (30, 60), (25, 60)],
}


# ---------------------------------------------------------------- atlases

def rainforest_atlas():
    """One 2048x1024 sheet: baked broadleaf sprays B1-B4 on the left, the
    jacaranda fronds J1-J2 on the right."""
    keys = [f'L{i}' for i in range(1, 9)]
    single = leaf_atlas_from_scan('island_tree_02', 'leaves', keys, os.path.join(TEX, 'island-leaves.png'))
    leaves = [upright(single, key) for key in keys]
    rng = random.Random(4011)
    sprays = bake_sprays([
        ('B1', lambda canvas, cell: broadleaf_spray(canvas, cell, rng, leaves, 13)),
        ('B2', lambda canvas, cell: broadleaf_spray(canvas, cell, rng, leaves, 11, bend=math.radians(12))),
        ('B3', lambda canvas, cell: broadleaf_spray(canvas, cell, rng, leaves, 9, toward_tip=0.6)),
        ('B4', lambda canvas, cell: broadleaf_spray(canvas, cell, rng, leaves, 7, fan=True)),
    ], (1024, 1024), os.path.join(TEX, 'broadleaf-sprays.png'))
    fronds = leaf_atlas_from_scan('jacaranda_tree', 'leaves', ['J1', 'J2'], os.path.join(TEX, 'jacaranda-fronds.png'))
    atlas = join_atlases(sprays, fronds, os.path.join(TEX, 'rainforest-leaves.png'))
    for stale in (single, sprays, fronds):
        bpy.data.images.remove(stale['image'])
    return atlas


def palm_atlas():
    rng = random.Random(4571)
    return bake_sprays([
        ('PF1', lambda canvas, cell: palm_frond(canvas, cell, rng, 34)),
        ('PF2', lambda canvas, cell: palm_frond(canvas, cell, rng, 28)),
    ], (1024, 512), os.path.join(TEX, 'palm-fronds.png'))


# ---------------------------------------------------------------- skeleton

def tube_sides(radius, depth=0):
    return 14 if radius > 0.5 else 8 if (radius > 0.2 or (depth == 1 and radius > 0.12)) else 5 if radius > 0.08 else 3


def tube_triangles(branch):
    r0 = getattr(branch, 'nominal_radius', branch.radii[0])
    sides = getattr(branch, 'forced_sides', None) or tube_sides(r0, branch.depth)
    return sides * (len(branch.points) - 1) * 2 + sides


def thinned(branch, step):
    if step <= 1 or len(branch.points) <= 3:
        return branch
    keep = sorted(set(range(0, len(branch.points), step)) | {len(branch.points) - 1})
    return Branch([branch.points[i].copy() for i in keep], [branch.radii[i] for i in keep],
                  branch.depth, kind=branch.kind, parent=branch.parent)


def fit_trunk(trunk, branches, limit):
    """Thin the fine branches' rings and weld junctions until the bark fits its triangle limit."""
    for step in (1, 2, 3, 4, 6):
        for add_collars in (True, False):
            # Clone branch points/radii so each candidate pass starts clean
            cloned = [Branch([p.copy() for p in trunk.points], list(trunk.radii), 0, kind='trunk')]
            id_map = {id(trunk): cloned[0]}
            for b in branches:
                cb = thinned(b, step) if b.depth >= 2 else Branch([p.copy() for p in b.points], list(b.radii), b.depth, kind=b.kind, parent=b.parent)
                id_map[id(b)] = cb
                cloned.append(cb)
            for cb in cloned[1:]:
                if cb.parent is not None and id(cb.parent) in id_map:
                    cb.parent = id_map[id(cb.parent)]
            weld_skeleton_junctions(cloned, add_collars=add_collars)
            if sum(tube_triangles(b) for b in cloned) <= limit:
                return cloned[0], cloned[1:]
    return cloned[0], cloned[1:]


def fit_crown(crown, origin, radius, top):
    """Scale the crown about the top of the bole to the tree's radius and height."""
    reach = max(Vector((p.x - origin.x, p.y - origin.y)).length for b in crown for p in b.points)
    rise = max(p.z - origin.z for b in crown for p in b.points)
    sx, sz = radius / max(reach, 1e-3), (top - origin.z) / max(rise, 1e-3)
    for b in crown:
        b.points = [Vector((origin.x + (p.x - origin.x) * sx, origin.y + (p.y - origin.y) * sx,
                            origin.z + (p.z - origin.z) * sz)) for p in b.points]


def bole(rng, height, base_radius, lean, top_share, steps=12):
    heading, phase = rng.uniform(0, 6.28), rng.uniform(0, 6.28)
    lean_dir = Vector((math.cos(heading), math.sin(heading), 0))
    points, radii = [], []
    # Cluster lower stations near the ground (starting slightly below grade) so the root flare curves smoothly
    ts = [-0.14 / max(height, 1.0), 0.0, 0.035, 0.08, 0.15] + [0.15 + 0.85 * i / (steps - 4) for i in range(1, steps - 3)]
    for t in ts:
        tc = max(0.0, t)
        wobble = Vector((math.sin(phase + tc * 2.6), math.cos(phase * 1.3 + tc * 2.1), 0)) * 0.12 * tc
        points.append(lean_dir * lean * height * tc + wobble + Vector((0, 0, height * t)))
        radii.append(base_radius * (1 - (1 - top_share) * tc))
    return Branch(points, radii, 0, kind='trunk'), heading


def limbs(rng, trunk, heading, count, elevation, length, radius_share):
    """Primary limbs from the top of the bole, forking per CROWN."""
    crown, top = [], trunk.points[-1]
    for k in range(count):
        angle = heading + k * 6.28318 / count + rng.uniform(-0.35, 0.35)
        e = math.radians(rng.uniform(*elevation))
        d = Vector((math.cos(angle) * math.cos(e), math.sin(angle) * math.cos(e), math.sin(e)))
        grow(rng, top, d, length * rng.uniform(0.85, 1.1), trunk.radii[-1] * radius_share, 1, CROWN, crown, parent=trunk)
    return crown


def liana(rng, limb, bole_axis):
    """A thin stem hanging from a limb to the ground a few metres from the bole."""
    start = limb.points[rng.randint(len(limb.points) // 3, len(limb.points) - 1)]
    angle = rng.uniform(0, 6.28)
    end = Vector((bole_axis.x, bole_axis.y, -0.1)) + Vector((math.cos(angle), math.sin(angle), 0)) * rng.uniform(1.5, 4)
    sag = (end - start).length * 0.12
    sideways = Vector((-math.sin(angle), math.cos(angle), 0)) * sag * rng.uniform(-0.6, 0.6)
    radius = rng.uniform(0.03, 0.05)
    points = [start.lerp(end, i / 12) + (Vector((0, 0, -sag)) + sideways) * 4 * (i / 12) * (1 - i / 12) for i in range(13)]
    return Branch(points, [radius] * 13, 1, kind='vine')


# ---------------------------------------------------------------- trees

def horizontal(direction, rng):
    flat = Vector((direction.x, direction.y, 0))
    if flat.length < 0.05:
        angle = rng.uniform(0, 6.28)
        flat = Vector((math.cos(angle), math.sin(angle), 0))
    return flat.normalized()


def tip_cards(rng, crown, keys, per_tip, fan, tilt, length, along=(1.0,)):
    """Cards at every fine branch tip (and at the `along` fractions of the branch:
    tips alone left the first build's crowns see-through), fanned about the
    vertical and tilted below the branch so the crown reads from underneath."""
    cards = []
    for b, f in ((b, f) for b in crown if b.depth >= 2 for f in along):
        index = max(1, round(f * (len(b.points) - 1)))
        tip = b.points[index]
        d = (tip - b.points[index - 1]).normalized()
        flat, elevation = horizontal(d, rng), math.asin(max(-1, min(1, d.z)))
        for k in range(per_tip):
            yaw = math.radians(fan) * (k - (per_tip - 1) / 2) + rng.uniform(-0.15, 0.15)
            h = flat.copy()
            h.rotate(Matrix.Rotation(yaw, 3, 'Z'))
            e = elevation - math.radians(rng.uniform(*tilt))
            direction = h * math.cos(e) + Vector((0, 0, math.sin(e)))
            cards.append({'base': tip - direction * 0.2, 'dir': direction, 'length': rng.uniform(*length),
                          'key': rng.choice(keys), 'inner': Vector((tip.x, tip.y)).length})
    return cards


def emit(bm, uv_layer, regions, cards):
    for c in cards:
        region = regions[c['key']]
        region_card(bm, uv_layer, region, c['base'], c['dir'], c['length'] / region['aspect'], 0.0, c['length'])


def build_emergent(rng, height, crown_radius, base_radius, trunk_limit, card_limit, extra, regions, bark_bm, leaf_bm, uvs):
    trunk, heading = bole(rng, height * 0.55, base_radius, 0.02, 0.62)
    crown = limbs(rng, trunk, heading, extra['buttresses'], (35, 50), crown_radius * 0.6, 0.54)
    # Sprays reach about 1.6 m past the twigs, so the skeleton stops short of the crown radius.
    fit_crown(crown, trunk.points[-1], crown_radius - 1.6, height - 1.0)
    primaries = [b for b in crown if b.depth == 1]
    vines = [liana(rng, rng.choice(primaries), trunk.points[0]) for _ in range(extra['lianas'])]
    phase, lobes = rng.uniform(0, 6.28), extra['buttresses']
    spur_steps = 4
    spur_tris = lobes * (spur_steps * 6 * 2 + 6) + 40
    vine_tris = sum(tube_triangles(v) for v in vines)

    spur_angles = [heading + k * 6.28318 / lobes + rng.uniform(-0.16, 0.16) for k in range(lobes)]

    def fluted(z, theta):
        flare = 1 + 0.45 * math.exp(-max(z, 0) / (1.05 * base_radius + 0.35))
        lobe_sum = sum(math.exp(-((math.atan2(math.sin(theta - a), math.cos(theta - a)) / 0.42) ** 2)) for a in spur_angles)
        flute = 1 + 0.18 * math.exp(-max(z, 0) / 4.2) * lobe_sum + 0.05 * math.exp(-max(z, 0) / 5.0) * math.sin(lobes * theta + phase)
        return flare * flute

    fitted_trunk, fitted_crown = fit_trunk(trunk, crown, trunk_limit - vine_tris - spur_tris)
    tube_mesh(bark_bm, uvs[0], fitted_trunk, fluted)
    for b in fitted_crown + vines:
        tube_mesh(bark_bm, uvs[0], b)
    spurs = [{
        'angle': ang,
        'up': extra['up'] * rng.uniform(1.15, 1.38),
        'out': extra['out'] * rng.uniform(0.92, 1.08),
        'crest_width': base_radius * rng.uniform(0.11, 0.15),
        'foot_width': base_radius * rng.uniform(0.38, 0.48),
        'curve': rng.uniform(-0.14, 0.14),
        'steps': spur_steps,
    } for ang in spur_angles]
    add_root_spurs(bark_bm, uvs[0], fitted_trunk, spurs, trunk_scale=fluted, steps=spur_steps)
    cards = tip_cards(rng, fitted_crown, ['B1', 'B2', 'B3', 'B4'], 3, 60, (20, 40), (2.2, 3.0), along=(0.45, 0.75, 1.0))
    epiphytes = []
    fitted_primaries = [b for b in fitted_crown if b.depth == 1]
    for _ in range(6):
        # A rosette seated on the upper side of a primary limb.
        limb = rng.choice(fitted_primaries)
        index = rng.randint(1, len(limb.points) - 1)
        seat, turn = limb.points[index] + Vector((0, 0, limb.radii[index])), rng.uniform(0, 6.28)
        for k in range(5):
            a = turn + k * 6.28318 / 5
            epiphytes.append({'base': seat, 'dir': Vector((math.cos(a), math.sin(a), 0.55)).normalized(),
                              'length': rng.uniform(0.7, 1.0), 'key': 'B4', 'inner': 0})
    # Over the limit: epiphytes go first, then the tips nearest the crown's middle.
    cards = epiphytes + sorted(cards, key=lambda c: c['inner'])
    emit(leaf_bm, uvs[1], regions, cards[max(0, len(cards) - card_limit // 2):])


def build_midstorey(rng, height, crown_radius, base_radius, trunk_limit, card_limit, extra, regions, bark_bm, leaf_bm, uvs):
    trunk, heading = bole(rng, height * 0.4, base_radius, 0.1, 0.7, steps=8)
    crown = limbs(rng, trunk, heading, 3, (40, 60), crown_radius * 0.7, 0.65)
    fit_crown(crown, trunk.points[-1], crown_radius - 1.2, height - 0.6)
    root_lobes = 4
    spur_steps = 3
    spur_tris = root_lobes * (spur_steps * 6 * 2 + 6)
    spur_angles = [heading + k * 6.28318 / root_lobes + rng.uniform(-0.2, 0.2) for k in range(root_lobes)]

    def mid_fluted(z, theta):
        flare = 1 + 0.35 * math.exp(-max(z, 0) / (1.4 * base_radius + 0.25))
        lobe_sum = sum(math.exp(-((math.atan2(math.sin(theta - a), math.cos(theta - a)) / 0.5) ** 2)) for a in spur_angles)
        return flare * (1 + 0.12 * math.exp(-max(z, 0) / 1.4) * lobe_sum)

    fitted_trunk, fitted_crown = fit_trunk(trunk, crown, trunk_limit - spur_tris)
    tube_mesh(bark_bm, uvs[0], fitted_trunk, mid_fluted)
    for b in fitted_crown:
        tube_mesh(bark_bm, uvs[0], b)
    spurs = [{
        'angle': ang,
        'up': base_radius * rng.uniform(1.8, 2.5),
        'out': base_radius * rng.uniform(1.6, 2.2),
        'crest_width': base_radius * 0.24,
        'foot_width': base_radius * 0.46,
        'curve': rng.uniform(-0.12, 0.12),
        'steps': spur_steps,
    } for ang in spur_angles]
    add_root_spurs(bark_bm, uvs[0], fitted_trunk, spurs, trunk_scale=mid_fluted, steps=spur_steps)
    cards = sorted(tip_cards(rng, fitted_crown, ['J1', 'J2'], 2, 70, (15, 35), (1.6, 2.2), along=(0.5, 1.0)), key=lambda c: c['inner'])
    emit(leaf_bm, uvs[1], regions, cards[max(0, len(cards) - card_limit // 2):])


def frond(bm, uv_layer, region, start, azimuth, rise, fall, length, width):
    """A strip of six quads along an arc that leaves the crown at `rise` and
    turns over to `fall` below level at its tip."""
    out = Vector((math.cos(azimuth), math.sin(azimuth), 0))
    side = Vector((-math.sin(azimuth), math.cos(azimuth), 0)) * width / 2
    (bl, br, tr, tl), spine, pos = region['uvs'], [start.copy()], start.copy()
    for i in range(6):
        e = rise - (rise + fall) * (i + 0.5) / 6
        pos = pos + (out * math.cos(e) + Vector((0, 0, math.sin(e)))) * length / 6
        spine.append(pos.copy())
    lerp = lambda a, b, t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)  # noqa: E731
    for i in range(6):
        t0, t1 = i / 6, (i + 1) / 6
        card(bm, uv_layer, [spine[i] - side, spine[i] + side, spine[i + 1] + side, spine[i + 1] - side],
             [lerp(bl, tl, t0), lerp(br, tr, t0), lerp(br, tr, t1), lerp(bl, tl, t1)])


def build_palm(rng, height, crown_radius, base_radius, trunk_limit, card_limit, extra, regions, bark_bm, leaf_bm, uvs):
    heading, bow = rng.uniform(0, 6.28), rng.uniform(0, 6.28)
    lean_dir = Vector((math.cos(heading), math.sin(heading), 0))
    bow_dir = Vector((math.cos(bow), math.sin(bow), 0))
    stem = height - 1.2  # the fronds arch above the top of the trunk
    # Cluster stations near the base so the palm's bulbous fibrous root boss curves smoothly
    last = extra['rings'] - 1
    ts = [-0.008, 0.0, 0.025, 0.06, 0.11] + [0.11 + 0.89 * i / (last - 2) for i in range(1, last - 1)]
    points = [lean_dir * extra['lean'] * stem * (max(0.0, t) ** 1.6) + bow_dir * 0.25 * math.sin(math.pi * max(0.0, t))
              + Vector((0, 0, stem * t)) for t in ts]
    radii = [base_radius * (1 - 0.3 * max(0.0, t)) for t in ts]
    trunk = Branch(points, radii, 0, kind='trunk')

    def palm_bole(z, theta):
        zc = max(z, 0.0)
        bulb = 1.0 + 0.44 * math.exp(-((zc / 0.52) ** 1.4))
        flute = 1.0 + 0.06 * math.exp(-zc / 0.9) * math.cos(7 * theta + heading)
        return bulb * flute

    tube_mesh(bark_bm, uvs[0], trunk, palm_bole)
    top = points[-1]
    for k in range(extra['fronds']):
        young = k < 5
        frond(leaf_bm, uvs[1], regions[rng.choice(['PF1', 'PF2'])], top, k * 2.39996 + rng.uniform(-0.15, 0.15),
              math.radians(rng.uniform(50, 75) if young else rng.uniform(10, 40)),
              rng.uniform(0.3, 0.7) if young else rng.uniform(0.6, 1.2),
              extra['frond'] * rng.uniform(0.9, 1.05), FROND_STRIP)
    for k in range(3):
        # Dead fronds hang against the trunk; build_tree darkens these last faces.
        frond(leaf_bm, uvs[1], regions['PF2'], top - Vector((0, 0, 0.3)), rng.uniform(0, 6.28),
              math.radians(-35), 1.45, extra['frond'] * 0.75, FROND_STRIP * 0.8)
    return 3 * 6


# The baked frond fills about 40 % of its cell's width, so a 2.2 m strip shows
# the 0.9 m frond the plan asks for.
FROND_STRIP = 2.2

BUILDERS = {'emergent': build_emergent, 'midstorey': build_midstorey, 'palm': build_palm}


def build_tree(name, regions, bark_mat, leaf_mat):
    kind, seed, height, crown_radius, base_radius, trunk_limit, card_limit, extra = TREES[name]
    bark_bm, leaf_bm = bmesh.new(), bmesh.new()
    uvs = (bark_bm.loops.layers.uv.new('UVMap'), leaf_bm.loops.layers.uv.new('UVMap'))
    dead_faces = BUILDERS[kind](random.Random(seed), height, crown_radius, base_radius, trunk_limit, card_limit,
                                extra, regions, bark_bm, leaf_bm, uvs) or 0
    trunk_mesh, leaf_mesh = bpy.data.meshes.new(f'{name}-bark'), bpy.data.meshes.new(f'{name}-leaves')
    bark_bm.to_mesh(trunk_mesh)
    leaf_bm.to_mesh(leaf_mesh)
    bark_bm.free()
    leaf_bm.free()
    for label, mesh, limit in (('trunk', trunk_mesh, trunk_limit), ('card', leaf_mesh, card_limit)):
        if triangles(mesh) > limit:
            raise SystemExit(f'{name}: {triangles(mesh)} {label} triangles, over the limit of {limit}.')
    root = assemble(name, trunk_mesh, leaf_mesh, bark_mat, leaf_mat, seed)
    if dead_faces:
        colours = leaf_mesh.color_attributes['Col'].data
        for poly in list(leaf_mesh.polygons)[-dead_faces:]:
            for loop in poly.loop_indices:
                r, g, b, a = colours[loop].color
                colours[loop].color = (r * 0.45, g * 0.42, b * 0.3, a)
    lo = [min(v.co[i] for m in (trunk_mesh, leaf_mesh) for v in m.vertices) for i in range(3)]
    hi = [max(v.co[i] for m in (trunk_mesh, leaf_mesh) for v in m.vertices) for i in range(3)]
    print(f'{name}: {hi[0] - lo[0]:.1f} x {hi[1] - lo[1]:.1f} wide, {hi[2] - lo[2]:.1f} tall')
    if hi[2] - lo[2] < max(hi[0] - lo[0], hi[1] - lo[1]):
        raise SystemExit(f'{name} is wider than tall; the runtime would reject it as a tree.')
    return root


def main():
    for folder in (OUT, TEX, PREVIEW):
        os.makedirs(folder, exist_ok=True)
    setup_scene(sky=(0.5, 0.6, 0.62), ground=(0.07, 0.09, 0.05))
    previews = []
    for glb, names, bark_name, bark_colour, leaf_name in GROUPS:
        names = [n for n in names if not ONLY or n == ONLY]
        if not names:
            continue
        atlas = rainforest_atlas() if glb == 'rainforest' else palm_atlas()
        bark = material(bark_name, None, alpha=False, color=bark_colour)
        leaves = material(leaf_name, atlas['image'], alpha=True)
        roots = [build_tree(name, atlas['regions'], bark, leaves) for name in names]
        if not ONLY:
            export_group(roots, os.path.join(OUT, f'{glb}.glb'))
        for name, root in zip(names, roots):
            if RENDER:
                previews.append(os.path.join(PREVIEW, f'{name}.png'))
                render_preview(root, previews[-1])
        for root in roots:
            remove(root)
    if RENDER and not ONLY:
        # The scans' own renders sit under the built trees for comparison.
        contact_sheet([previews, [source_path(i, 'preview') for i in REFERENCES]],
                      os.path.join(PREVIEW, 'contact-sheet.png'))


main()
