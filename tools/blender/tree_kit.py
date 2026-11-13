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
    def __init__(self, points, radii, depth, kind='branch', parent=None):
        self.points = points
        self.radii = radii
        self.depth = depth
        self.kind = kind
        self.parent = parent
        self.uncapped_tip = False
        self.base_tangent = None
        self.nominal_radius = radii[0] if radii else 0.05


def jitter(rng, scale):
    return Vector((rng.gauss(0, scale), rng.gauss(0, scale), rng.gauss(0, scale)))


def perpendicular(direction):
    other = Vector((0, 0, 1)) if abs(direction.z) < 0.9 else Vector((1, 0, 0))
    return direction.cross(other).normalized()


def grow(rng, start, direction, length, radius, depth, spec, out, tip_radius=None, parent=None):
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
    branch = Branch(points, radii, depth, parent=parent)
    out.append(branch)
    if depth >= spec['max_depth'] or radius < spec['min_radius']:
        return branch
    count = spec['children'][min(depth, 4)]
    golden = rng.uniform(0, 6.28)
    for k in range(count):
        # Anchor the final child at the parent tip (1.0) so limbs divide into terminal
        # shoots instead of ending as thick amputated logs past their last side branch.
        t = 1.0 if (k == count - 1 and count >= 2) else rng.uniform(spec['child_start'][min(depth, 4)], 0.92)
        index = min(len(points) - 1, max(1, round(t * (len(points) - 1))))
        parent_dir = (points[index] - points[index - 1]).normalized()
        side = perpendicular(parent_dir)
        golden += 2.39996
        side.rotate(Matrix.Rotation(golden, 3, parent_dir))
        angle_range = spec['angle'][min(depth, 4)]
        angle = math.radians(rng.uniform(*angle_range) * (0.55 if index == len(points) - 1 else 1.0))
        child_dir = (parent_dir * math.cos(angle) + side * math.sin(angle)).normalized()
        child_len = length * rng.uniform(*spec['ratio']) * (1.15 - 0.35 * (index / (len(points) - 1)))
        child_radius = radii[index] * (rng.uniform(0.62, 0.78) if index == len(points) - 1 else rng.uniform(0.45, 0.68))
        if child_radius < spec['min_radius'] * 0.6:
            continue
        grow(rng, points[index], child_dir, child_len, child_radius, depth + 1, spec, out, parent=branch)
    return branch


def _closest_point_on_branch(branch, pt):
    """Return (closest_point, interp_radius, tangent, arc_fraction) on `branch` to `pt`."""
    pts, radii = branch.points, branch.radii
    best_dist = 1e18
    best = (pts[0].copy(), radii[0], (pts[1] - pts[0]).normalized(), 0.0)
    total_len = sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)) or 1.0
    acc = 0.0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        seg_len_sq = ab.length_squared
        t = max(0.0, min(1.0, (pt - a).dot(ab) / seg_len_sq)) if seg_len_sq > 1e-8 else 0.0
        q = a + ab * t
        dist = (pt - q).length_squared
        if dist < best_dist:
            best_dist = dist
            r = radii[i] + (radii[i + 1] - radii[i]) * t
            tang = ab.normalized() if seg_len_sq > 1e-8 else Vector((0, 0, 1))
            frac = (acc + ab.length * t) / total_len
            best = (q, r, tang, frac)
        acc += ab.length
    return best


def _tube_sides_for(branch):
    if getattr(branch, 'forced_sides', None):
        return branch.forced_sides
    r0 = getattr(branch, 'nominal_radius', branch.radii[0])
    return 14 if r0 > 0.5 else 8 if r0 > 0.2 else 5 if r0 > 0.08 else 3


def _translate_subtree(branch, delta, children_map):
    branch.points = [p + delta for p in branch.points]
    for child in children_map.get(id(branch), ()):
        _translate_subtree(child, delta, children_map)


