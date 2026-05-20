from __future__ import annotations

import contextlib
import importlib.util
import json
import os
import sys
import tempfile
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterator

from fastmcp import FastMCP
from PIL import Image, ImageOps


def _cpu_thread_count_from_env() -> int:
    requested = os.getenv("ACTIVE_GEO_CPU_THREADS", "auto").strip().lower()
    if requested and requested != "auto":
        try:
            return max(1, int(requested))
        except ValueError:
            pass
    cpu_count = os.cpu_count() or 2
    return max(1, min(8, cpu_count - 1 if cpu_count > 2 else cpu_count))


def _mcp_log(message: str) -> None:
    print(f"[geo-perception] {message}", file=sys.stderr, flush=True)


@contextlib.contextmanager
def _library_output_to_stderr() -> Iterator[None]:
    # MCP stdio uses stdout for protocol frames; noisy ML libraries must not write there.
    with contextlib.redirect_stdout(sys.stderr):
        yield


REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = Path(os.getenv("ACTIVE_GEO_MODELS_DIR", str(REPO_ROOT / "models")))
if not MODELS_DIR.is_absolute():
    MODELS_DIR = REPO_ROOT / MODELS_DIR

CACHE_DIR = Path(os.getenv("ACTIVE_GEO_CACHE_DIR", str(REPO_ROOT / ".active-perception" / "cache")))
if not CACHE_DIR.is_absolute():
    CACHE_DIR = REPO_ROOT / CACHE_DIR

_CPU_THREADS = str(_cpu_thread_count_from_env())
for env_name in ["OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_MAX_THREADS", "ORT_INTRA_OP_NUM_THREADS"]:
    os.environ.setdefault(env_name, _CPU_THREADS)
