"""Whorled conifers: a straight leader with rings of branches (trees plan §5.5).

`whorled_conifer` returns the skeleton and the card placements; the builder
turns them into the bark and leaf meshes, as the swamp and savanna builders do
with `grow`.
"""
import math

from mathutils import Vector

from tree_kit import Branch

GOLDEN = 2.39996


def trunk_sampler(points, radii, height):
    def at(z):
        f = min(max(z / height, 0), 1) * (len(points) - 1)
        i = min(int(f), len(points) - 2)
        return points[i].lerp(points[i + 1], f - i), radii[i] + (radii[i + 1] - radii[i]) * (f - i)
    return at


def whorled_conifer(rng, spec):
    """`spec`: height, crown, base_radius, clear_bole, whorl_spacing, per_whorl,
    profile_power, droop, stations, station_range, tuft (cards per station, splay),
    card_width, lean, regions,
    top_regions, stubs, and optionally tip_radius and length_range (a snag).
    Returns (branches, cards); a card is {base, dir, width, key, roll, whorl, branch}."""
    height, crown, base_radius = spec['height'], spec['crown'], spec['base_radius']
    tip_radius = spec.get('tip_radius', 0.03)
    bole = spec['clear_bole'] * height
    heading, phase = rng.uniform(0, 6.28), rng.uniform(0, 6.28)
    lean_dir = Vector((math.cos(heading), math.sin(heading), 0))
    points, radii = [], []
    for i in range(15):
        t = i / 14
        z = t * height
        wobble = Vector((math.sin(phase + t * 5.1), math.cos(phase * 1.7 + t * 4.3), 0)) * 0.15 * math.sin(math.pi * t)
        points.append(lean_dir * spec['lean'] * z + wobble + Vector((0, 0, z)))
        radii.append(base_radius * (1 - 0.2 * z / bole) if z < bole
                     else base_radius * 0.8 + (tip_radius - base_radius * 0.8) * (z - bole) / (height - bole))
    branches, cards = [Branch(points, radii, 0)], []
    trunk_at = trunk_sampler(points, radii, height)

    def pick(t):
        return rng.choice(spec['top_regions'] if t > 0.75 else spec['regions'])

    stations, (near, far) = spec['stations'], spec.get('station_range', (0.3, 0.9))
    segments = 3 if spec['droop'] < 0 else 2  # a rising pine limb needs the extra bend
    count, spread = spec.get('tuft', (2, 0.0))
    whorl, turn, z = 0, rng.uniform(0, 6.28), bole
    top = height * (0.94 if stations else 0.97)
    while z < top:
        t = (z - bole) / (height - bole)
        reach = crown * (1 - t) ** spec['profile_power']
        start, trunk_radius = trunk_at(z)
        for k in range(spec['per_whorl']):
            angle = turn + k * 6.28318 / spec['per_whorl'] + rng.uniform(-0.2, 0.2)
            length = rng.uniform(*spec['length_range']) if 'length_range' in spec else reach * 0.85 * rng.uniform(0.88, 1.12)
            if length < 0.25:
                continue
            pts, dirs, pos = [start.copy()], [], start.copy()
            for j in range(segments):
                f = (j + 0.5) / segments
                elevation = 0.15 * (1 - f) - spec['droop'] * f
                d = Vector((math.cos(angle) * math.cos(elevation), math.sin(angle) * math.cos(elevation), math.sin(elevation)))
                pos = pos + d * length / segments
                pts.append(pos.copy())
                dirs.append(d)
            r0 = max(0.02, min(0.07, trunk_radius * 0.35))
            branches.append(Branch(pts, [r0 + (0.012 - r0) * j / segments for j in range(segments + 1)], 1))
            for s in range(stations):
                f = near if stations == 1 else near + (far - near) * s / (stations - 1)
                at = min(int(f * segments), segments - 1)
                base = pts[at].lerp(pts[at + 1], f * segments - at)
                roll = rng.uniform(0, 3.14)
                key = pick(t)
                width = spec['card_width'] * (0.45 + 0.55 * reach / crown)
                for c in range(count):
                    # A tuft: cards turned evenly about the branch and splayed a little off it.
                    d = (dirs[at] + Vector([rng.gauss(0, spread) for _ in range(3)])).normalized() if spread else dirs[at]
                    cards.append({'base': base, 'dir': d, 'width': width, 'key': key,
                                  'roll': roll + c * math.pi / count, 'whorl': whorl, 'branch': k})
        whorl += 1
        turn += GOLDEN
        z += spec['whorl_spacing']
    if stations:
        # The top of the crown is one upright leader pair.
        base, _ = trunk_at(height * 0.9)
        key, roll = pick(1.0), rng.uniform(0, 3.14)
        for twist in (0.0, math.pi / 2):
            cards.append({'base': base, 'dir': Vector((0, 0, 1)), 'width': spec['card_width'] * 0.55, 'key': key,
                          'roll': roll + twist, 'whorl': whorl, 'branch': 0})
    for _ in range(rng.randint(3, 5) if spec.get('stubs') else 0):
        # Bare, broken stubs where the lower crown has died back.
        start, _ = trunk_at(bole * rng.uniform(0.35, 0.95))
        angle = rng.uniform(0, 6.28)
        d = Vector((math.cos(angle), math.sin(angle), rng.uniform(-0.25, 0.1))).normalized()
        branches.append(Branch([start, start + d * rng.uniform(0.3, 0.9)], [0.03, 0.02], 1))
    return branches, cards


def drop_to_limit(cards, triangle_limit):
    """Whole cards only, lowest whorls first, alternating branches."""
    order = sorted(range(len(cards)), key=lambda i: (cards[i]['whorl'], cards[i]['branch'] % 2 == 0))
    excess = len(cards) - triangle_limit // 2
    dropped = set(order[:max(0, excess)])
    return [card for i, card in enumerate(cards) if i not in dropped]
