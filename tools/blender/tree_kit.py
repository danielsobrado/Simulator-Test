"""Shared helpers for the Blender-built trees (swamp_trees, savanna_trees).

Noise textures, a recursive branch skeleton, tube and card meshes, and the
two-material GLB export StylizedTreeView extracts (one bark mesh, one leaf
mesh). Everything takes its RNG from the caller, so a build stays seeded.
"""
import math
import random

import bpy
import numpy as np
from mathutils import Vector, Matrix


# ---------------------------------------------------------------- textures

def save_image(name, pixels, path):
    h, w, _ = pixels.shape
    image = bpy.data.images.new(name, w, h, alpha=True)
    image.pixels.foreach_set(np.flipud(pixels).astype(np.float32).ravel())
    image.filepath_raw = path
    image.file_format = 'PNG'
    image.save()
    return image


def value_noise(w, h, cells, rng):
    grid = rng.random((cells[1] + 1, cells[0] + 1))
    grid[:, -1] = grid[:, 0]
    grid[-1, :] = grid[0, :]
    ys, xs = np.mgrid[0:h, 0:w]
    gx, gy = xs / w * cells[0], ys / h * cells[1]
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


# ---------------------------------------------------------------- skeleton

class Branch:
    def __init__(self, points, radii, depth):
        self.points, self.radii, self.depth = points, radii, depth


def jitter(rng, scale):
    return Vector((rng.gauss(0, scale), rng.gauss(0, scale), rng.gauss(0, scale)))


def perpendicular(direction):
    other = Vector((0, 0, 1)) if abs(direction.z) < 0.9 else Vector((1, 0, 0))
    return direction.cross(other).normalized()


def grow(rng, start, direction, length, radius, depth, spec, out, tip_radius=None):
    """A branch from `start`, recursing into children per `spec` (taper,
    phototropism, gnarl, droop, children, child_start, angle, ratio, max_depth,
    min_radius; per-depth lists are indexed by depth, capped at 4)."""
    seg = max(0.35, min(1.4, length / 9))
    steps = max(3, int(length / seg))
    points, radii = [start.copy()], [radius]
    pos, d = start.copy(), direction.normalized()
    end_radius = tip_radius if tip_radius is not None else radius * spec['taper']
    for i in range(1, steps + 1):
        t = i / steps
        up = Vector((0, 0, 1)) * spec['phototropism'][min(depth, 4)]
        droop = Vector((0, 0, -1)) * spec['droop'] * t * (depth >= 2)
        d = (d + jitter(rng, spec['gnarl'][min(depth, 4)]) + up * seg * 0.1 + droop * 0.1).normalized()
        pos = pos + d * seg
        points.append(pos.copy())
        radii.append(radius + (end_radius - radius) * t ** 0.8)
    branch = Branch(points, radii, depth)
    out.append(branch)
    if depth >= spec['max_depth'] or radius < spec['min_radius']:
        return branch
    count = spec['children'][min(depth, 4)]
    golden = rng.uniform(0, 6.28)
    for k in range(count):
        t = rng.uniform(spec['child_start'][min(depth, 4)], 0.97)
        index = min(len(points) - 1, max(1, int(t * (len(points) - 1))))
        parent_dir = (points[index] - points[index - 1]).normalized()
        side = perpendicular(parent_dir)
        golden += 2.39996
        side.rotate(Matrix.Rotation(golden, 3, parent_dir))
        angle = math.radians(rng.uniform(*spec['angle'][min(depth, 4)]))
        child_dir = (parent_dir * math.cos(angle) + side * math.sin(angle)).normalized()
        child_len = length * rng.uniform(*spec['ratio']) * (1.15 - 0.4 * t)
        child_radius = radii[index] * rng.uniform(0.45, 0.7)
        if child_radius < spec['min_radius'] * 0.6:
            continue
        grow(rng, points[index], child_dir, child_len, child_radius, depth + 1, spec, out)
    return branch


# ---------------------------------------------------------------- mesh

def tube_mesh(bm, uv_layer, branch, radius_scale=None):
    """A capped tube along `branch`; `radius_scale(z, theta)` reshapes a bole."""
    pts, radii = branch.points, branch.radii
    r0 = radii[0]
    sides = 14 if r0 > 0.5 else 8 if r0 > 0.2 else 5 if r0 > 0.08 else 3
    rings = []
    normal = perpendicular((pts[1] - pts[0]).normalized())
    length_acc = 0.0
    circumference = 2 * math.pi * max(r0, 0.05)
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        normal = (normal - d * normal.dot(d)).normalized()
        binormal = d.cross(normal)
        if i > 0:
            length_acc += (pts[i] - pts[i - 1]).length
        ring = []
        for s in range(sides + 1):
            theta = s / sides * 2 * math.pi
            r = radii[i]
            if radius_scale:
                r *= radius_scale(p.z, theta)
            offset = normal * math.cos(theta) * r + binormal * math.sin(theta) * r
            ring.append((bm.verts.new(p + offset), (s / sides, length_acc / circumference)))
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for s in range(sides):
            face = bm.faces.new((a[s][0], a[s + 1][0], b[s + 1][0], b[s][0]))
            for loop, (_, uv) in zip(face.loops, (a[s], a[s + 1], b[s + 1], b[s])):
                loop[uv_layer].uv = uv
    # cap the tip so the end of a broken or fine branch is never open
    tip = rings[-1]
    centre = bm.verts.new(pts[-1] + (pts[-1] - pts[-2]).normalized() * radii[-1] * 0.5)
    for s in range(sides):
        face = bm.faces.new((tip[s][0], tip[s + 1][0], centre))
        for loop, uv in zip(face.loops, (tip[s][1], tip[s + 1][1], (tip[s][1][0], tip[s][1][1] + 0.1))):
            loop[uv_layer].uv = uv


