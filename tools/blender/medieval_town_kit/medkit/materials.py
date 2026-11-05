"""The kit's material library: a dozen materials over shared tileable textures.

`scale` is the world size (m) one texture tile covers, so every module that
uses a material has the same texel density and adjacent modules tile seamlessly.
"""
from dataclasses import dataclass, replace

import bpy

from . import scans


@dataclass(frozen=True)
class Spec:
    tex: str = None
    scale: float = 2.0
    rough: float = 0.85
    metal: float = 0.0
    grain: bool = False      # texture's long axis follows the part's long axis
    fit: bool = False        # map 0..1 across each face (window panes)
    tint: tuple = (1.0, 1.0, 1.0)
    emission: float = 0.0
    normal: float = 1.0
    color: tuple = (0.8, 0.8, 0.8)
    glow_tint: tuple = None  # emission colour multiplier; None emits the albedo itself
    opacity: float = 1.0


SPEC = {
    'stone': Spec('stone', 2.0, 0.86, normal=2.4),
    'stone_ashlar': Spec('ashlar', 2.0, 0.82, normal=2.0),
    # Dressed stone (quoins, copings, sills, voussoirs): one tooled block per piece.
    'stone_dressed': Spec('dressed', 1.2, 0.80, normal=1.8),
    'brick': Spec('brick', 1.2, 0.84, normal=2.2),
    'cobble': Spec('cobble', 2.0, 0.82, normal=2.2),
    'plaster': Spec('plaster', 2.0, 0.90, normal=1.6, tint=(1.0, 0.94, 0.82)),
    'timber': Spec('timber', 1.5, 0.70, grain=True, normal=2.0),
    'wood_trim': Spec('fine_wood', 1.1, 0.62, grain=True, normal=0.95, tint=(0.94, 0.92, 0.90)),
    'carved_wood': Spec('carved_wood', 0.6, 0.64, fit=True, normal=1.8),
    'planks': Spec('planks', 2.0, 0.75, grain=True, normal=2.0),
    # Weathered split slate with mineral sheen and deep baked course lap shadows.
    'roof': Spec('roof', 2.0, 0.74, tint=(0.72, 0.73, 0.76), normal=2.3),
    'roof_terracotta': Spec('terracotta', 2.0, 0.72, normal=2.0),
    'thatch': Spec('thatch', 2.0, 0.92, normal=2.0),
    'clapboard': Spec('clapboard', 2.0, 0.76, normal=2.0, tint=(1.08, 0.96, 0.86)),
    'grass': Spec('grass', 2.0, 0.95),
    'iron': Spec('iron', 1.0, 0.5, metal=0.85, normal=0.6),
    # Old crown glass: dark and reflective by day with a low warm glow from the
    # room behind, so panes read as glass instead of lit white panels.
    'glass': Spec('window', fit=True, rough=0.08, emission=0.12, tint=(0.9, 0.95, 0.95),
                  glow_tint=(1.0, 0.62, 0.30), normal=0.5),
    # Cured hides stretched over goblin walls, and bleached trophy bone.
    'hide': Spec('cloth', 0.8, 0.92, tint=(0.56, 0.41, 0.28), normal=1.4),
    'bone': Spec(color=(0.8, 0.74, 0.6), rough=0.55),
    # Weathered dyes: earth pigments gone chalky in the sun, never primaries
    # (the game's SettlementView trim uses the same aged palette).
    'cloth_cream': Spec('cloth', 1.0, 0.95, tint=(0.86, 0.8, 0.68)),
    'cloth_blue': Spec('cloth', 1.0, 0.95, tint=(0.16, 0.22, 0.4)),
    'cloth_red': Spec('cloth', 1.0, 0.95, tint=(0.46, 0.15, 0.11)),
    'foliage': Spec('foliage', 1.5, 0.9),
    'bark': Spec('bark', 1.0, 0.9, tint=(0.78, 0.74, 0.70)),
    'flowers': Spec('flowers', 1.0, 0.9),
    'glow': Spec(color=(1.0, 0.42, 0.12), emission=2.4),
    'water': Spec(color=(0.07, 0.14, 0.18), rough=0.08),
    # Lashing cord and rigging: tan bast fibre, never white.
    'rope': Spec('cloth', 0.5, 0.95, tint=(0.44, 0.36, 0.25), normal=1.2),
    # A fire-lit room seen through a small opening: warm but far dimmer than a flame.
    'firelight': Spec(color=(0.30, 0.16, 0.07), emission=0.7, rough=1.0),
    # The dark of an unlit opening (arrow loops, a door rebate) seen from outside.
    'shadow': Spec(color=(0.025, 0.022, 0.02), rough=1.0),
    'gold': Spec(color=(0.85, 0.65, 0.22), rough=0.35, metal=1.0),
    # Regional families (docs/asset-bible/regions): reuse the shared textures with a
    # tint where the bible's material is a darker or weathered variant of one we have.
    # Grukmar upland orcs: dark ridge fieldstone, bog-aged hardwood, reed thatch.
    'stone_dark': Spec('stone', 2.0, 0.88, normal=2.6, tint=(0.52, 0.52, 0.54)),
    'timber_dark': Spec('timber', 1.5, 0.74, grain=True, normal=2.2, tint=(0.62, 0.56, 0.50)),
    'thatch_reed': Spec('thatch', 2.0, 0.94, normal=2.2, tint=(0.80, 0.76, 0.66)),
    # Frostgard: weather-silvered hewn pine logs and rooted sod roofs.
    'log': Spec('timber', 1.8, 0.8, grain=True, normal=2.4, tint=(0.86, 0.90, 1.02)),
    'sod': Spec('sod', 2.0, 0.96, normal=1.8),
    # Stonehold: mined granite courses, charcoal basalt dressings, dulled bronze.
    'stone_granite': Spec('granite', 3.0, 0.84, normal=2.2),
    # Basalt is laid in smaller, darker courses of the same masonry: a jointless face
    # read as grey plastic at gameplay distance.
    'stone_basalt': Spec('granite', 2.0, 0.86, normal=2.2, tint=(0.58, 0.62, 0.70)),
    'bronze': Spec(color=(0.26, 0.22, 0.14), rough=0.55, metal=0.85),
    # Regional ground and greenery: packed earth lanes, frost-bitten grass, dark conifers.
    'earth': Spec('earth', 2.0, 0.95, normal=1.8),
    'grass_frost': Spec('grass', 2.0, 0.95, tint=(0.86, 0.90, 0.84)),
    # Grukmar clan halls roof with stretched hides stained a weathered ochre red.
    'hide_red': Spec('plaster', 2.5, 0.94, tint=(0.60, 0.37, 0.29), normal=1.4),
    'grass_upland': Spec('grass', 2.0, 0.95, tint=(0.92, 0.86, 0.70)),
    # Open land round a town in previews: the same grass at field scale, so it never checkers.
    'meadow': Spec('grass', 23.0, 0.95, tint=(0.90, 0.86, 0.72)),
    'meadow_frost': Spec('grass', 23.0, 0.97, tint=(0.80, 0.84, 0.80)),
    'meadow_earth': Spec('earth', 31.0, 0.95),
    # Frostgard winter: drifted snow on roofs and ground, trodden lanes, frosted slate, lake ice.
    'snow': Spec('snow', 7.0, 0.72, normal=0.8),
    'snow_land': Spec('snow', 19.0, 0.75, normal=0.8),
    'snow_path': Spec('snow_path', 2.0, 0.8, normal=1.4),
    'roof_frost': Spec('roof', 2.0, 0.7, tint=(1.45, 1.52, 1.66), normal=2.0),
    'ice': Spec('snow', 7.0, 0.12, tint=(0.55, 0.68, 0.82), normal=0.4),
    # Natural crag and boulder rock (bedding and cracks, no joints).
    'rock': Spec('crag', 4.0, 0.9, normal=2.2, tint=(0.70, 0.74, 0.86)),
    'rock_land': Spec('rock', 17.0, 0.92, normal=1.6),
    # Stonehold columnar cliff basalt, dark so the pale terrace decks read above it.
    'rock_cliff': Spec('basalt', 1.6, 0.95, normal=1.05, tint=(0.98, 1.02, 1.10)),
    'stone_flag': Spec('flagstone', 1.1, 0.90, normal=0.95),
    'hold_bronze': Spec('hold_bronze', 0.65, 0.86, metal=0.78, normal=0.45),
    'hold_water': Spec('hold_water', 0.6, 0.65, normal=0.75),
    'hold_foam': Spec('hold_foam', 0.4, 0.95, normal=0.5),
    'hold_wet_rock': Spec('basalt', 2.0, 0.32, normal=0.9, tint=(0.70, 0.79, 0.82)),
    'hold_soot': Spec(color=(0.08, 0.075, 0.065), rough=1.0),
    'hold_mist': Spec(color=(0.58, 0.70, 0.73), rough=1.0, fit=True, opacity=0.10),
    'hold_warm_stone': Spec('dressed', 1.2, 0.85, tint=(1.0, 0.72, 0.42), emission=0.16, normal=0.8),
    'hold_flame': Spec('hold_flame', 1.0, 1.0, emission=3.2, normal=0, fit=True),
    'foliage_pine': Spec('foliage', 1.5, 0.9, tint=(0.52, 0.66, 0.60)),
    # Plain blown glass for frontier and hold windows (the lattice pane is a lowland look).
    'glass_clear': Spec(color=(0.11, 0.12, 0.12), rough=0.1, emission=0.35, glow_tint=(1.0, 0.62, 0.30)),
}

