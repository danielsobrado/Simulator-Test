"""Scanned leaf atlases for the Blender-built trees (boreal_trees, rainforest_trees).

Turns the Poly Haven branch atlases fetched by `npm run fetch:tree-sources` into
card atlases: the measured rectangles of tree_regions.py are self-checked, the
scan's relief is baked into brightness (the runtime samples no leaf normal map)
and the result is normalised for the canopy grade. Also the grouped GLB export
and the contact sheet both builders share.
"""
import os

import bpy
import numpy as np

from tree_kit import oriented_card, save_image
from tree_regions import REGIONS

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, 'assets', 'source-cache', 'polyhaven')
LIGHT = np.array([-0.4, 0.5, 0.77]) / np.linalg.norm([-0.4, 0.5, 0.77])
LUMA = np.array([0.2126, 0.7152, 0.0722])
TARGET_LUMA = 0.36


def source_path(asset_id, suffix):
    folder = os.path.join(CACHE, asset_id)
    names = sorted(os.listdir(folder)) if os.path.isdir(folder) else []
    match = next((n for n in names if n.startswith(f'{asset_id}_{suffix}')), None)
    if match is None:
        raise SystemExit(f'Missing {asset_id} {suffix} in the source cache; run `npm run fetch:tree-sources`.')
    return os.path.join(folder, match)


def read_pixels(path, width, height, colour=True):
    """An image as (h, w, 4) floats, top row first, in its stored encoding."""
    image = bpy.data.images.load(path)
    image.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    image.scale(width, height)
    flat = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(flat)
    bpy.data.images.remove(image)
    return np.flipud(flat.reshape(height, width, 4)).astype(np.float64)


def sharpen_alpha(alpha):
    return np.clip((alpha - 0.5) * 4 + 0.5, 0, 1)


def check_rectangle(opaque, key, rect):
    """Fails the build when a measured rectangle no longer frames one spray."""
    x0, y0, x1, y1 = rect
    cover = opaque[y0:y1, x0:x1].mean()
    if not 0.05 <= cover <= 0.75:
        raise SystemExit(f'Card region {key}: {cover:.0%} opaque, outside 5-75 %. The sheet has changed upstream.')
    # The rectangles are tight, so foliage grazes every edge; an edge that is
    # mostly opaque means the box now sits in a neighbour or in the bark blobs.
    edges = (opaque[y0:y0 + 2, x0:x1], opaque[y1 - 2:y1, x0:x1], opaque[y0:y1, x0:x0 + 2], opaque[y0:y1, x1 - 2:x1])
    if sum(edge.mean() > 0.35 for edge in edges) > 1:
        raise SystemExit(f'Card region {key}: more than one edge is over 35 % opaque. The sheet has changed upstream.')


