param()

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$McpDir = Resolve-Path (Join-Path $ScriptDir "..")

function Invoke-McpPython {
  param(
    [Parameter(Mandatory = $true)][string]$Code
  )

  $Code | uv run python -
}

Push-Location $McpDir
try {
  uv sync

  Write-Host "Prewarming RapidOCR..."
  Invoke-McpPython @"
from perception_mcp.server import _rapidocr
_rapidocr()
print("rapidocr-prewarmed")
"@

  uv run python -m perception_mcp --check
}
finally {
  Pop-Location
}
