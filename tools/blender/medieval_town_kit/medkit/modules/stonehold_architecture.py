"""Terraces, traversal and summit structures for Stonehold landmarks."""
import math
import random

from mathutils import Matrix, Vector

from ..config import detailed
from ..mesh import MeshBuilder
from .stonehold_rock import STONE_BEVEL, ring_pts, loft_rings, jagged_cliff_tier, _angle_in_ranges

def dwarven_terrace_deck(b, cx, cy, z0, z_deck, rx, ry, seed=1, sides=8,
                         parapet=True, gold_trim=True, buttresses=True,
                         open_angles=(), ribs=20):
    """Build a complete Vondari Dwarven cliff tier matching `stonehold-3.jpg`:
    1) Jagged vertical dark-rock cliff ribs from z0 to z_deck - 0.060
    2) Overhanging moulded basalt rim cornice with inlaid gold frieze band
    3) Broad, sunlit polygonal flagstone terrace deck (`stone_dressed` slabs over dark joints)
    4) Sleek, low-profile crenellated stone parapet curbs (so the paved terrace stays visible!)
    5) Slender vertical corner pilaster buttresses with gold rune strips descending the cliff.
    """
    jagged_cliff_tier(b, cx, cy, z0, z_deck, rx, ry, seed=seed, ribs=ribs,
                      under_terrace=True, open_angles=open_angles)

    rng = random.Random(seed + 7)
    angles = [2 * math.pi * i / sides for i in range(sides)]
    # Keep entrance sectors stable; the rear follows irregular natural rock shelves.
    radii = [1.0 if math.sin(a) < -0.65 else rng.uniform(0.90, 1.14) for a in angles]

    # 1. Overhanging moulded basalt upper cliff cornice & continuous gold inlay frieze
    cornice_bot = ring_pts(cx, cy, z_deck - 0.065, rx * 0.98, ry * 0.98, angles, radii)
    cornice_top = ring_pts(cx, cy, z_deck, rx * 1.02, ry * 1.02, angles, radii)
    loft_rings(b, cornice_bot, cornice_top, 'stone_basalt',
               cap_bot=True, cap_top=True, cap_mat='stone_basalt', tone=0.82)

    if detailed() and gold_trim:
        for i in range(0, sides, 3):
            a, c = cornice_top[i], cornice_top[(i + 1) % sides]
            a, c = a.lerp(c, 0.22), a.lerp(c, 0.78)
            b.beam(a - Vector((0, 0, 0.028)), c - Vector((0, 0, 0.028)),
                   (0, 0, 1), (-0.006, 0.006), 0.028, 'hold_bronze', bevel=0)

    # 2. One flagstone paving course over the whole deck (the texture draws the slabs)
    pave_bot = ring_pts(cx, cy, z_deck - 0.005, rx * 0.96, ry * 0.96, angles, radii)
    pave_top = ring_pts(cx, cy, z_deck + 0.012, rx * 0.96, ry * 0.96, angles, radii)
    loft_rings(b, pave_bot, pave_top, 'stone_flag', cap_bot=False, cap_top=True,
               cap_mat='stone_flag', tone=0.96)

    # 3. Sleek perimeter crenellated parapet curbs & slender vertical cliff pilaster buttresses
    rim_pts = ring_pts(cx, cy, z_deck, rx * 0.97, ry * 0.97, angles, radii)
    for i in range(sides):
        j = (i + 1) % sides
        p0 = rim_pts[i]
        p1 = rim_pts[j]
        c0 = cornice_top[i]
        # Slender vertical corner pilaster buttress descending down the cliff face
        if buttresses and i % 2 == 0:
            ang_v = angles[i]
            vx, vy = c0.x, c0.y
            bw = 0.060
            z_butt_bot = max(0.0, z0)
            b.box((vx - bw, vy - bw, z_butt_bot), (vx + bw, vy + bw, z_deck + 0.19), 'stone_basalt', bevel=STONE_BEVEL)
            b.box((vx - bw * 1.15, vy - bw * 1.15, z_deck + 0.075),
                  (vx + bw * 1.15, vy + bw * 1.15, z_deck + 0.095), 'stone_basalt', bevel=STONE_BEVEL)
            if detailed() and gold_trim and (z_deck - z_butt_bot) > 0.22:
                gx = vx + math.cos(ang_v) * (bw * 0.55)
                gy = vy + math.sin(ang_v) * (bw * 0.55)
                # Short bronze plaques, leaving most of the structural pier as stone.
                b.box((gx - bw * 0.28, gy - bw * 0.28, z_deck - 0.12),
                      (gx + bw * 0.28, gy + bw * 0.28, z_deck - 0.04), 'hold_bronze', bevel=0)
            foot = Vector((vx, vy, z_deck - 0.22))
            inner = Vector((cx, cy, z_deck - 0.06)).lerp(Vector((vx, vy, z_deck - 0.06)), 0.84)
            b.beam(foot, inner, (0, 0, 1), (-0.035, 0.035), 0.12, 'stone_basalt', bevel=STONE_BEVEL)

        if not parapet:
            continue
        mid_ang = math.atan2(0.5 * (p0.y + p1.y) - cy, 0.5 * (p0.x + p1.x) - cx)
        if _angle_in_ranges(mid_ang, open_angles):
            continue

        seg_vec = p1 - p0
        seg_len = seg_vec.length
        if seg_len < 0.14:
            continue
        # Note: in MeshBuilder.beam(p0, p1, (0,0,1), side_range, width, mat),
        # `side_range` is vertical height along Z and `width` is horizontal thickness!
        # Low dark balustrade (curb, slim posts, handrail) so the paving stays the bright read.
        b.beam((p0.x, p0.y, z_deck), (p1.x, p1.y, z_deck),
               (0, 0, 1), (0.0, 0.022), 0.040, 'stone_basalt', bevel=STONE_BEVEL)
        b.beam((p0.x, p0.y, z_deck), (p1.x, p1.y, z_deck),
               (0, 0, 1), (0.175, 0.19), 0.026, 'stone_basalt', bevel=STONE_BEVEL)
        if detailed():
            n_posts = max(2, int(seg_len / 0.22))
            for m_idx in range(1, n_posts):
                mp = p0.lerp(p1, m_idx / n_posts)
                b.box((mp.x - 0.009, mp.y - 0.009, z_deck + 0.02),
                       (mp.x + 0.009, mp.y + 0.009, z_deck + 0.18), 'iron', bevel=0)
            if seg_len > 0.40 and i % 2 == 0:
                # Lantern post mid-span: the warm points of light along every terrace edge.
                lp = p0.lerp(p1, 0.5)
                b.box((lp.x - 0.013, lp.y - 0.013, z_deck), (lp.x + 0.013, lp.y + 0.013, z_deck + 0.12),
                      'stone_basalt', bevel=0)
                b.box((lp.x - 0.018, lp.y - 0.018, z_deck + 0.12), (lp.x + 0.018, lp.y + 0.018, z_deck + 0.128),
                      'hold_bronze', bevel=0)
                b.box((lp.x - 0.012, lp.y - 0.012, z_deck + 0.128), (lp.x + 0.012, lp.y + 0.012, z_deck + 0.158),
                      'glow', bevel=0)
                b.box((lp.x - 0.017, lp.y - 0.017, z_deck + 0.158), (lp.x + 0.017, lp.y + 0.017, z_deck + 0.166),
                      'iron', bevel=0)


