"""Shared Stonehold builders and environmental dressing."""
import math
import random

from mathutils import Matrix, Vector

from ..config import detailed
from ..mesh import MeshBuilder
from .stonehold_rock import STONE_BEVEL, ring_pts, loft_rings, crag_block, rock_spire, jagged_cliff_tier
from .stonehold_architecture import (
    dwarven_terrace_deck, dwarven_brazier, dwarven_stair_flight, viaduct_bridge,
    cliff_portal_alcove, summit_citadel_hall, summit_beacon_fort,
)
from .stonehold_water import waterfall_cascade

def vondari_cliff_banner(b, cx, cy, z_top, yaw=0.0, height=0.58, width=0.22):
    """Vertical navy-blue & gold Vondari Dwarven cliff banner with bronze crossbar,
    gold borders, swallowtail/chevron tip, and geometric gold diamond-mountain emblem."""
    start = b.mark()
    c_y, s_y = math.cos(yaw), math.sin(yaw)
    fwd = Vector((s_y, -c_y, 0.0))   # Outward normal (yaw=0 faces -Y)
    right = Vector((c_y, s_y, 0.0))
    hw = width * 0.5
    top_c = Vector((cx, cy, z_top)) + fwd * 0.04

    # Bronze crossbar & gold finials
    bar_L = top_c - right * (hw * 1.18)
    bar_R = top_c + right * (hw * 1.18)
    b.beam((bar_L.x, bar_L.y, z_top), (bar_R.x, bar_R.y, z_top),
           (0, 0, 1), (-0.014, 0.014), 0.028, 'bronze', bevel=0)
    b.box((bar_L.x - 0.020, bar_L.y - 0.020, z_top - 0.008),
          (bar_L.x + 0.020, bar_L.y + 0.020, z_top + 0.032), 'hold_bronze', bevel=0)
    b.box((bar_R.x - 0.020, bar_R.y - 0.020, z_top - 0.008),
          (bar_R.x + 0.020, bar_R.y + 0.020, z_top + 0.032), 'hold_bronze', bevel=0)

    # Navy cloth body with pointed chevron bottom
    z_mid = z_top - height * 0.78
    z_tip = z_top - height
    p_tl = top_c - right * hw
    p_tr = top_c + right * hw
    p_bl = Vector((p_tl.x, p_tl.y, z_mid))
    p_br = Vector((p_tr.x, p_tr.y, z_mid))
    p_tip = Vector((top_c.x, top_c.y, z_tip))

    thick = fwd * 0.002
    b.extrude([p_tl, p_tr, p_br, p_tip, p_bl], thick, 'cloth_blue')

    if detailed():
        # Gold edge borders (use `fwd` as side_axis so steep lines in banner plane never become degenerate)
        bw = 0.004
        b.box((p_tl.x - bw, p_tl.y - bw, z_mid), (p_tl.x + bw, p_tl.y + bw, z_top), 'hold_bronze', bevel=0)
        b.box((p_tr.x - bw, p_tr.y - bw, z_mid), (p_tr.x + bw, p_tr.y + bw, z_top), 'hold_bronze', bevel=0)
        b.beam((p_bl.x, p_bl.y, z_mid), (p_tip.x, p_tip.y, z_tip),
               fwd, (-0.004, 0.026), 0.024, 'hold_bronze', bevel=0)
        b.beam((p_br.x, p_br.y, z_mid), (p_tip.x, p_tip.y, z_tip),
               fwd, (-0.004, 0.026), 0.024, 'hold_bronze', bevel=0)

        # Central geometric gold Vondari diamond & mountain chevron emblem
        emb_c = top_c + fwd * 0.016 + Vector((0, 0, -height * 0.44))
        dr = hw * 0.56
        dz = height * 0.17
        d_top = emb_c + Vector((0, 0, dz))
        d_bot = emb_c - Vector((0, 0, dz))
        d_L = emb_c - right * dr
        d_R = emb_c + right * dr
        for a_pt, b_pt in ((d_top, d_R), (d_R, d_bot), (d_bot, d_L), (d_L, d_top),
                           (d_L + Vector((0, 0, -dz * 0.3)), emb_c + Vector((0, 0, dz * 0.35))),
                           (emb_c + Vector((0, 0, dz * 0.35)), d_R + Vector((0, 0, -dz * 0.3)))):
            b.beam((a_pt.x, a_pt.y, a_pt.z), (b_pt.x, b_pt.y, b_pt.z),
                   fwd, (-0.004, 0.014), 0.018, 'hold_bronze', bevel=0)


    # Cloth and embroidery share one fold field; the supporting rod stays fixed.
    for v in b.verts[start:]:
        t = max(0.0, min(1.0, (z_top - v.z) / height))
        across = (v - top_c).dot(right) / width
        v += fwd * (math.sin(across * math.tau * 2.5) * 0.014 + math.sin(t * 4 + across) * 0.018) * t


