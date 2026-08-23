import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CompanionManifestV2 } from "../types.ts";

export function formatManifestFilename(screenId: string, viewport: string): string {
  const sanitizedScreen = screenId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const sanitizedViewport = viewport.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${sanitizedScreen}-${sanitizedViewport}.manifest.json`;
}

export async function saveCompanionManifest(
  manifest: CompanionManifestV2,
  outputDir: string,
): Promise<string> {
  const filename = formatManifestFilename(manifest.screenId, manifest.viewport);
  const targetPath = join(outputDir, filename);

  await mkdir(dirname(targetPath), { recursive: true });
  const serialized = JSON.stringify(manifest, null, 2);
  await writeFile(targetPath, serialized, "utf8");

  return targetPath;
}

export async function loadCompanionManifest(filePath: string): Promise<CompanionManifestV2> {
  const raw = await readFile(filePath, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { version?: unknown }).version !== "2.0"
  ) {
    throw new Error(`Invalid Companion Manifest v2.0 file at ${filePath}`);
  }

  return parsed as unknown as CompanionManifestV2;
}
