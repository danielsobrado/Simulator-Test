"""Seeded terraced-town generator: a different town map for every seed.

Produces a plan with the same shape as village_plan (W, H, height(), GRASS,
STAIRS, BRIDGES, BUILDINGS, PROPS, LAMPS), so village.build assembles it
unchanged. Pure Python (no bpy), deterministic in (seed, family).

Upgraded for D&D / Baldur's Gate urban streetscapes:
  terraces   three bands climbing +Y whose edges step per column block, plus a
             raised crown terrace for the chapel / keep / guildhall
  streets    continuous 2-cell-wide E-W high streets and N-S avenues connecting
             entrances, terrace stairs, market plaza, and the crown forecourt
  buildings  street-fronting urban rows (terraced townhouses, taverns, smithies,
             bakeries, apothecaries, shops, guildhalls) facing directly onto the
             streets to form enclosed medieval street canyons
  arches     overhead stone arches, half-timbered skybridges, dwarven basalt
             viaducts, and festive bunting spanning across the street canyons
  frontages  role-aware street dressing outside taverns, smithies, bakeries,
             shops, guardhouses, and civic halls
  plaza      bustling market square with civic monuments, stalls, bake ovens,
             armorer stands, notice boards, and stocks
"""
import random
from dataclasses import replace

from .prefab_families import BASE_BY_NAME, FAMILY_BY_NAME
from .town_styles import style_for

# Every stair set climbs one terrace over two cells or two over three.
STAIR_CELLS = {f'{kind}_{units}': units + 1 for units in (1, 2)
               for kind in ('Stairs_Stone', 'Stairs_Boardwalk', 'Stairs_Dark', 'Stairs_Frost', 'Stairs_Granite')}
FACINGS = (0, 0, 2, 1, 3)


