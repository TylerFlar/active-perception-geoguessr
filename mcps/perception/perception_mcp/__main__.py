from __future__ import annotations

import argparse
import contextlib
import json
import sys
import time

from .server import build_status, mcp


def main() -> None:
    parser = argparse.ArgumentParser(description="Active Geo local perception MCP server.")
    parser.add_argument("--check", action="store_true", help="Print backend status and exit.")
    parser.add_argument(
        "--analyze",
        metavar="IMAGE",
        help="Run OCR + ALPR on IMAGE once, print a compact JSON summary, and exit.",
    )
    args = parser.parse_args()

    if args.check:
        print(json.dumps(build_status(), indent=2))
        return

    if args.analyze:
        print(json.dumps(_analyze(args.analyze)))
        return

    mcp.run()


def _analyze(image_path: str) -> dict:
    """Single-shot perception pre-pass: OCR + ALPR in one process invocation."""
    from .server import ocr_read_text, read_plate

    started = time.perf_counter()
    # ML libraries may write to stdout; keep the protocol/result channel clean.
    with contextlib.redirect_stdout(sys.stderr):
        try:
            ocr = ocr_read_text(image_path=image_path)
        except Exception as exc:  # noqa: BLE001 - report, never crash the pre-pass
            ocr = {"ok": False, "error": str(exc)}
        try:
            plate = read_plate(image_path=image_path)
        except Exception as exc:  # noqa: BLE001
            plate = {"ok": False, "error": str(exc)}

    if isinstance(ocr, dict):
        ocr.pop("raw", None)  # drop the verbose backend dump; `texts` is the useful part
    return {
        "ok": True,
        "elapsed_sec": round(time.perf_counter() - started, 2),
        "ocr": ocr,
        "plate": plate,
    }


if __name__ == "__main__":
    main()
