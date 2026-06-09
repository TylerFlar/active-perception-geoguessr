# Active Perception GeoGuessr

Street-level geolocation harness for a Navigator, Geographer, and Verifier loop. The app opens a project-owned Google Maps browser window, captures masked Street View screenshots, and can inject bounded Google Maps tools into CLI runs.

## Setup

```powershell
npm install
Copy-Item .env.example .env
uv --directory mcps/google_maps sync
```

Set `.env`:

```dotenv
GEO_AGENT_PROVIDER=codex
GOOGLE_MAPS_START_URL=https://www.google.com/maps
```

## Run

```powershell
npm run dev
```

Open the printed local URL, press the map button to open Google Maps, pick a Street View location in that Maps window, then press **Go** in the app.

## Local MCPs

The app uses one project-local MCP server:

- `mcps/google_maps`: `google_maps_status`, `google_maps_look`, `google_maps_screenshot`, `google_maps_pan`, `google_maps_zoom`, `google_maps_move`, `google_maps_inspect`

The Navigator receives the current Street View frame and can decide whether movement or camera work is useful. `google_maps_look` is the easiest path: it can pan, zoom, inspect, move, or simply capture, then returns the resulting screenshot. Captured frames are stored in a 2.5D/topological scene graph with physical nodes, move edges, camera heading/pitch/zoom, and extracted evidence.

The Geographer and Verifier receive only the Navigator's text survey and prior workflow messages. They do not receive Google Maps tools, MCP servers, screenshots, or hidden Maps metadata.

## Checks

```powershell
npm run test
npm run build
uv --directory mcps/google_maps run python -m google_maps_mcp --check
```