class GeneratedVillage:
    STAIR_CELLS = STAIR_CELLS
    BRIDGES = ()

    def __init__(self, seed=1, family='Tudor'):
        if family not in FAMILY_BY_NAME:
            raise ValueError(f'Unknown family {family}; use one of {sorted(FAMILY_BY_NAME)}.')
        self.seed, self.family = seed, family
        self.STYLE = 'goblin' if family == 'Goblin' else 'medieval'
        self.TOWN_STYLE = style_for(family)
        self.stair_mod = 'Stairs_Boardwalk_1' if family == 'Goblin' else f'{self.TOWN_STYLE.stairs}_1'
        self.entrances = []
        self.rng = random.Random(seed)
        self.dress = FAMILY_BY_NAME[family]
        self._terraces()
        self.occupied, self.streets, self.main_streets = set(), set(), set()
        self.spine_y = {}
        self.plaza_center = (self.W // 2, (self.b1 + self.b2) // 2)
        self.STAIRS, self.BUILDINGS, self.PROPS, self.LAMPS = [], [], [], []
        self._chapel()
        self._stairs()
        self._carve_streets()
        self._towers()      # before the houses, which would otherwise take every corner
        self._landmarks()
        self._houses()
        self._street_arches()
        self._plaza()
        self._dress_frontages()
        self._dressing()

    # -- terrain -------------------------------------------------------------
    def _terraces(self):
        rng = self.rng
        self.W, self.H = rng.randint(22, 26), rng.randint(18, 22)
        if self.TOWN_STYLE.under_mountain:
            self.W, self.H = 24, 22
            self.b1 = 6
            self.b2 = 13
            self.hill = True
            self.edge1 = {x: 0 for x in range(self.W)}
            self.edge2 = {x: 0 for x in range(self.W)}
            self.crown = (8, 15, 17, self.H - 1)
            return
        self.b1 = rng.randint(4, 5)
        self.b2 = min(self.b1 + rng.randint(6, 7), self.H - 7)
        self.hill = self.TOWN_STYLE.terrain == 'hill'
        if self.hill:
            # Terrace edges wander smoothly across the town like contour lines on a hillside.
            self.edge1, self.edge2 = self._meander(rng, 1.3), self._meander(rng, 1.5)
        else:
            blocks = range(0, self.W, 4)
            self.step1 = {b: rng.choice((-1, 0, 0, 1)) for b in blocks}
            self.step2 = {b: rng.choice((-1, 0, 0, 1)) for b in blocks}
        tw = rng.randint(7, 9)
        tx = rng.randint(3, self.W - tw - 3)
        ty = self.b2 + 4
        self.crown = (tx, tx + tw - 1, ty, self.H - 1)

    def _meander(self, rng, amp, period=5):
        """Per-column offset (cells) that wanders smoothly within +-amp."""
        knots = [rng.uniform(-amp, amp) for _ in range(self.W // period + 3)]
        out = {}
        for x in range(self.W):
            t = x / period
            i, f = int(t), t - int(t)
            f = f * f * (3 - 2 * f)
            out[x] = round(knots[i] * (1 - f) + knots[i + 1] * f)
        return out

    def height(self, x, y):
        if not (0 <= x < self.W and 0 <= y < self.H):
            return 0
        x0, x1, y0, y1 = self.crown
        if self.hill:
            if y < self.b1 + self.edge1[x]:
                return 1
            if y < self.b2 + self.edge2[x]:
                return 2
            if x0 <= x <= x1 and y0 <= y <= y1:
                return 4
            # The upper terrace falls away at the hill's shoulders.
            return 2 if x < 2 or x >= self.W - 2 else 3
        block = x - x % 4
        if y < self.b1 + self.step1[block]:
            return 1
        if y < self.b2 + self.step2[block]:
            return 2
        return 4 if x0 <= x <= x1 and y0 <= y <= y1 else 3

    def _free(self, cells):
        return all(c not in self.occupied and c not in self.streets and 0 <= c[0] < self.W
                   and 0 <= c[1] < self.H for c in cells)

    # -- stairs & street network ------------------------------------------------
    def _stair_columns(self, level):
        """Columns with a two-cell run at `level` right below a `level + 1` cell."""
        found = []
        for x in range(2, self.W - 2):
            for y in range(0, self.H):
                if (self.height(x, y) == level + 1 and self.height(x, y - 1) == level
                        and self.height(x, y - 2) == level and y - 2 >= (0 if level else -2)):
                    found.append((x, y - 2))
                    break
        return found

    def _place_stairs(self, level, count):
        options = self._stair_columns(level)
        # Prefer stairs near the middle third and flanking avenues so streets align cleanly
        options.sort(key=lambda pos: abs(pos[0] - self.W // 2))
        if len(options) > 4:
            mid = options[:4]
            rest = options[4:]
            self.rng.shuffle(mid)
            self.rng.shuffle(rest)
            options = mid + rest
        else:
            self.rng.shuffle(options)
        placed = []
        for x, y in options:
            if len(placed) >= count or any(abs(x - px) < 5 for px, _ in placed):
                continue
            run = {(x, y), (x, y + 1)}
            if level and any(c in self.occupied for c in run | {(x, y + 2)}):
                continue
            placed.append((x, y))
            self.STAIRS.append((self.stair_mod, x, y))
            self.occupied |= run
            landing = {(x, y - 1), (x, y + 2), (x, y + 3)}
            self.streets |= landing
            self.main_streets |= landing
        return placed

    def _stairs(self):
        if self.TOWN_STYLE.under_mountain:
            c1 = self.W // 2
            self.STAIRS.append((self.stair_mod, c1, -2))
            self.entrances.append(c1)
            # Single monumental mountain-gate stair from Terrace 1 (outside) into Terrace 2 (inside the mountain)
            gy = self.b1 - 2
            self.STAIRS.append((self.stair_mod, c1, gy))
            self.occupied |= {(c1, gy), (c1, gy + 1)}
            # Central subterranean stair from Terrace 2 to Terrace 3 and from Terrace 3 to Crown (Terrace 4)
            s2_y = self.b2 - 2
            self.STAIRS.append((self.stair_mod, c1, s2_y))
            self.occupied |= {(c1, s2_y), (c1, s2_y + 1)}
            _, _, cy0, _ = self.crown
            s3_y = cy0 - 2
            self.STAIRS.append((self.stair_mod, c1, s3_y))
            self.occupied |= {(c1, s3_y), (c1, s3_y + 1)}
            self.stairs_by_level = {
                1: [(c1, gy)],
                2: [(c1, s2_y)] + self._place_stairs(2, 2),
                3: [(c1, s3_y)],
            }
            # Reserve the central subterranean avenue & Upper Vault Courtyard in front of the Crown
            for y in range(0, cy0 + 1):
                for dx in (-1, 0, 1):
                    cell = (c1 + dx, y)
                    if cell not in self.occupied:
                        self.streets.add(cell)
                        self.main_streets.add(cell)
            for y in range(self.b2 + 1, cy0):
                for x in range(c1 - 3, c1 + 4):
                    if (x, y) not in self.occupied:
                        self.streets.add((x, y))
                        self.main_streets.add((x, y))
            return

        # Place main gate entrance near town centre-left and secondary entrance on the right
        c1 = self.rng.randint(max(4, self.W // 3 - 2), self.W // 2)
        c2 = self.rng.randint(self.W // 2 + 3, self.W - 5)
        for x in (c1, c2):
            self.STAIRS.append((self.stair_mod, x, -2))
            landing = {(x, 0), (x, 1), (min(self.W - 2, x + 1), 0), (min(self.W - 2, x + 1), 1)}
            self.streets |= landing
            self.main_streets |= landing
            self.entrances.append(x)
        self.stairs_by_level = {}
        for level in (1, 2):
            self.stairs_by_level[level] = self._place_stairs(level, 2)
        self.stairs_by_level[3] = self._place_stairs(3, 1)

    def _carve_streets(self):
        """Carve continuous E-W High Streets on each terrace band, N-S connecting avenues
        between stair landings, and a central Market Plaza on terrace 2."""
        preferred_spines = {1: 1, 2: 9, 3: 15} if self.TOWN_STYLE.under_mountain else {}
        for level in (1, 2, 3):
            if level in preferred_spines:
                best_y, best_score = preferred_spines[level], 20
            else:
                # Find the row y with the widest flat span at `level`
                best_y, best_score = None, -1
                for y in range(1, self.H - 2):
                    span = sum(
                        1 for x in range(2, self.W - 2)
                        if self.height(x, y) == level and (x, y) not in self.occupied
                    )
                    if span > best_score:
                        best_score, best_y = span, y
            if best_y is not None and best_score >= 6:
                self.spine_y[level] = best_y
                for x in range(2, self.W - 2):
                    if self.height(x, best_y) == level and (x, best_y) not in self.occupied:
                        self.streets.add((x, best_y))
                        self.main_streets.add((x, best_y))
                    # Make the main high street 2 cells wide where terrace height matches
                    if (level == 2 and best_y + 1 < self.H
                            and self.height(x, best_y + 1) == level
                            and (x, best_y + 1) not in self.occupied):
                        self.streets.add((x, best_y + 1))
                        self.main_streets.add((x, best_y + 1))

        # Connect entrance and stair landings vertically to the terrace spines
        anchors = [(x, 0, 1) for x in self.entrances]
        for lvl, sts in self.stairs_by_level.items():
            for sx, sy in sts:
                anchors.append((sx, max(0, sy - 1), lvl))
                anchors.append((sx, min(self.H - 1, sy + 2), lvl + 1))

        for ax, ay, lvl in anchors:
            target_y = self.spine_y.get(lvl)
            if target_y is None:
                continue
            y0, y1 = min(ay, target_y), max(ay, target_y)
            for y in range(y0, y1 + 1):
                for dx in (0, 1):
                    cx = min(self.W - 2, max(1, ax + dx))
                    if self.height(cx, y) == lvl and (cx, y) not in self.occupied:
                        self.streets.add((cx, y))
                        self.main_streets.add((cx, y))

        # Carve a 4x3 Market Plaza on terrace 2 near the town centre
        py = self.spine_y.get(2, (self.b1 + self.b2) // 2)
        px = self.W // 2
        best_plaza = (px, py)
        best_open = -1
        for cand_x in range(5, self.W - 6):
            for cand_y in range(max(2, py - 2), min(self.H - 4, py + 2)):
                cnt = sum(
                    1 for dx in range(-2, 2) for dy in range(-1, 2)
                    if self.height(cand_x + dx, cand_y + dy) == 2
                    and (cand_x + dx, cand_y + dy) not in self.occupied
                )
                if cnt > best_open - abs(cand_x - self.W // 2) * 0.25:
                    best_open = cnt
                    best_plaza = (cand_x, cand_y)
        self.plaza_center = best_plaza
        px, py = best_plaza
        self.plaza_cells = set()
        for dx in range(-2, 2):
            for dy in range(-1, 2):
                c = (px + dx, py + dy)
                if 0 <= c[0] < self.W and 0 <= c[1] < self.H and self.height(*c) == 2 and c not in self.occupied:
                    self.streets.add(c)
                    self.main_streets.add(c)
                    self.plaza_cells.add(c)

    # -- buildings ---------------------------------------------------------------
    @staticmethod
    def _footprint(cx, cy, w, d, rotq):
        fw, fd = (w, d) if rotq % 2 == 0 else (d, w)
        return {(cx + i, cy + j) for i in range(fw) for j in range(fd)}, fw, fd

    @staticmethod
    def _front(cx, cy, fw, fd, rotq):
        if rotq == 0:
            return {(cx + i, cy - 1) for i in range(fw)}
        if rotq == 1:
            return {(cx + fw, cy + j) for j in range(fd)}
        if rotq == 3:
            return {(cx - 1, cy + j) for j in range(fd)}
        return {(cx + i, cy + fd) for i in range(fw)}

    def _can_place(self, spec, cx, cy, rotq):
        cells, fw, fd = self._footprint(cx, cy, spec.w, spec.d, rotq)
        front = self._front(cx, cy, fw, fd, rotq)
        level = self.height(cx, cy)
        if not self._free(cells) or not all(self.height(*c) == level for c in cells | front):
            return None
        if any(c in self.occupied for c in front):
            return None
        return cells, front, fw, fd, level

    def _commit_building(self, spec, cx, cy, rotq, cells, front):
        index = len(self.BUILDINGS)
        named = replace(spec, name=f'{spec.name}_{index}', seed=spec.seed * 31 + index)
        self.BUILDINGS.append((named, cx, cy, rotq))
        self.occupied |= cells
        self.streets |= front
        return True

    def _try_place(self, spec, cx, cy, rotq):
        res = self._can_place(spec, cx, cy, rotq)
        if res is None:
            return False
        cells, front, _, _, _ = res
        return self._commit_building(spec, cx, cy, rotq, cells, front)

    def _try_place_street_front(self, spec, levels):
        """Place `spec` directly fronting an existing street so buildings form continuous,
        enclosed Baldur's Gate urban rows along both sides of the thoroughfares."""
        candidates = []
        for cy in range(0, self.H - 1):
            for cx in range(0, self.W - 1):
                lvl = self.height(cx, cy)
                if lvl not in levels:
                    continue
                for rotq in (0, 2, 1, 3):
                    res = self._can_place(spec, cx, cy, rotq)
                    if res is None:
                        continue
                    cells, front, fw, fd, _ = res
                    # Require at least half the front strip to touch existing streets
                    street_hits = sum(1 for c in front if c in self.streets)
                    if street_hits < max(1, len(front) // 2):
                        continue
                    main_hits = sum(1 for c in front if c in self.main_streets)
                    # Bonus for standing side-by-side next to an existing building (continuous urban row)
                    side_adj = 0
                    for bx, by in cells:
                        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                            nb = (bx + dx, by + dy)
                            if nb not in cells and nb in self.occupied:
                                side_adj += 1
                    # Bonus for facing another building across a 1-2 cell street canyon
                    canyon = 0
                    for fx, fy in front:
                        for step in (1, 2):
                            ox = fx + (step if rotq == 1 else (-step if rotq == 3 else 0))
                            oy = fy + (-step if rotq == 0 else (step if rotq == 2 else 0))
                            if (ox, oy) in self.occupied:
                                canyon += 2
                    score = main_hits * 6 + street_hits * 4 + min(side_adj, 6) * 3 + min(canyon, 6) * 2
                    candidates.append((score + self.rng.uniform(0, 2.5), cx, cy, rotq, cells, front))
        if not candidates:
            return False
        candidates.sort(key=lambda item: item[0], reverse=True)
        _, cx, cy, rotq, cells, front = candidates[0]
        return self._commit_building(spec, cx, cy, rotq, cells, front)

    def _spec(self, base_name):
        return self.dress(BASE_BY_NAME[base_name])

    def _scatter(self, spec, levels, attempts=240, facings=FACINGS):
        # Always prefer street-fronting urban placement first!
        if self._try_place_street_front(spec, levels):
            return True
        for _ in range(attempts):
            cx, cy = self.rng.randrange(self.W), self.rng.randrange(self.H)
            if self.height(cx, cy) in levels and self._try_place(spec, cx, cy, self.rng.choice(facings)):
                return True
        return False

    def _chapel(self):
        """The crown building sits on the top terrace, set back one row for its forecourt."""
        x0, x1, y0, _ = self.crown
        chapel = self._spec(self.TOWN_STYLE.crown)
        spots = [(cx, y0 + 1) for cx in range(x0, x1 + 1)]
        spots.sort(key=lambda pos: abs(pos[0] - (x0 + x1) // 2))
        for spot in spots:
            if self._try_place(chapel, *spot, 0):
                # Mark the crown forecourt as paved street
                for fx in range(spot[0] - 1, spot[0] + chapel.w + 1):
                    if self.height(fx, y0) == 4 and (fx, y0) not in self.occupied:
                        self.streets.add((fx, y0))
                        self.main_streets.add((fx, y0))
                break

    def _landmarks(self):
        if self.TOWN_STYLE.under_mountain:
            # In a Dwarven hold, major civic/guild/keep landmarks stand inside the mountain (levels 2 & 3)
            self._scatter(self._spec(self.TOWN_STYLE.tower), {3}, facings=(0,))
            for name in self.TOWN_STYLE.landmarks:
                self._scatter(self._spec(name), {2, 3})
            return
        self._scatter(self._spec(self.TOWN_STYLE.tower), {1, 3}, facings=(0,))
        for name in self.TOWN_STYLE.landmarks:
            self._scatter(self._spec(name), {1, 2, 3})

    def _houses(self):
        target = max(18, self.W * self.H // self.TOWN_STYLE.density)
        if self.TOWN_STYLE.under_mountain:
            # First place 4 small stone outpost/worker buildings outside the mountain on Terrace 1
            # flanking both sides of the Mountain Gate approach road (y = 1)
            outer_spots = [
                ('House_Small', 7, 2),
                ('House_Cottage', 4, 2),
                ('Shop_Small', 14, 2),
                ('Smithy', 17, 2),
            ]
            for name, ox, oy in outer_spots:
                self._try_place(self._spec(name), ox, oy, 0)
            # Place the entire rest of the city inside the mountain on Terraces 2 & 3
            misses = 0
            while len(self.BUILDINGS) < target and misses < 22:
                name = self.rng.choice(self.TOWN_STYLE.pool)
                if not self._scatter(self._spec(name), {2, 3}, attempts=180):
                    misses += 1
            return
        misses = 0
        while len(self.BUILDINGS) < target and misses < 18:
            name = self.rng.choice(self.TOWN_STYLE.pool)
            if not self._scatter(self._spec(name), {1, 2, 3}, attempts=160):
                misses += 1

    # -- overhead street arches & skybridges ------------------------------------
    def _street_arches(self):
        """Place overhead stone street arches, timber skybridges, dwarven basalt viaducts,
        and market bunting spanning across 2-cell street corridors between buildings."""
        arches = self.TOWN_STYLE.arches
        if not arches:
            return
        bldg_cells = set()
        for spec, cx, cy, rotq in self.BUILDINGS:
            cells, _, _ = self._footprint(cx, cy, spec.w, spec.d, rotq)
            bldg_cells |= cells

        arch_spots = []
        # 1. Check E-W street corridors (arch rotated 90 deg, spanning Y across 2 street rows)
        for x in range(3, self.W - 3):
            for y in range(1, self.H - 2):
                lvl = self.height(x, y)
                if ( (x, y) in self.streets and (x, y + 1) in self.streets
                        and (x, y) not in self.occupied and (x, y + 1) not in self.occupied
                        and self.height(x, y + 1) == lvl ):
                    flank_s = (x, y - 1) in bldg_cells or self.height(x, y - 1) != lvl
                    flank_n = (x, y + 2) in bldg_cells or self.height(x, y + 2) != lvl
                    if flank_s and flank_n:
                        arch_spots.append((2 if (flank_s and flank_n and (x, y - 1) in bldg_cells) else 1,
                                           x + 0.5, y + 1.0, 90))
        # 2. Check N-S street corridors (arch rotated 0 deg, spanning X across 2 street cols)
        for x in range(2, self.W - 3):
            for y in range(1, self.H - 2):
                lvl = self.height(x, y)
                if ( (x, y) in self.streets and (x + 1, y) in self.streets
                        and (x, y) not in self.occupied and (x + 1, y) not in self.occupied
                        and self.height(x + 1, y) == lvl ):
                    flank_w = (x - 1, y) in bldg_cells
                    flank_e = (x + 2, y) in bldg_cells
                    if flank_w or flank_e:
                        arch_spots.append((2 if (flank_w and flank_e) else 1,
                                           x + 1.0, y + 0.5, 0))

        self.rng.shuffle(arch_spots)
        arch_spots.sort(key=lambda item: item[0], reverse=True)
        chosen = []
        for _, ax, ay, rot in arch_spots:
            if len(chosen) >= 4:
                break
            if any((ax - cx) ** 2 + (ay - cy) ** 2 < 18.0 for cx, cy in chosen):
                continue
            mod = arches[len(chosen) % len(arches)]
            self.PROPS.append((mod, ax, ay, rot))
            chosen.append((ax, ay))

    # -- contextual building frontage dressing ----------------------------------
    def _dress_frontages(self):
        """Place role-appropriate D&D street props outside taverns, smithies, bakeries,
        apothecaries, shops, guardhouses, and chapels/guildhalls."""
        is_stonehold = self.family == 'Stonehold'
        is_frostgard = self.family == 'Frostgard'
        is_orc = self.family == 'Orc'
        is_goblin = self.family == 'Goblin'

        role_kits = {
            'inn': ('Tavern_Table_Set', 'Horse_Trough', 'Barrel'),
            'smithy': ('Smelter_Stack', 'Mine_Cart_Track', 'Armorer_Stand') if is_stonehold else ('Armorer_Stand', 'Grindstone', 'Brazier'),
            'bakery': ('Bake_Oven_Outdoor', 'Cargo_Pile', 'Woodpile'),
            'apothecary': ('Alchemist_Stall', 'Market_Stall_Blue', 'Crate'),
            'shop': ('Market_Stall_Red', 'Alchemist_Stall', 'Cargo_Pile') if not is_stonehold else ('Mine_Cart_Track', 'Cargo_Pile', 'Market_Stall_Cream'),
            'keep': ('Guard_Post', 'Stonehold_Ward_Pillar', 'Brazier_Pillar') if is_stonehold else ('Guard_Post', 'Bollards', 'Brazier'),
            'church': ('Stonehold_Ward_Pillar', 'Statue_Plinth') if is_stonehold else ('Statue_Plinth', 'Wayside_Shrine', 'Town_Cross'),
            'library': ('Statue_Plinth', 'Notice_Board', 'Bench'),
            'store': ('Winter_Supply_Sled', 'Cargo_Pile', 'Crate') if is_frostgard else (
                ('Mine_Cart_Track', 'Cargo_Pile', 'Barrel') if is_stonehold else ('Cart', 'Cargo_Pile', 'Barrel')
            ),
        }
        if is_goblin:
            role_kits = {k: ('Cauldron_Fire', 'Goblin_Totem', 'Drying_Rack', 'Basket_Cluster') for k in role_kits}
        elif is_orc:
            role_kits['inn'] = ('Clan_Hearth', 'War_Banner', 'Barrel')
            role_kits['keep'] = ('Guard_Post', 'War_Banner', 'Spike_Barricade')

        for spec, cx, cy, rotq in self.BUILDINGS:
            role = getattr(spec, 'furnish', '')
            kit_choices = role_kits.get(role)
            if not kit_choices:
                continue
            _, fw, fd = self._footprint(cx, cy, spec.w, spec.d, rotq)
            front = sorted(self._front(cx, cy, fw, fd, rotq))
            if not front:
                continue
            # Pick the corner cells of the building's front strip so we never block the central door
            corner_cells = [front[0]] + ([front[-1]] if len(front) > 2 else [])
            base_yaw = {0: 0, 1: 90, 2: 180, 3: 270}.get(rotq, 0)
            for idx, cell in enumerate(corner_cells):
                if cell in self.occupied or not (0 <= cell[0] < self.W and 0 <= cell[1] < self.H):
                    continue
                if self.height(*cell) != self.height(cx, cy):
                    continue
                prop_name = kit_choices[idx % len(kit_choices)]
                self.PROPS.append((prop_name, cell[0] + 0.5, cell[1] + 0.5, base_yaw))
                self.occupied.add(cell)

    # -- open space & market plaza ----------------------------------------------
    def _open_cells(self, level=None):
        return [(x, y) for x in range(self.W) for y in range(self.H)
                if (x, y) not in self.occupied and (level is None or self.height(x, y) == level)]

    def _plaza(self):
        def openness(cell):
            x, y = cell
            return sum((x + dx, y + dy) not in self.occupied and self.height(x + dx, y + dy) == 2
                       for dx in (-1, 0, 1) for dy in (-1, 0, 1))
        cells = self._open_cells(2)
        if not cells:
            return
        wx, wy = max(cells, key=lambda c: (openness(c), -abs(c[0] - self.plaza_center[0]) - abs(c[1] - self.plaza_center[1])))
        self.plaza_center = (wx, wy)
        centerpiece = self.TOWN_STYLE.centerpieces[0]
        self.PROPS.append((centerpiece, wx + 0.5, wy + 0.5, 0))
        self.occupied.add((wx, wy))
        stalls = self.TOWN_STYLE.stalls
        offsets = (
            (-2, -1, 0), (2, -1, 0), (-2, 1, 180), (2, 1, 180),
            (0, -2, 0), (0, 2, 180), (-3, 0, 90), (3, 0, 270),
        )
        placed_stalls = 0
        for dx, dy, rot in offsets:
            if placed_stalls >= min(6, len(stalls)):
                break
            cell = (wx + dx, wy + dy)
            if (0 <= cell[0] < self.W and 0 <= cell[1] < self.H
                    and cell not in self.occupied and self.height(*cell) == 2):
                self.PROPS.append((stalls[placed_stalls], cell[0] + 0.5, cell[1] + 0.5, rot))
                self.occupied.add(cell)
                self.streets.add(cell)
                placed_stalls += 1
        for bx, by, brot in ((wx + 1, wy - 1, 0), (wx - 1, wy + 1, 180)):
            if (bx, by) not in self.occupied and 0 <= bx < self.W and 0 <= by < self.H and self.height(bx, by) == 2:
                self.PROPS.append(('Bench', bx + 0.5, by + 0.5, brot))
                self.occupied.add((bx, by))

    def _dressing(self):
        rng, style = self.rng, self.TOWN_STYLE
        free = [c for c in self._open_cells() if c not in self.streets]
        rng.shuffle(free)
        self.GRASS = set()
        for x, y in free[: int(len(free) * style.grass_share)]:
            self.GRASS.add((x, y))
        greenery = free[: int(len(free) * style.tree_share)]
        for x, y in greenery:
            kind = rng.choice(style.trees)
            self.PROPS.append((kind, x + rng.uniform(0.3, 0.7), y + rng.uniform(0.3, 0.7),
                               rng.uniform(0, 360)))
            self.occupied.add((x, y))

        # Place street lamps along the kerb edges at regular intervals
        streets = sorted(
            c for c in self.streets
            if c not in self.occupied and 0 <= c[1] < self.H and 0 <= c[0] < self.W
        )
        lamp_positions = []
        for x, y in streets:
            if any((x - lx) ** 2 + (y - ly) ** 2 < 9.0 for lx, ly in lamp_positions):
                continue
            lamp_positions.append((x, y))
            self.LAMPS.append((x + 0.16, y + 0.16))

        # Dress street kerbs and corners with regional street furniture
        rng.shuffle(streets)
        street_prop_count = min(18, max(8, len(streets) // 5))
        for x, y in streets[:street_prop_count]:
            if (x, y) in self.occupied:
                continue
            kind = rng.choice(style.yard)
            self.PROPS.append((kind, x + 0.80, y + 0.50, rng.choice((0, 90, 180, 270))))
            self.occupied.add((x, y))

        yards = [c for c in self._open_cells() if c not in self.streets]
        rng.shuffle(yards)
        for module, count in style.extras:
            for _ in range(count):
                if not yards:
                    break
                x, y = yards.pop()
                self.PROPS.append((module, x + 0.5, y + 0.5, rng.choice((0, 90, 180, 270))))
                self.occupied.add((x, y))
        self._surroundings()

    def _towers(self):
        """Watchtowers on the town's corners first, then along its rim: each stands on a grid
        point with the four cells round it free."""
        modules = [m for m, count in self.TOWN_STYLE.towers for _ in range(count)]
        if not modules:
            return
        corners = [(1, 1), (self.W - 1, 1), (1, self.H - 1), (self.W - 1, self.H - 1)]
        rim = [(x, 1) for x in range(3, self.W - 2, 3)] + [(x, self.H - 1) for x in range(3, self.W - 2, 3)]
        rim += [(1, y) for y in range(3, self.H - 2, 3)] + [(self.W - 1, y) for y in range(3, self.H - 2, 3)]
        self.rng.shuffle(rim)
        for gx, gy in corners + rim:
            if not modules:
                return
            cells = {(gx - 1, gy - 1), (gx, gy - 1), (gx - 1, gy), (gx, gy)}
            levels = {self.height(*c) for c in cells}
            if len(levels) != 1 or not self._free(cells):
                continue
            self.PROPS.append((modules.pop(0), gx, gy, self.rng.choice((0, 90, 180, 270))))
            self.occupied |= cells

    def _surroundings(self):
        """Outside the map: a gate tower before the first entrance stair, a rock backdrop,
        and sculpted regional stone formations (such as Stonehold's Vondari crags & shrines)."""
        style = self.TOWN_STYLE
        if style.under_mountain:
            gate_x = self.entrances[0] if self.entrances else self.W // 2
            # 1. Monumental Fortress Mountain Gate carved into the cliff line at y = b1 - 0.65
            self.PROPS.append(('Mountain_Gate_Massif', gate_x + 0.5, self.b1 - 0.65, 0))
            # 2. Seamless Mountain Cliff Wall across the front (y = b1 - 0.65) flanking the Mountain Gate
            for cx in (0.8, 3.6, 7.2, 17.8, 21.4, 23.2):
                self.PROPS.append(('Mountain_Cliff_Wall', cx, self.b1 - 0.65, 0))
            # 3. West, East, and North Mountain Cliff Walls enclosing Terraces 2, 3, and 4
            for cy in range(self.b1 + 2, self.H - 1, 4):
                self.PROPS.append(('Mountain_Cliff_Wall', 0.05, cy + 0.5, 90))
                self.PROPS.append(('Mountain_Cliff_Wall', self.W - 0.05, cy + 0.5, 270))
            for cx in range(2, self.W - 1, 4):
                self.PROPS.append(('Mountain_Cliff_Wall', cx + 1.5, self.H - 0.05, 180))
            # 4. Hollow Mountain Peak & Subterranean Cavern Vault Ceiling covering the indoor city (Terraces 2-4)
            for vy in (self.b1 + 2.8, self.b1 + 7.6, self.b1 + 12.4):
                if vy >= self.H - 0.5:
                    continue
                for vx in (3.6, 9.2, 14.8, 20.4):
                    if vx < self.W - 1.5:
                        self.PROPS.append(('Mountain_Cavern_Vault', vx, vy, 0))
            # 5. Outer mountainside formations & mine ventilation stacks on Terrace 1 and perimeter
            outer_formations = [
                ('Stonehold_Fang_Shrine', -9.0, -6.0, 25),
                ('Stonehold_Ward_Pillar', gate_x - 1.8, self.b1 - 1.5, 0),
                ('Stonehold_Ward_Pillar', gate_x + 2.8, self.b1 - 1.5, 0),
                ('Mine_Vent_Stack', 2.2, 1.2, 15),
                ('Stonehold_Twin_Outcrop', self.W + 12.0, -5.0, -20),
                ('Stonehold_Ledge_Large', -10.0, self.H * 0.45, 65),
                ('Stonehold_Ledge_Large', self.W + 10.0, self.H * 0.45, -65),
                ('Stonehold_Horned_Sanctum', -12.0, self.H + 8.0, 15),
                ('Stonehold_Cavern_Maw', self.W + 12.0, self.H + 8.0, -15),
            ]
            for fmod, fx, fy, frot in outer_formations:
                self.PROPS.append((fmod, fx, fy, frot))
            return

        if style.gate and self.entrances:
            # Gate_Stonehold is 6 m (3 cells) wide; Gate_Tower_Orc is 4 m (2 cells) wide.
            dx = -1.0 if style.gate == 'Gate_Stonehold' else -0.5
            self.PROPS.append((style.gate, self.entrances[0] + dx, -4.0, 0))
        if style.backdrop:
            for x in range(-2, self.W + 2, 2):
                self.PROPS.append((style.backdrop, x, self.H + 0.1, 0))
            for y in range(self.H // 2, self.H, 2):
                self.PROPS.append((style.backdrop, -0.1, y, 90))
                self.PROPS.append((style.backdrop, self.W + 0.1, y + 2, 270))
        if style.formations:
            # Frame the city's approaches, lower crags, and upper mountain shoulders
            gate_x = self.entrances[0] if self.entrances else self.W // 2
            perimeter_spots = [
                (gate_x - 3.2, -2.2, 20),
                (gate_x + 4.2, -2.0, -25),
                (-1.8, 3.5, 75),
                (self.W + 1.6, 4.0, -75),
                (-1.8, self.b2 + 1.5, 65),
                (self.W + 1.6, self.b2 + 2.0, -65),
                (2.2, self.H - 1.5, 15),
                (self.W - 2.5, self.H - 1.5, -15),
            ]
            for idx, (fx, fy, frot) in enumerate(perimeter_spots):
                fmod = style.formations[idx % len(style.formations)]
                self.PROPS.append((fmod, fx, fy, frot))
