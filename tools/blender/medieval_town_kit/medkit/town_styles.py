"""How a generated town of each family is dressed: ground, terrace edges, stairs, street fire,
greenery, street arches, contextual frontage props, the square, the crown building and the
town edge (pure data, no bpy).

Every regional family (`Tudor`, `Nordic`, `Med`, `Orc`, `Frostgard`, `Stonehold`, `Goblin`)
has a distinct architectural and street-life profile grounded in the Drusniel asset bible.
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class TownStyle:
    street: str = 'Tile_Cobble'
    grass: str = 'Tile_Grass'
    wall: str = 'Terrace_Wall'
    pillar: str = 'Terrace_Wall_Pillar'
    coping: str = 'Terrace_Coping'
    railing: str = 'Railing_Wood'
    stairs: str = 'Stairs_Stone'            # + '_1' / '_2'
    lamp: str = 'Lamp_Post_Banner'
    lamp_light: float = 2.7                 # light height above the lamp's foot (preview only)
    trees: tuple = ('Tree_Oak', 'Tree_Cypress', 'Tree_Cypress', 'Bush', 'Bush')
    yard: tuple = (
        'Barrel', 'Crate', 'Cart', 'Woodpile', 'Horse_Trough', 'Brazier', 'Cargo_Pile',
        'Signpost', 'Wayside_Shrine', 'Bollards', 'Tavern_Table_Set', 'Guard_Post',
    )
    arches: tuple = ('Street_Arch_Stone', 'Street_Arch_Timber', 'Street_Bunting')
    centerpieces: tuple = ('Statue_Plinth', 'Fountain', 'Well', 'Town_Cross')
    stalls: tuple = (
        'Market_Stall_Cream', 'Market_Stall_Blue', 'Market_Stall_Red',
        'Alchemist_Stall', 'Armorer_Stand', 'Bake_Oven_Outdoor', 'Notice_Board', 'Pillory_Stocks',
    )
    crown: str = 'Chapel'
    tower: str = 'Tower'
    landmarks: tuple = ('Tavern_Large', 'Guildhall', 'Manor', 'Townhouse_Wide', 'Smithy', 'Bakery', 'Apothecary')
    pool: tuple = (
        'Townhouse_Narrow', 'Townhouse_Tall', 'Townhouse_Wide', 'Shop_Small', 'Shop_Large',
        'House_Large', 'House_Square', 'House_Long', 'House_Small', 'House_Cottage',
        'Bakery', 'Smithy', 'Apothecary', 'Tavern', 'Guardhouse', 'Library', 'Warehouse',
    )
    terrain: str = 'bands'                  # 'bands' (straight stepped terraces) | 'hill' (meandering)
    density: int = 11                       # one building per this many cells
    grass_share: float = 0.22               # of the open, non-street cells
    tree_share: float = 0.14
    # Map edge: the module that replaces the railing on the town's outer terrace edges,
    # and what stands outside the map ('' = nothing).
    rim: str = ''
    rim_sides: tuple = ('S', 'E', 'N', 'W')
    backdrop: str = ''
    gate: str = ''                          # stands in front of the first outside stair
    extras: tuple = field(default_factory=tuple)   # (module, count) set in open yards
    towers: tuple = ()                      # (module, count) watchtowers on the corners and rim
    formations: tuple = ()                  # regional rock/crag formations around perimeter/terraces
    under_mountain: bool = False            # true for Dwarven holds built mostly inside a mountain
    outer_pool: tuple = ()                  # small outpost/worker buildings allowed outside the mountain


DEFAULT = TownStyle(
    extras=(
        ('Tavern_Table_Set', 2), ('Bake_Oven_Outdoor', 1), ('Armorer_Stand', 1),
        ('Alchemist_Stall', 1), ('Guard_Post', 1), ('Pillory_Stocks', 1),
    ),
)

STYLES = {
    # Lumeshire / Tudor: Baldur's Gate-style half-timbered jettied streets, covered timber
    # skybridges, stone street arches, bustling market stalls, outdoor bake ovens, tavern tables.
    'Tudor': DEFAULT,

    # Zuraldi / Nordic: dark-timber & slate guild-hall city with carved stone crosses,
    # heavy stone street arches, outdoor tavern benches, armorer stands, and pine/oak trees.
    'Nordic': TownStyle(
        street='Tile_Cobble', grass='Tile_Grass',
        wall='Terrace_Wall', pillar='Terrace_Wall_Pillar',
        coping='Terrace_Coping', railing='Railing_Wood',
        stairs='Stairs_Stone', lamp='Lamp_Post_Banner', lamp_light=2.7,
        trees=('Tree_Pine', 'Tree_Oak', 'Tree_Pine_Tall', 'Bush'),
        yard=(
            'Barrel', 'Crate', 'Cart', 'Woodpile', 'Horse_Trough', 'Brazier', 'Cargo_Pile',
            'Signpost', 'Town_Cross', 'Bollards', 'Tavern_Table_Set', 'Armorer_Stand', 'Guard_Post',
        ),
        arches=('Street_Arch_Stone', 'Street_Arch_Timber', 'Street_Arch_Stone'),
        centerpieces=('Statue_Plinth', 'Town_Cross', 'Well'),
        stalls=(
            'Market_Stall_Blue', 'Market_Stall_Red', 'Armorer_Stand',
            'Tavern_Table_Set', 'Bake_Oven_Outdoor', 'Notice_Board',
        ),
        crown='Keep', tower='Tower',
        landmarks=('Guildhall', 'Tavern_Large', 'Manor', 'Smithy', 'Bakery', 'Guardhouse'),
        pool=(
            'Townhouse_Narrow', 'Townhouse_Tall', 'Townhouse_Wide', 'House_Large', 'House_Long',
            'House_Square', 'Shop_Small', 'Shop_Large', 'Smithy', 'Bakery', 'Tavern',
            'Guardhouse', 'Warehouse', 'Library',
        ),
        density=11, grass_share=0.24, tree_share=0.15,
        extras=(
            ('Tavern_Table_Set', 2), ('Armorer_Stand', 2), ('Guard_Post', 1),
            ('Bake_Oven_Outdoor', 1), ('Woodpile', 2),
        ),
    ),

    # Contia / Mediterranean: sun-warmed stucco & arcaded stone piazzas, fountains, bronze
    # hero statues,stone street arches, festive bunting, alchemist stalls, and cypresses.
    'Med': TownStyle(
        street='Tile_Cobble', grass='Tile_Grass',
        wall='Terrace_Wall', pillar='Terrace_Wall_Pillar',
        coping='Terrace_Coping', railing='Railing_Wood',
        stairs='Stairs_Stone', lamp='Lamp_Post_Banner', lamp_light=2.7,
        trees=('Tree_Cypress', 'Tree_Cypress', 'Tree_Cypress', 'Tree_Oak', 'Bush'),
        yard=(
            'Barrel', 'Crate', 'Cart', 'Horse_Trough', 'Brazier', 'Cargo_Pile',
            'Wayside_Shrine', 'Bollards', 'Tavern_Table_Set', 'Alchemist_Stall', 'Statue_Plinth',
        ),
        arches=('Street_Arch_Stone', 'Street_Bunting', 'Street_Arch_Stone'),
        centerpieces=('Fountain', 'Statue_Plinth', 'Well'),
        stalls=(
            'Market_Stall_Red', 'Market_Stall_Cream', 'Alchemist_Stall',
            'Market_Stall_Blue', 'Tavern_Table_Set', 'Bake_Oven_Outdoor',
        ),
        crown='Chapel', tower='Tower',
        landmarks=('Manor', 'Guildhall', 'Tavern_Large', 'Townhouse_Wide', 'Apothecary', 'Shop_Large'),
        pool=(
            'Townhouse_Narrow', 'Townhouse_Tall', 'Townhouse_Wide', 'Shop_Small', 'Shop_Large',
            'Manor', 'House_Large', 'House_Square', 'Apothecary', 'Bakery', 'Tavern',
            'Library', 'Guardhouse', 'Warehouse',
        ),
        density=11, grass_share=0.20, tree_share=0.15,
        extras=(
            ('Tavern_Table_Set', 3), ('Alchemist_Stall', 2), ('Statue_Plinth', 1),
            ('Bake_Oven_Outdoor', 1), ('Wayside_Shrine', 1),
        ),
    ),

    # Grukmar upland ridge-hold: earth lanes, dark stone terraces, stake edges, a palisade
    # rim and a gate tower, the clan hearth with red banners, armorer racks & guard checkpoints.
    'Orc': TownStyle(
        terrain='hill',
        street='Tile_Earth', grass='Tile_Grass_Upland', wall='Terrace_Wall_Dark', pillar='Terrace_Wall_Dark_Pillar',
        coping='Terrace_Coping_Dark', railing='Railing_Stakes', stairs='Stairs_Dark',
        lamp='Fire_Post', lamp_light=2.55,
        trees=('Tree_Oak', 'Tree_Oak', 'Bush', 'Bush', 'Tree_Pine'),
        yard=(
            'Barrel', 'Crate', 'Cart', 'Woodpile', 'Drying_Rack', 'Cargo_Pile',
            'Grindstone', 'Armorer_Stand', 'Guard_Post', 'Brazier', 'Spike_Barricade',
        ),
        arches=('Street_Bunting',),
        centerpieces=('Clan_Hearth',),
        stalls=('War_Banner', 'Armorer_Stand', 'Market_Stall_Red', 'Guard_Post', 'War_Banner', 'Grindstone'),
        crown='Manor', landmarks=('Tavern_Large', 'Tavern', 'Smithy', 'Guardhouse', 'Warehouse'),
        pool=(
            'House_Small', 'House_Large', 'House_Long', 'House_Cottage', 'House_Square',
            'Farmhouse_Small', 'Smithy', 'Smithy', 'Warehouse', 'Shop_Small', 'Guardhouse', 'Tavern',
        ),
        density=14, grass_share=0.32, tree_share=0.16, rim='Palisade_Orc', gate='Gate_Tower_Orc',
        extras=(
            ('War_Banner', 5), ('Drying_Rack', 2), ('Armorer_Stand', 2),
            ('Guard_Post', 2), ('Clan_Hearth', 1),
        ),
        towers=(('Watchtower_Orc', 4),),
    ),

    # Frostgard: trodden snow lanes and snowfields, rugged granite terraces, split-log edges, a
    # windbreak rim on the weather sides, conifers, an oath-stone square, supply sleds, longhall crown.
    'Frostgard': TownStyle(
        terrain='hill',
        street='Tile_Snow_Path', grass='Tile_Snow', wall='Terrace_Wall_Frost',
        pillar='Terrace_Wall_Frost_Pillar', coping='Terrace_Coping_Frost', railing='Railing_Log',
        stairs='Stairs_Frost', lamp='Fire_Post', lamp_light=2.55,
        trees=('Tree_Pine_Snow', 'Tree_Pine_Snow', 'Tree_Pine_Snow_Tall', 'Boulder_Cluster'),
        yard=(
            'Winter_Supply_Sled', 'Barrel', 'Woodpile', 'Cart', 'Drying_Rack', 'Crate',
            'Boulder_Cluster', 'Tavern_Table_Set', 'Armorer_Stand', 'Guard_Post', 'Brazier',
        ),
        arches=('Street_Arch_Timber', 'Street_Bunting'),
        centerpieces=('Rune_Stone', 'Clan_Hearth'),
        stalls=(
            'Rune_Stone', 'Winter_Supply_Sled', 'Armorer_Stand',
            'Bake_Oven_Outdoor', 'Tavern_Table_Set', 'Notice_Board',
        ),
        crown='Tavern_Large', landmarks=('Guildhall', 'Tavern', 'Smithy', 'Bakery', 'Warehouse'),
        pool=(
            'House_Small', 'House_Large', 'House_Long', 'House_Cottage', 'House_Square', 'House_Long',
            'Farmhouse_Small', 'Smithy', 'Warehouse', 'Bakery', 'Tavern', 'Guardhouse', 'Shop_Small',
        ),
        density=14, grass_share=0.35, tree_share=0.18, rim='Windbreak_Wall', rim_sides=('E', 'N', 'W'),
        extras=(
            ('Winter_Supply_Sled', 4), ('Boulder_Cluster', 3), ('Woodpile', 3),
            ('Bake_Oven_Outdoor', 1), ('Guard_Post', 1), ('Rune_Stone', 2),
        ),
        towers=(('Watchtower_Frost', 3),),
    ),

    # Stonehold (Vondari Dwarven & Gnome mountain-hold citadel): flagged basalt/granite streets,
    # granite terraces with basalt piers, parapet edges, dwarven squared granite viaduct arches,
    # smelter stacks, mine cart tracks, ore cranes, ward pillars, Gate_Stonehold, and sculpted
    # crag/geothermal stone formations framing the hold.
    'Stonehold': TownStyle(
        terrain='hill',
        street='Tile_Flagstone', grass='Tile_Earth', wall='Terrace_Wall_Granite',
        pillar='Terrace_Wall_Granite_Pillar', coping='Terrace_Coping_Granite', railing='Railing_Parapet',
        stairs='Stairs_Granite', lamp='Brazier_Pillar', lamp_light=1.5,
        trees=('Boulder_Cluster', 'Tree_Pine', 'Boulder_Cluster'),
        yard=(
            'Mine_Cart_Track', 'Smelter_Stack', 'Stonehold_Ward_Pillar', 'Armorer_Stand',
            'Cargo_Pile', 'Crate', 'Barrel', 'Grindstone', 'Brazier_Pillar', 'Guard_Post',
            'Tavern_Table_Set',
        ),
        arches=('Street_Arch_Granite', 'Street_Arch_Granite', 'Street_Arch_Stone'),
        centerpieces=('Ore_Crane', 'Statue_Plinth', 'Stonehold_Ward_Pillar'),
        stalls=(
            'Smelter_Stack', 'Mine_Cart_Track', 'Armorer_Stand', 'Ore_Crane',
            'Stonehold_Ward_Pillar', 'Cargo_Pile', 'Market_Stall_Cream', 'Notice_Board',
        ),
        crown='Guildhall', tower='Keep',
        landmarks=('Keep', 'Guildhall', 'Townhouse_Wide', 'Smithy', 'Smithy', 'Tavern_Large', 'Guardhouse'),
        pool=(
            'Townhouse_Narrow', 'Townhouse_Tall', 'Townhouse_Wide', 'House_Square', 'House_Large',
            'Shop_Small', 'Shop_Large', 'Smithy', 'Smithy', 'Warehouse', 'Guardhouse', 'Library', 'Tavern',
        ),
        density=11, grass_share=0.08, tree_share=0.06,
        backdrop='', gate='',
        under_mountain=True,
        outer_pool=(
            'House_Cottage', 'House_Small', 'Smithy', 'Shop_Small', 'Guardhouse',
        ),
        extras=(
            ('Mine_Cart_Track', 3), ('Smelter_Stack', 2), ('Stonehold_Ward_Pillar', 3),
            ('Ore_Crane', 2), ('Armorer_Stand', 2), ('Mine_Vent_Stack', 2),
        ),
        formations=(
            'Stonehold_Horned_Sanctum', 'Stonehold_Cavern_Maw', 'Stonehold_Fang_Shrine',
            'Stonehold_Caldera_Basin', 'Stonehold_Twin_Outcrop', 'Stonehold_Ledge_Large',
            'Stonehold_Vent_Crater', 'Stonehold_Ledge_Small',
        ),
    ),

    # Goblin swamp stilt bazaar: dense boardwalk thoroughfares, rope bridges, cauldron fires,
    # totems, drying & fishing racks, loot piles, and shaman shrines.
    'Goblin': TownStyle(
        street='Tile_Boardwalk', grass='Tile_Grass',
        stairs='Stairs_Boardwalk', lamp='Torch_Pole', lamp_light=2.65,
        trees=('Swamp_Tree', 'Bush', 'Mud_Bank'),
        yard=(
            'Cauldron_Fire', 'Goblin_Totem', 'Drying_Rack', 'Fishing_Net_Rack',
            'Basket_Cluster', 'Spike_Barricade', 'Barrel', 'Crate', 'Cargo_Pile',
        ),
        arches=('Street_Bunting',),
        centerpieces=('Cauldron_Fire', 'Goblin_Totem'),
        stalls=(
            'Goblin_Totem', 'Drying_Rack', 'Fishing_Net_Rack',
            'Basket_Cluster', 'Spike_Barricade', 'Cauldron_Fire',
        ),
        crown='Tavern_Large', tower='Tower',
        landmarks=('Tavern', 'Shop_Small', 'Smithy', 'Guardhouse'),
        pool=(
            'House_Small', 'House_Large', 'House_Cottage', 'House_Square',
            'Shop_Small', 'Tavern', 'Smithy', 'Guardhouse',
        ),
        density=12, grass_share=0.18, tree_share=0.12,
        extras=(
            ('Cauldron_Fire', 3), ('Goblin_Totem', 3), ('Spike_Barricade', 2),
            ('Goblin_Skiff', 2), ('Drying_Rack', 2),
        ),
    ),
}


def style_for(family):
    return STYLES.get(family, DEFAULT)
