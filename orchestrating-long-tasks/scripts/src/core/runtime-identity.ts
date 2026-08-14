import { lstatSync } from "node:fs";
import { join } from "node:path";
import { readBoundedBytes } from "./json.ts";

const VERSION_PATTERN = /RUNTIME_VERSION\s*=\s*["']([^"']+)["']/u;

export function pinnedRuntimeVersion(runtimeRoot: string): string {
  const entrypoint = join(runtimeRoot, "harness.ts");
  const metadata = lstatSync(entrypoint);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("pinned runtime entrypoint is not a regular file");
  const constants = readBoundedBytes(join(runtimeRoot, "src/config/constants.ts"), 128 * 1024);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(constants);
  const version = VERSION_PATTERN.exec(source)?.[1];
  if (version === undefined || !version.trim())
    throw new Error("pinned runtime source version is missing");
  return version;
}
