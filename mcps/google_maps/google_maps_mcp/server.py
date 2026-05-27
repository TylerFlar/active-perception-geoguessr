from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

from fastmcp import FastMCP

SERVER_URL = os.getenv("ACTIVE_GEO_SERVER_URL", "http://127.0.0.1:5173").rstrip("/")

mcp = FastMCP(name="Active Geo Google Maps")


def _mcp_log(message: str) -> None:
    print(f"[geo-google-maps] {message}", file=sys.stderr, flush=True)


@mcp.tool("google_maps_status")
def google_maps_status() -> dict[str, Any]:
    """Return whether the project-owned Google Maps browser is open."""
    return _request("GET", "/api/maps/status")


@mcp.tool("google_maps_open")
def google_maps_open(url: str | None = None) -> dict[str, Any]:
    """Open or focus the project-owned Google Maps browser window."""
    return _request("POST", "/api/maps/open", {"url": url} if url else {})


@mcp.tool("google_maps_screenshot")
def google_maps_screenshot() -> dict[str, Any]:
    """Capture the current masked Google Maps frame and return its local file path."""
    return _request("POST", "/api/maps/snapshot", {})


@mcp.tool("google_maps_pan")
def google_maps_pan(heading_delta: float, pitch_delta: float = 0, reason: str = "Pan Street View.") -> dict[str, Any]:
    """Drag Google Maps Street View by heading and pitch deltas."""
    return _action(
        {
            "type": "pan",
            "headingDelta": heading_delta,
            "pitchDelta": pitch_delta,
            "reason": reason,
        }
    )


@mcp.tool("google_maps_zoom")
def google_maps_zoom(zoom_delta: float, reason: str = "Zoom Street View.") -> dict[str, Any]:
    """Zoom the current Google Maps Street View frame in or out."""
    return _action(
        {
            "type": "zoom",
            "zoomDelta": zoom_delta,
            "reason": reason,
        }
    )


@mcp.tool("google_maps_move")
def google_maps_move(link_index: int = 0, reason: str = "Move to a Street View screen target.") -> dict[str, Any]:
    """Click one of the available screen move targets in Google Maps Street View."""
    return _action(
        {
            "type": "move",
            "linkIndex": link_index,
            "reason": reason,
        }
    )


@mcp.tool("google_maps_inspect")
def google_maps_inspect(
    target: str = "other",
    heading: float | None = None,
    pitch: float | None = None,
    zoom: float | None = None,
    reason: str = "Inspect a visual target in Street View.",
) -> dict[str, Any]:
    """Pan or zoom toward a specific inspection target in Google Maps Street View."""
    return _action(
        {
            "type": "inspect",
            "target": target,
            "heading": heading,
            "pitch": pitch,
            "zoom": zoom,
            "reason": reason,
        }
    )


def _action(action: dict[str, Any]) -> dict[str, Any]:
    return _request("POST", "/api/maps/action", {"action": action})


def _request(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{SERVER_URL}{path}"
    data = None
    headers: dict[str, str] = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["content-type"] = "application/json"

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {"ok": True}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        return {"ok": False, "error": f"HTTP {error.code}: {detail[:800]}"}
    except Exception as error:
        _mcp_log(f"{method} {url} failed: {error}")
        return {"ok": False, "error": str(error), "serverUrl": SERVER_URL}


def build_status() -> dict[str, Any]:
    return {
        "ok": True,
        "serverUrl": SERVER_URL,
        "tools": [
            "google_maps_status",
            "google_maps_open",
            "google_maps_screenshot",
            "google_maps_pan",
            "google_maps_zoom",
            "google_maps_move",
            "google_maps_inspect",
        ],
    }