def dwarven_brazier(b, cx, cy, z0, scale=1.0, tall=False):
    """Slender basalt-and-gold Dwarven brazier pedestal with iron bowl and sharp flickering fire tongues."""
    s = scale
    h_ped = (0.20 if tall else 0.11) * s
    z_base = max(0.0, z0 - 0.02 * s)
    r_ped = 0.048 * s
    b.box((cx - r_ped, cy - r_ped, z_base),
          (cx + r_ped, cy + r_ped, z0 + h_ped), 'stone_basalt', bevel=STONE_BEVEL)
    if detailed():
        b.box((cx - r_ped * 1.12, cy - r_ped * 1.12, z0 + h_ped - 0.024 * s),
              (cx + r_ped * 1.12, cy + r_ped * 1.12, z0 + h_ped + 0.005 * s), 'hold_bronze', bevel=0)
    r_bowl = 0.062 * s
    b.box((cx - r_bowl, cy - r_bowl, z0 + h_ped),
          (cx + r_bowl, cy + r_bowl, z0 + h_ped + 0.034 * s), 'iron', bevel=0)
    b.box((cx - r_ped, cy - r_ped, z0 + h_ped + 0.025 * s),
          (cx + r_ped, cy + r_ped, z0 + h_ped + 0.052 * s), 'firelight', bevel=0)
    b.blob((cx, cy, z0 + h_ped + 0.075 * s), 0.042 * s, 'glow',
           subdiv=1, squash=(0.75, 0.75, 1.85), jitter=0.25, seed=int(abs(cx * 100 + cy * 37)) + 11)
    if detailed():
        b.blob((cx + 0.018 * s, cy - 0.014 * s, z0 + h_ped + 0.065 * s), 0.028 * s, 'firelight',
               subdiv=1, squash=(0.7, 0.7, 1.6), jitter=0.2, seed=int(abs(cx * 73 + cy * 19)) + 17)


