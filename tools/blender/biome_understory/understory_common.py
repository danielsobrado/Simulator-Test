"""Shared geometry, procedural noise, material, and export helpers for biome understory."""
import math
import os
import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

MAX_TRIANGLES = 350


def save_image(name, pixels, path, non_color=False):
    h, w, _ = pixels.shape
    out = np.clip(pixels.astype(np.float32), 0.0, 1.0)
    if not non_color:
        # Lift procedural dark/mid tones for sRGB texture encoding so Three.js
        # sRGB->linear sampling and understoryRamp receive balanced luminance.
        out[..., :3] = np.power(out[..., :3], 0.74)
    image = bpy.data.images.new(name, w, h, alpha=True)
    image.pixels.foreach_set(np.flipud(out).ravel())
    image.filepath_raw = path
    image.file_format = 'PNG'
    if non_color:
        image.colorspace_settings.name = 'Non-Color'
    image.save()
    return image


def value_noise(w, h, cells, rng):
    cx = max(1, int(cells[0]))
    cy = max(1, int(cells[1]))
    grid = rng.random((cy + 1, cx + 1))
    grid[:, -1] = grid[:, 0]
    grid[-1, :] = grid[0, :]
    ys, xs = np.mgrid[0:h, 0:w]
    gx, gy = xs / w * cx, ys / h * cy
    x0, y0 = np.floor(gx).astype(int), np.floor(gy).astype(int)
    fx, fy = gx - x0, gy - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = grid[y0, x0], grid[y0, x0 + 1]
    c, d = grid[y0 + 1, x0], grid[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(w, h, cells, rng, octaves=4):
    total, amp, norm = np.zeros((h, w)), 1.0, 0.0
    for o in range(octaves):
        total += amp * value_noise(w, h, (cells[0] * 2 ** o, cells[1] * 2 ** o), rng)
        norm += amp
        amp *= 0.5
    return total / norm


def height_to_normal(height_field, strength=2.2):
    h, w = height_field.shape
    dx = (np.roll(height_field, -1, axis=1) - np.roll(height_field, 1, axis=1)) * strength
    dy = (np.roll(height_field, -1, axis=0) - np.roll(height_field, 1, axis=0)) * strength
    dz = np.ones_like(height_field)
    norm = np.sqrt(dx * dx + dy * dy + dz * dz) + 1e-8
    nx = (-dx / norm) * 0.5 + 0.5
    ny = (dy / norm) * 0.5 + 0.5
    nz = (dz / norm) * 0.5 + 0.5
    return np.stack([nx, ny, nz, np.ones_like(nz)], axis=-1)


def make_material(name, image, alpha=False, normal_image=None, roughness=0.78, subsurface=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image
    links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = roughness
    if subsurface > 0 and 'Subsurface Weight' in bsdf.inputs:
        bsdf.inputs['Subsurface Weight'].default_value = subsurface
    if normal_image is not None:
        ntex = nodes.new('ShaderNodeTexImage')
        ntex.image = normal_image
        nmap = nodes.new('ShaderNodeNormalMap')
        nmap.inputs['Strength'].default_value = 0.85
        links.new(ntex.outputs['Color'], nmap.inputs['Color'])
        links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    if alpha:
        compare = nodes.new('ShaderNodeMath')
        compare.operation = 'GREATER_THAN'
        compare.inputs[1].default_value = 0.4
        links.new(tex.outputs['Alpha'], compare.inputs[0])
        links.new(compare.outputs[0], bsdf.inputs['Alpha'])
        mat.use_backface_culling = False
    return mat


def tube(bm, uv, points, radii, sides, u_range=(0.0, 1.0), v_range=(0.0, 0.9), cap_end=True, rough=0.0, rng=None, scale_y=1.0):
    rings = []
    d0 = (points[1] - points[0]).normalized()
    normal = d0.orthogonal().normalized()
    length = 0.0
    total = sum((points[i] - points[i - 1]).length for i in range(1, len(points)))
    for i, p in enumerate(points):
        d = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
        normal = (normal - d * normal.dot(d)).normalized()
        binormal = d.cross(normal)
        if i:
            length += (points[i] - points[i - 1]).length
        ring = []
        v_coord = v_range[0] + (v_range[1] - v_range[0]) * (length / max(total, 1e-6))
        for s in range(sides + 1):
            a = s / sides * 2 * math.pi
            r = radii[i] * (1 + (rng.uniform(-rough, rough) if rng and 0 < s < sides else 0))
            offset = normal * (math.cos(a) * r) + binormal * (math.sin(a) * r * scale_y)
            v = bm.verts.new(p + offset)
            u_coord = u_range[0] + (u_range[1] - u_range[0]) * (s / sides)
            ring.append((v, (u_coord, v_coord)))
        ring[-1] = (ring[0][0], ring[-1][1])
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for s in range(sides):
            verts = (a[s][0], a[s + 1][0], b[s + 1][0], b[s][0])
            if len(set(verts)) == 4:
                f = bm.faces.new(verts)
                for loop, (_, coord) in zip(f.loops, (a[s], a[s + 1], b[s + 1], b[s])):
                    loop[uv].uv = coord
    if cap_end and radii[-1] > 1e-3:
        tip = rings[-1]
        centre = bm.verts.new(points[-1])
        uc = 0.5 * (u_range[0] + u_range[1])
        vc = min(0.98, v_range[1] + 0.04)
        for s in range(sides):
            verts = (tip[s][0], tip[s + 1][0], centre)
            if len(set(verts)) == 3:
                f = bm.faces.new(verts)
                for loop, coord in zip(f.loops, ((uc - 0.08, vc - 0.02), (uc + 0.08, vc - 0.02), (uc, vc))):
                    loop[uv].uv = coord
    return rings


def arched_card(bm, uv, p0, p1, p2, w0, w1, w2, side_dir, u_range=(0.0, 1.0), v_range=(0.0, 1.0), v_mid=0.55):
    u0, u1 = u_range
    v0, v1 = v_range
    vm = v0 + (v1 - v0) * v_mid
    s0 = side_dir * (w0 * 0.5)
    s1 = side_dir * (w1 * 0.5)
    s2 = side_dir * (w2 * 0.5)
    verts = [
        bm.verts.new(p0 - s0),
        bm.verts.new(p0 + s0),
        bm.verts.new(p1 + s1),
        bm.verts.new(p1 - s1),
        bm.verts.new(p2 + s2),
        bm.verts.new(p2 - s2),
    ]
    quads = (
        (((u0, v0), (u1, v0), (u1, vm), (u0, vm)), (verts[0], verts[1], verts[2], verts[3])),
        (((u0, vm), (u1, vm), (u1, v1), (u0, v1)), (verts[3], verts[2], verts[4], verts[5])),
    )
    faces = []
    out_hint = Vector((p1.x, p1.y, max(0.6, abs(p2.z - p0.z) + 0.5)))
    for uvs, vs in quads:
        if len(set(vs)) == 4:
            n_est = (vs[1].co - vs[0].co).cross(vs[2].co - vs[1].co)
            if n_est.dot(out_hint) < 0:
                vs = (vs[1], vs[0], vs[3], vs[2])
                uvs = (uvs[1], uvs[0], uvs[3], uvs[2])
            f = bm.faces.new(vs)
            for loop, coord in zip(f.loops, uvs):
                loop[uv].uv = coord
            faces.append(f)
    return faces


def rock_chunk(bm, uv, center, radii, u_range=(0.0, 0.5), v_range=(0.0, 0.9), subdivisions=2, rng=None, dome=False):
    """Sculpted organic boulder or moss/cushion hummock with seam-free UV projection."""
    existing_verts = set(bm.verts)
    existing_faces = set(bm.faces)
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1.0)
    new_verts = [v for v in bm.verts if v not in existing_verts]
    new_faces = [f for f in bm.faces if f not in existing_faces]
    rx, ry, rz = radii
    p1 = rng.uniform(0, 6.28) if rng else 0.7
    p2 = rng.uniform(0, 6.28) if rng else 1.9
    for v in new_verts:
        co = v.co.copy()
        # Deterministic organic facets so neighboring vertices displace coherently
        warp = (
            0.14 * math.sin(co.x * 3.2 + p1) * math.cos(co.y * 2.8 + p2)
            + 0.10 * math.cos(co.z * 3.7 - p1)
        )
        if rng is not None:
            warp += rng.uniform(-0.05, 0.05)
        scale = 1.0 + (warp * 0.55 if dome else warp)
        co.x *= scale
        co.y *= scale
        co.z *= scale
        if co.z < -0.25:
            co.z = -0.25 + (co.z + 0.25) * 0.20
        v.co = Vector((center.x + co.x * rx, center.y + co.y * ry, center.z + co.z * rz))
    u0, u1 = u_range
    v0, v1 = v_range
    for f in new_faces:
        for loop in f.loops:
            rel = loop.vert.co - center
            nx = max(0.02, min(0.98, 0.5 + 0.42 * (rel.x / max(rx, 1e-4))))
            ny = max(0.02, min(0.98, 0.5 + 0.42 * (rel.y / max(ry, 1e-4)) * 0.6 + 0.35 * (rel.z / max(rz, 1e-4))))
            loop[uv].uv = (u0 + (u1 - u0) * nx, v0 + (v1 - v0) * ny)
    return new_faces


def mushroom_dome(bm, uv, center, radius, height, sides=6, u_range=(0.52, 0.98), v_range=(0.52, 0.98), tilt=Vector((0, 0, 1))):
    """3D mushroom cap with top dome and gill underside."""
    up = tilt.normalized()
    right = up.orthogonal().normalized()
    fwd = up.cross(right).normalized()
    ring = []
    for k in range(sides):
        a = k * 2 * math.pi / sides
        rim = center + (right * math.cos(a) + fwd * math.sin(a)) * radius
        ring.append((bm.verts.new(rim), a))
    top = bm.verts.new(center + up * height)
    under = bm.verts.new(center - up * (height * 0.22))
    uc = 0.5 * (u_range[0] + u_range[1])
    vc = 0.5 * (v_range[0] + v_range[1])
    ru = 0.46 * (u_range[1] - u_range[0])
    rv = 0.46 * (v_range[1] - v_range[0])
    faces = []
    for k in range(sides):
        v_a, ang_a = ring[k]
        v_b, ang_b = ring[(k + 1) % sides]
        f_top = bm.faces.new((v_a, v_b, top))
        for loop, coord in zip(f_top.loops, (
            (uc + math.cos(ang_a) * ru, vc + math.sin(ang_a) * rv),
            (uc + math.cos(ang_b) * ru, vc + math.sin(ang_b) * rv),
            (uc, vc),
        )):
            loop[uv].uv = coord
        f_bot = bm.faces.new((v_b, v_a, under))
        for loop, coord in zip(f_bot.loops, (
            (uc + math.cos(ang_b) * ru * 0.5, v_range[0] * 0.5),
            (uc + math.cos(ang_a) * ru * 0.5, v_range[0] * 0.5),
            (uc, v_range[0] * 0.25),
        )):
            loop[uv].uv = coord
        faces.extend((f_top, f_bot))
    return faces


def finish_mesh(name, bm, materials):
    """Weld close vertices, triangulate, purge tiny/degenerate triangles, and convert to Mesh."""
    if not isinstance(materials, (list, tuple)):
        materials = [materials]
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=5e-4)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    degen = []
    for f in bm.faces:
        if f.calc_area() < 1e-6:
            degen.append(f)
            continue
        lengths = [e.calc_length() for e in f.edges]
        if min(lengths) < 5e-4:
            degen.append(f)
    if degen:
        bmesh.ops.delete(bm, geom=degen, context='FACES')
    # Delete any loose verts/edges
    loose_edges = [e for e in bm.edges if not e.link_faces]
    if loose_edges:
        bmesh.ops.delete(bm, geom=loose_edges, context='EDGES')
    loose_verts = [v for v in bm.verts if not v.link_faces]
    if loose_verts:
        bmesh.ops.delete(bm, geom=loose_verts, context='VERTS')

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for mat in materials:
        mesh.materials.append(mat)
    for p in mesh.polygons:
        p.use_smooth = True
    up = Vector((0.0, 0.0, 1.0))
    custom_normals = []
    for v in mesh.vertices:
        radial = Vector((v.co.x, v.co.y, max(0.40, v.co.z + 0.45)))
        radial = radial.normalized() if radial.length > 1e-4 else up
        n = v.normal * 0.30 + radial * 0.40 + up * 0.30
        if n.z < 0.30:
            n.z = 0.30
        custom_normals.append(n.normalized())
    mesh.normals_split_custom_set_from_vertices(custom_normals)
    tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
    assert tris <= MAX_TRIANGLES, f'{name} has {tris} triangles (budget {MAX_TRIANGLES})'
    return mesh, tris


def place_and_export(name, mesh, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    obj = bpy.data.objects.new(f'{name}-mesh', mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = root
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for child in root.children:
        child.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )
    return root
