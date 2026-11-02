/** Measure the visible foot of a flared root mesh once per prototype. An
 * isolated downward tip must not ground the whole root plate above the soil.
 * Narrow trunks and low branches do not establish a broad, surrounding plate.
 */
export function prototypeRootSeat(parts) {
  // Grown roots are built on the bole's foot and dive below it on purpose: their
  // lowest tips are not a plate standing above the soil.
  if (parts.some(p => p.kind === 'trunk' && p.bole)) return { seat: 0, reach: 0 };
  const positions = parts.filter(p => p.kind === 'trunk').map(p => p.geometry.getAttribute('position')).filter(Boolean);
  let minimum = Infinity, maximum = -Infinity;
  for (const attribute of positions) for (let i = 0; i < attribute.count; i++) {
    minimum = Math.min(minimum, attribute.getY(i)); maximum = Math.max(maximum, attribute.getY(i));
  }
  const height = maximum - minimum;
  if (!(height > 0)) return { seat: 0, reach: 0 };
  const band = Math.min(.9, height * .06), roots = [], stem = [];
  let reach = 0;
  for (const attribute of positions) for (let i = 0; i < attribute.count; i++) {
    const x = attribute.getX(i), z = attribute.getZ(i), y = attribute.getY(i) - minimum;
    const radius = Math.hypot(x, z);
    if (y <= band) { roots.push({ x, y, z, radius }); reach = Math.max(reach, radius); }
    else if (y <= band * 2) stem.push(radius);
  }
  stem.sort((a, b) => a - b);
  if (!stem.length || reach < stem[Math.floor(stem.length * .9)] * 1.5) return { seat: 0, reach: 0 };
  const outer = roots.filter(p => p.radius >= reach * .65);
  const quadrants = new Set(outer.map(p => (p.x >= 0 ? 1 : 0) + (p.z >= 0 ? 2 : 0)));
  if (outer.length < 6 || quadrants.size < 3) return { seat: 0, reach: 0 };
  outer.sort((a, b) => a.y - b.y);
  return { seat: Math.min(.6, height * .03, outer[Math.floor(outer.length / 2)].y), reach };
}
