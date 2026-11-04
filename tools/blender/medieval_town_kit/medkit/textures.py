"""Write the shared tileable textures to PNG and load them as Blender images."""
import os

import bpy
import numpy as np

from . import scans
from .texture_patterns import PATTERNS, _uv, courses, fbm, lerp, normal_from_height, rounded_edge, smooth, tint
from .texture_patterns_extra import EXTRA_PATTERNS
from .texture_patterns_regional import REGIONAL_PATTERNS
from .texture_patterns_weathered import WEATHERED_PATTERNS


def _blur_periodic(field, radius):
    """Fast tileable box/tent blur over a 2D float array."""
    out = field.astype(np.float32)
    for shift in range(1, radius + 1):
        w = (radius + 1 - shift) / (radius + 1)
        out = (
            out
            + w * (np.roll(field, shift, 0) + np.roll(field, -shift, 0)
                   + np.roll(field, shift, 1) + np.roll(field, -shift, 1))
        ) / (1.0 + 4.0 * w)
    return out


def _brick_underlayer(n, seed):
    """Running-bond medieval kilned clay bricks with pale sandy lime-mortar joints."""
    rng = np.random.default_rng(seed)
    block, dx, dy, t_row, count = courses(n, rng, 14, 0.16 * n, 0.26 * n, row_jitter=0.05)
    fine = fbm(n, seed + 1, 1.35)
    wobble = fbm(n, seed + 2, 2.0)
    edge = rounded_edge(dx, dy, n * 0.008) + (wobble - 0.5) * n * 0.005
    mortar = n * 0.0042
    face = smooth(mortar, mortar + n * 0.006, edge)

    BRICK_PALETTE = np.array([
        [0.64, 0.29, 0.18],  # terracotta red
        [0.54, 0.25, 0.16],  # burnt russet
        [0.69, 0.38, 0.23],  # warm salmon-ochre clay
        [0.44, 0.22, 0.15],  # kiln-flashed dark clinker
        [0.60, 0.33, 0.21],  # weathered red-brown brick
    ], np.float32)
    pick = rng.integers(0, len(BRICK_PALETTE), count)
    tones = rng.uniform(0.86, 1.12, count)
    brick_col = (BRICK_PALETTE[pick] * tones[:, None])[block]
    top_hi = smooth(0.80, 0.98, t_row) * face
    bot_ao = smooth(0.20, 0.02, t_row) * face
    brick_col = tint(brick_col, (0.86 + 0.24 * fine) * (0.92 + 0.12 * top_hi - 0.12 * bot_ao))
    mortar_col = tint((0.74, 0.69, 0.59), 0.88 + 0.20 * fine)
    albedo = lerp(mortar_col, brick_col, face)
    height = (face * (0.72 + 0.12 * top_hi + 0.16 * fine) + (1.0 - face) * 0.12 * fine).astype(np.float32)
    return albedo, height, face