def cliff_scaffolding_crane(b, cx, cy, z_base, z_deck, yaw=0.0, scale=1.0, has_crane=True):
    """Cliff-hugging timber scaffolding frame topped by a raking timber-and-iron ore crane
    with pulley wheel, rigging cables, and a suspended iron-bound ore bucket hanging in mid-air."""
    s = scale
    c_y, s_y = math.cos(yaw), math.sin(yaw)
    fwd = Vector((s_y, -c_y, 0.0))   # Outward over the cliff
    right = Vector((c_y, s_y, 0.0))
    origin = Vector((cx, cy, 0.0))

    hw = 0.22 * s
    hd = 0.18 * s
    z0 = max(0.0, z_base)
    corners = [
        origin - right * hw - fwd * hd,
        origin + right * hw - fwd * hd,
        origin + right * hw + fwd * hd,
        origin - right * hw + fwd * hd,
    ]
    for cp in corners:
        b.box((cp.x - 0.024 * s, cp.y - 0.024 * s, z0),
              (cp.x + 0.024 * s, cp.y + 0.024 * s, z_deck + 0.04 * s), 'timber_dark', bevel=0)

    n_tiers = max(1, int((z_deck - z0) / (0.28 * s)))
    for k in range(n_tiers + 1):
        zt = z0 + (z_deck - z0) * (k / max(1, n_tiers))
        for i in range(4):
            pA, pB = corners[i], corners[(i + 1) % 4]
            b.beam((pA.x, pA.y, zt), (pB.x, pB.y, zt),
                   (0, 0, 1), (-0.016 * s, 0.016 * s), 0.030 * s, 'timber_dark', bevel=0)
        if detailed() and k < n_tiers:
            zt_next = z0 + (z_deck - z0) * ((k + 1) / max(1, n_tiers))
            pF0, pF1 = corners[3], corners[2]
            b.beam((pF0.x, pF0.y, zt), (pF1.x, pF1.y, zt_next),
                   fwd, (-0.012 * s, 0.012 * s), 0.024 * s, 'timber_dark', bevel=0)
            b.beam((pF1.x, pF1.y, zt), (pF0.x, pF0.y, zt_next),
                   fwd, (-0.012 * s, 0.012 * s), 0.024 * s, 'timber_dark', bevel=0)

    # Top planked work deck
    b.box((cx - hw * 1.1, cy - hw * 1.1, z_deck - 0.018 * s),
          (cx + hw * 1.1, cy + hw * 1.1, z_deck + 0.028 * s), 'planks', bevel=0)

    if not has_crane:
        return

    # Crane mast & raking jib boom extending outward along `fwd`
    mast_h = 0.66 * s
    b.box((cx - 0.036 * s, cy - 0.036 * s, z_deck),
          (cx + 0.036 * s, cy + 0.036 * s, z_deck + mast_h), 'timber_dark', bevel=0)
    b.box((cx - 0.045 * s, cy - 0.045 * s, z_deck + mast_h * 0.88),
          (cx + 0.045 * s, cy + 0.045 * s, z_deck + mast_h * 0.96), 'iron', bevel=0)

    jib_tip = Vector((cx, cy, z_deck + mast_h * 0.92)) + fwd * (0.64 * s)
    b.beam((cx, cy, z_deck + mast_h * 0.32), (jib_tip.x, jib_tip.y, jib_tip.z),
           (0, 0, 1), (-0.024 * s, 0.024 * s), 0.044 * s, 'timber_dark', bevel=0)
    b.beam((cx, cy, z_deck + mast_h * 0.95), (jib_tip.x, jib_tip.y, jib_tip.z + 0.02 * s),
           (0, 0, 1), (-0.010 * s, 0.010 * s), 0.018 * s, 'rope', bevel=0)
    b.box((jib_tip.x - 0.038 * s, jib_tip.y - 0.038 * s, jib_tip.z - 0.045 * s),
          (jib_tip.x + 0.038 * s, jib_tip.y + 0.038 * s, jib_tip.z + 0.038 * s), 'iron', bevel=0)

    # Vertical hoist cable & suspended iron-bound ore bucket
    bucket_z = z_deck - 0.14 * s
    b.box((jib_tip.x - 0.008 * s, jib_tip.y - 0.008 * s, bucket_z + 0.12 * s),
          (jib_tip.x + 0.008 * s, jib_tip.y + 0.008 * s, jib_tip.z - 0.04 * s), 'rope', bevel=0)

    br = 0.072 * s
    bh = 0.125 * s
    b.box((jib_tip.x - br, jib_tip.y - br, bucket_z),
          (jib_tip.x + br, jib_tip.y + br, bucket_z + bh), 'timber_dark', bevel=0)
    b.box((jib_tip.x - br * 1.08, jib_tip.y - br * 1.08, bucket_z + bh * 0.15),
          (jib_tip.x + br * 1.08, jib_tip.y + br * 1.08, bucket_z + bh * 0.32), 'iron', bevel=0)
    b.box((jib_tip.x - br * 1.08, jib_tip.y - br * 1.08, bucket_z + bh * 0.72),
          (jib_tip.x + br * 1.08, jib_tip.y + br * 1.08, bucket_z + bh * 0.88), 'iron', bevel=0)
    if detailed():
        b.blob((jib_tip.x, jib_tip.y, bucket_z + bh * 0.95), br * 0.72, 'hold_bronze',
               subdiv=1, squash=(1.0, 1.0, 0.55), jitter=0.25, seed=91)


