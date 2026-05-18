import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

export interface SnapshotResult {
  filePath?: string;
  publicUrl?: string;
  warning?: string;
}

const MAX_BROWSER_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export async function capturePanoramaxSnapshot(params: {
  snapshotDir: string;
  snapshotDataUrl?: string;
}): Promise<SnapshotResult> {
  await fs.mkdir(params.snapshotDir, { recursive: true });

  if (params.snapshotDataUrl) {
    return await saveBrowserSnapshot(params.snapshotDir, params.snapshotDataUrl);
  }

  return {
    warning: "Browser viewport snapshot was not provided."
  };
}

async function saveBrowserSnapshot(snapshotDir: string, snapshotDataUrl: string): Promise<SnapshotResult> {
  const parsed = parseImageDataUrl(snapshotDataUrl);
  if (!parsed) {
    return { warning: "Browser viewport snapshot was not a supported image data URL." };
  }
  if (parsed.buffer.byteLength > MAX_BROWSER_SNAPSHOT_BYTES) {
    return { warning: "Browser viewport snapshot was too large to save." };
  }

  const fileName = `${Date.now()}-${nanoid(8)}.${parsed.extension}`;
  const filePath = path.join(snapshotDir, fileName);
  await fs.writeFile(filePath, parsed.buffer);
  return {
    filePath,
    publicUrl: `/snapshots/${fileName}`
  };
}

function parseImageDataUrl(value: string): { buffer: Buffer; extension: string } | undefined {
  const match = value.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return undefined;
  }

  const [, type, data] = match;
  return {
    buffer: Buffer.from(data, "base64"),
    extension: type === "jpeg" ? "jpg" : type
  };
}
