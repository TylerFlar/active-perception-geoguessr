# Perception MCP

Local MCP server for image clues used by the geolocation loop.

```powershell
uv --directory mcps/perception sync
mcps/perception/scripts/setup.ps1
uv --directory mcps/perception run python -m perception_mcp --check
```

Active tools: `make_crops`, `ocr_read_text`, `read_plate`, `place_lookup`, `perception_status`.

Caches are ignored under `models/` and `.active-perception/`.
