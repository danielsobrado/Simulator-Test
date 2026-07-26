export function clumpsPerCell(bladesPerCell, bladesPerClump) {
  if (!Number.isInteger(bladesPerCell) || bladesPerCell < 1) {
    throw new Error('bladesPerCell must be a positive integer.');
  }
  if (!Number.isInteger(bladesPerClump) || bladesPerClump < 1) {
    throw new Error('bladesPerClump must be a positive integer.');
  }
  return Math.ceil(bladesPerCell / bladesPerClump);
}

/**
 * Triangles a blade costs at `segments` height divisions: each division above the
 * first contributes a quad, and the tip contributes one triangle. So 3 segments is
 * 5 triangles and 1 segment is a single triangle — the cheap band.
 */
export function trianglesPerBlade(segments) {
  if (!Number.isInteger(segments) || segments < 1) {
    throw new Error('segments must be a positive integer.');
  }
  return segments * 2 - 1;
}

/**
 * Which blade geometry a chunk at `distance` chunks from the focus should use.
 *
 * Grass used to have one band and simply stop at `residentRadius`, which left the
 * terrain shader's faked distant cover to pick up from much further out. A cheap
 * middle band — full-shape blades near, single-triangle blades beyond — is what
 * lets real grass reach past the near ring without paying near-band cost for it.
 */
export function grassLodBand(distance, nearRadius) {
  return distance <= nearRadius ? 'near' : 'far';
}

/** Mean centre-to-centre distance between clumps at a given per-cell count. */
export function clumpSpacing(clumpsPerCellCount, tileSize) {
  const perSquareMetre = clumpsPerCellCount / (tileSize * tileSize);
  return 1 / Math.sqrt(Math.max(1e-6, perSquareMetre));
}

/**
 * Whether clumps overlap into continuous ground cover rather than reading as
 * separate tufts with bare ground between them. Meadow grass is a carpet; a field
 * of discrete pom-poms is the failure mode when blade count per clump goes up
 * without the clump footprint following it.
 *
 * `clumpRadius` is in metres and no longer depends on blade width. It used to be
 * expressed in blade-widths, because the clump's blade offsets and each blade's
 * half-width shared one local geometry that the shader scaled by the instance's
 * width — which meant a clump's footprint moved with how wide its blades were,
 * and narrowing blades to fix the ribbon silhouette would have shrunk every
 * clump by the same factor and broken the field into tufts. `createClumpGeometry`
 * now keeps the two in separate channels.
 */
export function clumpsFormCarpet(clumpRadius, clumpsPerCellCount, tileSize) {
  return clumpRadius * 2 >= clumpSpacing(clumpsPerCellCount, tileSize);
}

/**
 * Blade length fraction for a uniform roll, skewed toward the short end.
 *
 * Rolling length flat between min and max concentrates a field around "all
 * medium", which reads as a mown lawn or a crop rather than unmanaged grassland —
 * real sward is mostly short with a scattered tall minority. Raising the roll to a
 * power above 1 produces that without a branch or a second random draw.
 *
 * This mirrors what the vertex shader computes; it exists so the distribution the
 * config claims can be asserted rather than asserted-in-a-comment. Keep the two in
 * step.
 */
export function bladeLengthFraction(roll, skew = 1) {
  return Math.max(0, Math.min(1, roll)) ** skew;
}

export function densityForDistance(distance, radius, farDensity) {
  if (radius <= 0 || distance <= 0) return 1;
  const amount = Math.min(1, distance / radius);
  return 1 + (farDensity - 1) * amount;
}

export function grassInstanceAttributeBytes({
  chunkSize,
  bladesPerCell,
  bladesPerClump,
  floatsPerInstance = 7,
}) {
  return chunkSize * chunkSize
    * clumpsPerCell(bladesPerCell, bladesPerClump)
    * floatsPerInstance
    * Float32Array.BYTES_PER_ELEMENT;
}