def _bake_scan_relief(name, albedo, normal, seed):
    """Bake normal-derived cavity AO, overlap shadows, chiselled edge highlights,
    and rich material-specific albedo & normal details (exposed brick/mortar courses,
    multi-hued stonework, wood cathedral grain) into scanned PBR textures."""
    n = albedo.shape[0]
    u, v = _uv(n)
    nx = normal[..., 0] * 2.0 - 1.0
    ny = normal[..., 1] * 2.0 - 1.0
    nz = np.clip(normal[..., 2] * 2.0 - 1.0, 0.05, 1.0)

    # Tangent-space divergence: > 0 on convex ridges/lips, < 0 in concave joints/grooves
    dnx = (np.roll(nx, -1, axis=1) - np.roll(nx, 1, axis=1)) * 0.5
    dny = (np.roll(ny, -1, axis=0) - np.roll(ny, 1, axis=0)) * 0.5
    curv = dnx + dny

    tilt = smooth(0.015, 0.26, 1.0 - nz)
    valley = smooth(0.0, 0.16, -curv)
    under_lap = smooth(0.02, 0.28, -ny)
    raw_cavity = np.clip(0.45 * tilt + 0.35 * valley + 0.45 * under_lap, 0.0, 1.0)
    cavity = 0.55 * raw_cavity + 0.30 * _blur_periodic(raw_cavity, 2) + 0.15 * _blur_periodic(raw_cavity, 5)
    edge_hi = smooth(0.015, 0.18, curv) * smooth(-0.08, 0.24, ny)

    fine = fbm(n, seed + 11, 1.35)
    mid = fbm(n, seed + 17, 1.95)
    big = fbm(n, seed + 23, 2.5)
    streak = fbm(n, seed + 37, 1.85, sy=9.0)

    # Config per scan type: (ao_strength, hi_strength, normal_boost)
    cfg = {
        'roof': (0.58, 0.20, 1.65),
        'terracotta': (0.54, 0.18, 1.50),
        'thatch': (0.50, 0.15, 1.45),
        'stone': (0.52, 0.22, 1.60),
        'ashlar': (0.48, 0.20, 1.55),
        'clapboard': (0.56, 0.22, 1.60),
        'planks': (0.52, 0.20, 1.50),
        'plaster': (0.38, 0.14, 1.45),
        'cobble': (0.52, 0.18, 1.45),
    }
    ao_str, hi_str, n_boost = cfg.get(name, (0.45, 0.14, 1.35))

    col = albedo.astype(np.float32)

    if name == 'roof':
        # Enrich slate with blue-charcoal to weathered plum-grey variation & crevice moss
        slate_tint = lerp((0.88, 0.93, 1.04), (1.05, 0.96, 0.92), big)
        col = col * slate_tint * (0.90 + 0.20 * fine)[..., None]
        moss = smooth(0.56, 0.80, big) * smooth(0.18, 0.55, cavity) * 0.55
        col = lerp(col, (0.25, 0.31, 0.14), moss)
    elif name == 'terracotta':
        # Sun-baked kilned clay warmth & trough patina
        clay_var = lerp((1.06, 0.92, 0.84), (0.94, 1.02, 0.96), big)
        col = col * clay_var * (0.90 + 0.18 * fine)[..., None]
        lichen = smooth(0.60, 0.84, big) * smooth(0.22, 0.60, cavity) * 0.42
        col = lerp(col, (0.30, 0.29, 0.18), lichen)
    elif name in ('stone', 'ashlar'):
        # Extract stone/brick faces vs recessed mortar joints from luminance + normal cavity
        lum = 0.299 * col[..., 0] + 0.587 * col[..., 1] + 0.114 * col[..., 2]
        lum_local = lum - _blur_periodic(lum, 10)
        mortar_mask = np.clip(smooth(0.18, 0.48, cavity) * smooth(0.015, -0.045, lum_local), 0.0, 1.0)
        stone_face = 1.0 - mortar_mask

        # Multi-hued geological block tinting (warm terracotta sandstone, golden honey limestone, cool buff)
        patch_a = fbm(n, seed + 41, 2.2)
        patch_b = fbm(n, seed + 43, 2.0)
        warm_sandstone = lerp((1.02, 0.97, 0.90), (0.92, 0.95, 0.98), patch_a)
        terracotta_fleck = smooth(0.62, 0.84, patch_b) * stone_face
        col = col * warm_sandstone * (0.88 + 0.22 * fine)[..., None]
        col = lerp(col, col * np.array([1.08, 0.97, 0.88], np.float32), terracotta_fleck * 0.35)

        # Crisp chiselled stone micro-grain and sunlit top-edge arris polish
        chisel = 0.5 + 0.5 * np.sin((u * 42.0 + v * 42.0 + 0.35 * mid) * np.pi * 2.0)
        top_arris = smooth(0.05, 0.35, ny) * stone_face
        col = lerp(col, (0.76, 0.70, 0.60), top_arris * 0.24)
        col = tint(col, 0.95 + 0.10 * chisel * stone_face)

        # Distinct pale sandy-lime mortar in recessed joints with deep inner crevice AO
        inner_crevice = smooth(0.45, 0.82, cavity)
        mortar_col = tint((0.68, 0.63, 0.54), (0.90 + 0.16 * fine) * (1.0 - 0.38 * inner_crevice))
        col = lerp(col, mortar_col, mortar_mask * 0.72)

        moss = smooth(0.60, 0.82, big) * smooth(0.28, 0.68, cavity) * 0.45
        col = lerp(col, (0.24, 0.30, 0.13), moss)
    elif name in ('clapboard', 'planks'):
        # Rich wood cathedral figure, longitudinal fibers, and per-plank tone diversity
        fibers = fbm(n, seed + 51, 1.45, sx=20.0, sy=1.1)
        warp = fbm(n, seed + 53, 2.2, sx=6.0, sy=1.4)
        board_rows = 8.0 if name == 'clapboard' else 7.0
        v_board = (v * board_rows) % 1.0
        board_id = np.floor(v * board_rows).astype(np.int32)
        rng_b = np.random.default_rng(seed + 55)
        board_tones = rng_b.uniform(0.86, 1.16, 16)[board_id % 16]
        board_warmth = rng_b.uniform(-0.06, 0.08, 16)[board_id % 16]

        # Cathedral grain arches within each horizontal plank
        r_pith = np.hypot((v_board - 0.48 + 0.18 * (warp - 0.5)) * 3.6, 0.32 * np.sin(u * np.pi * 2.0 + warp * 2.5))
        rings = 0.5 + 0.5 * np.sin((r_pith * 10.0 + fibers * 1.8) * np.pi * 2.0)
        latewood = smooth(0.55, 0.92, rings)
        pores = smooth(0.74, 0.88, fbm(n, seed + 57, 1.2, sx=18.0, sy=0.8)) * (1.0 - 0.6 * latewood)

        warm_wood = lerp((0.90, 0.84, 0.78), (1.04, 0.98, 0.90), 0.60 * fibers + 0.40 * (1.0 - latewood))
        warm_wood = warm_wood * board_tones[..., None] + np.stack(
            [board_warmth, board_warmth * 0.4, -board_warmth * 0.3], axis=-1
        )
        col = col * warm_wood * (0.86 + 0.24 * fine)[..., None] * (1.0 - 0.25 * pores)[..., None]

        # Add wood grain normal detail
        grain_n = normal_from_height((0.55 * fibers + 0.30 * (1.0 - latewood) - 0.25 * pores).astype(np.float32), 0.85)
        nx = nx + (grain_n[..., 0] * 2.0 - 1.0) * 0.45
        ny = ny + (grain_n[..., 1] * 2.0 - 1.0) * 0.45
    elif name == 'plaster':
        # Hand-troweled limewash plaster with sweeping trowel arcs, warm ochre/cream mottling,
        # sub-surface brick/mortar ghosting, and weathered exposed medieval brick patches!
        brick_col, brick_h, brick_face = _brick_underlayer(n, seed + 60)

        trowel_sweep = 0.5 + 0.5 * np.sin(
            (np.hypot((u - 0.5) * 3.0, (v - 0.5) * 3.0) + 0.45 * mid) * np.pi * 3.0
        )
        trowel = 0.45 * fbm(n, seed + 63, 1.85, sx=2.2, sy=2.2) + 0.30 * trowel_sweep + 0.25 * fine
        crazing = smooth(0.84, 0.93, fbm(n, seed + 71, 1.35))

        # Wear field: faint brick ghosting where limewash is thin, plus flaked-off exposed brick patches
        wear_field = 0.55 * fbm(n, seed + 75, 2.3) + 0.30 * mid + 0.15 * (1.0 - v)
        ghost_mask = smooth(0.46, 0.68, wear_field)
        exposed_mask = 0.0 * wear_field
        plaster_rim = smooth(0.67, 0.71, wear_field) * (1.0 - exposed_mask)

        # Enrich base limewash plaster with warm cream & ochre lime pigment variation
        lime_warm = lerp((1.02, 0.99, 0.93), (0.95, 0.89, 0.79), big)
        plaster_col = col * lime_warm
        plaster_col = tint(
            plaster_col,
            (0.92 + 0.14 * trowel)
            * (1.0 - 0.06 * smooth(0.45, 0.92, big))
            * (1.0 - 0.24 * crazing)
            + 0.08 * plaster_rim,
        )
        # Blend sub-surface brick ghosting through thin limewash
        ghost_tint = lerp(plaster_col, brick_col * 0.92 + 0.08, 0.08 * (1.0 - 0.35 * brick_face))
        plaster_col = lerp(plaster_col, ghost_tint, ghost_mask * (1.0 - exposed_mask))
        # Exposed brick patch with dark plaster-edge drop shadow
        rim_shadow = smooth(0.70, 0.74, wear_field) * exposed_mask
        exposed_brick_shaded = tint(brick_col, 1.0 - 0.28 * rim_shadow)
        col = lerp(plaster_col, exposed_brick_shaded, exposed_mask)

        # Combined height relief for plaster trowel waves, cracks, plaster lip, and exposed bricks
        comp_h = (
            (1.0 - exposed_mask) * (0.58 + 0.24 * trowel + 0.08 * plaster_rim - 0.28 * crazing + 0.08 * ghost_mask * brick_h)
            + exposed_mask * (0.35 * brick_h)
        ).astype(np.float32)
        plaster_n = normal_from_height(comp_h, 1.45)
        nx = nx + (plaster_n[..., 0] * 2.0 - 1.0) * 0.75
        ny = ny + (plaster_n[..., 1] * 2.0 - 1.0) * 0.75

    # Scans photographed in warm light read orange under the game's low sun: pull
    # clay and field stone back toward their own luminance.
    saturation = {'terracotta': 0.72, 'stone': 0.78, 'ashlar': 0.85}.get(name)
    if saturation is not None:
        lum = (0.299 * col[..., 0] + 0.587 * col[..., 1] + 0.114 * col[..., 2])[..., None]
        col = lum + (col - lum) * saturation

    # Apply baked cavity AO, vertical rain streaks, and convex arris highlights
    shade = (1.0 - ao_str * cavity) * (1.0 - 0.10 * smooth(0.55, 0.90, streak)) + hi_str * edge_hi
    col = np.clip(col * shade[..., None], 0.0, 1.0)

    # Boost normal relief and re-normalize
    bnx = nx * n_boost
    bny = ny * n_boost
    bnz = nz
    norm_len = np.sqrt(bnx * bnx + bny * bny + bnz * bnz + 1e-9)
    boosted_normal = np.stack([bnx / norm_len, bny / norm_len, bnz / norm_len], axis=-1) * 0.5 + 0.5
    return col.astype(np.float32), np.clip(boosted_normal, 0.0, 1.0).astype(np.float32)


