"""Turns a module's blockout rock into sculpted, game-budget rock (Stonehold AAA pass).

The procedural crag blocks (stonehold_parts) are the blockout. Their faces are split off,
voxel-remeshed into one solid, displaced with columnar fracture noise, decimated into
the module's triangle budget, smoothed by angle, wrapped with the tiled
rock texture, given baked ambient occlusion in the shared 'Col' vertex shading, and joined
back. The game multiplies 'Col' into the colour (TownKitMaterial data.x), so the baked
occlusion ships without per-asset textures.
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector

from . import materials
from .config import detailed

# Prefer ROCK_FLOOR for near rock; the complete module's budget takes precedence.
ROCK_FLOOR = 12000
MODULE_TRIS = 48000  # LOD0 only: bevels, lanterns and ribbons are not built at LOD1
MODULE_TRIS_LOD1 = 12000


def _split_rock(obj, mat):
    """Move obj's rock faces into a new object; None if it has none."""
    slot = next((i for i, m in enumerate(obj.data.materials) if m and m.name == f'M_{mat}'), None)
    if slot is None:
        return None
    rock_me = obj.data.copy()
    for me, keep_rock in ((rock_me, True), (obj.data, False)):
        bm = bmesh.new()
        bm.from_mesh(me)
        drop = [f for f in bm.faces if (f.material_index == slot) != keep_rock]
        bmesh.ops.delete(bm, geom=drop, context='FACES')
        if keep_rock:
            # MeshBuilder never welds faces, and blocks are open at the foot: weld, then close.
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
            bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
        bm.to_mesh(me)
        bm.free()
    # Remesh emits material slot zero. Isolate the rock material before remeshing,
    # rather than relying on which material the authored recipe happened to add first.
    rock_me.materials.clear()
    rock_me.materials.append(materials.get(mat))
    for poly in rock_me.polygons:
        poly.material_index = 0
    rock = bpy.data.objects.new(f'{obj.name}_rock', rock_me)
    bpy.context.scene.collection.objects.link(rock)
    return rock


def _apply(obj, mod):
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
    obj.modifiers.remove(mod)
    old, obj.data = obj.data, me
    bpy.data.meshes.remove(old)


def _shape(rock, seed, voxel):
    """Fuse and fracture: voxel remesh, then columnar Voronoi plus fine crackle displacement."""
    rem = rock.modifiers.new('remesh', 'REMESH')
    rem.mode = 'VOXEL'
    rem.voxel_size = voxel
    _apply(rock, rem)
    # Texture space squashed in z (via a scaled empty) stretches cells into vertical columns.
    k = max(1.0, voxel / 0.045)  # big pieces (mountains) get proportionally bigger fractures
    space = bpy.data.objects.new(f'{rock.name}_space', None)
    bpy.context.scene.collection.objects.link(space)
    space.scale = (1.0, 1.0, 2.4)
    space.location = (random.Random(seed).uniform(-9, 9), 0.0, 0.0)
    for tex_type, size, strength in (('VORONOI', 0.48, 0.050), ('STUCCI', 0.10, 0.009)):
        tex = bpy.data.textures.new(f'{rock.name}_{tex_type}', tex_type)
        tex.noise_scale = size * k
        if tex_type == 'VORONOI':
            tex.distance_metric = 'DISTANCE'
            tex.weight_1, tex.weight_2 = -1.0, 1.0  # F2 - F1: crisp ridges between cells
        disp = rock.modifiers.new(f'disp_{tex_type}', 'DISPLACE')
        disp.texture = tex
        disp.texture_coords = 'OBJECT'
        disp.texture_coords_object = space
        disp.strength = strength * k
        disp.mid_level = 0.5
        _apply(rock, disp)
        bpy.data.textures.remove(tex)
    bpy.data.objects.remove(space)


