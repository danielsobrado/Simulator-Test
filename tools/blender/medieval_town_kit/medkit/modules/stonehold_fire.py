"""Fire cards use shared emission/alpha maps and stay in the module's opaque batch."""
import math

from mathutils import Vector


def flame(b, centre, radius, height):
    c = Vector(centre)
    for angle in (0, math.pi / 2):
        side = Vector((math.cos(angle), math.sin(angle), 0)) * radius
        top = Vector((0, 0, height))
        quad = [c - side, c + side, c + side + top, c - side + top]
        uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
        b.poly(quad, 'hold_flame', uvs=uvs)
        b.poly(list(reversed(quad)), 'hold_flame', uvs=list(reversed(uvs)))