def weld_skeleton_junctions(branches, add_collars=True, snag=False):
    """Snap child branches onto their parent's actual segments, eliminate blunt
    amputated limb tips, flare apical forks so no horizontal trunk cap is exposed,
    and seat lateral branches with flared collars."""
    if not branches:
        return branches
    # Identify parent for each branch (depth > 0 and kind == 'branch')
    children_map = {id(b): [] for b in branches}
    for b in branches:
        if b.depth <= 0 or getattr(b, 'kind', 'branch') != 'branch':
            continue
        parent = getattr(b, 'parent', None)
        if parent not in branches:
            # Find closest lower-depth branch
            candidates = [p for p in branches if p.depth < b.depth and getattr(p, 'kind', 'branch') in ('branch', 'trunk')]
            if not candidates:
                continue
            parent = min(candidates, key=lambda p: (_closest_point_on_branch(p, b.points[0])[0] - b.points[0]).length_squared)
            b.parent = parent
        if parent is not None:
            children_map[id(parent)].append(b)

    # Process top-down by depth so parent translations propagate to descendants
    for parent in sorted(branches, key=lambda b: b.depth):
        kids = children_map.get(id(parent), [])
        if not kids:
            # Terminal shoot with no children: taper its last segments smoothly if not a snag
            if not snag and parent.depth >= 1 and len(parent.radii) >= 3:
                parent.radii[-1] = min(parent.radii[-1], max(0.014, parent.radii[0] * 0.24))
                parent.radii[-2] = min(parent.radii[-2], 0.5 * (parent.radii[-3] + parent.radii[-1]))
            continue

        p_tip = parent.points[-1]
        r_tip = parent.radii[-1]
        t_tip = (parent.points[-1] - parent.points[-2]).normalized()

        apical_kids = []
        lateral_kids = []
        max_frac = 0.0
        for c in kids:
            q, r_p, tang_p, frac = _closest_point_on_branch(parent, c.points[0])
            delta = q - c.points[0]
            if delta.length > 1e-5:
                _translate_subtree(c, delta, children_map)
            max_frac = max(max_frac, frac)
            if frac > 0.93 or (q - p_tip).length <= r_tip * 1.15:
                apical_kids.append(c)
            else:
                lateral_kids.append((c, q, r_p, tang_p, frac))

        # If no apical kids exist on a non-snag limb, taper the parent past its last lateral child
        if not apical_kids and not snag and parent.depth >= 1 and len(parent.points) >= 4:
            parent.radii[-1] = min(parent.radii[-1], max(0.016, parent.radii[0] * 0.25))

        # Handle apical fork: flare the fork limbs from the parent's exact ring at p_base
        if apical_kids:
            parent.uncapped_tip = True
            p_base = p_tip - t_tip * (r_tip * 0.90)
            r_base = r_tip * 0.98
            parent_sides = _tube_sides_for(parent)
            for c in apical_kids:
                if len(c.points) < 2:
                    continue
                if (c.points[0] - p_tip).length > 1e-4:
                    _translate_subtree(c, p_tip - c.points[0], children_map)
                d_c = (c.points[1] - c.points[0]).normalized()
                seg1_len = (c.points[1] - p_tip).length
                r_c = c.radii[0]
                u_c = d_c - t_tip * d_c.dot(t_tip)
                u_c = u_c.normalized() if u_c.length > 1e-4 else perpendicular(t_tip)

                if parent.depth == 0 and parent_sides <= 8:
                    c.forced_sides = parent_sides
                elif _tube_sides_for(c) < parent_sides and r_c > 0.12:
                    c.forced_sides = min(8, parent_sides)

                if (add_collars or parent.depth == 0) and len(c.points) >= 3:
                    r_crotch = max(r_c * 1.12, r_tip * 0.74)
                    p_crotch = p_tip + u_c * max(0.0, (r_tip * 0.94 - r_crotch)) + d_c * (r_tip * 0.12)
                    neck_dist = min(seg1_len * 0.55, r_tip * 0.95)
                    if add_collars and seg1_len > r_tip * 1.35:
                        p_neck = p_tip.lerp(c.points[1], neck_dist / max(seg1_len, 1e-4))
                        r_neck = r_c + (c.radii[1] - r_c) * (neck_dist / max(seg1_len, 1e-4))
                        c.points = [p_base.copy(), p_crotch, p_neck] + c.points[1:]
                        c.radii = [r_base, r_crotch, r_neck] + c.radii[1:]
                    else:
                        c.points = [p_base.copy(), p_crotch] + c.points[1:]
                        c.radii = [r_base, r_crotch] + c.radii[1:]
                    c.base_tangent = t_tip
                else:
                    r_crotch = max(r_c * 1.14, r_tip * 0.76)
                    c.points[0] = p_base.copy()
                    c.radii[0] = r_base
                    c.base_tangent = t_tip

            # End the parent bole at p_base + a short internal taper so it never pokes outside p_base..p_crotch
            if len(parent.points) >= 3 and (parent.points[-1] - parent.points[-2]).length > r_tip * 1.1:
                parent.points[-1] = p_base.copy()
                parent.radii[-1] = r_base
                parent.points.append(p_tip - t_tip * (r_tip * 0.15))
                parent.radii.append(r_tip * 0.55)
            else:
                parent.radii[-1] = r_tip * 0.58

        # Handle lateral branch collars
        for c, q, r_p, tang_p, _ in lateral_kids:
            if len(c.points) < 2:
                continue
            d_c = (c.points[1] - c.points[0]).normalized()
            seg1_len = (c.points[1] - q).length
            r_c = min(c.radii[0], r_p * 0.78)
            c.radii[0] = r_c
            sin_a = max(0.38, math.sqrt(max(0.0, 1.0 - min(1.0, abs(d_c.dot(tang_p))) ** 2)))
            s_surf = min(r_p * 1.10, max(r_p * 0.42, r_p / sin_a))
            p_anchor = q + d_c * (s_surf * 0.40)
            r_anchor = min(r_p * 0.86, max(r_c * 1.36, r_c + r_p * 0.14))
            collar_dist = s_surf + r_c * 0.55
            p_collar = q + d_c * collar_dist
            r_collar = r_c

            if add_collars and len(c.points) >= 3 and seg1_len > collar_dist + r_c * 0.35:
                c.points = [p_anchor, p_collar] + c.points[1:]
                c.radii = [r_anchor, r_collar] + c.radii[1:]
            else:
                c.points[0] = p_anchor
                c.radii[0] = r_anchor
                if seg1_len < s_surf + r_c * 0.25 and len(c.points) == 2:
                    c.points[1] = q + d_c * max(seg1_len, s_surf + r_c * 0.6)
    return branches


