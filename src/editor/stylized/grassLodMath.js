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

/**
 * World radius a clump covers.
 *
 * The clump's blade offsets and each blade's half-width live in the same local
 * geometry, and the shader scales all of it by the instance's blade width — so
 * `clumpRadiusUnits` is expressed in blade-widths, and a clump's footprint moves
 * with how wide its blades are.
 */
export function clumpWorldRadius(clumpRadiusUnits, bladeWidth) {
  return clumpRadiusUnits * bladeWidth;
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
 */
export function clumpsFormCarpet(clumpRadiusUnits, bladeWidth, clumpsPerCellCount, tileSize) {
  return clumpWorldRadius(clumpRadiusUnits, bladeWidth) * 2
    >= clumpSpacing(clumpsPerCellCount, tileSize);
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
