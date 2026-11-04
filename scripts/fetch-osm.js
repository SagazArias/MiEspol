// Descarga de OpenStreetMap la red caminable del campus Gustavo Galindo (ESPOL, Guayaquil) y alrededores.
// Uso: node scripts/fetch-osm.js
// Escribe assets/campus/osm-campus.json: solo los nodos y vías caminables, con las etiquetas que usa el grafo.
// Datos © OpenStreetMap contributors, licencia ODbL (https://www.openstreetmap.org/copyright).
const fs = require('fs');

// Campus + ~400 m de margen (sur, oeste, norte, este).
const BBOX = [-2.16, -79.975, -2.136, -79.944];
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Vías por las que se puede caminar. Se excluyen autopistas, vías en construcción y las que prohíben peatones.
const query = `[out:json][timeout:90];
way["highway"]["highway"!~"^(motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|bus_guideway|corridor)$"]["foot"!="no"]["area"!="yes"](${BBOX.join(',')});
(._;>;);
out body;`;

const KEEP_TAGS = ['highway', 'name', 'surface', 'covered', 'footway', 'sidewalk', 'access', 'foot', 'tunnel', 'bridge', 'lit'];

async function download() {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'MiEspol-campus-graph/1.0' },
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`Falló ${url}: ${err.message}`);
    }
  }
  throw new Error('No se pudo descargar de ningún servidor Overpass.');
}

(async () => {
  const data = await download();
  const nodes = {};
  const ways = [];
  for (const el of data.elements) {
    if (el.type === 'node') nodes[el.id] = [Number(el.lat.toFixed(7)), Number(el.lon.toFixed(7))];
  }
  for (const el of data.elements) {
    if (el.type !== 'way') continue;
    const tags = Object.fromEntries(Object.entries(el.tags || {}).filter(([k]) => KEEP_TAGS.includes(k)));
    ways.push({ id: el.id, nodes: el.nodes.filter((n) => nodes[n]), tags });
  }
  const out = {
    source: 'OpenStreetMap vía Overpass API',
    license: 'ODbL 1.0 — © OpenStreetMap contributors',
    bbox: BBOX,
    fetchedAt: new Date().toISOString(),
    nodes,
    ways,
  };
  fs.writeFileSync('assets/campus/osm-campus.json', JSON.stringify(out));
  const byType = {};
  for (const w of ways) byType[w.tags.highway] = (byType[w.tags.highway] || 0) + 1;
  console.log({ nodes: Object.keys(nodes).length, ways: ways.length, byType });
})();
