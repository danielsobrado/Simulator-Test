"""Build, validate and photograph Stonehold at game scale, using deterministic cameras.

blender -b --factory-startup --python tools/blender/medieval_town_kit/stonehold_review.py -- --modules Stonehold_Twin_Outcrop
"""
import argparse
import json
import math
import os
import sys
import time

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from medkit import config, export, materials, render, textures
from medkit.kit import Kit
from medkit.modules.stonehold_formations import STONEHOLD_MODULES, build_module


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--modules', default='')
    parser.add_argument('--out', default=os.path.join(config.SOURCE_DIR, 'previews', 'stonehold-aaa'))
    parser.add_argument('--lod1', action='store_true')
    parser.add_argument('--no-render', action='store_true')
    parser.add_argument('--work-dir', default='tmp/stonehold-aaa')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    args.out = os.path.abspath(args.out)
    args.work_dir = os.path.abspath(args.work_dir)
    os.makedirs(args.work_dir, exist_ok=True)
    config.LOD = int(args.lod1)
    os.makedirs(args.out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials.build(textures.generate(config.TEXTURE_DIR))
    kit = Kit()
    selected = set(args.modules.split(',')) if args.modules else {name for name, _ in STONEHOLD_MODULES}
    report = {'lod': config.LOD, 'modules': {}}
    for name, builder in STONEHOLD_MODULES:
        if name not in selected:
            continue
        start = time.monotonic()
        obj = build_module(kit, name, builder)
        mesh = obj.data
        mesh.calc_loop_triangles()
        assert all(math.isfinite(c) for v in mesh.vertices for c in v.co), name
        assert len(mesh.loop_triangles) <= (12000 if config.LOD else 48000), name
        assert all(t.area > 1e-12 for t in mesh.loop_triangles), f'{name}: degenerate triangle'
        obj.location = (0, 0, 0)
        report['modules'][name] = {'triangles': len(mesh.loop_triangles), 'vertices': len(mesh.vertices),
                                   'materials': len(mesh.materials), 'buildSeconds': round(time.monotonic() - start, 2),
                                   'bounds': [[min(v.co[i] for v in mesh.vertices), max(v.co[i] for v in mesh.vertices)] for i in range(3)]}
        obj.hide_render = True
    export.kit_glb(kit, args.work_dir, 'stonehold_lod1.glb' if config.LOD else 'stonehold.glb', images=not config.LOD)
    with open(os.path.join(args.out, f'metrics-lod{config.LOD}.json'), 'w') as f:
        json.dump(report, f, indent=2)
    if args.no_render:
        return
    render.setup_scene(look='storybook')
    scene = bpy.context.scene
    # Broad key and cool mountain bounce keep rough rock legible in the shadows.
    for name, position, energy, colour, size in [
        ('MountainKey', (-16, -24, 32), 8500, (1.0, 0.86, 0.70), 18),
        ('MountainFill', (22, -8, 18), 6000, (0.55, 0.72, 1.0), 22),
        ('MountainRim', (6, 20, 26), 11000, (0.72, 0.84, 1.0), 15),
    ]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy, data.color, data.shape, data.size = energy, colour, 'DISK', size
        light = bpy.data.objects.new(name, data)
        scene.collection.objects.link(light)
        light.location = position
        light.rotation_euler = (Vector((0, 0, 5)) - light.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
    scene.render.resolution_percentage = 100
    scene.eevee.taa_render_samples = 64
    camera_data = bpy.data.cameras.new('StoneholdReviewCamera')
    camera = bpy.data.objects.new('StoneholdReviewCamera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = 'ORTHO'
    for name, obj in kit.modules.items():
        obj.hide_render = False
        pts = [Vector(c) for c in obj.bound_box]
        centre = sum(pts, Vector()) / len(pts)
        size = max(obj.dimensions)
        for view, direction in [('hero', (-0.22, -1, 0.58)), ('front', (0, -1, 0.12)), ('rear', (0.6, 1, 0.42))]:
            camera.location = centre + Vector(direction).normalized() * size * 2.5
            camera.rotation_euler = (centre - camera.location).to_track_quat('-Z', 'Y').to_euler()
            camera_data.ortho_scale = max(obj.dimensions.x, obj.dimensions.y, obj.dimensions.z * 4 / 3) * 1.35
            scene.render.filepath = os.path.join(args.out, f'{name}-{view}.png')
            bpy.ops.render.render(write_still=True)
        obj.hide_render = True
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.work_dir, f'stonehold-lod{config.LOD}.blend'))


if __name__ == '__main__':
    main()
