"""Boreal conifers: spruces, a fir, two pines and a dead snag.

Run headless:
  "F:\\Blender 5.2\\blender.exe" -b --factory-startup --python tools/blender/boreal_trees/build_boreal_trees.py -- [--no-render] [--only spruce-01]

Needs the scanned needle atlases (`npm run fetch:tree-sources`). Writes three
grouped GLBs to assets/runtime-sources/trees/boreal/ (trees that share a bark
profile and a leaf atlas share a file; each tree is its own root empty with one
bark mesh and one leaf mesh) and previews plus a contact sheet to
tmp/boreal/blender/. `--only` builds and previews one tree and exports nothing.
Everything is seeded, so a rerun is identical.

docs/plans/trees-aaa-plan-2026-11-10.md §5: a straight leader with whorls of
drooping (spruce, fir) or rising (pine) branches, each carrying crossed cards of
scanned needle sprays.
"""
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from tree_kit import add_root_spurs, assemble, material, remove, render_preview, setup_scene, tube_mesh, weld_skeleton_junctions  # noqa: E402
from tree_conifer import drop_to_limit, whorled_conifer  # noqa: E402
from tree_kit_scans import (contact_sheet, export_group, leaf_atlas_from_scan, region_card,  # noqa: E402
                            source_path, triangles)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'runtime-sources', 'trees', 'boreal')
PREVIEW = os.path.join(ROOT, 'tmp', 'boreal', 'blender')
TEX = os.path.join(ROOT, 'tmp', 'boreal', 'textures')

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = '--no-render' not in argv
ONLY = argv[argv.index('--only') + 1] if '--only' in argv else None

SPRAYS = ['F1', 'F2', 'F3', 'F4']
# Stations and tufts are denser than the plan's table: at its values the crowns
# were bare spokes (first build, 2026-11-11), with two thirds of the card budget unspent.
SPRUCE = {'per_whorl': 5, 'profile_power': 0.85, 'stations': 6, 'tuft': (3, 0.25), 'lean': 0.02, 'stubs': True,
          'regions': SPRAYS, 'top_regions': SPRAYS + ['F5', 'F5']}
FIR = {**SPRUCE, 'profile_power': 0.7, 'stations': 6, 'tuft': (3, 0.2), 'stubs': False}
PINE = {'per_whorl': 5, 'profile_power': 0.45, 'droop': -0.25, 'stations': 3, 'station_range': (0.5, 0.9), 'tuft': (5, 0.55),
        'card_width': 1.3, 'stubs': True, 'regions': ['P1', 'P2'], 'top_regions': ['P1', 'P2']}
SNAG = {'per_whorl': 1, 'profile_power': 0, 'droop': 0.2, 'stations': 0, 'card_width': 0.4, 'lean': 0.03,
        'stubs': True, 'tip_radius': 0.12, 'length_range': (0.6, 2.4), 'regions': ['FT'], 'top_regions': ['FT']}

# name: seed, trunk and card triangle limits, then the whorled_conifer spec.
TREES = {
    'spruce-01': (311, 1800, 5200, {**SPRUCE, 'height': 16, 'crown': 2.2, 'base_radius': 0.26,
                                    'clear_bole': 0.18, 'whorl_spacing': 0.7, 'droop': 0.5, 'card_width': 1.1}),
    'spruce-02': (331, 2000, 6000, {**SPRUCE, 'height': 21, 'crown': 2.7, 'base_radius': 0.34,
                                    'clear_bole': 0.22, 'whorl_spacing': 0.8, 'droop': 0.6, 'card_width': 1.25}),
    'fir-01': (347, 2000, 6400, {**FIR, 'height': 18, 'crown': 3.6, 'base_radius': 0.38,
                                 'clear_bole': 0.2, 'whorl_spacing': 0.85, 'droop': 0.3, 'card_width': 1.5}),
    'pine-01': (367, 2200, 4800, {**PINE, 'height': 15, 'crown': 3.8, 'base_radius': 0.32,
                                  'clear_bole': 0.5, 'whorl_spacing': 1.3, 'lean': 0.08}),
    'pine-02': (389, 2200, 5200, {**PINE, 'height': 19, 'crown': 3.0, 'base_radius': 0.36,
                                  'clear_bole': 0.58, 'whorl_spacing': 1.4, 'lean': 0.05}),
    'snag-01': (397, 1400, 300, {**SNAG, 'height': 13, 'crown': 1.6, 'base_radius': 0.3,
                                 'clear_bole': 0.33, 'whorl_spacing': 0.95}),
}

