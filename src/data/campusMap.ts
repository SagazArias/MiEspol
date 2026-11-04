import graph from '../../assets/campus/graph.json';
import mapLayers from '../../assets/campus/map-layers.json';

export type GraphNode = {
  id: string;
  lat: number;
  lng: number;
  kind: string;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  distanceM: number;
  name: string;
  shade: number;
  heatExposure: number;
  pathCondition: number;
  covered: boolean;
  blocked: boolean;
};

type StoredGraph = {
  destinations: { id: string; name: string; lat: number; lng: number }[];
  nodes: GraphNode[];
  edges: GraphEdge[];
};

// graph.json guarda cada tramo una sola vez (todos son de doble sentido): aquí se agrega el sentido inverso.
const stored = graph as StoredGraph;
export const campusGraph: StoredGraph = {
  ...stored,
  edges: stored.edges.flatMap((e) => [e, { ...e, id: `${e.to}__${e.from}`, from: e.to, to: e.from }]),
};

export const campusMapLayers = mapLayers as {
  destinations: { id: string; name: string; lat: number; lng: number }[];
  paths: { name: string; coordinates: [number, number][] }[];
  buildings: { name: string; coordinates: [number, number][] }[];
};
