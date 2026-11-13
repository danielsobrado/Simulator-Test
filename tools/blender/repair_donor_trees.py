"""Repair donor meadow (tree1..9) and alpine (tree10..11) bark meshes."""

from __future__ import annotations

import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree


def _connected_components(bm: bmesh.types.BMesh) -> list[list[bmesh.types.BMVert]]:
    bm.verts.ensure_lookup_table()
    visited: set[int] = set()
    comps: list[list[bmesh.types.BMVert]] = []
    for v in bm.verts:
        if v.index in visited:
            continue
        comp: list[bmesh.types.BMVert] = []
        stack = [v]
        visited.add(v.index)
        while stack:
            curr = stack.pop()
            comp.append(curr)
            for e in curr.link_edges:
                other = e.other_vert(curr)
                if other.index not in visited:
                    visited.add(other.index)
                    stack.append(other)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    return comps


def _trunk_slice_center_radius(
    trunk_verts: list[bmesh.types.BMVert], z: float, window: float
) -> tuple[float, float, float]:
    pts = [v.co for v in trunk_verts if abs(v.co.z - z) <= window]
    if not pts:
        nearest = min(trunk_verts, key=lambda v: abs(v.co.z - z))
        pts = [v.co for v in trunk_verts if abs(v.co.z - nearest.co.z) <= window]
    cx = sum(p.x for p in pts) / len(pts)
    cy = sum(p.y for p in pts) / len(pts)
    radii = sorted(math.hypot(p.x - cx, p.y - cy) for p in pts)
    r = radii[len(radii) // 2] if radii else 0.12
    return cx, cy, max(r, 1e-4)


def _add_donor_root_spurs(
    bm: bmesh.types.BMesh,
    uv_layer: bmesh.types.BMLayerItem,
    trunk_verts: list[bmesh.types.BMVert],
    t_min_z: float,
    t_height: float,
    seed: int,
    n_spurs: int = 5,
    steps: int = 3,
) -> None:
    """Subdivide the lower donor trunk and sculpt its own vertices into a single-surface,
    concave J-curved root flare with narrow, rounded root ridges and zero intersecting tent meshes."""
    trunk_set = set(trunk_verts)
    subdiv_top_z = t_min_z + 0.14 * t_height
    low_edges = [
        e
        for e in bm.edges
        if e.verts[0] in trunk_set
        and e.verts[1] in trunk_set
        and max(e.verts[0].co.z, e.verts[1].co.z) <= subdiv_top_z
    ]
    if low_edges:
        bmesh.ops.subdivide_edges(bm, edges=low_edges, cuts=1, use_grid_fill=True)

    comps = _connected_components(bm)
    sculpt_verts = [
        v
        for comp in comps
        if min(u.co.z for u in comp) <= t_min_z + 0.05 * t_height
        for v in comp
    ] or comps[0]

    foot_cx, foot_cy, foot_r = _trunk_slice_center_radius(
        sculpt_verts, t_min_z + 0.025 * t_height, window=0.03 * t_height
    )
    mid_cx, mid_cy, mid_r = _trunk_slice_center_radius(
        sculpt_verts, t_min_z + 0.16 * t_height, window=0.035 * t_height
    )
    ref_r = max(mid_r, foot_r * 0.75, 0.02 * t_height)
    flare_top_z = t_min_z + 0.19 * t_height
    base_ang_w = min(0.36, math.pi / (n_spurs * 1.45))

    spurs = []
    for s_idx in range(n_spurs):
        angle = (2.0 * math.pi * s_idx) / n_spurs + ((seed * 0.618 + s_idx * 0.29) % 0.36 - 0.18)
        up_h = t_height * (0.16 + 0.025 * math.cos(seed * 1.3 + s_idx * 1.9))
        out_r = ref_r * (0.92 + 0.18 * math.sin(seed * 1.7 + s_idx * 2.1))
        curv = 0.14 * math.sin(seed * 2.1 + s_idx * 1.5)
        spurs.append((angle, up_h, out_r, curv))

    for v in sculpt_verts:
        z_rel = v.co.z - t_min_z
        if z_rel < flare_top_z - t_min_z:
            u_axis = max(0.0, min(1.0, z_rel / max(1e-4, 0.16 * t_height)))
            cx = foot_cx * (1.0 - u_axis) + mid_cx * u_axis
            cy = foot_cy * (1.0 - u_axis) + mid_cy * u_axis
            dx = v.co.x - cx
            dy = v.co.y - cy
            r_orig = math.hypot(dx, dy)
            if r_orig > 1e-5:
                theta_0 = math.atan2(dy, dx)
                theta_shift = 0.0
                for angle, up_h, _, curv in spurs:
                    h_k = max(0.0, min(1.0, z_rel / max(1e-4, up_h)))
                    if h_k >= 1.0:
                        continue
                    az_k = angle + curv * ((1.0 - h_k) ** 1.45)
                    dth = math.atan2(math.sin(theta_0 - az_k), math.cos(theta_0 - az_k))
                    pinch_env = ((1.0 - h_k) ** 1.35) * math.exp(-((dth / (base_ang_w * 1.55)) ** 2))
                    theta_shift -= 0.44 * dth * pinch_env
                theta = theta_0 + theta_shift

                h_collar = max(0.0, min(1.0, z_rel / max(1e-4, 0.09 * t_height)))
                valley_swell = 1.0 + 0.22 * ((1.0 - h_collar) ** 2.4)

                ext_total = 0.0
                for angle, up_h, out_r, curv in spurs:
                    h_k = max(0.0, min(1.0, z_rel / max(1e-4, up_h)))
                    if h_k >= 1.0:
                        continue
                    az_k = angle + curv * ((1.0 - h_k) ** 1.45)
                    dth = math.atan2(math.sin(theta - az_k), math.cos(theta - az_k))
                    ang_w = base_ang_w * (0.72 + 0.28 * h_k)
                    if abs(dth) >= ang_w * 1.75:
                        continue
                    lobe = math.exp(-((dth / ang_w) ** 2)) * (
                        math.cos(min(math.pi * 0.5, abs(dth) / (ang_w * 1.75))) ** 2
                    )
                    h_low = max(0.0, min(1.0, z_rel / max(1e-4, up_h * 0.42)))
                    j_curve = 0.26 * ((1.0 - h_k) ** 2.5) + 0.74 * ((1.0 - h_low) ** 2.35)
                    ext_k = out_r * j_curve * lobe
                    if ext_k > ext_total:
                        ext_total = ext_k

                r_new = r_orig * valley_swell + ext_total
                v.co.x = cx + math.cos(theta) * r_new
                v.co.y = cy + math.sin(theta) * r_new
        if v.co.z < t_min_z + 0.008 * t_height:
            v.co.z = t_min_z - 0.010 * t_height



def _collar_branch_by_boundary_rings(
    comp: list[bmesh.types.BMVert],
    parent_verts: list[bmesh.types.BMVert],
    tree_height: float,
    collar_scales: tuple[float, float, float] = (0.78, 1.28, 1.10),
) -> None:
    """Seat and flare a tubular branch component using its exact base boundary ring."""
    kd = KDTree(len(parent_verts))
    for i, pv in enumerate(parent_verts):
        kd.insert(pv.co, i)
    kd.balance()

    comp_set = set(comp)
    boundary_verts = [v for v in comp if v.is_boundary]
    search_verts = boundary_verts if boundary_verts else comp

    best_v = None
    best_parent_co = None
    best_dist = 1e9
    for v in search_verts:
        co, _, dist = kd.find(v.co)
        if dist < best_dist:
            best_dist = dist
            best_v = v
            best_parent_co = co.copy()

    if best_v is None or best_parent_co is None:
        return

    # 1. Walk boundary edges from best_v within base radius to collect the exact base ring (ring 0)
    max_ring0_span = 0.05 * tree_height
    ring0: list[bmesh.types.BMVert] = []
    visited: set[bmesh.types.BMVert] = {best_v}
    stack = [best_v]
    while stack:
        curr = stack.pop()
        ring0.append(curr)
        for e in curr.link_edges:
            if e.is_boundary:
                other = e.other_vert(curr)
                if (
                    other in comp_set
                    and other not in visited
                    and (other.co - best_v.co).length <= max_ring0_span
                ):
                    visited.add(other)
                    stack.append(other)

    # Fallback if the base wasn't an open boundary loop
    if len(ring0) < 3:
        ring0 = [v for v in comp if (v.co - best_v.co).length <= 0.025 * tree_height]
        visited = set(ring0)

    # 2. Step 1 edge-hop from ring0 to get ring1, and 1 edge-hop from ring1 to get ring2
    ring1: list[bmesh.types.BMVert] = []
    for v in ring0:
        for e in v.link_edges:
            other = e.other_vert(v)
            if (
                other in comp_set
                and other not in visited
                and (other.co - best_v.co).length <= 0.11 * tree_height
            ):
                visited.add(other)
                ring1.append(other)

    ring2: list[bmesh.types.BMVert] = []
    for v in ring1:
        for e in v.link_edges:
            other = e.other_vert(v)
            if (
                other in comp_set
                and other not in visited
                and (other.co - best_v.co).length <= 0.17 * tree_height
            ):
                visited.add(other)
                ring2.append(other)

    ring0_center = sum((v.co for v in ring0), Vector((0.0, 0.0, 0.0))) / len(ring0)
    ring0_radius = sum((v.co - ring0_center).length for v in ring0) / len(ring0)

    # Estimate parent center at attachment height
    p_window = max(0.025 * tree_height, ring0_radius * 2.5)
    p_neighbors = [pv.co for pv in parent_verts if abs(pv.co.z - ring0_center.z) <= p_window]
    if not p_neighbors:
        p_neighbors = [pv.co for pv in parent_verts if (pv.co - best_parent_co).length <= p_window * 2.0]
    parent_center = (
        sum(p_neighbors, Vector((0.0, 0.0, 0.0))) / len(p_neighbors)
        if p_neighbors
        else best_parent_co
    )

    # Seat target pulls ring0 inside the parent axis so open ring0 never pokes out
    seat_target = best_parent_co.lerp(parent_center, 0.82)
    seat_delta = seat_target - ring0_center
    max_pull = max(ring0_radius * 2.6, 0.032 * tree_height)
    if seat_delta.length > max_pull:
        seat_delta = seat_delta.normalized() * max_pull

    rings = (ring0, ring1, ring2)
    pull_weights = (1.0, 0.42, 0.12)
    for h in (0, 1, 2):
        r_verts = rings[h]
        if len(r_verts) < 3:
            continue
        rc = sum((v.co for v in r_verts), Vector((0.0, 0.0, 0.0))) / len(r_verts)
        scale = collar_scales[h]
        pull = seat_delta * pull_weights[h]
        for v in r_verts:
            v.co = rc + (v.co - rc) * scale + pull


def repair_meadow_tree(idx: int, donor_dir: Path, existing_dir: Path, out_dir: Path) -> None:
    donor_path = donor_dir / f"tree{idx}.glb"
    existing_path = existing_dir / f"tree{idx}.glb"
    out_path = out_dir / f"tree{idx}.glb"

    bpy.ops.wm.read_factory_settings(use_empty=True)

    # 1. Import existing prepared runtime source
    bpy.ops.import_scene.gltf(filepath=str(existing_path))
    existing_objs = list(bpy.context.selected_objects)
    existing_bark = None
    for obj in existing_objs:
        if obj.type == "MESH":
            mats = [m.name for m in obj.data.materials if m]
            if "Meadow bark" in mats or obj.name.startswith("Mesh_0") or "Branches" in obj.name:
                existing_bark = obj
                break
    if existing_bark is None:
        raise RuntimeError(f"tree{idx}: could not find bark mesh in {existing_path}")

    bark_mat = existing_bark.data.materials[0]
    bark_node_name = existing_bark.name

    # 2. Import raw un-decimated donor from grass-test
    bpy.ops.import_scene.gltf(filepath=str(donor_path))
    donor_objs = [o for o in bpy.context.selected_objects if o not in existing_objs]
    donor_bark = None
    for obj in donor_objs:
        if obj.type == "MESH":
            mats = [m.name.lower() for m in obj.data.materials if m]
            if any("branch" in m for m in mats) or obj.data.name.startswith("Mesh_0"):
                donor_bark = obj
                break
    if donor_bark is None:
        raise RuntimeError(f"tree{idx}: could not find donor Mesh_0 in {donor_path}")

    old_bark_mesh = existing_bark.data
    existing_bark.data = donor_bark.data.copy()
    existing_bark.name = bark_node_name
    existing_bark.data.name = "Mesh_0"
    existing_bark.data.materials.clear()
    existing_bark.data.materials.append(bark_mat)

    for obj in donor_objs:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(old_bark_mesh, do_unlink=True)

    mesh = existing_bark.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    uv_layer = bm.loops.layers.uv.active or bm.loops.layers.uv.verify()

    # Weld duplicate glTF UV-seam vertices while preserving per-loop UVs
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)

    # Bake KHR_texture_transform scale=[1, 0.2] for trees 4..9
    if idx >= 4:
        for f in bm.faces:
            for loop in f.loops:
                uv = loop[uv_layer].uv
                loop[uv_layer].uv = (uv.x, 1.0 - (1.0 - uv.y) * 0.2)

    all_zs = [v.co.z for v in bm.verts]
    global_max_z = max(all_zs)
    tree_height = max(1.0, global_max_z)

    comps = _connected_components(bm)

    # Identify trunk components:
    # - comps[0] is ALWAYS either the single-piece trunk (tree2, 3, 4: min_z ~ 0, max_z == global_max_z)
    #   or upper_trunk (tree1, 5, 6, 7, 8, 9: min_z ~ 0.48..0.65 * tree_height, max_z == global_max_z)
    # - In two-piece trunks, lower_trunk is the component with min_z ~ 0 and max_z ~ min_z(upper_trunk)
    top_trunk = comps[0]
    top_min_z = min(v.co.z for v in top_trunk)

    lower_trunk = None
    upper_trunk = None
    if top_min_z > 0.20 * tree_height:
        upper_trunk = top_trunk
        for comp in comps[1:]:
            zs = [v.co.z for v in comp]
            if len(comp) >= 95 and abs(min(zs)) < 0.02 * tree_height and abs(max(zs) - top_min_z) < 0.05 * tree_height:
                lower_trunk = comp
                break
    else:
        lower_trunk = top_trunk

    # Seamlessly align lower_trunk + upper_trunk across z_join if split
    if upper_trunk is not None and lower_trunk is not None:
        z_join = top_min_z
        ring_win = 0.015 * tree_height
        up_ring = [v for v in upper_trunk if v.is_boundary and abs(v.co.z - z_join) <= ring_win]
        if not up_ring:
            up_ring = [v for v in upper_trunk if abs(v.co.z - z_join) <= ring_win]
        cx = sum(v.co.x for v in up_ring) / max(1, len(up_ring))
        cy = sum(v.co.y for v in up_ring) / max(1, len(up_ring))
        r_up = sum(math.hypot(v.co.x - cx, v.co.y - cy) for v in up_ring) / max(1, len(up_ring))

        low_top = [v for v in lower_trunk if v.is_boundary and abs(v.co.z - z_join) <= ring_win]
        if not low_top:
            low_top = [v for v in lower_trunk if abs(v.co.z - z_join) <= ring_win]
        r_low = sum(math.hypot(v.co.x - cx, v.co.y - cy) for v in low_top) / max(1, len(low_top))

        low_min_z = min(v.co.z for v in lower_trunk)
        low_span = max(0.1, z_join - low_min_z)
        for v in lower_trunk:
            t = max(0.0, min(1.0, (v.co.z - low_min_z) / low_span))
            dx = v.co.x - cx
            dy = v.co.y - cy
            cur_r = math.hypot(dx, dy)
            if cur_r > 1e-4:
                target_top_scale = r_up / max(1e-4, r_low)
                blend = t * t * (3.0 - 2.0 * t)
                scale = (1.0 - blend) * 1.0 + blend * target_top_scale
                v.co.x = cx + dx * scale
                v.co.y = cy + dy * scale

        for v in low_top:
            nearest_u = min(up_ring, key=lambda u: math.hypot(u.co.x - v.co.x, u.co.y - v.co.y))
            v.co = nearest_u.co.copy()
        bmesh.ops.remove_doubles(bm, verts=low_top + up_ring, dist=0.02 * tree_height)

    trunk_verts = list(lower_trunk) + (list(upper_trunk) if upper_trunk is not None else [])
    trunk_set = set(trunk_verts)

    trunk_zs = [v.co.z for v in trunk_verts]
    t_min_z, t_max_z = min(trunk_zs), max(trunk_zs)
    t_height = max(1.0, t_max_z - t_min_z)

    # Filter non-trunk components:
    # - Drop the 7 separate spider-leg root pipes (max_z < 0.08 * t_height)
    # - Drop tiny canopy micro-twigs (len < 115 after remove_doubles)
    # - Keep all primary branches (len >= 115 after remove_doubles)
    drop_verts: set[bmesh.types.BMVert] = set()
    for comp in comps:
        if comp is lower_trunk or comp is upper_trunk:
            continue
        zs = [v.co.z for v in comp]
        if max(zs) < t_min_z + 0.08 * t_height or len(comp) < 115:
            drop_verts.update(comp)

    if drop_verts:
        drop_faces = [f for f in bm.faces if any(v in drop_verts for v in f.verts)]
        bmesh.ops.delete(bm, geom=drop_faces, context="FACES")
        orphan_verts = [v for v in bm.verts if not v.link_faces]
        if orphan_verts:
            bmesh.ops.delete(bm, geom=orphan_verts, context="VERTS")

    # Recompute components: separate trunk components from primary branch components
    comps = _connected_components(bm)
    surviving_trunk: list[bmesh.types.BMVert] = []
    branch_comps: list[list[bmesh.types.BMVert]] = []
    for comp in comps:
        zs = [v.co.z for v in comp]
        if min(zs) < t_min_z + 0.02 * t_height or max(zs) >= global_max_z - 0.01 * t_height:
            surviving_trunk.extend(comp)
        else:
            branch_comps.append(comp)

    branch_comps.sort(key=lambda c: min(v.co.z for v in c))

    parent_verts: list[bmesh.types.BMVert] = list(surviving_trunk)
    for comp in branch_comps:
        _collar_branch_by_boundary_rings(comp, parent_verts, t_height)
        parent_verts.extend(comp)

    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    # Lightly decimate ONLY non-trunk branch vertices so total with 5 root spurs (205 tris) <= 1,980
    total_tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
    if total_tris > 1760:
        bm2 = bmesh.new()
        bm2.from_mesh(mesh)
        comps2 = _connected_components(bm2)
        trunk_indices: set[int] = set()
        for comp in comps2:
            zs = [v.co.z for v in comp]
            if min(zs) < t_min_z + 0.02 * t_height or max(zs) >= global_max_z - 0.01 * t_height:
                trunk_indices.update(v.index for v in comp)
        trunk_tris = sum(
            len(f.verts) - 2 for f in bm2.faces if any(v.index in trunk_indices for v in f.verts)
        )
        bm2.free()

        vg = existing_bark.vertex_groups.new(name="NonTrunk")
        non_trunk_indices = [v.index for v in mesh.vertices if v.index not in trunk_indices]
        vg.add(non_trunk_indices, 1.0, "REPLACE")

        branch_tris = max(1, total_tris - trunk_tris)
        target_branch_tris = max(400, 1750 - trunk_tris)
        ratio = max(0.45, min(0.95, target_branch_tris / branch_tris))

        bpy.context.view_layer.objects.active = existing_bark
        mod = existing_bark.modifiers.new(name="BranchDecimate", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.vertex_group = vg.name
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)
        existing_bark.vertex_groups.clear()

    bm3 = bmesh.new()
    bm3.from_mesh(existing_bark.data)
    uv3 = bm3.loops.layers.uv.active or bm3.loops.layers.uv.verify()
    comps3 = _connected_components(bm3)
    trunk3 = [
        v
        for comp in comps3
        if min( u.co.z for u in comp) < t_min_z + 0.05 * t_height
        for v in comp
    ] or comps3[0]
    _add_donor_root_spurs(bm3, uv3, trunk3, t_min_z, t_height, seed=idx, n_spurs=5, steps=3)
    bmesh.ops.dissolve_degenerate(bm3, dist=1e-5, edges=bm3.edges)
    orphan = [v for v in bm3.verts if not v.link_faces]
    if orphan:
        bmesh.ops.delete(bm3, geom=orphan, context="VERTS")
    bmesh.ops.recalc_face_normals(bm3, faces=bm3.faces)
    bm3.to_mesh(existing_bark.data)
    bm3.free()
    existing_bark.data.update()

    for poly in existing_bark.data.polygons:
        poly.use_smooth = True

    final_bark_tris = sum(len(p.vertices) - 2 for p in existing_bark.data.polygons)
    leaf_objs = [o for o in bpy.data.objects if o.type == "MESH" and o != existing_bark]
    leaf_tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in leaf_objs)
    print(f"meadow tree{idx}: repaired bark tris={final_bark_tris}, leaves tris={leaf_tris}")

    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        export_apply=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
    )