def _bake_procedural_relief(albedo, height, strength):
    """Bake subtle height-derived cavity AO and ridge polish into procedural albedos."""
    normal = normal_from_height(height.astype(np.float32), strength)
    nx = normal[..., 0] * 2.0 - 1.0
    ny = normal[..., 1] * 2.0 - 1.0
    dnx = (np.roll(nx, -1, axis=1) - np.roll(nx, 1, axis=1)) * 0.5
    dny = (np.roll(ny, -1, axis=0) - np.roll(ny, 1, axis=0)) * 0.5
    curv = dnx + dny
    cavity = smooth(0.0, 0.18, -curv)
    ridge = smooth(0.01, 0.18, curv)
    shade = 1.0 - 0.22 * cavity + 0.10 * ridge
    return np.clip(albedo * shade[..., None], 0.0, 1.0).astype(np.float32), normal


def _save(name, rgb, path, non_color):
    n = rgb.shape[0]
    img = bpy.data.images.new(name, n, n, alpha=False)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    rgba = np.concatenate([np.clip(rgb, 0, 1), np.ones((n, n, 1), np.float32)], axis=2)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


def _load_cached(name, path, non_color):
    """Load a previously baked texture PNG instead of regenerating it."""
    img = bpy.data.images.load(path, check_existing=True)
    img.name = name
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    return img


