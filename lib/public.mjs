// What the browser (and anything published) may see of a market analysis.
// Qloo's internal entity IDs, raw popularity and affinity scores, tag IDs
// and raw heatmap cells stay on the server; the page only needs names,
// places and our own derived numbers (taste lift, normalized map intensity).

const r2 = n => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

export function publicMarket(m) {
  return {
    concept: m.concept,
    city: m.city,
    place: m.place,
    tag: { name: m.tag?.name },
    competitors: (m.competitors || []).map(c => ({ name: c.name, address: c.address, lat: c.lat, lon: c.lon })),
    zones: (m.zones || []).map(z => ({
      rank: z.rank,
      lat: z.lat,
      lon: z.lon,
      lift: r2(z.lift),
      neighborhood: z.neighborhood,
      competitorsWithin1km: z.competitorsWithin1km,
      landmark: z.landmark ? { name: z.landmark.name, address: z.landmark.address } : null,
    })),
    heatmap: m.heatmap,
    audience: {
      demographics: {
        age: Object.fromEntries(Object.entries(m.audience?.demographics?.age || {}).map(([k, v]) => [k, r2(v)])),
        gender: Object.fromEntries(Object.entries(m.audience?.demographics?.gender || {}).map(([k, v]) => [k, r2(v)])),
      },
      artists: m.audience?.artists || [],
      movies: m.audience?.movies || [],
      brands: m.audience?.brands || [],
    },
    lowSignal: m.lowSignal,
  };
}
