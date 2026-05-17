# Active Perception GeoGuessr

Street-level geolocation harness for a Geographer/Navigator agent loop. The app uses free Panoramax imagery, lets you pan/zoom/walk, and can inject local perception MCP tools into Codex or Claude CLI runs.

## Setup

```powershell
npm install
Copy-Item .env.example .env
uv --directory mcps/perception sync
mcps/perception/scripts/setup.ps1
```

Set `.env`:

```dotenv
GEO_AGENT_PROVIDER=codex
PERCEPTION_MCP_CONFIG=perception-mcps.json
PANORAMAX_ENDPOINT=https://panoramax.openstreetmap.fr/api
```

## Run

```powershell
npm run dev
```

Open the printed local URL, choose a Panoramax location, then press **Go**.

## Perception MCP

`perception-mcps.json` starts `mcps/perception`, which exposes:

- `make_crops`
- `ocr_read_text`
- `read_plate`
- `place_lookup`
- `perception_status`

The MCP is intentionally small: OCR, plate reading, deterministic crops, and visible-text place lookup.
Caches live in ignored local folders: `models/` and `.active-perception/`.

## Checks

```powershell
npm run test
npm run build
uv --directory mcps/perception run python -m perception_mcp --check
```
