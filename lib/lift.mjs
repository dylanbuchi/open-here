// Taste lift: how much a cell's affinity for a concept exceeds what its
// general popularity predicts. Raw Qloo heatmaps track popularity closely,
// so the residual is where the concept-specific signal lives.

export function fitLine(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let cov = 0, vx = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
  }
  const slope = vx === 0 ? 0 : cov / vx;
  return { slope, intercept: my - slope * mx };
}

// cells: [{ lat, lon, geohash, affinity, popularity }]
export function scoreCells(cells, { minPopularity = 0.2 } = {}) {
  const usable = cells.filter(c => c.popularity >= minPopularity);
  const { slope, intercept } = fitLine(usable.map(c => c.popularity), usable.map(c => c.affinity));
  return usable.map(c => ({ ...c, lift: c.affinity - (slope * c.popularity + intercept) }));
}

// Group scored cells into zones by geohash prefix and rank by mean lift.
export function rankZones(scored, { precision = 6, minCells = 2, top = 5 } = {}) {
  const groups = new Map();
  for (const c of scored) {
    const key = c.geohash.slice(0, precision);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const zones = [];
  for (const [geohash, cs] of groups) {
    if (cs.length < minCells) continue;
    const mean = f => cs.reduce((s, c) => s + f(c), 0) / cs.length;
    zones.push({
      geohash,
      lat: mean(c => c.lat),
      lon: mean(c => c.lon),
      cells: cs.length,
      lift: mean(c => c.lift),
      affinity: mean(c => c.affinity),
      popularity: mean(c => c.popularity),
    });
  }
  zones.sort((a, b) => b.lift - a.lift);
  return zones.slice(0, top);
}

// Spread lift onto a 0..1 scale for map coloring.
export function normalizeLift(scored) {
  if (!scored.length) return [];
  const lifts = scored.map(c => c.lift);
  const lo = Math.min(...lifts), hi = Math.max(...lifts);
  const span = hi - lo || 1;
  return scored.map(c => ({ ...c, intensity: (c.lift - lo) / span }));
}