def repair_alpine_tree(idx: int, donor_dir: Path, alpine_dir: Path) -> None:
    donor_path = donor_dir / f"tree{idx}.glb"
    path = alpine_dir / f"tree{idx}.glb"
    bpy.ops.wm.read_factory_settings(use_empty=True)

    bpy.ops.import_scene.gltf(filepath=str(path))
    existing_objs = list(bpy.context.selected_objects)

    bark_obj = None
    for obj in existing_objs:
        if obj.type == "MESH":
            mats = [m.name for m in obj.data.materials if m]
            if "Alpine bark" in mats or obj.name == "0" or "Alpine" in obj.name:
                if "needles" not in " ".join(m.lower() for m in mats):
                    bark_obj = obj
                    break
    if bark_obj is None:
        raise RuntimeError(f"alpine tree{idx}: could not find Alpine bark object")

    bark_mat = bark_obj.data.materials[0]
    bark_node_name = bark_obj.name

    # Import original donor tree from grass-test so repair is 100% idempotent
    bpy.ops.import_scene.gltf(filepath=str(donor_path))
    donor_objs = [o for o in bpy.context.selected_objects if o not in existing_objs]
    donor_bark = None
    for obj in donor_objs:
        if obj.type == "MESH":
            mats = [m.name.lower() for m in obj.data.materials if m]
            if any("bark" in m for m in mats) or obj.name == "0":
                donor_bark = obj
                break
    if donor_bark is not None:
        old_mesh = bark_obj.data
        bark_obj.data = donor_bark.data.copy()
        bark_obj.name = bark_node_name
        bark_obj.data.name = "Mesh_0"
        bark_obj.data.materials.clear()
        bark_obj.data.materials.append(bark_mat)
        bpy.data.meshes.remove(old_mesh, do_unlink=True)
    for obj in donor_objs:
        bpy.data.objects.remove(obj, do_unlink=True)

    mesh = bark_obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)

    comps = _connected_components(bm)
    trunk_comp = comps[0]
    trunk_zs = [v.co.z for v in trunk_comp]
    t_min_z, t_max_z = min(trunk_zs), max(trunk_zs)
    t_height = max(1.0, t_max_z - t_min_z)

    # Drop the 5-6 awkward separate hollow root pipes at the base (c_max_z < t_min_z + 1.2)
    # and the 3 lowest branches on tree10 that plunge underground (min(zs) < t_min_z - 0.1)
    drop_verts: set[bmesh.types.BMVert] = set()
    for comp in comps[1:]:
        zs = [v.co.z for v in comp]
        if max(zs) < t_min_z + 1.2 or min(zs) < t_min_z - 0.05:
            drop_verts.update(comp)

    if drop_verts:
        drop_faces = [f for f in bm.faces if any(v in drop_verts for v in f.verts)]
        bmesh.ops.delete(bm, geom=drop_faces, context="FACES")
        orphan_verts = [v for v in bm.verts if not v.link_faces]
        if orphan_verts:
            bmesh.ops.delete(bm, geom=orphan_verts, context="VERTS")

    comps = _connected_components(bm)
    trunk_comp = comps[0]

    # Repair branch components: lift sub-ground drooping tips on tree10, collar base, taper tip
    for comp in comps[1:]:
        zs = [v.co.z for v in comp]
        c_min_z = min(zs)
        if c_min_z < t_min_z + 0.20:
            for v in comp:
                if v.co.z < t_min_z + 0.25:
                    v.co.z = max(t_min_z + 0.25, v.co.z + 0.78)

        _collar_branch_by_boundary_rings(
            comp, trunk_comp, t_height, collar_scales=(0.78, 1.32, 1.08)
        )

        # Taper outer pipe end to a closed point instead of an open cylinder
        comp_d = []
        for v in comp:
            cx, cy, _ = _trunk_slice_center_radius(trunk_comp, v.co.z, window=0.25)
            d = math.hypot(v.co.x - cx, v.co.y - cy)
            comp_d.append((d, v))
        comp_d.sort(key=lambda item: item[0])
        min_d = comp_d[0][0]
        max_d = comp_d[-1][0]
        span_d = max(1e-4, max_d - min_d)
        if span_d > 0.30:
            outer_verts = [v.co.copy() for d, v in comp_d if (d - min_d) / span_d >= 0.80]
            tip_co = (
                sum(outer_verts, Vector((0.0, 0.0, 0.0))) / len(outer_verts)
                if outer_verts
                else comp_d[-1][1].co.copy()
            )
            for d, v in comp_d:
                t = (d - min_d) / span_d
                if t > 0.82:
                    u = min(1.0, (t - 0.82) / 0.18)
                    v.co = v.co.lerp(tip_co, 0.88 * (u * u))

    uv_layer = bm.loops.layers.uv.active or bm.loops.layers.uv.verify()
    _add_donor_root_spurs(bm, uv_layer, trunk_comp, t_min_z, t_height, seed=idx, n_spurs=5, steps=3)

    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    orphan = [v for v in bm.verts if not v.link_faces]
    if orphan:
        bmesh.ops.delete(bm, geom=orphan, context="VERTS")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth = True

    bark_tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
    leaf_objs = [o for o in bpy.data.objects if o.type == "MESH" and o != bark_obj]
    leaf_tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in leaf_objs)
    print(f"alpine tree{idx}: repaired bark tris={bark_tris}, leaves tris={leaf_tris}")

    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_apply=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
    )


def main() -> None:
    repo = Path(__file__).resolve().parents[2]
    donor_dir = Path(r"F:/Development/grass-test/public/Assets/terrain/fantasy")
    meadow_dir = repo / "assets" / "runtime-sources" / "trees" / "meadow"
    alpine_dir = repo / "assets" / "runtime-sources" / "trees" / "alpine"

    for idx in range(1, 10):
        repair_meadow_tree(idx, donor_dir, meadow_dir, meadow_dir)

    for idx in (10, 11):
        repair_alpine_tree(idx, donor_dir, alpine_dir)


if __name__ == "__main__":
    main()
