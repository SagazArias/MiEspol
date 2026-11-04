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

export function obstacleBlocksEdge(obstacles: Obstacle[], edgeId: string) {
  const nodeMap = new Map(campusGraph.nodes.map((n) => [n.id, n]));
  const edge = campusGraph.edges.find((e) => e.id === edgeId);
  if (!edge) {
    return obstacles.some((o) => o.severity !== 'low' && o.edgeIds.includes(edgeId));
  }
  const a = nodeMap.get(edge.from);
  const b = nodeMap.get(edge.to);
  if (!a || !b) return false;

  return obstacles.some((o) => {
    if (o.severity === 'low') return false;
    if ((o.noVotes ?? 0) >= 3) return false;
    if (o.edgeIds.includes(edgeId)) return true;
    return (
      haversineM(o, a) <= BLOCK_RADIUS_M ||
      haversineM(o, b) <= BLOCK_RADIUS_M ||
      haversineM(o, { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }) <= BLOCK_RADIUS_M
    );
  });
}
