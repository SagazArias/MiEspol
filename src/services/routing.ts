import { campusGraph, type GraphEdge, type GraphNode } from '../data/campusMap';
import { haversineM } from './geo';
import { blockedEdgeIds, type Obstacle } from './obstacleRules';
import type { WeatherSnapshot } from './weather';

export type RouteOptionKind =
  | 'fastest'
  | 'most_shade'
  | 'least_heat'
  | 'best_path';

export type LatLng = { latitude: number; longitude: number };

export type RouteOption = {
  id: string;
  kind: RouteOptionKind;
  label: string;
  description: string;
  nodeIds: string[];
  edgeIds: string[];
  coordinates: LatLng[];
  distanceM: number;
  etaMin: number;
  score: number;
  blocked: boolean;
  warnings: string[];
};

const META: Record<RouteOptionKind, { label: string; description: string }> = {
  fastest: {
    label: 'Más rápida',
    description: 'Minimiza distancia y tiempo estimado a pie.',
  },
  most_shade: {
    label: 'Mayor sombra',
    description: 'Ideal con sol intenso o UV elevado.',
  },
  least_heat: {
    label: 'Menor calor',
    description: 'Reduce exposición térmica en senderos abiertos.',
  },
  best_path: {
    label: 'Mejor estado',
    description: 'Prioriza caminos en buen estado y con drenaje.',
  },
};

function edgeCost(edge: GraphEdge, kind: RouteOptionKind, weather: WeatherSnapshot) {
  if (edge.blocked) return Number.POSITIVE_INFINITY;
  const rain = weather.precipitationProbability / 100;
  const heat = Math.max(0, (weather.temperatureC - 26) / 10);
  const uv = Math.max(0, (weather.uvIndex - 5) / 6);

  switch (kind) {
    case 'fastest':
      return edge.distanceM;
    case 'most_shade':
      return edge.distanceM * (1.35 - edge.shade * 0.7 - (edge.covered ? 0.25 : 0) + uv * 0.1);
    case 'least_heat':
      return edge.distanceM * (1.2 + edge.heatExposure * 0.8 + heat * 0.15 - edge.shade * 0.2);
    case 'best_path':
      return edge.distanceM * (1.4 - edge.pathCondition * 0.7 + rain * (edge.covered ? -0.2 : 0.35));
    default:
      return edge.distanceM;
  }
}

function nearestNodeId(
  nodes: GraphNode[],
  point: { lat: number; lng: number },
  preferDest = false
) {
  let best: GraphNode | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    if (preferDest && n.kind !== 'destination') continue;
    const d = haversineM(point, n);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return { node: best, dist: bestDist };
}

// Adyacencia del grafo estático, construida una sola vez.
const baseAdj = new Map<string, GraphEdge[]>();
for (const e of campusGraph.edges) {
  if (!baseAdj.has(e.from)) baseAdj.set(e.from, []);
  baseAdj.get(e.from)!.push(e);
}