def work_tent(b, cx, cy, z0, yaw=0.0, w=0.36, d=0.28, h=0.25):
    """Pitched canvas work awning on 4 timber poles with a work table & crate underneath."""
    h = max(h, 0.42)
    c_y, s_y = math.cos(yaw), math.sin(yaw)
    fwd = Vector((s_y, -c_y, 0.0))
    right = Vector((c_y, s_y, 0.0))
    origin = Vector((cx, cy, z0))
    hw, hd = w * 0.5, d * 0.5

    poles = [
        (origin - right * hw - fwd * hd, h * 1.08),
        (origin + right * hw - fwd * hd, h * 1.08),
        (origin + right * hw + fwd * hd, h * 0.80),
        (origin - right * hw + fwd * hd, h * 0.80),
    ]
    for pp, ph in poles:
        b.box((pp.x - 0.015, pp.y - 0.015, max(0.0, z0 - 0.01)),
              (pp.x + 0.015, pp.y + 0.015, z0 + ph), 'timber_dark', bevel=0)

    p0 = Vector((poles[0][0].x, poles[0][0].y, z0 + poles[0][1]))
    p1 = Vector((poles[1][0].x, poles[1][0].y, z0 + poles[1][1]))
    p2 = Vector((poles[2][0].x, poles[2][0].y, z0 + poles[2][1]))
    p3 = Vector((poles[3][0].x, poles[3][0].y, z0 + poles[3][1]))
    panels = 8 if detailed() else 2
    for i in range(panels):
        t0, t1 = i / panels, (i + 1) / panels
        a, c = p0.lerp(p1, t0), p0.lerp(p1, t1)
        d0, e = p3.lerp(p2, t0), p3.lerp(p2, t1)
        for point, t in ((a, t0), (c, t1), (d0, t0), (e, t1)):
            point.z -= math.sin(t * math.pi) * 0.035
        b.extrude([a, c, e, d0], (0, 0, 0.002), 'cloth_cream')
    if detailed():
        c_pos = origin - right * (hw * 0.35)
        b.box((c_pos.x - 0.048, c_pos.y - 0.048, z0),
              (c_pos.x + 0.048, c_pos.y + 0.048, z0 + 0.085), 'timber', bevel=0)
        b_pos = origin + right * (hw * 0.38)
        b.box((b_pos.x - 0.040, b_pos.y - 0.040, z0),
              (b_pos.x + 0.040, b_pos.y + 0.040, z0 + 0.095), 'timber_dark', bevel=0)


