"""Headless helpers for turning Poly Haven scans into game meshes (plan: understory-aaa-plan-2026-11-10 §5)."""
import math
import os
import bmesh
import bpy
import numpy as np
from mathutils import Vector

ATLAS = 1024
MASK_RES = 512
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def tri_count(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def import_scan(gltf_path):
    """Import a glTF and return its meshes joined into one object with identity transform."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=gltf_path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in meshes:
        activate(o)
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    for layer in list(obj.data.uv_layers)[1:]:
        obj.data.uv_layers.remove(layer)
    return obj


def coords(mesh):
    a = np.empty(len(mesh.vertices) * 3, np.float32)
    mesh.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def normalise(obj, height):
    """Lowest point at z = 0, xy centred, uniform scale to `height` (units vary per scan)."""
    co = coords(obj.data)
    lo, hi = co.min(0), co.max(0)
    co -= np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]], np.float32)
    co *= height / (hi[2] - lo[2])
    obj.data.vertices.foreach_set('co', co.ravel())
    obj.data.update()
    return co.min(0), co.max(0)


def clean(mesh):
    """Drop loose geometry and zero-area triangles: gltfpack drops them and the optimizer asserts parity."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_area() < 1e-10], context='FACES')
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.delete(bm, geom=[e for e in bm.edges if not e.link_faces], context='EDGES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(mesh)
    bm.free()


def decimate(obj, target):
    ratio = min(1.0, target / max(1, tri_count(obj)))
    for _ in range(2):
        activate(obj)
        mod = obj.modifiers.new('Decimate', 'DECIMATE')
        mod.decimate_type, mod.delimit, mod.use_collapse_triangulate, mod.ratio = 'COLLAPSE', {'UV'}, True, ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)
        tris = tri_count(obj)
        if tris <= target * 1.05:
            break
        ratio = target / tris
    clean(obj.data)
    return tri_count(obj)


def shade(obj, cutout):
    for p in obj.data.polygons:
        p.use_smooth = True
    if cutout:  # cards keep their own facing; the runtime bends them
        activate(obj)
        mod = obj.modifiers.new('WN', 'WEIGHTED_NORMAL')
        mod.keep_sharp = False
        bpy.ops.object.modifier_apply(modifier=mod.name)


def read_px(path, w, h):
    """Image as a bottom-up float array (h, w, 4) of the file's stored (sRGB-encoded) values."""
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    img.scale(w, h)
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)


def write_px(name, arr, path, srgb):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    img.alpha_mode = 'STRAIGHT'
    img.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).ravel())
    img.filepath_raw, img.file_format = path, 'PNG'
    img.save()
    return img


def silhouette(obj, bounds):
    """Front and top orthographic geometry masks (512 px, Workbench flat white on black): opaque pixel counts."""
    scene = bpy.data.scenes.get('mask') or bpy.data.scenes.new('mask')
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = scene.render.resolution_y = MASK_RES
    scene.render.film_transparent = False
    scene.display.render_aa = 'OFF'
    scene.display.shading.light, scene.display.shading.color_type = 'FLAT', 'SINGLE'
    scene.display.shading.single_color = (1, 1, 1)
    scene.view_settings.view_transform = 'Standard'
    scene.world = scene.world or bpy.data.worlds.new('mask')
    scene.world.color = (0, 0, 0)
    cam = bpy.data.objects.get('mask-cam') or bpy.data.objects.new('mask-cam', bpy.data.cameras.new('mask-cam'))
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'ORTHO'
    lo, hi = Vector(bounds[0]), Vector(bounds[1])
    centre, span = (lo + hi) / 2, max(hi - lo) * 1.1
    cam.data.ortho_scale = span
    scene.collection.objects.link(obj)
    out = []
    for name, offset, rot in (('front', (0, -span * 2, 0), (math.pi / 2, 0, 0)), ('top', (0, 0, span * 2), (0, 0, 0))):
        cam.location, cam.rotation_euler = centre + Vector(offset), rot
        scene.render.filepath = os.path.join(bpy.app.tempdir, f'mask-{name}.png')
        bpy.ops.render.render(write_still=True, scene=scene.name)
        out.append(float((read_px(scene.render.filepath, MASK_RES, MASK_RES)[..., 0] > 0.5).sum()))
    scene.collection.objects.unlink(obj)
    return out


