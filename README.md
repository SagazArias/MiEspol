# Mi ESPOL+ (Campus ESPOL+)

Prototipo de alta resolución, convertido en app Android, que extiende la experiencia de **Mi ESPOL** con tres módulos de movilidad dentro del campus Gustavo Galindo de la ESPOL (Guayaquil, Ecuador). Está hecho con **Expo + React Native + TypeScript**.

## Problema

Para moverse a pie por un campus grande y caluroso no basta con la ruta más corta: importan la sombra, el calor, el estado de los senderos y los obstáculos temporales, como obras o charcos. La app junta esa información en un solo lugar y además premia la movilidad activa.

## Funcionalidades

### Módulos principales

| Módulo | Qué hace |
|---|---|
| **Ruta Inteligente según el clima** | Toma la posición GPS del usuario, pide el clima del campus a Open-Meteo (temperatura, humedad, viento, UV, probabilidad de lluvia) y calcula **4 rutas alternativas** hacia uno de los 14 destinos: *Más rápida*, *Mayor sombra*, *Menor calor* y *Mejor estado*. |
| **Alertas inteligentes de obstáculos** | Los usuarios reportan obstáculos con descripción, severidad y foto (cámara o galería). Una bandeja comunitaria muestra los reportes, y cada usuario puede votar si el obstáculo sigue ahí. Con **3 votos de "ya no está"** el reporte se elimina. Los obstáculos de severidad media o alta bloquean los tramos del grafo que estén a menos de 90 m. |
| **Navegación e incentivos** | Navegación a pie con seguimiento GPS (`watchPositionAsync`) y conteo de pasos con el podómetro (`expo-sensors`). Las caminatas validadas suman puntos, nivel (1 nivel cada 120 pts), rachas, misiones diarias y semanales, y posición en un ranking semanal. |
| **Ganadores y premios** | Top 3 semanal, tu posición, puntos acumulados y un catálogo de recompensas canjeables, con productos de ESPOL Shop (gorras, termos, cuadernos, bolsos…) y cupones del campus. |

### Pantallas (`src/screens/`)

| Pantalla | Descripción |
|---|---|
| `HomeScreen` | Panel inicial con tarjetas de módulos (Académico, Calendario, Bienestar, Certificados, Restaurantes, Mapa) y los tres módulos nuevos. |
| `RutaInteligenteScreen` | Selector de destino, resumen del clima con consejo (`weatherAdvice`), las opciones de ruta y el mapa. |
| `WalkNavigationScreen` | Navegación activa: sigue al usuario, recalcula la ruta desde el GPS y cuenta pasos. |
| `NavegacionIncentivosScreen` | Puntos, misiones, racha y progreso del usuario. |
| `GanadoresPremiosScreen` | Ranking semanal, recompensas y catálogo de ESPOL Shop. |
| `AlertasScreen` | Avisos administrativos y obstáculos reportados por la comunidad, con votación. |
| `ReportObstacleScreen` | Formulario de reporte con foto (`expo-image-picker`) y ubicación. |
| `CarnetScreen`, `PerfilScreen` | Pestañas de carnet (QR) y perfil. |
| `ModulePlaceholderScreen` | Marcador para los módulos de Mi ESPOL que no están implementados. |

## Stack

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | Expo SDK | ~57.0.12 |
| UI | React / React Native | 19.2.3 / 0.86.2 |
| Lenguaje | TypeScript | ~6.0.3 |
| Navegación | React Navigation (native-stack, bottom-tabs) | 7.x |
| Mapa | Leaflet 1.9.4 + teselas OpenStreetMap dentro de `react-native-webview` | 13.16.1 |
| Ubicación / sensores | `expo-location`, `expo-sensors` (Pedometer) | ~57.0 |
| Fotos | `expo-image-picker`, `expo-file-system` | ~57.0 |
| Persistencia local | `@react-native-async-storage/async-storage` | 2.2.0 |
| UI extra | `expo-linear-gradient`, `@expo/vector-icons` (Ionicons) | — |
| Clima | API pública de Open-Meteo (sin clave) | — |
| Build | EAS Build (perfiles `development`, `preview`, `production`, que generan APK) | CLI >= 16 |