def cargo_cluster(b, cx, cy, z0, yaw=0.0, seed=1, scale=1.0):
    """Cluster of miniature wooden crates, iron-bound barrels, and ore sacks on a terrace."""
    if not detailed():
        return
    s = scale
    c_y, s_y = math.cos(yaw), math.sin(yaw)
    right = Vector((c_y, s_y, 0.0))
    fwd = Vector((s_y, -c_y, 0.0))
    origin = Vector((cx, cy, z0))

    c1 = origin - right * (0.068 * s)
    b.box((c1.x - 0.052 * s, c1.y - 0.052 * s, z0),
          (c1.x + 0.052 * s, c1.y + 0.052 * s, z0 + 0.088 * s), 'timber', bevel=0)
    b.box((c1.x - 0.038 * s, c1.y - 0.038 * s, z0 + 0.086 * s),
          (c1.x + 0.038 * s, c1.y + 0.038 * s, z0 + 0.155 * s), 'timber_dark', bevel=0)
    for bx_off, by_off in ((0.062 * s, -0.018 * s), (0.032 * s, 0.062 * s)):
        bp = origin + right * bx_off + fwd * by_off
        b.box((bp.x - 0.040 * s, bp.y - 0.040 * s, z0),
              (bp.x + 0.040 * s, bp.y + 0.040 * s, z0 + 0.098 * s), 'timber_dark', bevel=0)
        b.box((bp.x - 0.043 * s, bp.y - 0.043 * s, z0 + 0.064 * s),
              (bp.x + 0.043 * s, bp.y + 0.043 * s, z0 + 0.078 * s), 'iron', bevel=0)


def mini_pine(b, cx, cy, z0, height=0.38, seed=1):
    """Miniature gnarled alpine conifer (`foliage_pine` + `bark`) tucked into rock shelves."""
    rng = random.Random(seed)
    m_base = Matrix.Translation((cx, cy, max(0.0, z0 - 0.02)))
    b.lathe([(0.028, 0.0), (0.018, height * 0.55), (0.008, height * 0.92)], 5, 'bark', m=m_base)
    tiers = 3 if detailed() else 2
    for k in range(tiers):
        t = k / max(1, tiers - 1)
        z_t = height * (0.24 + 0.52 * t)
        r = height * 0.36 * (1.0 - 0.58 * t) * rng.uniform(0.9, 1.1)
        th = height * 0.38 * (1.0 - 0.3 * t)
        b.lathe([(0.0, z_t + th), (r * 0.85, z_t - 0.02), (r, z_t - 0.04), (0.0, z_t + 0.04)],
                7 if detailed() else 5, 'foliage_pine', m=m_base, smooth=False)


def moss_tuft(b, cx, cy, z0, radius=0.12, seed=1):
    """Alpine moss & lichen cushion tucked into crag crevices."""
    if not detailed():
        return
    b.blob((cx, cy, z0 + radius * 0.22), radius, 'grass_upland',
           subdiv=1, squash=(1.2, 1.0, 0.42), jitter=0.25, seed=seed)
    b.blob((cx + radius * 0.35, cy - radius * 0.2, z0 + radius * 0.25), radius * 0.68, 'foliage',
           subdiv=1, squash=(1.0, 1.1, 0.48), jitter=0.25, seed=seed + 1)