# ---------------------------------------------------------------- mesh

def tube_mesh(bm, uv_layer, branch, radius_scale=None):
    """A manifold tube along `branch`; `radius_scale(z, theta)` reshapes a bole."""
    pts, radii = branch.points, branch.radii
    r0 = getattr(branch, 'nominal_radius', radii[0])
    sides = _tube_sides_for(branch)
    rings = []
    ring_meta = []
    quad_faces_by_seg = []
    init_d = getattr(branch, 'base_tangent', None) or (pts[1] - pts[0]).normalized()
    normal = perpendicular(init_d)
    length_acc = 0.0
    circumference = 2 * math.pi * max(r0, 0.05)
    for i, p in enumerate(pts):
        if i == 0 and getattr(branch, 'base_tangent', None) is not None:
            d = branch.base_tangent
        else:
            d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        normal = (normal - d * normal.dot(d)).normalized()
        binormal = d.cross(normal)
        if i > 0:
            length_acc += (pts[i] - pts[i - 1]).length
        v_coord = length_acc / circumference
        ring_verts = []
        for s in range(sides):
            theta = s / sides * 2 * math.pi
            r = radii[i]
            if radius_scale:
                r *= radius_scale(p.z, theta)
            offset = normal * math.cos(theta) * r + binormal * math.sin(theta) * r
            ring_verts.append(bm.verts.new(p + offset))
        rings.append((ring_verts, v_coord))
        ring_meta.append({
            'verts': ring_verts,
            'v_coord': v_coord,
            'center': p.copy(),
            'radius': radii[i],
            'normal': normal.copy(),
            'binormal': binormal.copy(),
        })
    for seg_i, ((a_verts, v_a), (b_verts, v_b)) in enumerate(zip(rings[:-1], rings[1:])):
        seg_faces = []
        for s in range(sides):
            s_next = (s + 1) % sides
            u0, u1 = s / sides, (s + 1) / sides
            face = bm.faces.new((a_verts[s], a_verts[s_next], b_verts[s_next], b_verts[s]))
            for loop, uv in zip(face.loops, ((u0, v_a), (u1, v_a), (u1, v_b), (u0, v_b))):
                loop[uv_layer].uv = uv
            seg_faces.append(face)
        quad_faces_by_seg.append(seg_faces)
    branch._bm_ring_meta = ring_meta
    branch._bm_seg_faces = quad_faces_by_seg
    branch._bm_sides = sides
    # Cap the tip unless this branch divides into an apical fork
    tip_verts, v_tip = rings[-1]
    tip_dir = (pts[-1] - pts[-2]).normalized()
    tip_ext = 0.15 if getattr(branch, 'uncapped_tip', False) else 0.5
    centre = bm.verts.new(pts[-1] + tip_dir * radii[-1] * tip_ext)
    for s in range(sides):
        s_next = (s + 1) % sides
        u0, u1 = s / sides, (s + 1) / sides
        face = bm.faces.new((tip_verts[s], tip_verts[s_next], centre))
        for loop, uv in zip(face.loops, ((u0, v_tip), (u1, v_tip), (0.5 * (u0 + u1), v_tip + 0.08))):
            loop[uv_layer].uv = uv