def dwarven_stair_flight(b, p_start, p_end, width=0.38, steps=8, cheek_walls=True,
                         braziers_bottom=False, braziers_top=False):
    """Carved stone flight of steps from `p_start = (x0, y0, z0)` to `p_end = (x1, y1, z1)`
    with grounded substructure, sunlit dressed-stone treads, and plumb basalt/gold cheek-walls."""
    p0 = Vector(p_start)
    p1 = Vector(p_end)
    horiz = Vector((p1.x - p0.x, p1.y - p0.y, 0.0))
    dist = horiz.length
    if dist < 0.05:
        return
    fwd = horiz.normalized()
    right = Vector((-fwd.y, fwd.x, 0.0))
    hw = width * 0.5

    # Authoring units become 5 m: a 0.034 rise is a 17 cm stair riser.
    n_steps = max(steps, math.ceil(abs(p1.z - p0.z) / 0.034))
    if not detailed():
        n_steps = max(4, n_steps // 2)
    minimum_run = abs(p1.z - p0.z) * 1.45
    if dist < minimum_run:
        p0 -= fwd * (minimum_run - dist)
        horiz = Vector((p1.x - p0.x, p1.y - p0.y, 0.0))
    b.beam(p0 - Vector((0, 0, 0.07)), p1 - Vector((0, 0, 0.07)),
           right, (-hw, hw), 0.12, 'stone_basalt', bevel=0)
    for landing in (p0, p1):
        b.box((landing.x - hw * 1.15, landing.y - hw * 1.15, max(0, landing.z - 0.16)),
              (landing.x + hw * 1.15, landing.y + hw * 1.15, landing.z + 0.01), 'stone_basalt', bevel=STONE_BEVEL)
    for i in range(n_steps):
        t0 = i / n_steps
        t1 = (i + 1.05) / n_steps
        z_step = p0.z + (p1.z - p0.z) * ((i + 1) / n_steps)
        z_bot = max(0.0, p0.z + (p1.z - p0.z) * (i / n_steps) - 0.10)
        c0 = p0 + horiz * t0
        c1 = p0 + horiz * t1
        pts_bot = [
            Vector((c0.x - right.x * hw, c0.y - right.y * hw, z_bot)),
            Vector((c0.x + right.x * hw, c0.y + right.y * hw, z_bot)),
            Vector((c1.x + right.x * hw, c1.y + right.y * hw, z_bot)),
            Vector((c1.x - right.x * hw, c1.y - right.y * hw, z_bot)),
        ]
        pts_top = [Vector((p.x, p.y, z_step)) for p in pts_bot]
        loft_rings(b, pts_bot, pts_top, 'stone_dressed',
                   cap_bot=True, cap_top=True, cap_mat='stone_dressed',
                   tone=0.92 + 0.04 * (i % 3))

    if cheek_walls:
        cw = 0.032
        for side in (-1, 1):
            off = right * (side * (hw + cw * 0.85))
            w0 = p0 + off
            w1 = p1 + off
            # Stepped horizontal basalt & dressed-stone cheek-balustrade blocks
            n_ch = max(3, n_steps // 2)
            for k in range(n_ch):
                t_a = k / n_ch
                t_b = (k + 1.02) / n_ch
                wa = w0.lerp(w1, t_a)
                wb = w0.lerp(w1, t_b)
                zb_blk = max(0.0, p0.z + (p1.z - p0.z) * t_a - 0.08)
                zt_blk = p0.z + (p1.z - p0.z) * ((k + 1) / n_ch) + 0.18
                b.beam((wa.x, wa.y, zb_blk), (wb.x, wb.y, zb_blk),
                       (0, 0, 1), (0.0, zt_blk - zb_blk), cw * 1.85, 'stone_basalt', bevel=0)
                b.beam((wa.x, wa.y, zt_blk), (wb.x, wb.y, zt_blk),
                       (0, 0, 1), (0.0, 0.018), cw * 2.05, 'stone_dressed', bevel=STONE_BEVEL)
            # Terminal newel piers at bottom and top
            b.box((w0.x - cw * 1.25, w0.y - cw * 1.25, max(0.0, p0.z - 0.05)),
                  (w0.x + cw * 1.25, w0.y + cw * 1.25, p0.z + 0.11), 'stone_basalt', bevel=STONE_BEVEL)
            b.box((w1.x - cw * 1.25, w1.y - cw * 1.25, max(0.0, p1.z - 0.05)),
                  (w1.x + cw * 1.25, w1.y + cw * 1.25, p1.z + 0.11), 'stone_basalt', bevel=STONE_BEVEL)
            if braziers_bottom:
                dwarven_brazier(b, w0.x, w0.y, p0.z + 0.11, scale=0.68)
            if braziers_top:
                dwarven_brazier(b, w1.x, w1.y, p1.z + 0.11, scale=0.68)


def viaduct_bridge(b, p0_xy, p1_xy, z_deck, z_ground=0.0, width=0.52,
                   arches=1, braziers=True):
    """Engineered Dwarven stone viaduct bridge with battered basalt piers, segmental arch
    openings underneath, sunlit paved roadway deck, gold frieze, and low crenellated parapets."""
    p0 = Vector((p0_xy[0], p0_xy[1], z_deck))
    p1 = Vector((p1_xy[0], p1_xy[1], z_deck))
    span_vec = p1 - p0
    length = span_vec.length
    if length < 0.1:
        return
    fwd = span_vec.normalized()
    right = Vector((-fwd.y, fwd.x, 0.0))
    hw = width * 0.5

    # Roadway deck slab, sunlit dressed-stone flagstone paving & gold cornice frieze
    b.beam((p0.x, p0.y, z_deck), (p1.x, p1.y, z_deck),
           (0, 0, 1), (-0.09, 0.0), width, 'stone_basalt', bevel=STONE_BEVEL)
    b.beam((p0.x, p0.y, z_deck), (p1.x, p1.y, z_deck),
           (0, 0, 1), (-0.002, 0.018), width * 0.88, 'stone_flag', bevel=STONE_BEVEL)
    if detailed():
        b.beam((p0.x, p0.y, z_deck), (p1.x, p1.y, z_deck),
               (0, 0, 1), (-0.052, -0.026), width * 1.04, 'hold_bronze', bevel=0)

    # Sleek side parapet curbs with low merlons
    pw = 0.056
    for side in (-1, 1):
        off = right * (side * (hw - pw * 0.45))
        s0, s1 = p0 + off, p1 + off
        b.beam((s0.x, s0.y, z_deck), (s1.x, s1.y, z_deck),
               (0, 0, 1), (0.0, 0.050), pw, 'stone_granite', bevel=STONE_BEVEL)
        b.beam((s0.x, s0.y, z_deck), (s1.x, s1.y, z_deck),
               (0, 0, 1), (0.048, 0.064), pw * 1.15, 'stone_dressed', bevel=STONE_BEVEL)
        if detailed():
            n_m = max(2, int(length / 0.26))
            for m_i in range(n_m):
                mt0 = (m_i + 0.18) / n_m
                mt1 = (m_i + 0.68) / n_m
                mp0 = s0.lerp(s1, mt0)
                mp1 = s0.lerp(s1, mt1)
                b.beam((mp0.x, mp0.y, z_deck), (mp1.x, mp1.y, z_deck),
                       (0, 0, 1), (0.062, 0.088), pw, 'stone_dressed', bevel=STONE_BEVEL)

    # Supporting piers & arch spandrels underneath
    n_arches = max(1, arches)
    pier_h = max(0.05, z_deck - z_ground)
    for k in range(n_arches + 1):
        t = k / n_arches
        pier_c = p0.lerp(p1, t)
        pw_x = 0.075
        b.beam((pier_c.x - fwd.x * pw_x, pier_c.y - fwd.y * pw_x, z_ground),
               (pier_c.x + fwd.x * pw_x, pier_c.y + fwd.y * pw_x, z_ground),
               (0, 0, 1), (0.0, pier_h), width * 0.94, 'stone_basalt', bevel=STONE_BEVEL)
        if detailed() and pier_h > 0.25:
            b.beam((pier_c.x - fwd.x * (pw_x * 0.42), pier_c.y - fwd.y * (pw_x * 0.42), z_ground),
                   (pier_c.x + fwd.x * (pw_x * 0.42), pier_c.y + fwd.y * (pw_x * 0.42), z_ground),
                   (0, 0, 1), (0.06, pier_h - 0.08), width * 0.99, 'hold_bronze', bevel=0)
        if braziers and (k == 0 or k == n_arches):
            for side in (-1, 1):
                bc = pier_c + right * (side * (hw - 0.035))
                dwarven_brazier(b, bc.x, bc.y, z_deck + 0.065, scale=0.72)

    # Corbelled arch shoulders under each span
    if detailed() and pier_h > 0.25:
        for k in range(n_arches):
            a_start = p0.lerp(p1, (k + 0.12) / n_arches)
            a_end = p0.lerp(p1, (k + 0.88) / n_arches)
            a_mid1 = a_start.lerp(a_end, 0.30)
            a_mid2 = a_start.lerp(a_end, 0.70)
            b.beam((a_start.x, a_start.y, z_deck - 0.24),
                   (a_mid1.x, a_mid1.y, z_deck - 0.10),
                   (0, 0, 1), (-0.045, 0.045), width * 0.86, 'stone_granite', bevel=STONE_BEVEL)
            b.beam((a_mid2.x, a_mid2.y, z_deck - 0.10),
                   (a_end.x, a_end.y, z_deck - 0.24),
                   (0, 0, 1), (-0.045, 0.045), width * 0.86, 'stone_granite', bevel=STONE_BEVEL)


def cliff_portal_alcove(b, cx, cy, z0, yaw=0.0, width=0.38, height=0.48):
    """Deep shouldered opening: shadowed reveal, iron leaf, and an interior hearth."""
    right = Vector((math.cos(yaw), math.sin(yaw), 0))
    back = Vector((-math.sin(yaw), math.cos(yaw), 0))
    m = Matrix(((right.x, back.x, 0, cx), (right.y, back.y, 0, cy),
                (0, 0, 1, z0), (0, 0, 0, 1)))
    hw = width * 0.5
    jamb = width * 0.16
    aperture = hw - jamb
    # The opening has a visible floor, ceiling and jamb depth, not a luminous panel.
    b.box((-hw, -0.24, -0.018), (hw, 0.015, 0.018), 'hold_warm_stone', m=m, bevel=0.006)
    b.box((-aperture, -0.038, 0.018), (aperture, -0.025, height * 0.90), 'shadow', m=m, bevel=0)
    for side in (-1, 1):
        lo, hi = sorted((side * hw, side * aperture))
        courses = max(3, round(height / 0.075)) if detailed() else 1
        for k in range(courses):
            z = k * height / courses
            b.box((lo, -0.23, z), (hi, 0.02, z + height / courses - 0.003),
                  'stone_dressed', m=m, bevel=0, tone=0.86 + (k % 3) * 0.04)
        # Short lintel brackets carry the stone over the clear opening.
        a, c = sorted((side * aperture, side * (aperture - jamb * 0.38)))
        b.box((a, -0.23, height * 0.76), (c, 0.015, height * 0.90), 'stone_basalt', m=m, bevel=0.004)
    b.box((-hw * 1.08, -0.25, height * 0.90), (hw * 1.08, 0.035, height * 1.03),
          'stone_basalt', m=m, bevel=0.007)
    b.box((-hw * 0.8, -0.258, height * 0.935), (hw * 0.8, -0.25, height * 0.96),
          'hold_bronze', m=m, bevel=0)
    if detailed():
        # A partly open iron leaf and discrete fire source leave most of the room dark.
        b.box((-aperture, -0.14, 0.02), (-aperture * 0.48, -0.12, height * 0.76), 'iron', m=m, bevel=0.003)
        for z in (height * 0.20, height * 0.62):
            b.box((-aperture, -0.15, z), (-aperture * 0.48, -0.14, z + 0.012), 'hold_bronze', m=m, bevel=0)
        b.box((aperture * 0.3, -0.06, 0.06), (aperture * 0.7, -0.045, height * 0.33), 'firelight', m=m, bevel=0)
        b.box((aperture * 0.4, -0.068, 0.07), (aperture * 0.57, -0.06, height * 0.24), 'glow', m=m, bevel=0)
        # Soot accumulates at the top of the reveal, away from the walking threshold.
        b.box((-aperture * 0.88, -0.041, height * 0.73), (aperture * 0.88, -0.035, height * 0.88),
              'hold_soot', m=m, bevel=0)


def summit_citadel_hall(b, cx, cy, z0, height=0.62, rx=0.60, ry=0.54, seed=1,
                        door_yaws=(0.0, math.pi * 0.5)):
    """Polygonal Vondari Dwarven Summit Citadel Hall (as on the right peak of Stonehold_Twin_Outcrop):
    - Octagonal coursed granite & dressed-stone walls
    - 8 slender projecting basalt corner pilaster buttresses inlaid with vertical gold strips
    - Recessed glowing portals on `door_yaws`
    - Stepped octagonal stone roof deck with radial stone ribs, gold frieze, and crenellated parapet.
    """
    sides = 6 if seed % 3 == 1 else 8
    rx *= 1.12 if seed % 3 == 1 else 1.0
    angles = [2 * math.pi * i / sides + math.pi / sides for i in range(sides)]
    radii = [1.0] * sides

    # 1. Stepped octagonal plinth base
    p_bot = ring_pts(cx, cy, z0 - 0.03, rx * 1.06, ry * 1.06, angles, radii)
    p_top = ring_pts(cx, cy, z0 + 0.06, rx * 1.02, ry * 1.02, angles, radii)
    loft_rings(b, p_bot, p_top, 'stone_basalt', cap_bot=True, cap_top=True, cap_mat='stone_dressed', tone=0.86)

    # 2. Main octagonal granite citadel walls
    w_bot = ring_pts(cx, cy, z0 + 0.05, rx * 0.94, ry * 0.94, angles, radii)
    w_top = ring_pts(cx, cy, z0 + height * 0.78, rx * 0.90, ry * 0.90, angles, radii)
    loft_rings(b, w_bot, w_top, 'stone_granite', cap_bot=False, cap_top=True, cap_mat='stone_dressed', tone=0.96)

    # Upper cornice & gold band
    c_bot = ring_pts(cx, cy, z0 + height * 0.74, rx * 0.96, ry * 0.96, angles, radii)
    c_top = ring_pts(cx, cy, z0 + height * 0.83, rx * 0.98, ry * 0.98, angles, radii)
    loft_rings(b, c_bot, c_top, 'stone_basalt', cap_bot=False, cap_top=True, cap_mat='stone_dressed', tone=0.84)
    if detailed():
        g_bot = ring_pts(cx, cy, z0 + height * 0.77, rx * 0.985, ry * 0.985, angles, radii)
        g_top = ring_pts(cx, cy, z0 + height * 0.805, rx * 0.99, ry * 0.99, angles, radii)
        loft_rings(b, g_bot, g_top, 'hold_bronze', cap_bot=False, cap_top=False, tone=0.90)

    # 3. Eight corner pilaster buttresses with vertical gold inlays + roof parapet
    for i in range(sides):
        j = (i + 1) % sides
        v0 = w_bot[i]
        ang = angles[i]
        bw = 0.046
        b.box((v0.x - bw, v0.y - bw, z0),
              (v0.x + bw, v0.y + bw, z0 + height * 0.92), 'stone_basalt', bevel=STONE_BEVEL)
        if detailed():
            gx = v0.x + math.cos(ang) * (bw * 0.52)
            gy = v0.y + math.sin(ang) * (bw * 0.52)
            b.box((gx - bw * 0.36, gy - bw * 0.36, z0 + 0.06),
                  (gx + bw * 0.36, gy + bw * 0.36, z0 + height * 0.86), 'hold_bronze', bevel=0)
        # Roof parapet wall between corner buttresses
        rt0, rt1 = c_top[i], c_top[j]
        b.beam((rt0.x, rt0.y, z0 + height * 0.82), (rt1.x, rt1.y, z0 + height * 0.82),
               (0, 0, 1), (0.0, height * 0.09), 0.058, 'stone_granite', bevel=STONE_BEVEL)

    # 4. Stepped inner octagonal roof crown with radial stone ribs
    r2_bot = ring_pts(cx, cy, z0 + height * 0.82, rx * 0.72, ry * 0.72, angles, radii)
    r2_top = ring_pts(cx, cy, z0 + height * 1.22, rx * 0.30, ry * 0.30, angles, radii)
    loft_rings(b, r2_bot, r2_top, 'stone_basalt', cap_bot=False, cap_top=True, cap_mat='stone_dressed', tone=0.90)
    if detailed():
        # Individually bedded radial vault slabs: silhouette and joints survive close views.
        for facet in range(sides):
            j = (facet + 1) % sides
            for course in range(4):
                t0, t1 = course / 4, (course + 0.94) / 4
                a, c = r2_bot[facet].lerp(r2_top[facet], t0), r2_bot[j].lerp(r2_top[j], t0)
                d, e = r2_bot[j].lerp(r2_top[j], t1), r2_bot[facet].lerp(r2_top[facet], t1)
                offset = Vector((0, 0, 0.012))
                b.extrude([a + offset, c + offset, d + offset, e + offset], (0, 0, 0.012),
                          'stone_dressed', tone=0.78 + 0.055 * ((facet + course) % 4))
        for i in range(sides):
            p_in = Vector((cx + rx * 0.28 * math.cos(angles[i]), cy + ry * 0.28 * math.sin(angles[i]), z0 + height * 1.22))
            p_out = r2_top[i]
            b.beam((p_in.x, p_in.y, p_in.z), (p_out.x, p_out.y, p_out.z),
                   (0, 0, 1), (0.0, 0.032), 0.044, 'stone_basalt', bevel=STONE_BEVEL)
    r3_bot = ring_pts(cx, cy, z0 + height * 1.20, rx * 0.32, ry * 0.32, angles, radii)
    r3_top = ring_pts(cx, cy, z0 + height * 1.35, rx * 0.26, ry * 0.26, angles, radii)
    loft_rings(b, r3_bot, r3_top, 'stone_basalt', cap_bot=False, cap_top=True, cap_mat='stone_dressed', tone=0.88)

    # 5. Recessed glowing portals on specified door_yaws
    for dyaw in door_yaws:
        px = cx + math.sin(dyaw) * (rx * 0.92)
        py = cy - math.cos(dyaw) * (ry * 0.92)
        cliff_portal_alcove(b, px, py, z0 + 0.05, yaw=dyaw, width=0.34, height=min(0.48, height * 0.76))


def summit_beacon_fort(b, cx, cy, z0, height=0.34, radius=0.50, seed=1):
    """Octagonal fortified stone signal-beacon platform (as on the left peak of Stonehold_Twin_Outcrop):
    - Battered octagonal dressed-stone & granite bastion walls with slender gold-inlaid corner buttresses
    - Low crenellated stone parapet ring
    - Central raised circular stone fire-altar with crossed logs, embers, and multi-tongued signal fire!
    """
    sides = 8
    angles = [2 * math.pi * i / sides + math.pi / sides for i in range(sides)]
    radii = [1.0] * sides

    bot = ring_pts(cx, cy, z0 - 0.03, radius * 1.05, radius * 1.05, angles, radii)
    top = ring_pts(cx, cy, z0 + height, radius * 0.96, radius * 0.96, angles, radii)
    loft_rings(b, bot, top, 'stone_granite', cap_bot=True, cap_top=True, cap_mat='stone_dressed', tone=0.95)

    if detailed():
        g_bot = ring_pts(cx, cy, z0 + height - 0.042, radius * 0.975, radius * 0.975, angles, radii)
        g_top = ring_pts(cx, cy, z0 + height - 0.016, radius * 0.98, radius * 0.98, angles, radii)
        loft_rings(b, g_bot, g_top, 'hold_bronze', cap_bot=False, cap_top=False, tone=0.90)

    for i in range(sides):
        j = (i + 1) % sides
        p0, p1 = top[i], top[j]
        ang = angles[i]
        bw = 0.042
        b.box((p0.x - bw, p0.y - bw, z0),
              (p0.x + bw, p0.y + bw, z0 + height + 0.085), 'stone_basalt', bevel=STONE_BEVEL)
        if detailed():
            gx = p0.x + math.cos(ang) * (bw * 0.52)
            gy = p0.y + math.sin(ang) * (bw * 0.52)
            b.box((gx - bw * 0.36, gy - bw * 0.36, z0 + 0.05),
                  (gx + bw * 0.36, gy + bw * 0.36, z0 + height + 0.055), 'hold_bronze', bevel=0)
        # Low parapet curb (leave front facet open for summit steps)
        mid_a = math.atan2(0.5 * (p0.y + p1.y) - cy, 0.5 * (p0.x + p1.x) - cx)
        if abs(mid_a + math.pi * 0.5) > 0.42:
            b.beam((p0.x, p0.y, z0 + height), (p1.x, p1.y, z0 + height),
                   (0, 0, 1), (0.0, 0.050), 0.054, 'stone_granite', bevel=STONE_BEVEL)

    # Central circular stepped fire-ring & roaring signal fire
    z_deck = z0 + height
    r_pit = radius * 0.46
    pit_bot = ring_pts(cx, cy, z_deck - 0.01, r_pit * 1.12, r_pit * 1.12, angles, radii)
    pit_top = ring_pts(cx, cy, z_deck + 0.085, r_pit, r_pit, angles, radii)
    loft_rings(b, pit_bot, pit_top, 'stone_basalt', cap_bot=False, cap_top=True, cap_mat='firelight', tone=0.84)
    if detailed():
        for k in range(8):
            a = 2 * math.pi * k / 8
            mx = cx + r_pit * 0.96 * math.cos(a)
            my = cy + r_pit * 0.96 * math.sin(a)
            b.box((mx - 0.032, my - 0.032, z_deck + 0.07),
                  (mx + 0.032, my + 0.032, z_deck + 0.13), 'stone_dressed', bevel=STONE_BEVEL)
        # Crossed timber fire logs
        for k in range(3):
            a = math.pi * k / 3 + 0.2
            lx = r_pit * 0.62 * math.cos(a)
            ly = r_pit * 0.62 * math.sin(a)
            b.beam((cx - lx, cy - ly, z_deck + 0.06),
                   (cx + lx, cy + ly, z_deck + 0.14),
                   (0, 0, 1), (-0.024, 0.024), 0.048, 'bark', bevel=0)
    # Multi-tongued roaring signal fire (warm ember base + sharp flickering tongues)
    b.blob((cx, cy, z_deck + 0.14), r_pit * 0.48, 'firelight',
           subdiv=1, squash=(1.0, 1.0, 1.1), jitter=0.25, seed=seed + 300)
    b.blob((cx, cy, z_deck + 0.20), r_pit * 0.36, 'glow',
           subdiv=1, squash=(0.72, 0.72, 1.95), jitter=0.28, seed=seed + 301)
    if detailed():
        for k, (ox, oy, sc) in enumerate((
            (-0.045, -0.03, 0.28),
            (0.045, 0.025, 0.26),
            (0.0, 0.048, 0.25),
            (-0.02, 0.035, 0.22),
        )):
            b.blob((cx + ox, cy + oy, z_deck + 0.18), r_pit * sc, 'glow',
                   subdiv=1, squash=(0.68, 0.68, 2.0), jitter=0.25, seed=seed + 310 + k)