# GLB, its roots, bark colour (linear), leaf material, scan, kind, card keys, normalise for the canopy grade.
GROUPS = [
    ('boreal-spruce', ['spruce-01', 'spruce-02', 'fir-01'], (0.13, 0.10, 0.08), 'Boreal needles',
     'fir_tree_01', ['F1', 'F2', 'F3', 'F4', 'F5'], True),
    ('boreal-pine', ['pine-01', 'pine-02'], (0.20, 0.12, 0.07), 'Boreal needles',
     'pine_tree_01', ['P1', 'P2'], True),
    # Dead twigs keep the scan's grey-brown; the variant sets canopyGrade: false.
    ('boreal-snag', ['snag-01'], (0.17, 0.15, 0.13), 'Boreal dead twigs',
     'fir_tree_01', ['FT'], False),
]
REFERENCES = ['fir_tree_01', 'pine_tree_01']


def build_tree(name, regions, bark_mat, leaf_mat):
    seed, trunk_limit, card_limit, spec = TREES[name]
    rng = random.Random(seed)
    branches, cards = whorled_conifer(rng, spec)
    if spec['stations'] == 0:
        # A snag: one or two bare forked twigs at the end of each dead limb.
        for branch in (b for b in branches[1:] if len(b.points) > 2):
            direction = (branch.points[-1] - branch.points[-2]).normalized()
            for _ in range(rng.randint(1, 2)):
                cards.append({'base': branch.points[-1] - direction * 0.1, 'dir': direction, 'width': spec['card_width'],
                              'key': 'FT', 'roll': rng.uniform(0, 3.14), 'whorl': 0, 'branch': 0})
    cards = drop_to_limit(cards, card_limit)
    weld_skeleton_junctions(branches, add_collars=False, snag=(spec['stations'] == 0))
    base_radius = spec['base_radius']
    root_count = 4
    spur_angles = [rng.uniform(0, 1.57) + k * 6.28318 / root_count + rng.uniform(-0.22, 0.22) for k in range(root_count)]

    def conifer_bole(z, theta):
        zc = max(z, 0.0)
        flare = 1.0 + 0.36 * math.exp(-zc / (1.4 * base_radius + 0.22))
        lobe_sum = sum(math.exp(-((math.atan2(math.sin(theta - a), math.cos(theta - a)) / 0.48) ** 2)) for a in spur_angles)
        return flare * (1.0 + 0.12 * math.exp(-zc / 1.4) * lobe_sum)

    spurs = [{
        'angle': ang,
        'up': base_radius * rng.uniform(1.4, 2.0),
        'out': base_radius * rng.uniform(1.4, 1.9),
        'crest_width': base_radius * 0.25,
        'foot_width': base_radius * 0.46,
        'curve': rng.uniform(-0.12, 0.12),
        'steps': 3,
    } for ang in spur_angles]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    for branch in branches:
        tube_mesh(bm, uv, branch, conifer_bole if branch.depth == 0 else None)
    add_root_spurs(bm, uv, branches[0], spurs, trunk_scale=conifer_bole, steps=3)
    trunk_mesh = bpy.data.meshes.new(f'{name}-bark')
    bm.to_mesh(trunk_mesh)
    bm.free()
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    for card in cards:
        region_card(bm, uv, regions[card['key']], card['base'], card['dir'], card['width'], card['roll'])
    leaf_mesh = bpy.data.meshes.new(f'{name}-leaves')
    bm.to_mesh(leaf_mesh)
    bm.free()
    if triangles(trunk_mesh) > trunk_limit:
        raise SystemExit(f'{name}: {triangles(trunk_mesh)} trunk triangles, over the limit of {trunk_limit}.')
    root = assemble(name, trunk_mesh, leaf_mesh, bark_mat, leaf_mat, seed)
    lo = [min(v.co[i] for m in (trunk_mesh, leaf_mesh) for v in m.vertices) for i in range(3)]
    hi = [max(v.co[i] for m in (trunk_mesh, leaf_mesh) for v in m.vertices) for i in range(3)]
    if hi[2] - lo[2] < max(hi[0] - lo[0], hi[1] - lo[1]):
        raise SystemExit(f'{name} is wider than tall; the runtime would reject it as a tree.')
    return root


def main():
    for folder in (OUT, TEX, PREVIEW):
        os.makedirs(folder, exist_ok=True)
    setup_scene(sky=(0.42, 0.5, 0.56), ground=(0.06, 0.07, 0.05))
    previews = []
    for glb, names, bark_colour, leaf_name, scan, keys, normalise in GROUPS:
        names = [n for n in names if not ONLY or n == ONLY]
        if not names:
            continue
        atlas = leaf_atlas_from_scan(scan, 'twig', keys, os.path.join(TEX, f'{glb}-leaves.png'), normalise=normalise)
        bark = material('Boreal bark', None, alpha=False, color=bark_colour)
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
        # Groups reuse the material names the runtime looks up, so free them
        # before the next group or Blender would suffix the duplicates.
        bpy.data.materials.remove(bark)
        bpy.data.materials.remove(leaves)
    if RENDER and not ONLY:
        # The scans' own renders sit under the built trees for comparison.
        contact_sheet([previews, [source_path(i, 'preview') for i in REFERENCES]],
                      os.path.join(PREVIEW, 'contact-sheet.png'))


main()