// Nodos de la red abierta (sin tramos ⛔ del KML) conectada a los destinos. Si el usuario está parado sobre un
// sendero cerrado, la ruta arranca desde el punto abierto más cercano en lugar de caer en la línea recta.
const openNodes = (() => {
  const seen = new Set([campusGraph.destinations[0].id]);
  const queue = [campusGraph.destinations[0].id];
  while (queue.length) {
    for (const e of baseAdj.get(queue.shift()!) ?? []) {
      if (!e.blocked && !seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return campusGraph.nodes.filter((n) => seen.has(n.id));
})();

/** Cola de prioridad mínima (montículo binario): O(log n) por operación. */
class MinHeap {
  private items: { id: string; cost: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(item: { id: string; cost: number }) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= a[i].cost) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function dijkstra(
  startId: string,
  endId: string,
  kind: RouteOptionKind,
  weather: WeatherSnapshot,
  blocked: Set<string>,
  extraEdges: GraphEdge[]
): { nodeIds: string[]; edgeIds: string[]; distanceM: number } | null {
  const extraAdj = new Map<string, GraphEdge[]>();
  for (const e of extraEdges) {
    if (!extraAdj.has(e.from)) extraAdj.set(e.from, []);
    extraAdj.get(e.from)!.push(e);
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, { node: string; edge: GraphEdge } | null>();
  const walkDist = new Map<string, number>();
  const pq = new MinHeap();

  dist.set(startId, 0);
  walkDist.set(startId, 0);
  prev.set(startId, null);
  pq.push({ id: startId, cost: 0 });

  while (pq.size) {
    const cur = pq.pop();
    if (cur.id === endId) break;
    if (cur.cost > (dist.get(cur.id) ?? Infinity)) continue;

    const out = baseAdj.get(cur.id) ?? [];
    const extra = extraAdj.get(cur.id);
    for (const edge of extra ? [...out, ...extra] : out) {
      if (edge.blocked || blocked.has(edge.id)) continue;
      const cost = edgeCost(edge, kind, weather);
      if (!Number.isFinite(cost)) continue;
      const nextCost = cur.cost + cost;
      if (nextCost < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nextCost);
        walkDist.set(edge.to, (walkDist.get(cur.id) ?? 0) + edge.distanceM);
        prev.set(edge.to, { node: cur.id, edge });
        pq.push({ id: edge.to, cost: nextCost });
      }
    }
  }

  if (!prev.has(endId) && startId !== endId) return null;

  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  let cursor: string | null = endId;
  while (cursor) {
    nodeIds.push(cursor);
    const p = prev.get(cursor);
    if (!p) break;
    edgeIds.push(p.edge.id);
    cursor = p.node;
  }
  nodeIds.reverse();
  edgeIds.reverse();

  return {
    nodeIds,
    edgeIds,
    distanceM: walkDist.get(endId) ?? 0,
  };
}

function coordsForNodes(nodeIds: string[], liveNodes: GraphNode[]): LatLng[] {
  const map = new Map(liveNodes.map((n) => [n.id, n]));
  return nodeIds
    .map((id) => map.get(id))
    .filter(Boolean)
    .map((n) => ({ latitude: n!.lat, longitude: n!.lng }));
}

function etaFromDistance(distanceM: number) {
  return Math.max(1, Math.round(distanceM / 80));
}

export function computeRouteOptionsFromGps(
  user: { lat: number; lng: number },
  toId: string,
  weather: WeatherSnapshot,
  obstacles: Obstacle[]
): RouteOption[] {
  const dest = campusGraph.nodes.find((n) => n.id === toId);
  if (!dest) return [];

  const nodes: GraphNode[] = [
    ...campusGraph.nodes,
    { id: '__user__', lat: user.lat, lng: user.lng, kind: 'user' },
  ];

  const nearest = nearestNodeId(openNodes, user);
  const extra: GraphEdge[] = [];
  if (nearest.node) {
    const dist = nearest.dist;
    const meta = {
      id: `user__${nearest.node.id}`,
      from: '__user__',
      to: nearest.node.id,
      distanceM: dist,
      name: 'desde tu ubicación',
      shade: 0.5,
      heatExposure: 0.5,
      pathCondition: 0.85,
      covered: false,
      blocked: false,
    };
    extra.push(meta);
    extra.push({ ...meta, id: `${nearest.node.id}__user`, from: nearest.node.id, to: '__user__' });
  }

  // Direct fallback edge user -> destination for disconnected graphs
  const direct = haversineM(user, dest);
  extra.push({
    id: 'user__direct__dest',
    from: '__user__',
    to: toId,
    distanceM: direct * 1.15,
    name: 'ruta directa campus',
    shade: 0.45,
    heatExposure: 0.55,
    pathCondition: 0.7,
    covered: false,
    blocked: false,
  });

  const kinds: RouteOptionKind[] = ['fastest', 'most_shade', 'least_heat', 'best_path'];

  // La arista directa es solo un respaldo: si se ofrece siempre, su costo (1,15 × línea recta) le gana a
  // casi todos los senderos reales y la ruta termina siendo una recta que ignora sombra, calor y estado.
  const graphOnly = extra.filter((e) => e.id !== 'user__direct__dest');
  const blocked = blockedEdgeIds(obstacles);

  return kinds.map((kind) => {
    const path =
      dijkstra('__user__', toId, kind, weather, blocked, graphOnly) ??
      dijkstra('__user__', toId, kind, weather, blocked, extra);
    const warnings: string[] = [];
    if (!path) {
      return {
        id: `${kind}-${toId}`,
        kind,
        label: META[kind].label,
        description: META[kind].description,
        nodeIds: [],
        edgeIds: [],
        coordinates: [],
        distanceM: 0,
        etaMin: 0,
        score: -Infinity,
        blocked: true,
        warnings: ['No hay ruta disponible'],
      };
    }

    if (path.edgeIds.includes('user__direct__dest')) {
      warnings.push('Usando aproximación directa por el campus');
    }
    if (weather.precipitationProbability >= 60) {
      warnings.push('Alta probabilidad de lluvia');
    }
    if (weather.uvIndex >= 8) {
      warnings.push('Índice UV elevado');
    }

    return {
      id: `${kind}-${toId}`,
      kind,
      label: META[kind].label,
      description: META[kind].description,
      nodeIds: path.nodeIds,
      edgeIds: path.edgeIds,
      coordinates: coordsForNodes(path.nodeIds, nodes),
      distanceM: Math.round(path.distanceM),
      etaMin: etaFromDistance(path.distanceM),
      score: -path.distanceM,
      blocked: false,
      warnings,
    };
  });
}

export function recalculateFromGps(
  user: { lat: number; lng: number },
  toId: string,
  preferred: RouteOptionKind,
  weather: WeatherSnapshot,
  obstacles: Obstacle[]
): RouteOption | null {
  const options = computeRouteOptionsFromGps(user, toId, weather, obstacles);
  return (
    options.find((o) => o.kind === preferred && !o.blocked) ??
    options.find((o) => !o.blocked) ??
    null
  );
}