def card(bm, uv_layer, corners, uvs):
    verts = [bm.verts.new(c) for c in corners]
    face = bm.faces.new(verts)
    for loop, uv in zip(face.loops, uvs):
        loop[uv_layer].uv = uv


def card_uv(u_range, v0=0.0, v1=1.0):
    return [(u_range[0], v0), (u_range[1], v0), (u_range[1], v1), (u_range[0], v1)]


def oriented_card(bm, uv_layer, base, direction, width, length, uvs, roll):
    """A quad rising from `base` along `direction`, turned `roll` about it."""
    side = perpendicular(direction)
    side.rotate(Matrix.Rotation(roll, 3, direction))
    side *= width / 2
    tip = base + direction * length
    card(bm, uv_layer, [base - side, base + side, tip + side, tip - side], uvs)


def paint_cards(mesh, seed):
    """A per-card tint around white. The runtime keeps a vertex-coloured crown's
    own colours instead of re-grading it onto the shared green canopy ramp."""
    rng = random.Random(seed * 11 + 3)
    attribute = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for poly in mesh.polygons:
        shade = rng.uniform(0.82, 1.08)
        tint = (shade, shade * rng.uniform(0.97, 1.03), shade * rng.uniform(0.94, 1.0), 1.0)
        for loop in poly.loop_indices:
            attribute.data[loop].color = tint
    mesh.color_attributes.active_color = attribute


def material(name, image, alpha, color=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    if image is None:
        # The runtime synthesises the bark (barkProfile) and mixes it with this
        # flat base colour, so the GLB carries a colour, not a texture.
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Roughness'].default_value = 0.75
        return mat
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    if alpha:
        mat.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        try:
            mat.blend_method = 'CLIP'
        except Exception:
            pass
        mat.use_backface_culling = False
    return mat


def assemble(name, trunk_mesh, leaf_mesh, bark_mat, leaf_mat, seed):
    """Parent the bark and leaf meshes under one empty, as the runtime expects."""
    trunk_mesh.materials.append(bark_mat)
    leaf_mesh.materials.append(leaf_mat)
    paint_cards(leaf_mesh, seed)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for mesh, label in ((trunk_mesh, 'Bark'), (leaf_mesh, 'Leaves')):
        obj = bpy.data.objects.new(f'{name}-{label}', mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = root
        for poly in mesh.polygons:
            poly.use_smooth = label == 'Bark'
    tris = sum(len(p.vertices) - 2 for p in trunk_mesh.polygons) + sum(len(p.vertices) - 2 for p in leaf_mesh.polygons)
    print(f'{name}: bark {len(trunk_mesh.polygons)} faces, leaves {len(leaf_mesh.polygons)} cards, ~{tris} tris')
    return root


def export(root, path):
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for child in root.children:
        child.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_image_format='AUTO',
                              export_vertex_color='ACTIVE')


def remove(root):
    for child in list(root.children):
        bpy.data.objects.remove(child)
    bpy.data.objects.remove(root)


def render_preview(root, path):
    scene = bpy.context.scene
    for o in scene.objects:
        o.hide_render = not (o == root or o.parent == root or o.type in {'CAMERA', 'LIGHT'})
    cam = scene.camera
    height = max((child.matrix_world @ Vector(c)).z for child in root.children for c in child.bound_box)
    cam.location = Vector((height * 0.95, -height * 0.95, height * 0.4))
    direction = Vector((0, 0, height * 0.47)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def setup_scene(sky=(0.32, 0.4, 0.4), ground=(0.05, 0.06, 0.04)):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 640, 800
    world = bpy.data.worlds.new('World')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*sky, 1)
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (0.7, 0.2, 0.6)
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    cam.data.lens = 35
    scene.collection.objects.link(cam)
    scene.camera = cam
    import bmesh
    mesh = bpy.data.meshes.new('ground')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30)
    bm.to_mesh(mesh)
    bm.free()
    g = bpy.data.objects.new('Ground', mesh)
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (*ground, 1)
    mesh.materials.append(gm)
    scene.collection.objects.link(g)
