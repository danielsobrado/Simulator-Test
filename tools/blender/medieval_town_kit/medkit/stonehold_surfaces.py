"""Shared Stonehold surface maps. All detail survives glTF export; no preview-only nodes."""
import os

import bpy
import numpy as np

from .config import TEXTURE_DIR
from .texture_patterns import fbm, normal_from_height, smooth
from .textures import _save


VERSION = 2


def _rgb(image):
    w, h = image.size
    return np.array(image.pixels[:], np.float32).reshape(h, w, 4)[..., :3]


def _image(name, pixels, non_color=True):
    path = os.path.join(TEXTURE_DIR, f'{name}_v{VERSION}.png')
    if os.path.exists(path) and os.environ.get('MEDKIT_REBAKE_TEXTURES') != '1':
        image = bpy.data.images.load(path, check_existing=True)
        image.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
        return image
    if pixels.ndim == 2:
        pixels = np.repeat(pixels[..., None], 3, axis=2)
    return _save(f'T_{name}', pixels, path, non_color)


def extend(images):
    """Add physical surface variation without rebaking the other families' albedos."""
    images = dict(images)
    for name in ('basalt', 'granite', 'flagstone', 'dressed', 'iron', 'cloth'):
        albedo, normal = images[name][:2]
        n = normal.size[0]
        relief = _rgb(normal)
        grain = fbm(n, 910 + sum(map(ord, name)), 1.8)
        # Flat polished faces catch broader highlights; pits and joints stay matte.
        pit = smooth(0.82, 0.48, relief[..., 2])
        rough = np.clip(0.78 + grain * 0.18 + pit * 0.08, 0.60, 1.0)
        images[name] = (albedo, normal, _image(f'{name}_roughness', rough))

    n = 512
    u, v = np.meshgrid(np.arange(n) / n, np.arange(n) / n)
    grain = fbm(n, 1701, 1.6)
    patina = smooth(0.48, 0.72, fbm(n, 1702, 2.3))
    bronze = np.array((0.40, 0.29, 0.15)) * (0.84 + grain[..., None] * 0.30)
    bronze = bronze * (1 - patina[..., None] * 0.65) + np.array((0.075, 0.16, 0.14)) * patina[..., None] * 0.65
    images['hold_bronze'] = (
        _image('hold_bronze_albedo', bronze, False),
        _image('hold_bronze_normal', normal_from_height(grain * 0.12, 0.18)),
        _image('hold_bronze_roughness', 0.62 + patina * 0.25 + grain * 0.1),
    )
    # Dressed basalt has tooling, not the mortared granite courses of a wall texture.
    dressed, normal, rough = images['dressed']
    col = _rgb(dressed)
    lum = col @ np.array((0.3, 0.55, 0.15))
    basalt = lum[..., None] * np.array((0.47, 0.51, 0.56))
    images['hold_basalt'] = (_image('hold_basalt_albedo', basalt, False), normal, rough)

    # UV v follows the flow. Long fine ripples move in the runtime's existing opaque pass.
    ripple = np.sin(2 * np.pi * (u * 16 + 0.25 * np.sin(v * 2 * np.pi))) * 0.12
    ripple += np.sin(2 * np.pi * (u * 29 - v * 3)) * 0.05
    water = np.zeros((n, n, 3), np.float32) + (0.31, 0.43, 0.46)
    water += ripple[..., None] * 0.15
    images['hold_water'] = (
        _image('hold_water_albedo', water, False),
        _image('hold_water_normal', normal_from_height(ripple.astype(np.float32), 0.6)),
        _image('hold_water_roughness', 0.27 + grain * 0.18),
    )
    foam = np.repeat((0.64 + grain * 0.28)[..., None], 3, axis=2)
    images['hold_foam'] = (
        _image('hold_foam_albedo', foam, False),
        _image('hold_foam_normal', normal_from_height(grain * 0.2, 0.25)),
        _image('hold_foam_roughness', 0.85 + grain * 0.15),
    )
    return images
