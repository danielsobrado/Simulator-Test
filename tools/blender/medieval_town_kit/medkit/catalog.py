"""Defines every kit module and lays the catalog out in rows for browsing."""
from mathutils import Vector

from .kit import Kit
from .modules import (accents, city_street_life, defences, floors, foundations, goblin, goblin_props, interior,
                      interior_trade, nature, palisade, props, regional_formations, roof_shapes, roofs, roofs_regional,
                      props_regional, terrain, terrain_regional, towers, walls, walls_frontier,
                      walls_regional, walls_stonehold, towers_regional)

FAMILIES = (walls, walls_regional, foundations, floors, roofs, roof_shapes, terrain, defences, towers, props,
            city_street_life, nature, interior, interior_trade, accents, goblin, goblin_props,
            walls_frontier, roofs_regional, palisade, walls_stonehold, terrain_regional, props_regional,
            towers_regional, regional_formations)
CATALOG_ORIGIN = Vector((0.0, -24.0, 0.0))
# Modules only seen from inside a building; the game draws them only near the viewer.
INTERIOR = {
    'Floor_Ground', 'Floor_Planks', 'Floor_Stairwell_L', 'Floor_Stairwell_R',
    'Floor_Landing_L', 'Floor_Landing_R', 'Stairs_Interior_L', 'Stairs_Interior_R',
    'Table', 'Bed', 'Hearth', 'Shelf', 'Rug', 'Pew', 'Stool', 'Chest',
    'Bookcase', 'Writing_Desk', 'Wardrobe', 'Counter', 'Cask_Rack', 'Chandelier',
    'Wall_Sconce', 'Wall_Shield', 'Wall_Tapestry', 'Anvil_Block', 'Forge_Hood',
    'Bake_Oven', 'Stone_Altar', 'Lectern', 'Candelabra', 'Weapon_Rack',
    'Flour_Sacks', 'Alchemist_Table', 'Goblin_Firepit', 'Goblin_Nest',
    'Bone_Throne', 'Shaman_Altar', 'Loot_Pile', 'Meat_Rack',
}


def _layout(kit):
    rows = {}
    for obj in kit.modules.values():
        rows.setdefault(obj['kit_category'], []).append(obj)
    y = CATALOG_ORIGIN.y
    for objs in rows.values():
        x, depth = CATALOG_ORIGIN.x, 0.0
        for obj in objs:
            xs = [v.co.x for v in obj.data.vertices]
            ys = [v.co.y for v in obj.data.vertices]
            obj.location = (x - min(xs), y - max(ys), 0)
            x += max(xs) - min(xs) + 1.0
            depth = max(depth, max(ys) - min(ys))
        y -= depth + 2.0


def build_kit():
    kit = Kit()
    goblin_names = {'Plinth_Stilts', 'Plinth_Stilts_Corner', 'Entry_Steps_Stilts'}
    for family in FAMILIES:
        before = set(kit.modules.keys())
        family.define(kit)
        if family in (goblin, goblin_props):
            goblin_names |= set(kit.modules.keys()) - before
    for name in INTERIOR & kit.modules.keys():
        kit.modules[name]['kit_interior'] = True
    for name in goblin_names & kit.modules.keys():
        kit.modules[name]['kit_goblin'] = True
    _layout(kit)
    print(f'[kit] {len(kit.modules)} modules defined ({len(goblin_names)} goblin lego modules)')
    return kit