os.environ.setdefault("ORT_INTER_OP_NUM_THREADS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

mcp = FastMCP(name="Active Geo Perception")


@mcp.tool("perception_status")
def perception_status() -> dict[str, Any]:
    """Report the active MCP surface and runtime providers."""
    return build_status()


@mcp.tool("make_crops")
def make_crops(image_path: str, boxes: list[dict[str, Any]], label_prefix: str = "crop") -> dict[str, Any]:
    """Save pixel crops for downstream OCR or ALPR. This is cheap and deterministic."""
    image_file = _safe_image_path(image_path)
    crop_dir = CACHE_DIR / "crops"
    crop_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[dict[str, Any]] = []

    with Image.open(image_file) as raw_image:
        image = ImageOps.exif_transpose(raw_image)
        width, height = image.size
        for index, raw_box in enumerate(boxes):
            box = _normalize_box(raw_box, width, height)
            crop = image.crop((box["x1"], box["y1"], box["x2"], box["y2"]))
            out_path = crop_dir / f"{label_prefix}_{index}.png"
            crop.save(out_path)
            outputs.append({
                "index": index,
                "path": str(out_path),
                "box": box,
                "size": {"width": crop.width, "height": crop.height},
            })

    return {"ok": True, "image_path": str(image_file), "crops": outputs}


@mcp.tool("ocr_read_text")
def ocr_read_text(
    image_path: str,
    crop: dict[str, Any] | None = None,
    min_confidence: float = 0.35,
) -> dict[str, Any]:
    """Run lightweight RapidOCR for visible text in signs, storefronts, and markings."""
    image_file = _safe_image_path(image_path)
    target = _materialize_optional_crop(image_file, crop, "ocr")
    started = time.perf_counter()
    try:
        prepared = _prepare_image_for_ocr(target)
        with _library_output_to_stderr():
            output = _rapidocr()(str(prepared["path"]))
        texts = _rapidocr_texts(output, min_confidence=min_confidence, scale=prepared["scale"])
        return {
            "ok": True,
            "backend": "rapidocr",
            "image_path": str(target),
            "processed_image_path": str(prepared["path"]),
            "resized": prepared["resized"],
            "elapsed_sec": round(time.perf_counter() - started, 3),
            "texts": texts,
            "raw": _jsonable(output),
        }
    except Exception as exc:
        return _backend_missing(
            "rapidocr",
            exc,
            ["uv --directory mcps/perception sync"],
            extra={"image_path": str(target), "elapsed_sec": round(time.perf_counter() - started, 3)},
        )


@mcp.tool("read_plate")
def read_plate(image_path: str, crop: dict[str, Any] | None = None) -> dict[str, Any]:
    """Run FastALPR when a visible plate is plausibly present."""
    image_file = _safe_image_path(image_path)
    target = _materialize_optional_crop(image_file, crop, "plate")
    started = time.perf_counter()
    try:
        from fast_alpr import ALPR

        providers = _onnx_providers()
        with _library_output_to_stderr():
            alpr = ALPR(
                detector_model=os.getenv("FASTALPR_DETECTOR_MODEL", "yolo-v9-t-384-license-plate-end2end"),
                detector_providers=providers,
                ocr_model=os.getenv("FASTALPR_OCR_MODEL", "cct-xs-v2-global-model"),
                ocr_device="cuda" if providers and providers[0] == "CUDAExecutionProvider" else "cpu",
                ocr_providers=providers,
            )
            raw = alpr.predict(str(target))
        return {
            "ok": True,
            "backend": "fast-alpr",
            "image_path": str(target),
            "providers": providers,
            "elapsed_sec": round(time.perf_counter() - started, 3),
            "raw": _jsonable(raw),
        }
    except Exception as exc:
        return _backend_missing(
            "fast-alpr",
            exc,
            ["uv --directory mcps/perception sync"],
            extra={"image_path": str(target), "elapsed_sec": round(time.perf_counter() - started, 3)},
        )


@mcp.tool("place_lookup")
def place_lookup(query: str, country_hint: str | None = None, limit: int = 5) -> dict[str, Any]:
    """Lookup visible text only, such as a town, road, business, or landmark name."""
    cleaned = " ".join(query.split())
    if not cleaned:
        return {"ok": False, "backend": "nominatim", "error": "query must not be empty"}
    if len(cleaned) > 120:
        return {"ok": False, "backend": "nominatim", "error": "query is too long for a visible-text lookup"}

    search = f"{cleaned}, {country_hint}" if country_hint else cleaned
    started = time.perf_counter()
    try:
        from geopy.geocoders import Nominatim

        geocoder = Nominatim(user_agent="active-perception-geoguessr", timeout=6)
        results = geocoder.geocode(search, exactly_one=False, limit=max(1, min(10, int(limit))))
        places = []
        for result in results or []:
            raw = getattr(result, "raw", {}) or {}
            places.append({
                "display_name": getattr(result, "address", None),
                "lat": float(result.latitude),
                "lng": float(result.longitude),
                "class": raw.get("class"),
                "type": raw.get("type"),
                "importance": raw.get("importance"),
                "address": raw.get("address"),
            })
        return {
            "ok": True,
            "backend": "nominatim",
            "query": cleaned,
            "country_hint": country_hint,
            "elapsed_sec": round(time.perf_counter() - started, 3),
            "places": places,
        }
    except Exception as exc:
        return _backend_missing(
            "nominatim",
            exc,
            ["Check network access or skip map-context lookup."],
            extra={"query": cleaned, "elapsed_sec": round(time.perf_counter() - started, 3)},
        )


def build_status() -> dict[str, Any]:
    return {
        "ok": True,
        "tools": ["make_crops", "ocr_read_text", "read_plate", "place_lookup", "perception_status"],
        "repo_root": str(REPO_ROOT),
        "models_dir": str(MODELS_DIR),
        "cache_dir": str(CACHE_DIR),
        "packages": {
            "fastmcp": _has_module("fastmcp"),
            "PIL": _has_module("PIL"),
            "rapidocr": _has_module("rapidocr"),
            "fast_alpr": _has_module("fast_alpr"),
            "geopy": _has_module("geopy"),
            "onnxruntime": _has_module("onnxruntime"),
        },
        "hardware": _hardware_status(),
    }


@lru_cache(maxsize=1)
def _rapidocr() -> Any:
    from rapidocr import RapidOCR

    _mcp_log("loading RapidOCR")
    with _library_output_to_stderr():
        return RapidOCR()


@lru_cache(maxsize=1)
def _onnx_providers() -> list[str] | None:
    try:
        import onnxruntime as ort
    except Exception:
        return None

    available = ort.get_available_providers()
    requested = os.getenv("ACTIVE_GEO_ONNX_PROVIDER", "auto").strip()
    if requested and requested.lower() != "auto":
        providers = [entry.strip() for entry in requested.split(",") if entry.strip()]
        return providers or None

    for primary in ["CUDAExecutionProvider", "DmlExecutionProvider", "CoreMLExecutionProvider", "CPUExecutionProvider"]:
        if primary in available:
            providers = [primary]
            if primary != "CPUExecutionProvider" and "CPUExecutionProvider" in available:
                providers.append("CPUExecutionProvider")
            return providers
    return available or None


def _hardware_status() -> dict[str, Any]:
    status: dict[str, Any] = {
        "active_geo_cpu_threads": os.getenv("ACTIVE_GEO_CPU_THREADS", "auto"),
        "env_threads": {
            "OMP_NUM_THREADS": os.getenv("OMP_NUM_THREADS"),
            "MKL_NUM_THREADS": os.getenv("MKL_NUM_THREADS"),
            "ORT_INTRA_OP_NUM_THREADS": os.getenv("ORT_INTRA_OP_NUM_THREADS"),
            "ORT_INTER_OP_NUM_THREADS": os.getenv("ORT_INTER_OP_NUM_THREADS"),
        },
    }
    try:
        import onnxruntime as ort

        status["onnxruntime_version"] = ort.__version__
        status["onnx_available_providers"] = ort.get_available_providers()
        status["onnx_selected_providers"] = _onnx_providers()
    except Exception as exc:
        status["onnx_error"] = str(exc)
    return status


def _prepare_image_for_ocr(image_path: Path) -> dict[str, Any]:
    max_side = int(os.getenv("ACTIVE_GEO_OCR_MAX_SIDE", "2400"))
    with Image.open(image_path) as raw_image:
        image = ImageOps.exif_transpose(raw_image).convert("RGB")
        largest = max(image.size)
        if largest <= max_side:
            return {"path": image_path, "resized": False, "scale": 1.0}

        scale = max_side / largest
        resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        output = Path(tempfile.NamedTemporaryFile(
            prefix="ocr_resized_",
            suffix=".jpg",
            dir=CACHE_DIR,
            delete=False,
        ).name)
        resized.save(output, quality=92)
        return {"path": output, "resized": True, "scale": scale}


def _rapidocr_texts(output: Any, min_confidence: float, scale: float) -> list[dict[str, Any]]:
    txts = _as_list(getattr(output, "txts", None))
    scores = _as_list(getattr(output, "scores", None))
    boxes = _as_list(getattr(output, "boxes", None))
    texts: list[dict[str, Any]] = []
    for index, text in enumerate(txts):
        if not isinstance(text, str) or not text.strip():
            continue
        score = float(scores[index]) if index < len(scores) and scores[index] is not None else None
        if score is not None and score < min_confidence:
            continue
        box = _scale_box_points(boxes[index], scale) if index < len(boxes) else None
        texts.append({"text": text, "confidence": score, "box": box})
    return texts


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _scale_box_points(points: Any, scale: float) -> Any:
    if scale == 1.0:
        return _jsonable(points)
    try:
        return [[round(float(x) / scale), round(float(y) / scale)] for x, y in points]
    except Exception:
        return _jsonable(points)


def _backend_missing(
    backend: str,
    exc: Exception,
    install: list[str],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ok": False,
        "backend": backend,
        "error": str(exc),
        "install": install,
    }
    if extra:
        result.update(extra)
    return result


def _safe_image_path(image_path: str) -> Path:
    path = Path(image_path).expanduser()
    if not path.is_absolute():
        path = (REPO_ROOT / path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Image path does not exist: {path}")
    if not path.is_file():
        raise ValueError(f"Image path is not a file: {path}")
    return path


def _materialize_optional_crop(image_path: Path, crop: dict[str, Any] | None, prefix: str) -> Path:
    if not crop:
        return image_path
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with Image.open(image_path) as raw_image:
        image = ImageOps.exif_transpose(raw_image)
        box = _normalize_box(crop, image.width, image.height)
        cropped = image.crop((box["x1"], box["y1"], box["x2"], box["y2"]))
        output = Path(tempfile.NamedTemporaryFile(
            prefix=f"{prefix}_",
            suffix=".png",
            dir=CACHE_DIR,
            delete=False,
        ).name)
        cropped.save(output)
    return output


def _normalize_box(box: dict[str, Any], image_width: int, image_height: int) -> dict[str, int]:
    if {"x1", "y1", "x2", "y2"}.issubset(box):
        x1 = float(box["x1"])
        y1 = float(box["y1"])
        x2 = float(box["x2"])
        y2 = float(box["y2"])
    elif {"x", "y", "width", "height"}.issubset(box):
        x1 = float(box["x"])
        y1 = float(box["y"])
        x2 = x1 + float(box["width"])
        y2 = y1 + float(box["height"])
    else:
        raise ValueError("Crop/box must contain x1,y1,x2,y2 or x,y,width,height.")

    if max(x1, y1, x2, y2) <= 1.0:
        x1 *= image_width
        x2 *= image_width
        y1 *= image_height
        y2 *= image_height

    left = max(0, min(image_width - 1, round(x1)))
    top = max(0, min(image_height - 1, round(y1)))
    right = max(left + 1, min(image_width, round(x2)))
    bottom = max(top + 1, min(image_height, round(y2)))
    return {"x1": left, "y1": top, "x2": right, "y2": bottom}


def _has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def _jsonable(value: Any) -> Any:
    try:
        json.dumps(value)
        return value
    except TypeError:
        if isinstance(value, Path):
            return str(value)
        if hasattr(value, "tolist"):
            return value.tolist()
        if hasattr(value, "to_json"):
            try:
                parsed = json.loads(value.to_json())
                return parsed
            except Exception:
                return value.to_json()
        if hasattr(value, "to_dict"):
            return value.to_dict()
        if isinstance(value, dict):
            return {str(key): _jsonable(entry) for key, entry in value.items()}
        if isinstance(value, (list, tuple)):
            return [_jsonable(entry) for entry in value]
        return repr(value)