def add_root_spurs(bm, uv_layer, trunk, spurs, trunk_scale=None, steps=5):
    """Replace the lower trunk rings with a single, continuous, high-resolution manifold
    root-flare and buttress skirt stitched directly to the trunk tube so roots flow
    organically out of the bole with zero intersecting tent meshes."""
    if not spurs:
        return
    ring_meta = getattr(trunk, '_bm_ring_meta', None)
    seg_faces = getattr(trunk, '_bm_seg_faces', None)
    sides = getattr(trunk, '_bm_sides', None)
    if not ring_meta or not seg_faces or not sides or len(ring_meta) < 3:
        return

    max_up = max(spur.get('up', 0.8) for spur in spurs)
    # Find the ring on the trunk at or just above the top of the root-flare zone
    join_idx = 1
    for idx in range(1, len(ring_meta) - 1):
        if ring_meta[idx]['center'].z >= max_up * 0.92:
            join_idx = idx
            break
    else:
        join_idx = max(1, len(ring_meta) - 2)

    join_ring = ring_meta[join_idx]
    z_join = max(join_ring['center'].z, 0.25)
    v_join = join_ring['v_coord']
    join_verts = join_ring['verts']

    # Delete the coarse lower trunk faces and vertices below join_idx
    for idx in range(join_idx):
        for f in seg_faces[idx]:
            if f.is_valid:
                bm.faces.remove(f)
    for idx in range(join_idx):
        for v in ring_meta[idx]['verts']:
            if v.is_valid:
                bm.verts.remove(v)

    pts, radii = trunk.points, trunk.radii

    def interp_trunk(z_val):
        if z_val <= pts[0].z:
            return ring_meta[0]['center'].copy(), ring_meta[0]['radius'], ring_meta[0]['normal'], ring_meta[0]['binormal']
        for k in range(len(pts) - 1):
            z0, z1 = pts[k].z, pts[k + 1].z
            if z0 <= z_val <= z1 or k == len(pts) - 2:
                span = max(z1 - z0, 1e-5)
                t = max(0.0, min(1.0, (z_val - z0) / span))
                c = ring_meta[k]['center'].lerp(ring_meta[k + 1]['center'], t)
                r = ring_meta[k]['radius'] + (ring_meta[k + 1]['radius'] - ring_meta[k]['radius']) * t
                n = ring_meta[k]['normal'].lerp(ring_meta[k + 1]['normal'], t).normalized()
                b = ring_meta[k]['binormal'].lerp(ring_meta[k + 1]['binormal'], t).normalized()
                return c, r, n, b
        return ring_meta[-1]['center'].copy(), ring_meta[-1]['radius'], ring_meta[-1]['normal'], ring_meta[-1]['binormal']

    _, r_ref, _, _ = interp_trunk(min(z_join, max(0.4, z_join * 0.65)))
    circumference = 2.0 * math.pi * max(r_ref, 0.08)

    # Double the circumferential resolution in the root flare so each root ridge and sinus is smooth
    flare_sides = sides * 2
    n_lobes = max(len(spurs), 3)
    # Angular half-width of each root lobe: narrower on buttressed trees so deep valleys remain between roots
    base_ang_w = min(0.36, math.pi / (n_lobes * 1.45))

    # Vertical stations from z_join down to -0.14, clustered near the ground for a smooth concave J-curve
    z_bottom = min(-0.14, pts[0].z)
    h_fracs = [0.80, 0.58, 0.38, 0.22, 0.09, 0.0]
    z_stations = [z_join * hf for hf in h_fracs] + [z_bottom]

    flare_rings = []
    for z_st in z_stations:
        c_st, r_st, n_st, b_st = interp_trunk(z_st)
        h_global = min(1.0, max(0.0, z_st) / z_join)
        # Smooth blend to exact trunk_scale at h_global == 1.0
        flare_env = (1.0 - h_global)
        # Gentle valley/collar swell right at the base so sinuses between roots curve into the ground
        h_collar = min(1.0, max(0.0, z_st) / max(0.25, z_join * 0.45))
        valley_swell = 1.0 + 0.18 * ((1.0 - h_collar) ** 2.4)

        v_coord = v_join - (z_join - z_st) / circumference
        ring_verts = []
        for s in range(flare_sides):
            theta_0 = (s / flare_sides) * 2.0 * math.pi
            # Warp theta slightly toward nearby spur centerlines as the root extends outward
            # so root ridges stay narrow and cylindrical instead of fanning out with radius.
            theta_shift = 0.0
            for spur in spurs:
                up_k = max(0.25, min(z_join, spur.get('up', z_join * 0.85)))
                h_k = min(1.0, max(0.0, z_st) / up_k)
                if h_k >= 1.0:
                    continue
                curv_k = spur.get('curve', 0.0)
                az_k = spur['angle'] + curv_k * ((1.0 - h_k) ** 1.45)
                dth = math.atan2(math.sin(theta_0 - az_k), math.cos(theta_0 - az_k))
                pinch_env = ((1.0 - h_k) ** 1.35) * math.exp(-((dth / (base_ang_w * 1.55)) ** 2))
                theta_shift -= 0.46 * dth * pinch_env
            theta = theta_0 + theta_shift

            # Baseline trunk radius at (z_st, theta)
            r_trunk_here = r_st * (trunk_scale(max(0.0, z_st), theta) if trunk_scale else 1.0)
            # Tame excessive trunk_scale flare near the ground when explicit spurs are present
            r_valley = r_st * valley_swell
            r_base_blend = r_trunk_here * (h_global ** 1.4) + min(r_trunk_here, r_valley * 1.12) * (1.0 - (h_global ** 1.4))

            # Evaluate concave J-curve root extension across all spurs
            ext_total = 0.0
            droop_z = 0.0
            for spur in spurs:
                up_k = max(0.25, min(z_join, spur.get('up', z_join * 0.85)))
                h_k = min(1.0, max(0.0, z_st) / up_k)
                if h_k >= 1.0:
                    continue
                curv_k = spur.get('curve', 0.0)
                az_k = spur['angle'] + curv_k * ((1.0 - h_k) ** 1.45)
                dth = math.atan2(math.sin(theta - az_k), cos_val := math.cos(theta - az_k))
                # Narrower angular profile near the toe, slightly broader where it joins the bole
                ang_w = base_ang_w * (0.72 + 0.28 * h_k)
                if abs(dth) >= ang_w * 1.75:
                    continue
                lobe = math.exp(-((dth / ang_w) ** 2)) * (math.cos(min(math.pi * 0.5, abs(dth) / (ang_w * 1.75))) ** 2)
                # Cap spur reach to a realistic proportion of the trunk radius so roots never look like giant sails
                raw_out = spur.get('out', r_ref * 0.9)
                eff_out = min(raw_out, r_ref * 1.45 + 0.25 * raw_out)
                # Two-stage concave J-curve: subtle upper trunk flute + low ground-hugging root runner
                h_low = min(1.0, max(0.0, z_st) / max(0.18, up_k * 0.42))
                j_curve = 0.26 * ((1.0 - h_k) ** 2.5) + 0.74 * ((1.0 - h_low) ** 2.35)
                # Below grade (z_st < 0), tuck the root toe slightly inward and downward into the soil
                sub_grade = max(0.0, -z_st / max(0.05, -z_bottom))
                toe_tuck = 1.0 - 0.08 * (sub_grade ** 1.5)
                ext_k = eff_out * j_curve * lobe * toe_tuck
                if ext_k > ext_total:
                    ext_total = ext_k
                # Gentle dorsal arch/droop at the outer root tip near the ground
                if z_st > 0.0 and h_low < 1.0:
                    droop_z = max(droop_z, min(z_st * 0.55, 0.09 * lobe * ((1.0 - h_low) ** 2.2)))

            r_final = r_base_blend + ext_total * (1.0 - (h_global ** 3.0))
            radial_vec = n_st * math.cos(theta) + b_st * math.sin(theta)
            v_pos = Vector((c_st.x, c_st.y, z_st - droop_z)) + radial_vec * r_final
            ring_verts.append(bm.verts.new(v_pos))
        flare_rings.append((ring_verts, v_coord))

    # Stitch join_verts (sides) to flare_rings[0] (flare_sides = 2 * sides) with a manifold 1-to-2 transition strip
    first_flare_verts, v_first = flare_rings[0]
    for s in range(sides):
        s_next = (s + 1) % sides
        f0 = (2 * s) % flare_sides
        f1 = (2 * s + 1) % flare_sides
        f2 = (2 * s + 2) % flare_sides
        u_top0, u_top1 = s / sides, (s + 1) / sides
        u_bot0, u_bot1, u_bot2 = (2 * s) / flare_sides, (2 * s + 1) / flare_sides, (2 * s + 2) / flare_sides

        # Triangle 1: (first_flare[f0], first_flare[f1], join_verts[s])
        t1 = bm.faces.new((first_flare_verts[f0], first_flare_verts[f1], join_verts[s]))
        for loop, uv in zip(t1.loops, ((u_bot0, v_first), (u_bot1, v_first), (u_top0, v_join))):
            loop[uv_layer].uv = uv

        # Quad: (first_flare[f1], first_flare[f2], join_verts[s_next], join_verts[s])
        q1 = bm.faces.new((first_flare_verts[f1], first_flare_verts[f2], join_verts[s_next], join_verts[s]))
        for loop, uv in zip(q1.loops, ((u_bot1, v_first), (u_bot2, v_first), (u_top1, v_join), (u_top0, v_join))):
            loop[uv_layer].uv = uv

    # Connect consecutive flare_rings from top (index 0) down to bottom (index -1) with quad strips
    # Note: in tube_mesh, rings go from bottom (a_verts) to top (b_verts) with winding (a[s], a[s+1], b[s+1], b[s]).
    # Since flare_rings is ordered from top to bottom, upper is b_verts and lower is a_verts!
    for (b_verts, v_b), (a_verts, v_a) in zip(flare_rings[:-1], flare_rings[1:]):
        for s in range(flare_sides):
            s_next = (s + 1) % flare_sides
            u0, u1 = s / flare_sides, (s + 1) / flare_sides
            face = bm.faces.new((a_verts[s], a_verts[s_next], b_verts[s_next], b_verts[s]))
            for loop, uv in zip(face.loops, ((u0, v_a), (u1, v_a), (u1, v_b), (u0, v_b))):
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
