/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { campusGraph } from '../../data/campusMap';
import { haversineM } from '../geo';
import { obstacleBlocksEdge, type Obstacle } from '../obstacleRules';
import { computeRouteOptionsFromGps, recalculateFromGps } from '../routing';
import type { WeatherSnapshot } from '../weather';

const calm = {
  temperatureC: 27,
  humidity: 70,
  windKmh: 8,
  uvIndex: 5,
  precipitationProbability: 10,
} as unknown as WeatherSnapshot;

/** Nodos alcanzables desde `from` siguiendo las aristas del campus. */
function reachableFrom(from: string) {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of campusGraph.edges) {
      if (e.from === cur && !seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return seen;
}

// Destino dentro de la red principal y partida desde el nodo conectado más lejano a él.
const destId = 'biblioteca';
const destNode = campusGraph.nodes.find((n) => n.id === destId)!;
const connected = reachableFrom(destId);
const startNode = campusGraph.nodes
  .filter((n) => n.id !== destId && connected.has(n.id))
  .sort((a, b) => haversineM(b, destNode) - haversineM(a, destNode))[0];
const user = { lat: startNode.lat, lng: startNode.lng };

function obstacle(over: Partial<Obstacle>): Obstacle {
  return {
    id: 'o1',
    title: 'Obstáculo',
    description: '',
    category: 'obra',
    lat: 0,
    lng: 0,
    severity: 'high',
    source: 'community',
    edgeIds: [],
    createdAt: new Date(0).toISOString(),
    yesVotes: 0,
    noVotes: 0,
    ...over,
  };
}

describe('haversineM', () => {
  it('es 0 para el mismo punto y ~111 km por grado de latitud', () => {
    assert.equal(haversineM({ lat: -2.14, lng: -79.96 }, { lat: -2.14, lng: -79.96 }), 0);
    const d = haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    assert.ok(Math.abs(d - 111_195) < 50, `distancia inesperada: ${d}`);
  });
});

describe('computeRouteOptionsFromGps', () => {
  it('el grafo del campus tiene el destino de prueba como nodo', () => {
    assert.ok(destNode, `falta el nodo de destino ${destId}`);
    assert.ok(campusGraph.edges.length > 0);
  });

  it('devuelve las 4 opciones y todas llegan al destino', () => {
    const options = computeRouteOptionsFromGps(user, destId, calm, []);
    assert.deepEqual(
      options.map((o) => o.kind),
      ['fastest', 'most_shade', 'least_heat', 'best_path'],
    );
    for (const o of options) {
      assert.equal(o.blocked, false, `${o.kind} quedó bloqueada`);
      assert.equal(o.nodeIds[0], '__user__');
      assert.equal(o.nodeIds.at(-1), destId);
      assert.equal(o.edgeIds.length, o.nodeIds.length - 1);
      assert.ok(o.etaMin >= 1);
    }
  });

  it('"Más rápida" nunca es más larga que las demás opciones', () => {
    const options = computeRouteOptionsFromGps(user, destId, calm, []);
    const fastest = options.find((o) => o.kind === 'fastest')!;
    for (const o of options) {
      assert.ok(fastest.distanceM <= o.distanceM, `${o.kind} (${o.distanceM} m) es más corta que fastest (${fastest.distanceM} m)`);
    }
  });

  it('con un camino por el campus disponible, no usa la línea recta de respaldo', () => {
    for (const o of computeRouteOptionsFromGps(user, destId, calm, [])) {
      assert.ok(!o.edgeIds.includes('user__direct__dest'), `${o.kind} usó la línea recta`);
      assert.deepEqual(o.warnings, []);
    }
  });

  it('un destino sin conexión en el grafo (CTI) igual tiene ruta, por el respaldo en línea recta', () => {
    const [fastest] = computeRouteOptionsFromGps(user, 'cti', calm, []);
    assert.equal(fastest.blocked, false);
    assert.ok(fastest.edgeIds.includes('user__direct__dest'));
    assert.ok(fastest.warnings.includes('Usando aproximación directa por el campus'));
  });

  it('un destino inexistente no devuelve rutas', () => {
    assert.deepEqual(computeRouteOptionsFromGps(user, 'no-existe', calm, []), []);
  });

  it('avisa de lluvia y UV alto', () => {
    const stormy = { ...calm, precipitationProbability: 80, uvIndex: 9 } as WeatherSnapshot;
    const [fastest] = computeRouteOptionsFromGps(user, destId, stormy, []);
    assert.ok(fastest.warnings.includes('Alta probabilidad de lluvia'));
    assert.ok(fastest.warnings.includes('Índice UV elevado'));
  });

  it('esquiva un tramo bloqueado por un obstáculo alto', () => {
    const [before] = computeRouteOptionsFromGps(user, destId, calm, []);
    const campusEdge = before.edgeIds.find((id) => campusGraph.edges.some((e) => e.id === id));
    assert.ok(campusEdge, 'la ruta debería usar al menos un tramo del campus');

    const blocker = obstacle({ edgeIds: [campusEdge!], lat: 90, lng: 0 });
    const [after] = computeRouteOptionsFromGps(user, destId, calm, [blocker]);
    assert.ok(!after.edgeIds.includes(campusEdge!), `la ruta sigue pasando por ${campusEdge}`);
  });
});

describe('obstacleBlocksEdge', () => {
  const edge = campusGraph.edges[0];

  it('un obstáculo medio o alto sobre el tramo lo bloquea', () => {
    assert.equal(obstacleBlocksEdge([obstacle({ severity: 'medium', edgeIds: [edge.id] })], edge.id), true);
  });

  it('uno leve no bloquea', () => {
    assert.equal(obstacleBlocksEdge([obstacle({ severity: 'low', edgeIds: [edge.id] })], edge.id), false);
  });

  it('con 3 votos de "ya no está" deja de bloquear', () => {
    assert.equal(obstacleBlocksEdge([obstacle({ edgeIds: [edge.id], noVotes: 3 })], edge.id), false);
  });
});

describe('recalculateFromGps', () => {
  it('respeta el tipo de ruta preferido', () => {
    const route = recalculateFromGps(user, destId, 'most_shade', calm, []);
    assert.equal(route?.kind, 'most_shade');
  });
});
