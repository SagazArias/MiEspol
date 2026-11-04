import { campusGraph } from '../data/campusMap';
import { haversineM } from './geo';

/** Tipos y reglas puras de obstáculos (sin almacenamiento): se pueden probar en Node. */

export type ObstacleSeverity = 'low' | 'medium' | 'high';
export type ObstacleSource = 'community' | 'admin';

export type Obstacle = {
  id: string;
  title: string;
  description: string;
  category: string;
  lat: number;
  lng: number;
  severity: ObstacleSeverity;
  source: ObstacleSource;
  edgeIds: string[];
  photoUri?: string;
  createdAt: string;
  yesVotes: number;
  noVotes: number;
  localVoted?: 'yes' | 'no' | null;
};

/** Radio en metros dentro del cual un obstáculo medio/alto bloquea un tramo. */
export const BLOCK_RADIUS_M = 90;

function edgesNearPoint(lat: number, lng: number, radiusM = BLOCK_RADIUS_M) {
  const nodeMap = new Map(campusGraph.nodes.map((n) => [n.id, n]));
  return campusGraph.edges
    .filter((e) => {
      const a = nodeMap.get(e.from);
      const b = nodeMap.get(e.to);
      if (!a || !b) return false;
      const d = Math.min(haversineM({ lat, lng }, a), haversineM({ lat, lng }, b));
      return d <= radiusM;
    })
    .map((e) => e.id);
}

export function resolveEdgeIdsForObstacle(lat: number, lng: number) {
  return edgesNearPoint(lat, lng);
}

// El grafo es estático: se indexa una sola vez (el grafo de OSM tiene miles de tramos).
const nodeById = new Map(campusGraph.nodes.map((n) => [n.id, n]));
const edgeById = new Map(campusGraph.edges.map((e) => [e.id, e]));

/** Un obstáculo bloquea si es medio/alto y no tiene 3 votos de "ya no está". */
function isActive(o: Obstacle) {
  return o.severity !== 'low' && (o.noVotes ?? 0) < 3;
}

export function obstacleBlocksEdge(obstacles: Obstacle[], edgeId: string) {
  const active = obstacles.filter(isActive);
  if (!active.length) return false;
  const edge = edgeById.get(edgeId);
  if (!edge) return active.some((o) => o.edgeIds.includes(edgeId));
  const a = nodeById.get(edge.from);
  const b = nodeById.get(edge.to);
  if (!a || !b) return false;
  const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };

  return active.some(
    (o) =>
      o.edgeIds.includes(edgeId) ||
      haversineM(o, a) <= BLOCK_RADIUS_M ||
      haversineM(o, b) <= BLOCK_RADIUS_M ||
      haversineM(o, mid) <= BLOCK_RADIUS_M,
  );
}

/** Ids de todos los tramos del campus bloqueados por obstáculos: se calcula una vez por cálculo de rutas. */
export function blockedEdgeIds(obstacles: Obstacle[]): Set<string> {
  const blocked = new Set<string>();
  if (!obstacles.some(isActive)) return blocked;
  for (const e of campusGraph.edges) if (obstacleBlocksEdge(obstacles, e.id)) blocked.add(e.id);
  return blocked;
}
