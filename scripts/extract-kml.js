const fs = require('fs');

const path = require('path');

// Uso: node scripts/extract-kml.js [ruta.kml]  (por defecto, el KML versionado en assets/campus)
const DEST_KML = 'assets/campus/Mapa-ESPOL.kml';
const srcKml = process.argv[2] || DEST_KML;
const kml = fs.readFileSync(srcKml, 'utf8');

function centroid(coords) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const [lng, lat] of coords) {
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      sx += lng;
      sy += lat;
      n++;
    }
  }
  return n ? { lng: sx / n, lat: sy / n } : null;
}

function parseCoords(block) {
  const m = block.match(/<coordinates>\s*([\s\S]*?)\s*<\/coordinates>/);
  if (!m) return [];
  return m[1]
    .trim()
    .split(/\s+/)
    .map((p) => {
      const [lng, lat] = p.split(',').map(Number);
      return [lng, lat];
    })
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
}

const placemarks = [];
const re = /<Placemark>([\s\S]*?)<\/Placemark>/g;
let match;
while ((match = re.exec(kml))) {
  const block = match[1];
  const nameMatch = block.match(/<name>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/name>/);
  const name = (nameMatch ? nameMatch[1] : '').replace(/\s+/g, ' ').trim();
  const descMatch = block.match(
    /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/
  );
  const desc = (descMatch ? descMatch[1] : '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const coords = parseCoords(block);
  placemarks.push({
    name,
    desc,
    coords,
    isPoly: block.includes('<Polygon>'),
    isPoint: block.includes('<Point>'),
    isLine: block.includes('<LineString>'),
  });
}

const destMap = [
  { id: 'cti', name: 'CTI', match: (p) => p.name.includes('1A - CTI') },
  { id: 'admisiones', name: 'Admisiones', match: (p) => p.name.includes('2A - Admisiones') },
  { id: 'fcv', name: 'FCV', match: (p) => p.name.includes('3A - FCV') },
  {
    id: 'residencias',
    name: 'Residencias',
    match: (p) => /residenc/i.test(`${p.name} ${p.desc}`),
  },
  {
    id: 'fimcm',
    name: 'FIMCM',
    match: (p) => p.name.includes('5A - FIMCM') || /^5A/.test(p.name),
  },
  {
    id: 'rectorado',
    name: 'Rectorado',
    match: (p) => /rectorado/i.test(`${p.name} ${p.desc}`),
  },
  {
    id: 'biblioteca',
    name: 'Biblioteca',
    match: (p) => /biblioteca/i.test(`${p.name} ${p.desc}`),
  },
  { id: 'fcsh', name: 'FCSH', match: (p) => p.name.includes('8A - FCSH') },
  { id: 'fcnm', name: 'FCNM', match: (p) => p.name.includes('9A - FCNM') },
  {
    id: 'ubp',
    name: 'UBP',
    match: (p) => p.name.includes('10A - UBEP') || /\bUBEP\b|\bUBP\b/.test(p.name),
  },
  { id: 'fiec', name: 'FIEC', match: (p) => p.name.includes('11A - FIEC') },
  { id: 'fimcp', name: 'FIMCP', match: (p) => p.name.includes('12A - FIMCP') },
  { id: 'fict', name: 'FICT', match: (p) => p.name.includes('13A - FICT') },
  { id: 'fadcom', name: 'FADCOM', match: (p) => p.name.includes('14A - FADCOM') },
];

const destinations = [];
for (const d of destMap) {
  const hits = placemarks.filter(d.match);
  const best = hits.find((h) => h.isPoly) || hits.find((h) => h.isPoint) || hits[0];
  const c = best ? centroid(best.coords) : null;
  destinations.push({
    id: d.id,
    name: d.name,
    lat: c ? Number(c.lat.toFixed(7)) : null,
    lng: c ? Number(c.lng.toFixed(7)) : null,
    sourceName: best ? best.name : null,
    hits: hits.slice(0, 8).map((h) => h.name),
  });
}

const interesting = placemarks
  .filter((p) => /resid|rector|biblio|tecno|ubep|ubp|zona 4|zona 6|zona 7/i.test(`${p.name} ${p.desc}`))
  .slice(0, 60)
  .map((p) => ({
    name: p.name,
    desc: p.desc.slice(0, 100),
    poly: p.isPoly,
    point: p.isPoint,
    n: p.coords.length,
    c: centroid(p.coords),
  }));

const folders = [...kml.matchAll(/<Folder>\s*<name>([\s\S]*?)<\/name>/g)].map((m) =>
  m[1].replace(/\s+/g, ' ').trim()
);

const polygons = placemarks
  .filter((p) => p.isPoly && p.coords.length >= 3)
  .map((p) => ({
    name: p.name,
    // GeoJSON: [lng, lat]
    coordinates: [p.coords.map(([lng, lat]) => [lng, lat])],
  }));

const lines = placemarks
  .filter((p) => p.isLine && p.coords.length >= 2)
  .map((p) => ({
    name: p.name,
    coordinates: p.coords.map(([lng, lat]) => [lng, lat]),
  }));

fs.mkdirSync('assets/campus', { recursive: true });
if (path.resolve(srcKml) !== path.resolve(DEST_KML)) fs.copyFileSync(srcKml, DEST_KML);
fs.writeFileSync(
  'assets/campus/extract-report.json',
  JSON.stringify({ destinations, folders, interesting }, null, 2)
);
fs.writeFileSync('assets/campus/buildings.geojson', JSON.stringify({
  type: 'FeatureCollection',
  features: polygons.map((p) => ({
    type: 'Feature',
    properties: { name: p.name },
    geometry: { type: 'Polygon', coordinates: p.coordinates },
  })),
}));
fs.writeFileSync('assets/campus/paths.geojson', JSON.stringify({
  type: 'FeatureCollection',
  features: lines.map((p) => ({
    type: 'Feature',
    properties: { name: p.name },
    geometry: { type: 'LineString', coordinates: p.coordinates },
  })),
}));

console.log(JSON.stringify({ destinations, folders, interestingCount: interesting.length, poly: polygons.length, lines: lines.length }, null, 2));