# A scanned texture covers its photograph's real width (scans.py).
SPEC = {name: replace(spec, scale=scans.size(spec.tex, spec.scale)) if spec.tex else spec
        for name, spec in SPEC.items()}

_MATERIALS = {}


def _linear(c):
    return tuple(x ** 2.2 for x in c[:3]) + (1.0,)


def _principled(mat):
    if not mat.use_nodes:
        mat.use_nodes = True
    return next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def _with_shading(nodes, links, color_out):
    """Multiply by the baked vertex shading (grime, occlusion, per-piece tone)."""
    attr = nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 1.0
    links.new(color_out, mix.inputs[6])
    links.new(attr.outputs['Color'], mix.inputs[7])
    return mix.outputs[2]


def _build(name, spec, images):
    mat = bpy.data.materials.new(f'M_{name}')
    bsdf = _principled(mat)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf.inputs['Roughness'].default_value = spec.rough
    bsdf.inputs['Metallic'].default_value = spec.metal
    bsdf.inputs['Alpha'].default_value = spec.opacity
    color_out = None
    emit_out = None
    if spec.tex:
        albedo, normal, *surface = images[spec.tex]
        if surface:
            rough = nodes.new('ShaderNodeTexImage')
            rough.image = surface[0]
            factor = nodes.new('ShaderNodeMath')
            factor.operation = 'MULTIPLY'
            links.new(rough.outputs['Color'], factor.inputs[0])
            factor.inputs[1].default_value = spec.rough
            links.new(factor.outputs[0], bsdf.inputs['Roughness'])
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = albedo
        color_out = tex.outputs['Color']
        emit_out = color_out
        if spec.glow_tint:
            glow = nodes.new('ShaderNodeMix')
            glow.data_type = 'RGBA'
            glow.blend_type = 'MULTIPLY'
            glow.inputs[0].default_value = 1.0
            links.new(color_out, glow.inputs[6])
            glow.inputs[7].default_value = _linear(spec.glow_tint)
            emit_out = glow.outputs[2]
        if spec.tint != (1.0, 1.0, 1.0):
            mix = nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs[0].default_value = 1.0
            links.new(color_out, mix.inputs[6])
            mix.inputs[7].default_value = _linear(spec.tint)
            color_out = mix.outputs[2]
        links.new(_with_shading(nodes, links, color_out), bsdf.inputs['Base Color'])
        ntex = nodes.new('ShaderNodeTexImage')
        ntex.image = normal
        nmap = nodes.new('ShaderNodeNormalMap')
        nmap.inputs['Strength'].default_value = spec.normal
        links.new(ntex.outputs['Color'], nmap.inputs['Color'])
        links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        if name == 'hold_flame':
            links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    else:
        solid = nodes.new('ShaderNodeRGB')
        solid.outputs[0].default_value = _linear(spec.color)
        links.new(_with_shading(nodes, links, solid.outputs[0]), bsdf.inputs['Base Color'])
    if spec.emission:
        if emit_out is not None:
            links.new(emit_out, bsdf.inputs['Emission Color'])
        else:
            bsdf.inputs['Emission Color'].default_value = _linear(spec.color)
        bsdf.inputs['Emission Strength'].default_value = spec.emission
    return mat


def build(images):
    from .stonehold_surfaces import extend
    images = extend(images)
    for name, spec in SPEC.items():
        _MATERIALS[name] = _build(name, spec, images)


def get(name):
    return _MATERIALS[name]
