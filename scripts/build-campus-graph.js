// Construye el grafo peatonal del campus a partir de OpenStreetMap + los senderos anotados del KML propio.
// Uso: node scripts/build-campus-graph.js   (requiere assets/campus/osm-campus.json: node scripts/fetch-osm.js)
//
// - OSM aporta la red real (veredas, senderos, escaleras, calles) con topología: los cruces son nodos compartidos.
// - El KML aporta conocimiento local: tramos cubiertos, en precaución (⚠) o bloqueados (⛔). Los tramos de OSM que
//   corren sobre un sendero del KML heredan esas marcas, para que la ruta no esquive un bloqueo por un duplicado.
// - Solo se conserva la red conectada que contiene a todos los destinos; si un destino queda fuera, el script falla.
const fs = require('fs');

const destinations = [
  { id: 'cti', name: 'CTI', lat: -2.1458446, lng: -79.9489238 },
  { id: 'admisiones', name: 'Admisiones', lat: -2.1501606, lng: -79.9493357 },
  { id: 'fcv', name: 'FCV', lat: -2.1518773, lng: -79.9567078 },
  { id: 'residencias', name: 'Residencias', lat: -2.1536581, lng: -79.956962 },
  { id: 'fimcm', name: 'FIMCM', lat: -2.1468841, lng: -79.9628524 },
  { id: 'rectorado', name: 'Rectorado', lat: -2.1474978, lng: -79.9645096 },
  { id: 'biblioteca', name: 'Biblioteca', lat: -2.1472852, lng: -79.9661399 },
  { id: 'fcsh', name: 'FCSH', lat: -2.1477459, lng: -79.9687693 },
  { id: 'fcnm', name: 'FCNM', lat: -2.1468714, lng: -79.9671363 },
  { id: 'ubp', name: 'UBP', lat: -2.1429354, lng: -79.9671616 },
  { id: 'fiec', name: 'FIEC', lat: -2.1446222, lng: -79.9676414 },
  { id: 'fimcp', name: 'FIMCP', lat: -2.1444377, lng: -79.9659964 },
  { id: 'fict', name: 'FICT', lat: -2.1455118, lng: -79.9653321 },
  { id: 'fadcom', name: 'FADCOM', lat: -2.1440472, lng: -79.9624105 },
];

const osm = JSON.parse(fs.readFileSync('assets/campus/osm-campus.json', 'utf8'));
const paths = JSON.parse(fs.readFileSync('assets/campus/paths.geojson', 'utf8'));
const buildings = JSON.parse(fs.readFileSync('assets/campus/buildings.geojson', 'utf8'));

