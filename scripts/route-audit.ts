// Auditoría del grafo: desde muchos puntos de la red hacia cada destino, ¿cuántas rutas caen en la línea recta
// de respaldo y cuánto tarda el cálculo de las 4 opciones? Uso: npx tsx scripts/route-audit.ts
import { campusGraph } from '../src/data/campusMap';
import { computeRouteOptionsFromGps } from '../src/services/routing';
import type { WeatherSnapshot } from '../src/services/weather';

const calm = { temperatureC: 27, humidity: 70, windKmh: 8, uvIndex: 5, precipitationProbability: 10 } as WeatherSnapshot;
const starts = campusGraph.nodes.filter((n, i) => n.kind === 'path' && i % 25 === 0);
const counts: Record<string, { recta: number; senderos: number }> = {};
const times: number[] = [];

for (const d of campusGraph.destinations) {
  for (const s of starts) {
    const t0 = performance.now();
    const options = computeRouteOptionsFromGps({ lat: s.lat, lng: s.lng }, d.id, calm, []);
    times.push(performance.now() - t0);
    for (const o of options) {
      counts[o.kind] ??= { recta: 0, senderos: 0 };
      counts[o.kind][o.edgeIds.includes('user__direct__dest') ? 'recta' : 'senderos']++;
    }
  }
}
times.sort((a, b) => a - b);
console.log(`grafo: ${campusGraph.nodes.length} nodos, ${campusGraph.edges.length} tramos; ${starts.length} puntos de partida × ${campusGraph.destinations.length} destinos`);
console.log(counts);
console.log(`tiempo de las 4 rutas: mediana ${times[times.length >> 1].toFixed(1)} ms, p95 ${times[Math.floor(times.length * 0.95)].toFixed(1)} ms`);
