"""Equirectangular -> rectilinear projection.

Reads an equirectangular panorama and renders a rectilinear viewport
at the given heading, pitch, and FOV, saving the result as a JPEG.

Vectorized with numpy; ~200-400ms for a 5760x2880 input on a laptop CPU.
"""
import argparse
import math
import sys

import numpy as np
from PIL import Image


def render(
    pano_path: str,
    out_path: str,
    heading_deg: float,
    pitch_deg: float,
    fov_deg: float,
    out_w: int,
    out_h: int,
) -> None:
    pano = np.asarray(Image.open(pano_path).convert("RGB"))
    ph, pw, _ = pano.shape

    fov = math.radians(fov_deg)
    f = 0.5 * out_w / math.tan(fov / 2)
    xs, ys = np.meshgrid(
        np.arange(out_w) - out_w / 2,
        np.arange(out_h) - out_h / 2,
    )
    rays = np.stack(
        [xs, -ys, np.full_like(xs, f)], axis=-1
    ).astype(np.float64)
    rays /= np.linalg.norm(rays, axis=-1, keepdims=True)

    p = math.radians(pitch_deg)
    h = math.radians(heading_deg)
    cp, sp = math.cos(p), math.sin(p)
    ch, sh = math.cos(h), math.sin(h)
    Rp = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    Ry = np.array([[ch, 0, sh], [0, 1, 0], [-sh, 0, ch]])
    R = Ry @ Rp
    world = rays @ R.T

    x, y, z = world[..., 0], world[..., 1], world[..., 2]
    theta = np.arctan2(x, z)
    phi = np.arcsin(np.clip(y, -1, 1))

    u = ((theta / (2 * math.pi)) + 0.5) * pw
    v = ((-phi / math.pi) + 0.5) * ph
    u = np.clip(u, 0, pw - 1).astype(np.int32)
    v = np.clip(v, 0, ph - 1).astype(np.int32)

    out = pano[v, u]
    Image.fromarray(out).save(out_path, quality=88)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Path to equirectangular JPEG.")
    parser.add_argument("--output", required=True, help="Path to write rectilinear JPEG.")
    parser.add_argument("--heading", type=float, default=0.0, help="Yaw in degrees, +ve right.")
    parser.add_argument("--pitch", type=float, default=0.0, help="Pitch in degrees, +ve up.")
    parser.add_argument("--fov", type=float, default=75.0, help="Horizontal FOV in degrees.")
    parser.add_argument("--width", type=int, default=1280, help="Output width in pixels.")
    parser.add_argument("--height", type=int, default=720, help="Output height in pixels.")
    args = parser.parse_args()
    try:
        render(
            args.input,
            args.output,
            args.heading,
            args.pitch,
            args.fov,
            args.width,
            args.height,
        )
    except Exception as exc:
        print(f"unwarp failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