def generate(out_dir, seed=7):
    """Returns {pattern: (albedo_image, normal_image)}. A scanned surface (scans.py)
    replaces the procedural pattern of the same name when its files are present;
    'clapboard' falls back to the plank pattern."""
    os.makedirs(out_dir, exist_ok=True)
    patterns = {**PATTERNS, **EXTRA_PATTERNS, **WEATHERED_PATTERNS}
    patterns.setdefault('clapboard', patterns['planks'])
    # Appended last so the earlier patterns keep their seeds.
    patterns.update(REGIONAL_PATTERNS)
    images = {}
    rebake = os.environ.get('MEDKIT_REBAKE_TEXTURES') == '1'
    for i, (name, (fn, size)) in enumerate(patterns.items()):
        p_albedo = os.path.join(out_dir, f'{name}_albedo.png')
        p_normal = os.path.join(out_dir, f'{name}_normal.png')
        if not rebake and os.path.exists(p_albedo) and os.path.exists(p_normal):
            images[name] = (
                _load_cached(f'T_{name}_albedo', p_albedo, False),
                _load_cached(f'T_{name}_normal', p_normal, True),
            )
            print(f'[kit] texture {name} cached')
            continue
        p_seed = seed + i * 101
        scanned = scans.load(name)
        if scanned:
            albedo, normal = _bake_scan_relief(name, scanned[0], scanned[1], p_seed)
        else:
            raw_albedo, height, strength = fn(size, p_seed)
            albedo, normal = _bake_procedural_relief(raw_albedo, height, strength)
        images[name] = (
            _save(f'T_{name}_albedo', albedo, os.path.join(out_dir, f'{name}_albedo.png'), False),
            _save(f'T_{name}_normal', normal, os.path.join(out_dir, f'{name}_normal.png'), True),
        )
        print(f'[kit] texture {name} {albedo.shape[0]}px {"scan+baked" if scanned else "procedural+baked"}')
    return images
