"""Build the fifteen Poly Haven understory scans into game GLBs (plan: understory-aaa-plan-2026-11-10 §5).

blender -b --factory-startup --python build_understory_scans.py -- --config tmp/understory/sources.json [--no-render] [--only <name>]
"""
import json
import os
import struct
import sys

import bpy

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
for extra in (THIS_DIR, os.path.join(THIS_DIR, '..', 'biome_understory')):
    if extra not in sys.path:
        sys.path.insert(0, extra)

from scan_common import (  # noqa: E402
    build_material, crop_ground, decimate, grade, import_scan, keep_largest_plant, material_sets, normalise,
    pack_atlas, shade, silhouette, tri_count, write_px,
)
from understory_common import place_and_export, render_preview, save_contact_sheet, setup_scene  # noqa: E402

ROOT = os.path.abspath(os.path.join(THIS_DIR, '..', '..', '..'))
CACHE = os.path.join(ROOT, 'assets', 'source-cache', 'polyhaven')
OUT = {'ground': os.path.join(ROOT, 'assets', 'runtime-sources', 'ground', 'scans'),
       'bush': os.path.join(ROOT, 'assets', 'runtime-sources', 'bushes')}
WORK = os.path.join(ROOT, 'tmp', 'understory', 'scans')
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = lambda flag: args[args.index(flag) + 1] if flag in args else None
COVERAGE_MIN, RETRIES = 0.9, 2


def reduce_with_coverage(obj, asset):
    """Decimate to the target; for cutouts raise the target 25 % (twice at most) while the silhouette shrinks."""
    bounds = normalise(obj, asset['targetHeight'])
    original = obj.data.copy()
    before = silhouette(obj, bounds) if asset['cutout'] else None
    target, coverage = asset['targetTriangles'], None
    for attempt in range(RETRIES + 1):
        obj.data = original.copy()
        tris = decimate(obj, target)
        if not asset['cutout']:
            break
        after = silhouette(obj, bounds)
        coverage = min(a / b for a, b in zip(after, before))
        if coverage >= COVERAGE_MIN:
            break
        target *= 1.25
    return tris, coverage, attempt


def patch_alpha_mask(path):
    """Newer Blender drops blend_method: write alphaMode MASK / cutoff 0.5 into the GLB's JSON chunk."""
    data = open(path, 'rb').read()
    length = struct.unpack('<I', data[12:16])[0]
    doc = json.loads(data[20:20 + length])
    mat = doc['materials'][0]
    if mat.get('alphaMode') == 'MASK':
        return
    mat['alphaMode'], mat['alphaCutoff'] = 'MASK', 0.5
    body = json.dumps(doc, separators=(',', ':')).encode()
    body += b' ' * (-len(body) % 4)
    rest = data[20 + length:]
    open(path, 'wb').write(data[:8] + struct.pack('<I', 20 + len(body) + len(rest)) + struct.pack('<I', len(body)) + data[16:20] + body + rest)


def inspect_glb(path):
    data = open(path, 'rb').read()
    doc = json.loads(data[20:20 + struct.unpack('<I', data[12:16])[0]])
    prims = [p for m in doc['meshes'] for p in m['primitives']]
    tris = sum(doc['accessors'][p['indices']]['count'] for p in prims) // 3
    return {'meshes': len(doc['meshes']), 'primitives': len(prims), 'materials': len(doc['materials']),
            'alphaMode': doc['materials'][0].get('alphaMode', 'OPAQUE'), 'triangles': tris}


def build(asset, preview):
    name, cutout = asset['name'], asset['cutout']
    src = os.path.join(CACHE, asset['id'])
    obj = import_scan(os.path.join(src, f"{asset['id']}_2k.gltf"))
    source_tris = tri_count(obj)
    sets, slot_set = material_sets(obj, src, asset['id'])
    # Both trims come before normalise, so `targetHeight` measures the plant or stump that is kept.
    plants = keep_largest_plant(obj.data) if asset.get('singlePlant') else 1
    if asset.get('groundCrop'):
        crop_ground(obj.data, asset['groundCrop'])
    tris, coverage, attempt = reduce_with_coverage(obj, asset)
    shade(obj, cutout)
    tex = pack_atlas(obj, sets, slot_set)
    rgba, luma, rough = grade(tex, cutout, 0.32 if asset['kind'] == 'wood' or 'moss' in name else 0.42)
    albedo = write_px(f'{name}-albedo', rgba, os.path.join(WORK, 'textures', f'{name}-albedo.png'), True)
    normal = write_px(f'{name}-normal', tex['nor_gl'], os.path.join(WORK, 'textures', f'{name}-normal.png'), False)
    mesh = obj.data
    mesh.name = name
    mesh.materials.clear()
    mesh.materials.append(build_material(name, albedo, normal, rough, cutout))
    for p in mesh.polygons:
        p.material_index = 0
    bpy.data.objects.remove(obj)
    out_path = os.path.join(OUT[asset['layer']], f'{name}.glb')
    root = place_and_export(name, mesh, out_path, tangents=True)
    if cutout:
        patch_alpha_mask(out_path)
    png = os.path.join(WORK, 'previews', f'{name}.png')
    if preview:
        h = asset['targetHeight']
        render_preview(root, png, max(0.6, h * 1.7), h * 0.45)
    glb = inspect_glb(out_path)
    for child in list(root.children):
        bpy.data.objects.remove(child)
    bpy.data.objects.remove(root)
    target = asset['targetTriangles']
    return {'name': name, 'id': asset['id'], 'path': os.path.relpath(out_path, ROOT).replace('\\', '/'),
            'sourceTriangles': source_tris, 'plantsInScan': plants, 'targetTriangles': target, 'finalTriangles': glb['triangles'],
            'retries': attempt, 'coverage': None if coverage is None else round(coverage, 3), 'luma': round(luma, 3),
            'roughness': round(rough, 3), 'glb': glb, 'bytes': os.path.getsize(out_path),
            'belowCoverage': cutout and coverage < COVERAGE_MIN,
            'withinTarget': glb['triangles'] <= target * (1.5625 if attempt else 1.05),
            'singleDraw': glb['meshes'] == 1 and glb['primitives'] == 1 and glb['materials'] == 1, 'preview': png}


def main():
    config = json.load(open(opt('--config')))
    if opt('--only'):
        config = [a for a in config if a['name'] == opt('--only')]
    preview = '--no-render' not in args
    for d in (*OUT.values(), os.path.join(WORK, 'textures'), os.path.join(WORK, 'previews')):
        os.makedirs(d, exist_ok=True)
    setup_scene()
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = 640
    report = []
    for asset in config:
        r = build(asset, preview)
        report.append(r)
        print(f"{r['name']}: source {r['sourceTriangles']} final {r['finalTriangles']} coverage {r['coverage']} "
              f"luma {r['luma']} roughness {r['roughness']}", flush=True)
    if not opt('--only'):
        json.dump(report, open(os.path.join(WORK, 'report.json'), 'w'), indent=2)
        if preview:
            save_contact_sheet([r['preview'] for r in report], os.path.join(WORK, 'contact-sheet.png'), cols=5)
        below = [r['name'] for r in report if r['belowCoverage']]
        bad = [r['name'] for r in report if not (r['singleDraw'] and r['withinTarget'])]
        print('below coverage:', below, '| gate failures:', bad)


if __name__ == '__main__':
    main()
