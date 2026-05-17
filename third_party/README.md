# Third-Party Code

Only third-party projects that back the active lightweight MCP tools live here. Restore them after cloning:

```powershell
git submodule update --init --recursive --depth 1
```

Current perception submodules: `RapidOCR` and `fast-alpr`.
Do not commit model weights here. Use ignored local folders: `models/` and `.active-perception/`.