def material_sets(obj, source_dir, asset_id):
    """Per distinct diffuse texture: its arm/normal files, and the alpha file when the scan ships one."""
    alpha = os.path.join(source_dir, 'textures', f'{asset_id}_alpha_2k.png')
    sets, slot_set = [], []
    for slot in obj.material_slots:
        files = {}
        for n in slot.material.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                path = bpy.path.abspath(n.image.filepath)
                for key in ('diff', 'arm', 'nor_gl'):
                    if f'_{key}_' in os.path.basename(path):
                        files[key] = path
        known = next((i for i, s in enumerate(sets) if s['diff'] == files['diff']), None)
        if known is None:
            files['alpha'] = alpha if os.path.exists(alpha) else None
            sets.append(files)
            known = len(sets) - 1
        slot_set.append(known)
    if len(sets) > 1:  # only the twig sheet of a mixed scan is cut out
        for s in sets:
            if 'twig' not in os.path.basename(s['diff']):
                s['alpha'] = None
    return sets, slot_set


def pack_atlas(obj, sets, slot_set):
    """Stack each set into one 1024 square (strips when mixed) and remap UVs onto its strip."""
    n, strip = len(sets), ATLAS // len(sets)
    out = {k: np.ones((ATLAS, ATLAS, 4), np.float32) for k in ('diff', 'arm', 'nor_gl')}
    out['alpha'] = np.ones((ATLAS, ATLAS), np.float32)
    for i, s in enumerate(sets):
        rows = slice(i * strip, (i + 1) * strip)
        for k in ('diff', 'arm', 'nor_gl'):
            out[k][rows] = read_px(s[k], ATLAS, strip)
        if s['alpha']:
            out['alpha'][rows] = read_px(s['alpha'], ATLAS, strip)[..., 0]
    if n > 1:
        mesh = obj.data
        uv = np.empty(len(mesh.loops) * 2, np.float32)
        mesh.uv_layers[0].data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        mat = np.empty(len(mesh.polygons), np.int32)
        totals = np.empty(len(mesh.polygons), np.int32)
        mesh.polygons.foreach_get('material_index', mat)
        mesh.polygons.foreach_get('loop_total', totals)
        k = np.repeat(np.array(slot_set, np.int32)[mat], totals)
        uv[:, 1] = (np.clip(uv[:, 1], 0, 1) + k) / n
        mesh.uv_layers[0].data.foreach_set('uv', uv.ravel())
    return out


def grade(tex, cutout, target_luma):
    """AO-multiplied albedo, alpha sharpened round the cutoff, mean luma set by one gamma. Returns (rgba, luma, roughness)."""
    rgb = tex['diff'][..., :3] * np.power(np.clip(tex['arm'][..., 0:1], 0, 1), 0.6)
    alpha = np.clip((tex['alpha'] - 0.5) * 4 + 0.5, 0, 1) if cutout else np.ones_like(tex['alpha'])
    mask = alpha > 0.5
    luma = lambda c: float((c[mask] @ LUMA).mean())
    lo, hi = 0.15, 6.0  # mean luma falls as gamma rises
    for _ in range(24):
        g = math.sqrt(lo * hi)
        lo, hi = (g, hi) if luma(np.power(rgb, g)) > target_luma else (lo, g)
    rgb = np.power(rgb, math.sqrt(lo * hi))
    rough = float(np.clip(tex['arm'][..., 1][mask].mean(), 0.55, 0.95))
    return np.dstack([rgb, alpha]), luma(rgb), rough


def build_material(name, albedo, normal, roughness, cutout):
    mat = bpy.data.materials.new(f'Scan {name}')
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = albedo
    links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    ntex = nodes.new('ShaderNodeTexImage')
    ntex.image = normal
    nmap = nodes.new('ShaderNodeNormalMap')
    nmap.inputs['Strength'].default_value = 1.0
    links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0.0
    if cutout:
        links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        for attr, value in (('blend_method', 'CLIP'), ('alpha_threshold', 0.5)):
            if hasattr(mat, attr):  # gone in newer Blender; the build script patches the GLB if needed
                setattr(mat, attr, value)
    mat.use_backface_culling = False
    return mat
