import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ASSETS_ROOT = fileURLToPath(new URL("../../assets", import.meta.url));

export function resolveCommonInstructionsAsset(): string {
  return join(ASSETS_ROOT, "common-instructions.md");
}