def _drop_islands(rock, min_faces):
    """Tiny separate pieces (pebbles, talus slivers) decimate into floating shards."""
    bm = bmesh.new()
    bm.from_mesh(rock.data)
    seen, drop = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        island, stack = [], [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            island.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        if len(island) < min_faces:
            drop.extend(island)
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(rock.data)
    bm.free()


def _cut_openings(rock, cutouts):
    """Subtract authored aperture volumes after remesh, so voxel fusion cannot seal them."""
    for volume in cutouts:
        mesh = bpy.data.meshes.new('RockAperture')
        mesh.from_pydata(volume['vertices'], [], volume['faces'])
        cutter = bpy.data.objects.new('RockAperture', mesh)
        bpy.context.scene.collection.objects.link(cutter)
        try:
            modifier = rock.modifiers.new('AuthoredAperture', 'BOOLEAN')
            modifier.operation = 'DIFFERENCE'
            modifier.solver = 'EXACT'
            modifier.object = cutter
            _apply(rock, modifier)
        finally:
            bpy.data.objects.remove(cutter, do_unlink=True)
            bpy.data.meshes.remove(mesh)


def _drop_underside(rock):
    """Faces under the ground line are never seen; remove them before spending budget."""
    bm = bmesh.new()
    bm.from_mesh(rock.data)
    under = [f for f in bm.faces if f.normal.z < -0.5 and max(v.co.z for v in f.verts) < 0.03]
    bmesh.ops.delete(bm, geom=under, context='FACES')
    bm.to_mesh(rock.data)
    bm.free()


def _decimate(rock, budget):
    tris = sum(len(p.vertices) - 2 for p in rock.data.polygons)
    if tris > budget:
        dec = rock.modifiers.new('decimate', 'DECIMATE')
        dec.ratio = budget / tris
        _apply(rock, dec)
    # Collapse can flip faces in tight folds; the kit's backface-culled materials drop them.
    bm = bmesh.new()
    bm.from_mesh(rock.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(rock.data)
    bm.free()
    rock.data.shade_smooth()
    rock.data.set_sharp_from_angle(angle=math.radians(38))


def _wrap_uvs(rock, centres, mat, k=1.0):
    """Dominant-plane UVs preserve physical texel density on overhangs and concave cliffs."""
    scale = materials.SPEC[mat].scale * min(k, 1.5)
    me = rock.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        n = poly.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co
            if axis == 2:
                u, v = p.x * (1 if n.z >= 0 else -1), p.y
            elif axis == 1:
                u, v = p.x * (-1 if n.y >= 0 else 1), p.z
            else:
                u, v = p.y * (1 if n.x >= 0 else -1), p.z
            uv.data[li].uv = (u / scale, v / scale)


def _bake_occlusion(rock, samples, architecture):
    """Cycles AO into the 'Col' vertex shading, remapped so open faces stay near 1."""
    me = rock.data
    for attr in list(me.color_attributes):
        me.color_attributes.remove(attr)
    col = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    me.color_attributes.active_color = col
    scene = bpy.context.scene
    engine = scene.render.engine
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.world = scene.world or bpy.data.worlds.new('BakeWorld')
    # Short rays: crevices and deck overhangs only, never neighbouring catalog modules.
    ao_distance = scene.world.light_settings.distance
    scene.world.light_settings.distance = 0.35
    # Catalog modules share the origin until layout. They must never occlude one another.
    hidden = {obj: obj.hide_render for obj in scene.objects if obj.type == 'MESH' and obj not in (rock, architecture)}
    for obj in hidden:
        obj.hide_render = True
    try:
        with bpy.context.temp_override(active_object=rock, object=rock, selected_objects=[rock],
                                       selected_editable_objects=[rock]):
            result = bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
            assert result == {'FINISHED'}, f'{rock.name}: AO bake failed'
    finally:
        for obj, hide in hidden.items():
            obj.hide_render = hide
        scene.render.engine = engine
        scene.world.light_settings.distance = ao_distance
    for d in col.data:
        ao = d.color[0]
        v = 0.60 + 0.40 * ao
        d.color = (v, v, v, 1.0)


def _join(obj, rock):
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj, rock],
                                   selected_editable_objects=[obj, rock]):
        bpy.ops.object.join()


def sculpt_rock(obj, seed, centres=((0.0, 0.0),), floor=ROCK_FLOOR, mat='rock_cliff', cutouts=()):
    """Replace obj's blockout rock with sculpted rock within the budgets above; returns
    (blockout_tris, sculpted_tris) for the build's budget report."""
    mats = obj.data.materials
    blockout = sum(len(p.vertices) - 2 for p in obj.data.polygons
                   if mats[p.material_index] and mats[p.material_index].name == f'M_{mat}')
    rock = _split_rock(obj, mat)
    if rock is None:
        return 0, 0
    limit = MODULE_TRIS if detailed() else MODULE_TRIS_LOD1
    architecture = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    assert architecture < limit - 1000, f'{obj.name}: architecture alone exhausts {limit} triangles'
    budget = min(max(blockout, floor if detailed() else blockout), limit - architecture - 64)
    # Voxel scales with the rock (a 20 m mountain wall would otherwise remesh into millions).
    size = Vector(rock.dimensions).length
    voxel = max(0.045 if detailed() else 0.08, size / (110 if detailed() else 45))
    k = max(1.0, voxel / 0.045)
    _shape(rock, seed, voxel)
    assert len(rock.data.materials) == 1 and rock.data.materials[0] == materials.get(mat), obj.name
    _cut_openings(rock, cutouts)
    _drop_islands(rock, 400 if detailed() else 60)
    _drop_underside(rock)
    _decimate(rock, budget)
    _wrap_uvs(rock, centres, mat, k)
    _bake_occlusion(rock, 16 if detailed() else 4, obj)
    sculpted = sum(len(p.vertices) - 2 for p in rock.data.polygons)
    assert sculpted <= budget * 1.02, f'{obj.name}: sculpted rock {sculpted} > budget {budget}'
    _join(obj, rock)
    total = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    assert total <= limit, f'{obj.name}: {total} tris > {limit}'
    return blockout, sculpted
