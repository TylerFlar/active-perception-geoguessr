# Active Perception GeoGuessr

Street-level geolocation harness for a Geographer/Navigator agent loop. The app opens a project-owned Google Maps browser window, captures masked Street View screenshots, and can inject local perception plus Google Maps MCP tools into Codex or Claude CLI runs.

## Setup

```powershell
npm install
Copy-Item .env.example .env
uv --directory mcps/perception sync
uv --directory mcps/google_maps sync
mcps/perception/scripts/setup.ps1
```

Set `.env`:

```dotenv
GEO_AGENT_PROVIDER=codex
PERCEPTION_MCP_CONFIG=perception-mcps.json
GOOGLE_MAPS_START_URL=https://www.google.com/maps
```

## Run

```powershell
npm run dev
```

Open the printed local URL, press the map button to open Google Maps, pick a Street View location in that Maps window, then press **Go** in the app.

## Local MCPs

`perception-mcps.json` starts two project-local MCP servers:

- `mcps/perception`: `make_crops`, `ocr_read_text`, `read_plate`, `place_lookup`, `perception_status`
- `mcps/google_maps`: `google_maps_status`, `google_maps_open`, `google_maps_screenshot`, `google_maps_pan`, `google_maps_zoom`, `google_maps_move`, `google_maps_inspect`

The Google Maps MCP talks to this app server over `ACTIVE_GEO_SERVER_URL` so CLI agents do not depend on globally installed browser tools.

## Checks

```powershell
npm run test
npm run build
uv --directory mcps/perception run python -m perception_mcp --check
uv --directory mcps/google_maps run python -m google_maps_mcp --check
```