`react-native-maps` aparece en `package.json`, pero el mapa actual (`src/components/CampusMap.tsx`) se dibuja con Leaflet en un WebView.

## Arquitectura

```
App.tsx
└── NavigationContainer (tema oscuro)
    └── Stack (native-stack, animación fade)
        ├── Tabs (bottom-tabs flotante): Home · Alertas · Carnet · Perfil
        ├── RutaInteligente · WalkNavigation · NavegacionIncentivos
        ├── GanadoresPremios · ReportObstacle · ModulePlaceholder
```

- **Pantallas** (`src/screens`): solo se encargan de la UI y llaman a los servicios.
- **Servicios** (`src/services`): lógica de dominio sin UI.
  - `routing.ts`: Dijkstra sobre el grafo del campus con costos que dependen del clima.
  - `weather.ts`: consulta a Open-Meteo (zona horaria `America/Guayaquil`).
  - `location.ts`: permisos, GPS y distancia haversine.
  - `obstacles.ts`: CRUD de obstáculos en AsyncStorage, votos y cálculo de los tramos bloqueados.
  - `incentives.ts`: puntos, niveles, misiones, rachas, ranking semanal y recompensas, también en AsyncStorage.
  - Los dos servicios con estado ofrecen `subscribe*` para que las pantallas se actualicen.
- **Datos** (`src/data`): grafo y capas del mapa (`campusMap.ts`), destinos, catálogo de ESPOL Shop y avisos.
- **Componentes** (`src/components`): `CampusMap` (Leaflet en un WebView: usuario, destino y ruta) y `ModuleCard`.

### Del KML al grafo del campus

Los datos del campus salen de un mapa propio en KML (`assets/campus/Mapa-ESPOL.kml`), procesado con dos scripts de Node:

1. **`scripts/extract-kml.js`** recorre los `<Placemark>` con expresiones regulares, extrae nombre, descripción y coordenadas, y separa polígonos (edificios) de líneas (senderos). Escribe `buildings.geojson`, `paths.geojson` y un reporte (`extract-report.json`) que relaciona cada destino con su placemark de origen (por ejemplo `1A - CTI`).
2. **`scripts/build-campus-graph.js`**:
   - Simplifica cada sendero y deja un punto cada ~35 m como nodo.
   - Etiqueta cada tramo según su nombre en el KML: `⛔` lo marca como bloqueado, `⚠` como precaución, y *ciclovía / cubierto / pasarela* como cubierto. Con eso asigna `shade`, `heatExposure` y `pathCondition`.
   - Conecta cada uno de los 14 destinos con los 3 nodos de sendero más cercanos.
   - Escribe `graph.json`, con **155 nodos y 358 aristas**, además de `destinations.json`, `dest-buildings.geojson` y `map-layers.json`.

### Cálculo de la ruta (`routing.ts`)

1. El usuario se agrega al grafo como un nodo temporal `__user__` y se une a los nodos más cercanos.
2. Para cada uno de los 4 criterios se ejecuta **Dijkstra**. El costo de una arista es su distancia multiplicada por factores del clima actual:

| Criterio | Costo (simplificado) |
|---|---|
| Más rápida | `distancia` |
| Mayor sombra | `distancia × (1.35 − 0.7·sombra − 0.25·cubierto + 0.1·UV)` |
| Menor calor | `distancia × (1.2 + 0.8·exposición + 0.15·calor − 0.2·sombra)` |
| Mejor estado | `distancia × (1.4 − 0.7·estado ± lluvia según si está cubierto)` |

   Aquí `calor = (T − 26 °C)/10`, `UV = (índice − 5)/6` y `lluvia = probabilidad/100`. Las aristas bloqueadas, ya sea en el KML o por obstáculos activos, tienen costo infinito.
