/** Luma statistics on RGB bytes in the half-open row range. */
export function regionStats(data, width, y0, y1) {
  if (!Number.isInteger(width) || width < 1 || data.length % (width * 3)
    || !Number.isInteger(y0) || !Number.isInteger(y1) || y0 < 0 || y1 <= y0 || y1 * width * 3 > data.length) {
    throw new Error('Expected RGB pixels and a nonempty row range.');
  }
  const values = [];
  for (let i = y0 * width * 3; i < y1 * width * 3; i += 3) {
    values.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  values.sort((a, b) => a - b);
  return { mean, p05: values[Math.floor(values.length * 0.05)], p95: values[Math.floor(values.length * 0.95)], sd };
}

/** Regions scale with the image; production captures are measured at 480 × 270. */
export function lookMetrics(data, width, height, regions = {}) {
  if (!Number.isInteger(height) || height < 2 || data.length !== width * height * 3) throw new Error('Expected RGB image dimensions.');
  const skyRows = regions.sky ?? [0, Math.max(1, Math.floor(height * 0.3))];
  const groundRows = regions.ground ?? [Math.floor(height * 0.6), height];
  const bandRows = regions.band ?? [Math.floor(height * 0.4), Math.max(1, Math.floor(height * 0.8))];
  const full = regionStats(data, width, 0, height);
  const sky = regionStats(data, width, ...skyRows);
  const ground = regionStats(data, width, ...groundRows);
  const band = regionStats(data, width, ...bandRows);
  let maxRowStep = 0, previous, red = 0, r = 0, b = 0;
  const chroma = [];
  for (let y = groundRows[0]; y < groundRows[1]; y++) {
    const row = regionStats(data, width, y, y + 1).mean;
    if (previous !== undefined) maxRowStep = Math.max(maxRowStep, Math.abs(row - previous));
    previous = row;
    for (let i = y * width * 3; i < (y + 1) * width * 3; i += 3) chroma.push(data[i + 1] - data[i]);
  }
  for (let i = 0; i < data.length; i += 3) if (data[i] > 90 && data[i] > 1.25 * data[i + 1]) red++;
  for (let i = bandRows[0] * width * 3; i < bandRows[1] * width * 3; i += 3) { r += data[i]; b += data[i + 2]; }
  const chromaMean = chroma.reduce((sum, value) => sum + value, 0) / chroma.length;
  return { full, sky, ground, band, groundContrast: ground.p95 - ground.p05, maxRowStep,
    warmth: b > 0 ? r / b : null, redShare: red / (width * height),
    chromaSd: Math.sqrt(chroma.reduce((sum, value) => sum + (value - chromaMean) ** 2, 0) / chroma.length) };
}

/** `baseline` is the metrics of gates.against in this run, not a historical image. */
export function checkGates(metrics, gates, baseline) {
  return Object.entries(gates).filter(([key]) => !['against', 'distinctFrom', 'meanColorErrorMin'].includes(key)).map(([gate, limit]) => {
    const match = /^(.*?)(Ratio)?(Min|Max)$/.exec(gate);
    if (!match || !Number.isFinite(limit)) throw new Error(`Invalid look gate: ${gate}`);
    const read = object => match[1].split('.').reduce((value, key) => value?.[key], object);
    let value = read(metrics);
    if (match[2]) value = Number.isFinite(value) && read(baseline) > 0 ? value / read(baseline) : null;
    return { gate, value: value ?? null, limit, passed: Number.isFinite(value) && (match[3] === 'Min' ? value >= limit : value <= limit) };
  });
}