// --- Geometría -----------------------------------------------------------------------------------------------
function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distancia en metros de un punto a un segmento (proyección local equirectangular, suficiente a escala de campus). */
function pointToSegmentM(p, a, b) {
  const k = 111320;
  const cos = Math.cos((p.lat * Math.PI) / 180);
  const ax = (a.lng - p.lng) * k * cos, ay = (a.lat - p.lat) * k;
  const bx = (b.lng - p.lng) * k * cos, by = (b.lat - p.lat) * k;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

// --- Atributos de los tramos ---------------------------------------------------------------------------------
const PAVED = /^(paved|asphalt|concrete|concrete:plates|paving_stones|sett|bricks|metal|wood)$/;
const UNPAVED = /^(unpaved|ground|dirt|earth|gravel|fine_gravel|compacted|grass|sand|mud|pebblestone)$/;

function osmMeta(tags) {
  const hw = tags.highway;
  const covered = tags.covered === 'yes' || tags.tunnel === 'building_passage' || tags.tunnel === 'yes';
  const surface = tags.surface || '';
  const pedestrian = /^(footway|path|pedestrian|steps|cycleway|living_street|track|bridleway)$/.test(hw);
  const bigRoad = /^(primary|primary_link|secondary|secondary_link)$/.test(hw);
  const hasSidewalk = /^(both|left|right|separate|yes)$/.test(tags.sidewalk || '');

  let shade = pedestrian ? 0.5 : 0.3;
  let heatExposure = pedestrian ? 0.5 : bigRoad ? 0.8 : 0.7; // el asfalto abierto acumula calor
  let pathCondition = pedestrian ? (hw === 'path' || hw === 'track' ? 0.6 : 0.8) : bigRoad ? 0.5 : 0.7;
  if (hasSidewalk) pathCondition = Math.max(pathCondition, 0.8);
  if (PAVED.test(surface)) pathCondition = Math.max(pathCondition, 0.85);
  if (UNPAVED.test(surface)) pathCondition = Math.min(pathCondition, 0.5);
  if (hw === 'steps') pathCondition = Math.min(pathCondition, 0.65);
  if (covered) {
    shade = 0.9;
    heatExposure = 0.25;
  }
  return { shade, heatExposure, pathCondition, covered, blocked: false };
}

/** Marcas del KML propio, por nombre del sendero (⛔ bloqueado, ⚠ precaución, cubierto). */
function kmlMeta(name) {
  const blocked = /⛔/.test(name);
  const caution = /⚠/.test(name);
  const covered = /ciclov|cubierto|pasarela/i.test(name);
  return {
    blocked,
    shade: covered ? 0.75 : caution ? 0.35 : 0.5,
    heatExposure: covered ? 0.3 : caution ? 0.7 : 0.55,
    pathCondition: blocked ? 0.2 : caution ? 0.45 : 0.85,
    covered,
  };
}

const kmlLines = paths.features.map((f) => ({
  name: f.properties.name || 'sendero',
  meta: kmlMeta(f.properties.name || ''),
  pts: f.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
}));

/** Sendero del KML sobre el que corre un tramo (ambos extremos y el punto medio a ≤ 15 m), si existe. */
function kmlLineAlong(a, b) {
  const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
  for (const line of kmlLines) {
    const near = (p) => line.pts.some((q, i) => i > 0 && pointToSegmentM(p, line.pts[i - 1], q) <= 15);
    if (near(a) && near(b) && near(mid)) return line;
  }
  return null;
}

// --- Construcción ------------------------------------------------------------------------------------------------
const nodes = new Map(); // id -> { id, lat, lng, kind }
const edges = new Map(); // id -> edge

function addNode(id, lat, lng, kind) {
  if (!nodes.has(id)) nodes.set(id, { id, lat, lng, kind });
  return id;
}

function addEdge(from, to, meta, name) {
  if (from === to) return;
  const a = nodes.get(from);
  const b = nodes.get(to);
  const distanceM = haversine(a, b);
  if (distanceM < 0.5) return;
  for (const [x, y] of [[from, to], [to, from]]) {
    const id = `${x}__${y}`;
    if (edges.has(id)) continue;
    edges.set(id, { id, from: x, to: y, distanceM, name, ...meta });
  }
}

// 1) Red de OSM: se parte cada vía en los cruces y se conservan vértices cada ~20 m para dibujar la ruta.
const usage = new Map();
for (const w of osm.ways) for (const n of w.nodes) usage.set(n, (usage.get(n) || 0) + 1);

for (const w of osm.ways) {
  const meta = osmMeta(w.tags);
  const name = w.tags.name || ({ footway: 'vereda', path: 'sendero', steps: 'escaleras', service: 'vía de servicio' }[w.tags.highway] || 'calle');
  let last = null;
  w.nodes.forEach((osmId, i) => {
    const [lat, lng] = osm.nodes[osmId];
    const isEnd = i === 0 || i === w.nodes.length - 1;
    const isJunction = usage.get(osmId) > 1;
    const p = { lat, lng };
    if (last && !isEnd && !isJunction && haversine(nodes.get(last), p) < 20) return;
    const id = addNode(`o${osmId}`, lat, lng, 'path');
    if (last) {
      const along = kmlLineAlong(nodes.get(last), p);
      addEdge(last, id, along ? { ...meta, ...along.meta, covered: along.meta.covered || meta.covered } : meta, along ? along.name : name);
    }
    last = id;
  });
}

// 2) Senderos del KML que OSM no tiene: se agregan y se unen a la red en cada vértice cercano (≤ 30 m).
const osmNodeList = () => [...nodes.values()].filter((n) => n.id.startsWith('o'));
let seq = 0;
for (const line of kmlLines) {
  let last = null;
  for (let i = 0; i < line.pts.length; i++) {
    const p = line.pts[i];
    if (last && i < line.pts.length - 1 && haversine(nodes.get(last), p) < 25) continue;
    const id = addNode(`k${seq++}`, p.lat, p.lng, 'path');
    if (last) addEdge(last, id, line.meta, line.name);
    last = id;
  }
}
const kmlNodes = [...nodes.values()].filter((n) => n.id.startsWith('k'));
const osmNodes = osmNodeList();
for (const k of kmlNodes) {
  let best = null;
  let bestD = Infinity;
  for (const o of osmNodes) {
    const d = haversine(k, o);
    if (d < bestD) [best, bestD] = [o, d];
  }
  if (best && bestD <= 30) {
    addEdge(k.id, best.id, { shade: 0.5, heatExposure: 0.5, pathCondition: 0.8, covered: false, blocked: false }, 'conexión');
  }
}

// 3) Destinos: se conectan a los 3 nodos más cercanos de la red (entrada al edificio).
const access = { shade: 0.6, heatExposure: 0.45, pathCondition: 0.85, covered: false, blocked: false };
for (const d of destinations) {
  addNode(d.id, d.lat, d.lng, 'destination');
  const nearest = [...nodes.values()]
    .filter((n) => n.kind === 'path')
    .map((n) => ({ n, dist: haversine(d, n) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);
  for (const { n, dist } of nearest) {
    if (dist <= 120 || n === nearest[0].n) addEdge(d.id, n.id, access, 'acceso');
  }
}

// 4) Se conserva solo la red conectada principal y se exige que contenga a todos los destinos.
const adj = new Map();
for (const e of edges.values()) {
  if (!adj.has(e.from)) adj.set(e.from, []);
  adj.get(e.from).push(e.to);
}
const seen = new Set([destinations[0].id]);
const queue = [destinations[0].id];
while (queue.length) {
  for (const next of adj.get(queue.shift()) || []) {
    if (!seen.has(next)) {
      seen.add(next);
      queue.push(next);
    }
  }
}
const unreachable = destinations.filter((d) => !seen.has(d.id)).map((d) => d.id);
if (unreachable.length) throw new Error(`Destinos fuera de la red principal: ${unreachable.join(', ')}`);

// Salida compacta: ids cortos, 6 decimales (~11 cm) y cada tramo una sola vez (campusMap.ts genera el sentido inverso).
const shortId = new Map();
const finalNodes = [...nodes.values()]
  .filter((n) => seen.has(n.id))
  .map((n) => {
    const id = n.kind === 'destination' ? n.id : `n${shortId.size}`;
    shortId.set(n.id, id);
    return { id, lat: +n.lat.toFixed(6), lng: +n.lng.toFixed(6), kind: n.kind };
  });
const round2 = (x) => Math.round(x * 100) / 100;
const finalEdges = [];
for (const e of edges.values()) {
  if (!seen.has(e.from) || !seen.has(e.to)) continue;
  const from = shortId.get(e.from);
  const to = shortId.get(e.to);
  if (from > to) continue; // el sentido inverso tiene los mismos atributos
  finalEdges.push({
    id: `${from}__${to}`, from, to, distanceM: Math.round(e.distanceM * 10) / 10, name: e.name,
    shade: round2(e.shade), heatExposure: round2(e.heatExposure), pathCondition: round2(e.pathCondition),
    covered: e.covered, blocked: e.blocked,
  });
}

// --- Salida (mismo formato que antes) ---------------------------------------------------------------------------
const destBuildings = {
  type: 'FeatureCollection',
  features: buildings.features.filter((f) =>
    /CTI|ADMISIONES|FCV|RESIDENCIA|FIMCM|RECTORADO|BIBLIOTECA|FCSH|FCNM|UBEP|FIEC|FIMCP|FICT|FADCOM/.test(
      (f.properties.name || '').toUpperCase(),
    ),
  ),
};

fs.writeFileSync('assets/campus/graph.json', JSON.stringify({ destinations, nodes: finalNodes, edges: finalEdges }));
fs.writeFileSync('assets/campus/destinations.json', JSON.stringify(destinations, null, 2));
fs.writeFileSync('assets/campus/dest-buildings.geojson', JSON.stringify(destBuildings));
fs.writeFileSync(
  'assets/campus/map-layers.json',
  JSON.stringify({
    destinations,
    paths: paths.features.map((f) => ({ name: f.properties.name, coordinates: f.geometry.coordinates })),
    buildings: destBuildings.features.map((f) => ({ name: f.properties.name, coordinates: f.geometry.coordinates[0] })),
  }),
);

const blocked = finalEdges.filter((e) => e.blocked).length;
console.log({
  destinations: destinations.length,
  nodes: finalNodes.length,
  tramos: finalEdges.length,
  descartadosFueraDeLaRed: nodes.size - finalNodes.length,
  tramosBloqueadosPorKml: blocked,
  tramosCubiertos: finalEdges.filter((e) => e.covered).length,
});
