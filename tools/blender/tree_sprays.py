"""Sprays and fronds composed into a card atlas (trees plan §5.4).

Poly Haven's broadleaf sheet holds single leaves and no palm frond, so both are
assembled here. The plan asked for an orthographic emission render; this
composites the same flat quads in numpy instead, which records colour exactly,
needs no scene and is byte-stable across runs.
"""
import math
import os

import numpy as np

from tree_kit import save_image
from tree_kit_scans import region_from_pixels, sharpen_alpha


def upright(atlas, key):
    """A region's pixels, turned so its stem end is the bottom row."""
    region = atlas['regions'][key]
    x0, y0, x1, y1 = region['rect']
    sub = atlas['pixels'][y0:y1, x0:x1]
    du = region['tip_uv'][0] - region['base_uv'][0]
    dv = region['tip_uv'][1] - region['base_uv'][1]
    if abs(dv) >= abs(du):
        return sub if dv > 0 else np.rot90(sub, 2)
    return np.rot90(sub, 1) if du > 0 else np.rot90(sub, -1)


def shrink(src, step):
    """Box-filter by an integer step (alpha-weighted) before a minifying stamp."""
    if step <= 1:
        return src
    h, w = src.shape[0] // step * step, src.shape[1] // step * step
    if h == 0 or w == 0:
        return src
    pm = src[:h, :w].copy()
    pm[..., :3] *= pm[..., 3:]
    pm = pm.reshape(h // step, step, w // step, step, 4).mean(axis=(1, 3))
    pm[..., :3] /= np.maximum(pm[..., 3:], 1e-4)
    return pm


def stamp(canvas, src, base, axis, width):
    """Alpha-over `src` (stem on its bottom row) as a quad rising from pixel `base`
    along `axis` (canvas pixels, y down), `width` pixels across."""
    length = math.hypot(axis[0], axis[1])
    if length < 1 or width < 0.5:
        return
    src = shrink(src, int(src.shape[0] / length))
    ux, uy = axis[0] / length, axis[1] / length
    sx, sy = -uy, ux
    xs = [base[0] + sx * k * width / 2 + ux * m * length for k in (-1, 1) for m in (0, 1)]
    ys = [base[1] + sy * k * width / 2 + uy * m * length for k in (-1, 1) for m in (0, 1)]
    x0, x1 = max(0, int(min(xs))), min(canvas.shape[1], int(max(xs)) + 2)
    y0, y1 = max(0, int(min(ys))), min(canvas.shape[0], int(max(ys)) + 2)
    if x0 >= x1 or y0 >= y1:
        return
    gy, gx = np.mgrid[y0:y1, x0:x1] + 0.5
    dx, dy = gx - base[0], gy - base[1]
    t = (dx * ux + dy * uy) / length
    s = (dx * sx + dy * sy) / width + 0.5
    inside = (t >= 0) & (t < 1) & (s >= 0) & (s < 1)
    h, w = src.shape[:2]
    texel = src[np.clip(((1 - t) * h).astype(int), 0, h - 1), np.clip((s * w).astype(int), 0, w - 1)]
    a = texel[..., 3:] * inside[..., None]
    target = canvas[y0:y1, x0:x1]
    out_a = a + target[..., 3:] * (1 - a)
    target[..., :3] = (texel[..., :3] * a + target[..., :3] * target[..., 3:] * (1 - a)) / np.maximum(out_a, 1e-6)
    target[..., 3:] = out_a


def tapered(colour, rows=64, cols=9, tip=0.3):
    """A solid strip narrowing from full width to `tip` of it: twigs, rachises."""
    strip = np.zeros((rows, cols, 4))
    strip[..., :3] = colour
    t = 1 - (np.arange(rows)[:, None] + 0.5) / rows  # 0 at the bottom row (stem)
    across = np.abs((np.arange(cols)[None, :] + 0.5) / cols - 0.5) * 2
    strip[..., 3] = across <= 1 - (1 - tip) * t
    return strip


def polyline(base, length, heading, bend, segments=8):
    """Points of a stem rising from `base`; `heading` and `bend` in radians off straight up."""
    points, x, y = [base], base[0], base[1]
    for i in range(segments):
        angle = heading + bend * (i + 0.5) / segments
        x, y = x + math.sin(angle) * length / segments, y - math.cos(angle) * length / segments
        points.append((x, y))
    return points


def along(points, t):
    """Position and unit direction at fraction `t` of a polyline."""
    f = min(max(t, 0), 0.9999) * (len(points) - 1)
    i = int(f)
    (ax, ay), (bx, by) = points[i], points[i + 1]
    d = math.hypot(bx - ax, by - ay) or 1
    return (ax + (bx - ax) * (f - i), ay + (by - ay) * (f - i)), ((bx - ax) / d, (by - ay) / d)


def rotated(direction, angle):
    c, s = math.cos(angle), math.sin(angle)
    return (direction[0] * c - direction[1] * s, direction[0] * s + direction[1] * c)


def draw_stem(canvas, points, colour, width, tip=0.3):
    strip = tapered(colour, tip=1.0)
    for i, (a, b) in enumerate(zip(points[:-1], points[1:])):
        w = width * (1 - (1 - tip) * i / (len(points) - 1))
        stamp(canvas, strip, a, (b[0] - a[0], b[1] - a[1]), w)


def broadleaf_spray(canvas, cell, rng, leaves, count, bend=0.0, toward_tip=1.0, fan=False):
    """Alternate leaves along a twig with one terminal leaf, or (`fan`) a short
    tip cluster fanned from one point. `leaves` are upright leaf crops."""
    x0, y0, x1, y1 = cell
    height = y1 - y0
    petiole = leaves[0][-max(1, leaves[0].shape[0] // 20):]
    opaque = petiole[..., 3] > 0.5
    colour = petiole[opaque][:, :3].mean(axis=0) if opaque.any() else np.array([0.2, 0.18, 0.1])
    span = height * (0.4 if fan else 0.9)
    twig = polyline(((x0 + x1) / 2, y1), span, -bend / 2, bend)
    draw_stem(canvas, twig, colour, height * 0.022)

    def leaf(point, direction, scale=1.0):
        crop = leaves[rng.randrange(len(leaves))]
        # A few degrees of pitch out of the plane foreshortens the leaf.
        length = height * 0.9 * rng.uniform(0.28, 0.36) * scale * math.cos(math.radians(rng.uniform(-10, 10)))
        stamp(canvas, crop, point, (direction[0] * length, direction[1] * length), length * crop.shape[1] / crop.shape[0])

    if fan:
        point, direction = along(twig, 1.0)
        for i in range(count):
            leaf(point, rotated(direction, math.radians(-75 + 150 * i / (count - 1) + rng.uniform(-6, 6))), 1.5)
        return
    for i in range(count - 1):
        point, direction = along(twig, 0.15 + 0.8 * (i / max(1, count - 2)) ** toward_tip)
        side = 1 if i % 2 else -1
        leaf(point, rotated(direction, side * math.radians(rng.uniform(40, 60))))
    leaf(*along(twig, 1.0))


def srgb(colour):
    """The plan's frond colours, stored as written: read as linear and encoded
    they came out a pale mint (first build, 2026-11-11)."""
    return np.asarray(colour, dtype=float)


def palm_frond(canvas, cell, rng, pairs):
    """A bowed rachis carrying `pairs` leaflet pairs, long near the base third and
    closing toward the tip. A leaflet this narrow shows no surface detail: its
    shape is the detail."""
    x0, y0, x1, y1 = cell
    height = y1 - y0
    leaflet = np.zeros((64, 9, 4))
    across = np.abs(np.arange(9) - 4) / 4
    leaflet[..., :3] = srgb([0.24, 0.42, 0.14]) + (srgb([0.16, 0.30, 0.10]) - srgb([0.24, 0.42, 0.14])) * across[None, :, None]
    leaflet[:, 4, :3] = srgb([0.38, 0.46, 0.22])
    t = 1 - (np.arange(64)[:, None] + 0.5) / 64
    leaflet[..., 3] = across[None, :] <= np.clip((1 - t) / 0.3, 0, 1)  # pointed tip
    rachis = polyline(((x0 + x1) / 2 - height * 0.03, y1), height * 0.96, 0.12, -0.24)
    for i in range(pairs):
        f = 0.1 + 0.88 * i / (pairs - 1)
        length = height * (0.12 + 0.12 * f * 3 if f < 1 / 3 else 0.24 - 0.17 * (f - 1 / 3) / (2 / 3))
        point, direction = along(rachis, f)
        angle = math.radians(55 - 30 * f)
        for side in (-1, 1):
            d = rotated(direction, side * angle + rng.uniform(-0.05, 0.05))
            stamp(canvas, leaflet, point, (d[0] * length, d[1] * length), height * 0.018)
    draw_stem(canvas, rachis, srgb([0.38, 0.46, 0.22]), height * 0.014, tip=0.25)


def bake_sprays(sprays, size, out_path):
    """Draw each `(key, draw)` into its own cell of a grid (two columns) and save
    the atlas. `draw(canvas, cell)` paints with the stem at the middle of the
    cell's bottom edge. Returns {'image', 'pixels', 'regions'}."""
    width, height = size
    rows = (len(sprays) + 1) // 2
    cw, ch = width // 2, height // rows
    canvas = np.zeros((height, width, 4))
    regions = {}
    for index, (key, draw) in enumerate(sprays):
        cx, cy = (index % 2) * cw, (index // 2) * ch
        mx, my = int(cw * 0.03), int(ch * 0.03)
        draw(canvas, (cx + mx, cy + my, cx + cw - mx, cy + ch - my))
        rect = (cx, cy, cx + cw, cy + ch)
        regions[key] = region_from_pixels([(rect[0], rect[3]), (rect[2], rect[3]), (rect[2], rect[1]), (rect[0], rect[1])],
                                          rect, width, height)
    opaque = canvas[..., 3] > 0.5
    # Transparent texels take the mean leaf colour so mips do not fringe dark.
    canvas[~opaque, :3] = canvas[opaque][:, :3].mean(axis=0) if opaque.any() else 0
    canvas[..., 3] = sharpen_alpha(canvas[..., 3])
    name = os.path.splitext(os.path.basename(out_path))[0]
    return {'image': save_image(name, canvas, out_path), 'pixels': canvas, 'regions': regions}
