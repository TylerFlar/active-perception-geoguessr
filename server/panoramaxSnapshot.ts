import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type { PanoState } from "../src/agent/types";

export interface SnapshotResult {
  filePath?: string;
  publicUrl?: string;
  warning?: string;
}

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UNWARP_SCRIPT = path.join(__dirname, "unwarp.py");

function zoomToFov(zoom: number): number {
  // Panoramax/UI zoom is roughly 0..4; map to a natural horizontal FOV.
  // 0 -> 100° (wide), 1 -> 80° (default), 2 -> 60°, 3 -> 40°, 4 -> 22°.
  const fov = 100 - zoom * 19.5;
  return Math.max(18, Math.min(110, fov));
}

async function unwarpToRectilinear(
  panoPath: string,
  outPath: string,
  heading: number,
  pitch: number,
  zoom: number
): Promise<void> {
  const fov = zoomToFov(zoom);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("python3", [
      UNWARP_SCRIPT,
      "--input", panoPath,
      "--output", outPath,
      "--heading", String(heading),
      "--pitch", String(pitch),
      "--fov", String(fov),
      "--width", String(VIEWPORT_WIDTH),
      "--height", String(VIEWPORT_HEIGHT),
    ]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`unwarp.py exited ${code}: ${stderr.trim()}`));
      }
    });
  });
}

export async function capturePanoramaxSnapshot(params: {
  pano: PanoState;
  snapshotDir: string;
}): Promise<SnapshotResult> {
  if (!params.pano.imageUrl) {
    return { warning: "No Panoramax visual image URL is available for the current picture." };
  }

  await fs.mkdir(params.snapshotDir, { recursive: true });
  const response = await fetch(params.pano.imageUrl);

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      warning: `Panoramax image fetch returned ${response.status}: ${detail.slice(0, 240)}`
    };
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("image")) {
    const detail = await response.text().catch(() => "");
    return {
      warning: `Panoramax did not return an image: ${detail.slice(0, 240)}`
    };
  }

  const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const baseName = `${Date.now()}-${nanoid(8)}`;
  const panoPath = path.join(params.snapshotDir, `${baseName}-pano.${extension}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(panoPath, buffer);

  const viewPath = path.join(params.snapshotDir, `${baseName}.jpg`);
  try {
    await unwarpToRectilinear(
      panoPath,
      viewPath,
      params.pano.heading,
      params.pano.pitch,
      params.pano.zoom
    );
    return {
      filePath: viewPath,
      publicUrl: `/snapshots/${baseName}.jpg`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      filePath: panoPath,
      publicUrl: `/snapshots/${baseName}-pano.${extension}`,
      warning: `Unwarp failed, using raw equirectangular pano: ${message}`
    };
  }
}
