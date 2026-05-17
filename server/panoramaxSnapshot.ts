import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { PanoState } from "../src/agent/types";

export interface SnapshotResult {
  filePath?: string;
  publicUrl?: string;
  warning?: string;
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
  const fileName = `${Date.now()}-${nanoid(8)}.${extension}`;
  const filePath = path.join(params.snapshotDir, fileName);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  return {
    filePath,
    publicUrl: `/snapshots/${fileName}`
  };
}
