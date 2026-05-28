from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

from fastmcp import FastMCP
from fastmcp.tools import ToolResult
from mcp.types import ImageContent, TextContent

SERVER_URL = os.getenv("ACTIVE_GEO_SERVER_URL", "http://127.0.0.1:5173").rstrip("/")

mcp = FastMCP(name="Active Geo Google Maps")


def _mcp_log(message: str) -> None:
    print(f"[geo-google-maps] {message}", file=sys.stderr, flush=True)


@mcp.tool("google_maps_status")
def google_maps_status() -> dict[str, Any]:
    """Return whether the project-owned Google Maps browser is open."""
    return _request("GET", "/api/maps/status")


@mcp.tool("google_maps_screenshot")
def google_maps_screenshot() -> ToolResult:
    """Capture the current masked Street View frame and record its node/camera state."""
    payload = _request("POST", "/api/maps/snapshot", {})
    frame = payload.get("frame") if isinstance(payload.get("frame"), dict) else {}
    image_paths = [frame.get("filePath")]
    return _image_tool_result(payload, image_paths)


@mcp.tool("google_maps_look")
def google_maps_look(
    action: str = "screenshot",
    heading_delta: float = 0,
    pitch_delta: float = 0,
    zoom_delta: float = 0,
    link_index: int = 0,
    target: str = "other",
    heading: float | None = None,
    pitch: float | None = None,
    zoom: float | None = None,
    reason: str = "Look around for geolocation evidence.",
) -> ToolResult:
    """Optionally pan/zoom/move/inspect, then capture the resulting Street View frame."""
    payload = _request(
        "POST",
        "/api/maps/look",
        {
            "action": action,
            "headingDelta": heading_delta,
            "pitchDelta": pitch_delta,
            "zoomDelta": zoom_delta,
            "linkIndex": link_index,
            "target": target,
            "heading": heading,
            "pitch": pitch,
            "zoom": zoom,
            "reason": reason,
        },
    )
    frame = payload.get("frame") if isinstance(payload.get("frame"), dict) else {}
    image_paths = [frame.get("filePath")]
    return _image_tool_result(payload, image_paths)


@mcp.tool("google_maps_pan")
def google_maps_pan(heading_delta: float = 0, pitch_delta: float = 0, reason: str = "Pan Street View.") -> dict[str, Any]:
    """Pan the current Street View camera without moving."""
    return _action(
        {
            "type": "pan",
            "headingDelta": heading_delta,
            "pitchDelta": pitch_delta,
            "reason": reason,
        }
    )


@mcp.tool("google_maps_zoom")
def google_maps_zoom(zoom_delta: float = 0, reason: str = "Zoom Street View.") -> dict[str, Any]:
    """Zoom the current Street View camera without moving."""
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
    """Aim or zoom the Street View camera toward a specific target without moving."""
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


def _image_tool_result(payload: dict[str, Any], image_paths: list[Any]) -> ToolResult:
    content = [
        TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))
    ]
    for image_path in image_paths:
        image = _image_content(image_path)
        if image is not None:
            content.append(image)
    return ToolResult(content=content, structured_content=payload)


def _image_content(image_path: Any) -> ImageContent | None:
    if not isinstance(image_path, str) or not image_path:
        return None
    try:
        with open(image_path, "rb") as file:
            data = base64.b64encode(file.read()).decode("ascii")
    except OSError as error:
        _mcp_log(f"could not attach image {image_path}: {error}")
        return None

    return ImageContent(
        type="image",
        data=data,
        mimeType=_mime_type(image_path),
    )


def _mime_type(image_path: str) -> str:
    lower = image_path.lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".webp"):
        return "image/webp"
    return "image/jpeg"


def build_status() -> dict[str, Any]:
    return {
        "ok": True,
        "serverUrl": SERVER_URL,
        "tools": [
            "google_maps_status",
            "google_maps_look",
            "google_maps_screenshot",
            "google_maps_pan",
            "google_maps_zoom",
            "google_maps_move",
            "google_maps_inspect",
        ],
    }
