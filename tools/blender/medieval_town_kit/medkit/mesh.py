"""Low-poly geometry builder used by every kit module.

Faces carry a material name and get planar UVs computed in *module space*
(u horizontal along the face, v up the face), scaled by the material's tile
size. Because every module sits on the 2 m grid, textures continue across
neighbouring modules without any per-module UV work.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import materials
from .bevel import DEFAULT_BEVEL, chamfer_faces, grime_strips, piece_tone, vertex_shade
from .config import detailed

_BOX_FACES = {
    '-x': ((0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)),
    '+x': ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)),
    '-y': ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)),
    '+y': ((0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)),
    '-z': ((0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)),
    '+z': ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)),
}
_AXIS = {'-x': (-1, 0, 0), '+x': (1, 0, 0), '-y': (0, -1, 0),
         '+y': (0, 1, 0), '-z': (0, 0, -1), '+z': (0, 0, 1)}
IDENTITY = Matrix.Identity(4)


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        n.x += (p.y - q.y) * (p.z + q.z)
        n.y += (p.z - q.z) * (p.x + q.x)
        n.z += (p.x - q.x) * (p.y + q.y)
    return n


def frame(origin, x_dir, y_hint):
    """Matrix whose local X follows x_dir and local Y lies along y_hint."""
    x = Vector(x_dir).normalized()
    y = Vector(y_hint)
    y = (y - x * y.dot(x)).normalized()
    z = x.cross(y)
    o = Vector(origin)
    return Matrix(((x.x, y.x, z.x, o.x), (x.y, y.y, z.y, o.y),
                   (x.z, y.z, z.z, o.z), (0, 0, 0, 1)))


def rot_z(angle, origin=(0, 0, 0)):
    return Matrix.Translation(origin) @ Matrix.Rotation(angle, 4, 'Z')


def wall_point(loc, rotq, p):
    """Story-local position of a point given in a wall module's local frame, for a
    wall placed at loc turned rotq quarter turns."""
    v = rot_z(rotq * math.pi / 2) @ Vector(p)
    return (loc[0] + v.x, loc[1] + v.y, v.z)


class MeshBuilder:
    def __init__(self):
        self.verts, self.faces, self.uvs, self.colors = [], [], [], []
        self.face_mats, self.face_smooth = [], []
        self._mat_names = []

    # -- primitives -----------------------------------------------------
    def poly(self, pts, mat, outward=None, uvs=None, smooth=False, grain_dir=None, tone=1.0):
        pts = [Vector(p) for p in pts]
        n = newell(pts)
        if n.length < 1e-9:
            return
        if uvs is None and detailed():
            strips = grime_strips(pts, n, mat)
            if strips:
                for strip in strips:
                    self.poly(strip, mat, outward=outward, smooth=smooth, grain_dir=grain_dir, tone=tone)
                return
        if outward is not None and n.dot(Vector(outward)) < 0:
            pts.reverse()
            n = -n
            if uvs is not None:
                uvs = list(reversed(uvs))
        if uvs is None:
            uvs = self._planar_uvs(pts, n.normalized(), materials.SPEC[mat], grain_dir)
        base = len(self.verts)
        self.verts.extend(pts)
        self.uvs.extend(uvs)
        unit_n = n.normalized()
        self.colors.extend(tone * vertex_shade(p, unit_n, mat) for p in pts)
        self.faces.append(tuple(range(base, base + len(pts))))
        if mat not in self._mat_names:
            self._mat_names.append(mat)
        self.face_mats.append(self._mat_names.index(mat))
        self.face_smooth.append(smooth)

    def box(self, lo, hi, mat, m=IDENTITY, mats=None, skip=(), bevel=None, tone=None):
        """Box lo..hi in the frame m. Unskipped timber and stone boxes are chamfered
        by default; pass bevel=0 to keep one square."""
        m3 = m.to_3x3()
        ext = [hi[i] - lo[i] for i in range(3)]
        long_axis = max(range(3), key=lambda i: ext[i])
        grain = m3 @ Vector([1.0 if i == long_axis else 0.0 for i in range(3)])
        tone = piece_tone(mat, m @ Vector(lo), m @ Vector(hi)) if tone is None else tone
        bevel = DEFAULT_BEVEL.get(mat, 0.0) if bevel is None else bevel
        if not detailed():
            bevel = 0.0
        if bevel > 0 and not skip and min(ext) >= bevel * 3:
            for key, pts, out in chamfer_faces(lo, hi, bevel):
                face_mat = (mats or {}).get(key, mat) if key else mat
                self.poly([m @ Vector(p) for p in pts], face_mat, outward=m3 @ Vector(out),
                          grain_dir=grain, tone=tone)
            return
        for key, corners in _BOX_FACES.items():
            if key in skip:
                continue
            pts = [m @ Vector([hi[a] if bit else lo[a] for a, bit in enumerate(c)])
                   for c in corners]
            self.poly(pts, (mats or {}).get(key, mat), outward=m3 @ Vector(_AXIS[key]),
                      grain_dir=grain, tone=tone)

    def beam(self, p0, p1, side_axis, side_range, width, mat, mats=None, bevel=None, tone=1.0):
        """Box from p0 to p1; side_range spans along side_axis, width along the third axis."""
        d = Vector(p1) - Vector(p0)
        m = frame(p0, d, side_axis)
        self.box((0, side_range[0], -width / 2), (d.length, side_range[1], width / 2),
                 mat, m=m, mats=mats, bevel=bevel, tone=tone)

    def extrude(self, pts, offset, mat, m=IDENTITY, side_mat=None, tone=1.0):
        """Prism from a convex planar polygon swept along offset."""
        m3 = m.to_3x3()
        base = [m @ Vector(p) for p in pts]
        off = m3 @ Vector(offset)
        top = [p + off for p in base]
        centre = sum(base, Vector()) / len(base)
        self.poly(base, mat, outward=-off, tone=tone)
        self.poly(top, mat, outward=off, tone=tone)
        for i, a in enumerate(base):
            b = base[(i + 1) % len(base)]
            out = (a + b) / 2 - centre
            out -= off.normalized() * out.dot(off.normalized())
            self.poly([a, b, b + off, a + off], side_mat or mat, outward=out, tone=tone)

    def lathe(self, profile, seg, mat, m=IDENTITY, smooth=True, phase=0.0):
        """Surface of revolution of [(r, z), ...] around local Z.

        Facing follows the profile direction: walking the profile upward faces
        outward, walking it inward at constant z faces up.
        """
        spec = materials.SPEC[mat]
        if not detailed():
            seg = max(4, seg // 2)
        m3 = m.to_3x3()
        angles = [phase + 2 * math.pi * j / seg for j in range(seg + 1)]
        r_max = max(r for r, _ in profile) or 1.0
        v_acc = [0.0]
        for (r0, z0), (r1, z1) in zip(profile, profile[1:]):
            v_acc.append(v_acc[-1] + math.hypot(r1 - r0, z1 - z0))
        for k, ((r0, z0), (r1, z1)) in enumerate(zip(profile, profile[1:])):
            dz, dr = z1 - z0, r1 - r0
            for j in range(seg):
                a0, a1 = angles[j], angles[j + 1]
                am = (a0 + a1) / 2
                ring = [(r0, z0, a0), (r0, z0, a1), (r1, z1, a1), (r1, z1, a0)]
                pts, uvs = [], []
                for r, z, a in ring:
                    p = m @ Vector((r * math.cos(a), r * math.sin(a), z))
                    if pts and (p - pts[-1]).length < 1e-7:
                        continue
                    if len(pts) == 3 and (p - pts[0]).length < 1e-7:
                        continue
                    pts.append(p)
                    u = (a - phase) * r_max / spec.scale
                    v = (v_acc[k] if z == z0 and r == r0 else v_acc[k + 1]) / spec.scale
                    uvs.append((v, u) if spec.grain else (u, v))
                if len(pts) < 3:
                    continue
                out = m3 @ Vector((dz * math.cos(am), dz * math.sin(am), -dr))
                self.poly(pts, mat, outward=out, uvs=uvs, smooth=smooth)

    def blob(self, centre, radius, mat, m=IDENTITY, subdiv=2, squash=(1, 1, 1),
             jitter=0.15, seed=0):
        """Jittered icosphere — foliage clumps, bushes, pillows."""
        rng = random.Random(seed)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
        c = Vector(centre)
        pos = {}
        for v in bm.verts:
            k = 1 + jitter * (rng.random() * 2 - 1)
            local = Vector((v.co.x * squash[0], v.co.y * squash[1], v.co.z * squash[2]))
            pos[v.index] = m @ (c + local * radius * k)
        for f in bm.faces:
            pts = [pos[v.index] for v in f.verts]
            fc = sum(pts, Vector()) / len(pts)
            self.poly(pts, mat, outward=fc - m @ c, smooth=True)
        bm.free()

    def mark(self):
        return len(self.verts)

    def shift_from(self, start, offset):
        """Shift the vertices added since mark() (UVs keep their mapping)."""
        off = Vector(offset)
        self.verts[start:] = [v + off for v in self.verts[start:]]
        return self

    def translate(self, offset):
        """Shift everything built so far (UVs keep the module-space mapping they had)."""
        off = Vector(offset)
        self.verts = [v + off for v in self.verts]
        # Shading was baked in the old frame; it stays as baked.
        return self

    # -- uv ----------------------------------------------------------------
    @staticmethod
    def _planar_uvs(pts, n, spec, grain_dir):
        u = None
        if spec.grain and grain_dir is not None:
            g = Vector(grain_dir)
            g -= n * g.dot(n)
            if g.length > 1e-3:
                u = g.normalized()
        if u is None:
            u = Vector((1, 0, 0)) if abs(n.z) > 0.95 else Vector((0, 0, 1)).cross(n).normalized()
        v = n.cross(u)
        coords = [(p.dot(u), p.dot(v)) for p in pts]
        if spec.fit:
            us, vs = [c[0] for c in coords], [c[1] for c in coords]
            du, dv = (max(us) - min(us)) or 1, (max(vs) - min(vs)) or 1
            return [((a - min(us)) / du, (b - min(vs)) / dv) for a, b in coords]
        return [(a / spec.scale, b / spec.scale) for a, b in coords]

    # -- output ------------------------------------------------------------
    def to_mesh(self, name):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        uv = mesh.uv_layers.new(name='UVMap')
        uv.data.foreach_set('uv', [c for p in self.uvs for c in p])
        for mat in self._mat_names:
            mesh.materials.append(materials.get(mat))
        mesh.polygons.foreach_set('material_index', self.face_mats)
        mesh.polygons.foreach_set('use_smooth', self.face_smooth)
        shade = mesh.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
        shade.data.foreach_set('color', [c for v in self.colors for c in (v, v, v, 1.0)])
        if any(self.face_smooth):
            bm = bmesh.new()
            bm.from_mesh(mesh)
            bm.verts.ensure_lookup_table()
            weld = {v for f in bm.faces if f.smooth for v in f.verts}
            # Stable weld order avoids float-rounding drift from BMVert's address hash.
            bmesh.ops.remove_doubles(bm, verts=sorted(weld, key=lambda v: v.index), dist=1e-4)
            bm.to_mesh(mesh)
            bm.free()
        mesh.validate()
        mesh.update()
        return mesh
