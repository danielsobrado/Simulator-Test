"""Card rectangles on the Poly Haven branch atlases, measured on 2026-11-10 and
corrected against the 2k maps on 2026-11-11
(docs/plans/trees-aaa-plan-2026-11-10.md §5.3).

`[x0, y0, x1, y1]` in pixels of the sheet resized to 512x512, origin top left.
Nothing else on these sheets is usable: the fir sheet's left 105 px is a bark
strip, and 63 % of the pine sheet's alpha is cones, bark and trunk pieces.
"""

REGIONS = {
    'fir_tree_01': {
        'F1': [160, 208, 327, 396],  # large spray
        'F2': [330, 234, 486, 424],  # large spray
        'F3': [335, 27, 478, 188],   # medium spray
        'F4': [97, 25, 208, 158],    # medium spray
        'F5': [255, 135, 320, 204],  # small spray
        'FT': [163, 428, 501, 511],  # bare forked twig (snag only), below the sprays' tips
    },
    'pine_tree_01': {
        'P1': [18, 23, 110, 216],    # needle cluster
        'P2': [350, 176, 478, 264],  # needle cluster
    },
    'island_tree_02': {              # eight single leaves
        'L1': [85, 11, 171, 200],
        'L2': [111, 296, 180, 511],
        'L3': [9, 323, 92, 511],
        'L4': [9, 11, 73, 260],
        'L5': [356, 11, 417, 211],
        'L6': [265, 25, 331, 184],
        'L7': [216, 310, 286, 511],
        'L8': [185, 17, 246, 184],
    },
    'jacaranda_tree': {
        'J1': [150, 13, 505, 240],   # large feathery frond, bare stalk trimmed
        'J2': [215, 302, 511, 505],  # medium frond, both halves, cut at its neighbour
    },
}
