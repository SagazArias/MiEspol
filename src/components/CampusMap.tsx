import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { CAMPUS_CENTER } from '../data/destinations';
import { campusMapLayers } from '../data/campusMap';
import type { LatLng } from '../services/routing';

type Props = {
  user?: { lat: number; lng: number } | null;
  destination?: { lat: number; lng: number; name?: string } | null;
  route?: LatLng[];
  followUser?: boolean;
};

function buildHtml() {
  const layers = JSON.stringify(campusMapLayers);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { margin:0; padding:0; height:100%; width:100%; background:#0b0b0b; }
    .leaflet-control-attribution { font-size: 9px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const LAYERS = ${layers};
    const map = L.map('map', { zoomControl: true, attributionControl: true })
      .setView([${CAMPUS_CENTER.lat}, ${CAMPUS_CENTER.lng}], 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(map);

    const buildings = L.layerGroup().addTo(map);
    const paths = L.layerGroup().addTo(map);
    const dests = L.layerGroup().addTo(map);
    let userMarker = null;
    let destMarker = null;
    let routeLine = null;

    LAYERS.buildings.forEach((b) => {
      const latlngs = b.coordinates.map((c) => [c[1], c[0]]);
      L.polygon(latlngs, {
        color: '#2F6BFF',
        weight: 1,
        fillColor: '#2F6BFF',
        fillOpacity: 0.18
      }).bindTooltip(b.name, { sticky: true }).addTo(buildings);
    });

    LAYERS.paths.forEach((p) => {
      const latlngs = p.coordinates.map((c) => [c[1], c[0]]);
      const blocked = /⛔/.test(p.name);
      const caution = /⚠/.test(p.name);
      L.polyline(latlngs, {
        color: blocked ? '#FF3B30' : caution ? '#FFD60A' : '#34C759',
        weight: blocked ? 2 : 3,
        opacity: 0.85,
        dashArray: blocked ? '4 6' : null
      }).bindTooltip(p.name).addTo(paths);
    });

    LAYERS.destinations.forEach((d) => {
      L.circleMarker([d.lat, d.lng], {
        radius: 6,
        color: '#fff',
        weight: 1,
        fillColor: '#00BCD4',
        fillOpacity: 1
      }).bindTooltip(d.name).addTo(dests);
    });

    function setState(payload) {
      const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (data.user) {
        const ll = [data.user.lat, data.user.lng];
        if (!userMarker) {
          userMarker = L.circleMarker(ll, {
            radius: 9,
            color: '#fff',
            weight: 2,
            fillColor: '#2F6BFF',
            fillOpacity: 1
          }).bindTooltip('Tu ubicación').addTo(map);
        } else {
          userMarker.setLatLng(ll);
        }
        if (data.followUser) map.panTo(ll);
      }
      if (data.destination) {
        const ll = [data.destination.lat, data.destination.lng];
        if (!destMarker) {
          destMarker = L.marker(ll).bindPopup(data.destination.name || 'Destino').addTo(map);
        } else {
          destMarker.setLatLng(ll);
        }
      }
      if (Array.isArray(data.route)) {
        const latlngs = data.route.map((c) => [c.latitude, c.longitude]);
        if (routeLine) map.removeLayer(routeLine);
        if (latlngs.length > 1) {
          routeLine = L.polyline(latlngs, { color: '#2F6BFF', weight: 5, opacity: 0.95 }).addTo(map);
          map.fitBounds(routeLine.getBounds().pad(0.2));
        }
      }
    }

    window.setMapState = setState;
    document.addEventListener('message', (e) => setState(e.data));
    window.addEventListener('message', (e) => setState(e.data));
  </script>
</body>
</html>`;
}

export function CampusMap({ user, destination, route, followUser }: Props) {
  const ref = useRef<WebView>(null);
  const html = useMemo(() => buildHtml(), []);

  useEffect(() => {
    const payload = JSON.stringify({
      user,
      destination,
      route: route ?? [],
      followUser: !!followUser,
    });
    ref.current?.injectJavaScript(
      `window.setMapState && window.setMapState(${payload}); true;`
    );
  }, [user, destination, route, followUser]);

  return (
    <View style={styles.wrap}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.map}
        onLoadEnd={() => {
          const payload = JSON.stringify({
            user,
            destination,
            route: route ?? [],
            followUser: !!followUser,
          });
          ref.current?.injectJavaScript(
            `window.setMapState && window.setMapState(${payload}); true;`
          );
        }}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        mixedContentMode="always"
        allowFileAccess
        androidLayerType="hardware"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  map: { flex: 1, backgroundColor: '#000' },
});