3. Si un criterio no encuentra camino, la opción aparece como bloqueada. `recalculateFromGps` repite el cálculo durante la navegación y conserva el criterio elegido si sigue disponible.

### Destinos (14)

| N.º | Destino | N.º | Destino |
|---|---|---|---|
| 1 | CTI | 8 | FCSH |
| 2 | Admisiones | 9 | FCNM |
| 3 | FCV | 10 | UBP |
| 4 | Residencias | 11 | FIEC |
| 5 | FIMCM | 12 | FIMCP |
| 6 | Rectorado | 13 | FICT |
| 7 | Biblioteca | 14 | FADCOM |

## Cómo se construyó

1. Se diseñaron prototipos de alta resolución de los módulos y luego se llevaron a pantallas en React Native con un tema oscuro propio (`src/theme/colors.ts`).
2. Se trazaron edificios y senderos del campus en un mapa KML y se convirtieron en GeoJSON y en un grafo con los scripts anteriores.
3. Se implementó la lógica como servicios independientes de la UI: ruteo, clima, obstáculos e incentivos.
4. Se generó un APK instalable con EAS Build.

En este MVP no hay backend. Los obstáculos, votos e incentivos se guardan en el dispositivo con AsyncStorage, y el ranking se completa con competidores simulados de forma determinista para cada semana.

## Ejecutar el proyecto

Requisitos: Node.js y npm. Para probar en un teléfono hace falta la app Expo Go o un development build.

```bash
npm install
npx expo start        # o: npm start
```

Otros scripts:

```bash
npm run android       # expo run:android (build nativo local)
npm run web           # expo start --web
```

### Generar el APK con EAS

```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview      # APK de distribución interna
eas build -p android --profile production   # APK de producción
```

### Regenerar los datos del campus

```bash
node scripts/extract-kml.js          # KML -> buildings/paths GeoJSON
node scripts/build-campus-graph.js   # GeoJSON -> graph.json y capas
```

> `extract-kml.js` lee el KML desde una ruta local fija (`C:/Users/Sagaz/Downloads/Mapa ESPOL.kml`). Antes de ejecutarlo, cámbiala a `assets/campus/Mapa-ESPOL.kml`.

## Estructura

```
├── App.tsx                 # Navegación (stack + tabs)
├── index.ts                # Punto de entrada
├── app.json / eas.json     # Configuración Expo y EAS (package ec.edu.espol.campusinteligente)
├── assets/campus/          # KML, GeoJSON, graph.json, destinos, capas
├── scripts/                # extract-kml.js, build-campus-graph.js
└── src/
    ├── components/         # CampusMap (Leaflet/WebView), ModuleCard
    ├── data/               # campusMap, destinations, espolShop, notices
    ├── screens/            # 10 pantallas
    ├── services/           # routing, weather, location, obstacles, incentives
    ├── theme/              # colores
    ├── types/              # tipos de navegación
    └── utils/              # formato y tiempo
```

## Permisos (Android)

Ubicación precisa y aproximada (rutas y validación de caminatas), cámara y lectura de imágenes (fotos de obstáculos), vibración, internet y estado de red.

## Mejoras futuras

- Backend compartido para que obstáculos, votos y ranking sean reales entre usuarios, en lugar de vivir en AsyncStorage.
- Valores de sombra, calor y estado medidos en campo, en vez de inferidos del nombre del tramo.
- Mapa sin conexión, sin depender de las teselas de OSM ni de Leaflet desde unpkg.
- Retirar `react-native-maps` si no se va a usar, o migrar el mapa a él.
- Integrar los módulos de Mi ESPOL que hoy son marcadores.
- Pruebas automatizadas del ruteo y de las reglas de incentivos.

## Licencia

Ver [LICENSE](LICENSE) (MIT).
