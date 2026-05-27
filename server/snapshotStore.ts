import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

export interface SnapshotResult {
  filePath?: string;
  publicUrl?: string;
  warning?: string;
}

const MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024;

export async function saveImageSnapshot(params: {
  snapshotDir: string;
  data: Buffer;
  extension: "jpg" | "png" | "webp";
}): Promise<SnapshotResult> {
  await fs.mkdir(params.snapshotDir, { recursive: true });

  if (params.data.byteLength > MAX_SNAPSHOT_BYTES) {
    return { warning: "Google Maps screenshot was too large to save." };
  }

  const fileName = `${Date.now()}-${nanoid(8)}.${params.extension}`;
  const filePath = path.join(params.snapshotDir, fileName);
  await fs.writeFile(filePath, params.data);
  return {
    filePath,
    publicUrl: `/snapshots/${fileName}`
  };
}