def make_region(opaque, rect, width, height):
    """UVs in card order (base left, base right, tip right, tip left). The base is
    the end of the long axis with fewer opaque pixels: a stem is thinner than foliage."""
    x0, y0, x1, y1 = rect
    w, h = x1 - x0, y1 - y0
    sub = opaque[y0:y1, x0:x1]
    if h >= w:
        n = max(1, h // 10)
        base_low = sub[-n:].sum() <= sub[:n].sum()
        px = [(x0, y1), (x1, y1), (x1, y0), (x0, y0)] if base_low else [(x1, y0), (x0, y0), (x0, y1), (x1, y1)]
    else:
        n = max(1, w // 10)
        base_left = sub[:, :n].sum() <= sub[:, -n:].sum()
        px = [(x0, y0), (x0, y1), (x1, y1), (x1, y0)] if base_left else [(x1, y1), (x1, y0), (x0, y0), (x0, y1)]
    return region_from_pixels(px, rect, width, height)


def region_from_pixels(px, rect, width, height):
    uvs = [(x / width, 1 - y / height) for x, y in px]
    mid = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)  # noqa: E731
    w, h = rect[2] - rect[0], rect[3] - rect[1]
    return {'uvs': uvs, 'rect': list(rect), 'aspect': max(w, h) / max(1, min(w, h)),
            'base_uv': mid(uvs[0], uvs[1]), 'tip_uv': mid(uvs[2], uvs[3])}


def leaf_atlas_from_scan(asset_id, kind, keys, out_path, size=1024, normalise=True):
    """RGBA card atlas from a scan's `<kind>_diff/alpha/arm/nor_gl` maps.
    Returns {'image', 'pixels', 'regions'}; `normalise=False` keeps the scan's own
    brightness (dead twigs stay grey-brown)."""
    diff = read_pixels(source_path(asset_id, f'{kind}_diff'), size, size)
    alpha = read_pixels(source_path(asset_id, f'{kind}_alpha'), size, size, False)[..., 0]
    arm = read_pixels(source_path(asset_id, f'{kind}_arm'), size, size, False)
    normal = read_pixels(source_path(asset_id, f'{kind}_nor_gl'), size, size, False)[..., :3] * 2 - 1
    opaque = alpha > 0.5
    regions, used = {}, np.zeros_like(opaque)
    for key in keys:
        rect = [int(round(v * size / 512)) for v in REGIONS[asset_id][key]]
        check_rectangle(opaque, key, rect)
        regions[key] = make_region(opaque, rect, size, size)
        used[rect[1]:rect[3], rect[0]:rect[2]] = True
    # Relief baked into brightness: occlusion times one fixed light on the scan's normals.
    normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-6)
    lit = np.maximum(normal @ LIGHT, 0)
    shade = np.clip(arm[..., 0] ** 0.6 * (0.65 + 0.35 * lit / 0.8), 0.55, 1.15)
    rgb = np.clip(diff[..., :3] * shade[..., None], 0, 1)
    if normalise:
        # One gamma, so the canopy grade sees a mid-bright crown rather than a
        # dark one it leaves ungraded (the reason the forest pack needed leafGain).
        sample = rgb[used & opaque]
        low, high = 0.2, 5.0
        for _ in range(40):
            gamma = (low + high) / 2
            low, high = (gamma, high) if (sample ** gamma @ LUMA).mean() > TARGET_LUMA else (low, gamma)
        rgb = rgb ** ((low + high) / 2)
    pixels = np.dstack([rgb, sharpen_alpha(alpha)])
    name = os.path.splitext(os.path.basename(out_path))[0]
    return {'image': save_image(name, pixels, out_path), 'pixels': pixels, 'regions': regions}


def join_atlases(left, right, out_path):
    """Two equal-height atlases side by side as one image; regions keep their keys."""
    wl, wr = left['pixels'].shape[1], right['pixels'].shape[1]
    total = wl + wr
    pixels = np.concatenate([left['pixels'], right['pixels']], axis=1)
    regions = {}
    for atlas, offset, width in ((left, 0, wl), (right, wl, wr)):
        for key, region in atlas['regions'].items():
            move = lambda uv: ((offset + uv[0] * width) / total, uv[1])  # noqa: E731
            regions[key] = {**region, 'uvs': [move(uv) for uv in region['uvs']],
                            'base_uv': move(region['base_uv']), 'tip_uv': move(region['tip_uv'])}
    name = os.path.splitext(os.path.basename(out_path))[0]
    return {'image': save_image(name, pixels, out_path), 'pixels': pixels, 'regions': regions}


def region_card(bm, uv_layer, region, base, direction, width, roll, length=None):
    """A card whose base edge maps to the region's stem end, so a spray grows outward."""
    oriented_card(bm, uv_layer, base, direction, width, length or width * region['aspect'], region['uvs'], roll)


def triangles(mesh):
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def export_group(roots, path):
    """Several trees in one GLB, each its own root empty: one fetch and one leaf
    texture for trees that share a bark profile and a leaf atlas."""
    bpy.ops.object.select_all(action='DESELECT')
    for root in roots:
        root.select_set(True)
        for child in root.children:
            child.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_image_format='AUTO',
                              export_vertex_color='ACTIVE')


def contact_sheet(rows, out_path, cell=(320, 400)):
    """Rows of image paths tiled into one sheet; missing files leave a blank cell."""
    w, h = cell
    sheet = np.ones((h * len(rows), w * max(len(row) for row in rows), 4))
    sheet[..., :3] = 0.1
    for r, row in enumerate(rows):
        for c, path in enumerate(row):
            if os.path.exists(path):
                sheet[r * h:(r + 1) * h, c * w:(c + 1) * w] = read_pixels(path, w, h)
    save_image('contact-sheet', sheet, out_path)
