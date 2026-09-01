import * as fs from "node:fs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaptureRecord } from "../../../../olt/scripts/src/engine/store/capsule/captures.ts";
import { cleanupVirtualSummaryFS, setupVirtualSummaryFS } from "../../fixture.ts";

let rootCounter = 0;

export function setupAssetVirtualFS(): void {
  setupVirtualSummaryFS();
}

export function cleanupAssetVirtualFS(): void {
  cleanupVirtualSummaryFS();
}

export function runRoot(): string {
  rootCounter += 1;
  const root = `/virtual/graph-asset-completeness-${rootCounter}`;
  fs.mkdirSync(join(root, "evidence"), { recursive: true });
  return root;
}

export function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt8(0x89, 0);
  header.write("PNG\r\n\n", 1, "latin1");
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.alloc(48)]);
}

export function writePng(
  root: string,
  relativePath: string,
  width: number,
  height: number,
): number {
  const bytes = png(width, height);
  writeFileSync(join(root, relativePath), bytes);
  return bytes.length;
}

export function capture(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    kind: "screenshot",
    name: "shot.png",
    sha256: "a".repeat(64),
    bytes: 0,
    blob_path: "evidence/shot.png",
    path: "evidence/shot.png",
    storage: "copy",
    original_path: "evidence/shot.png",
    ...overrides,
  };
}
