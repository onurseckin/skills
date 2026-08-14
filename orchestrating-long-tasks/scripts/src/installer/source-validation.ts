import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { parseJsonBytes } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { treeDigest } from "./tree-digest.ts";
import { RUNTIME_PACKAGE_NAME, SKILL_NAME } from "./constants.ts";
import { readStableBytes, readStableText } from "./stable-file.ts";

export interface ValidatedSkillSource {
  root: string;
  digest: string;
  runtimeVersion: string;
}

export interface SourceValidationOptions {
  beforeSnapshotRecheck?(): Promise<void> | void;
}

export async function validateSkillSource(
  source: string,
  options: SourceValidationOptions = {},
): Promise<ValidatedSkillSource> {
  const requested = resolve(source);
  const stat = await lstat(requested).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new HarnessError("INVALID_ARGUMENT", "skill source must be a real directory");
  }
  const root = await realpath(requested);
  const before = await treeDigest(root, new Set(["installation.json"]));
  const skill = readStableText(resolve(root, "SKILL.md"));
  if (!new RegExp(`^---\\r?\\n(?:.|\\r?\\n)*?name:\\s*${SKILL_NAME}\\s*$`, "mu").test(skill)) {
    throw new HarnessError("INTEGRITY", `skill source identity is not ${SKILL_NAME}`);
  }
  let packageValue: unknown;
  try {
    packageValue = parseJsonBytes(
      readStableBytes(resolve(root, "scripts/package.json")),
      "skill runtime package",
      { maxBytes: 1024 * 1024, maxDepth: 16 },
    );
  } catch {
    throw new HarnessError("INTEGRITY", "skill runtime package is invalid");
  }
  if (
    typeof packageValue !== "object" ||
    packageValue === null ||
    Array.isArray(packageValue) ||
    (packageValue as Record<string, unknown>).name !== RUNTIME_PACKAGE_NAME
  ) {
    throw new HarnessError("INTEGRITY", "skill runtime package identity is invalid");
  }
  const runtimeConstants = readStableText(resolve(root, "scripts/src/config/constants.ts"));
  const runtimeVersion = /RUNTIME_VERSION\s*=\s*["']([^"']+)["']/u.exec(runtimeConstants)?.[1];
  if (!runtimeVersion)
    throw new HarnessError("INTEGRITY", "skill source runtime version is missing");
  await options.beforeSnapshotRecheck?.();
  const digest = await treeDigest(root, new Set(["installation.json"]));
  if (digest !== before)
    throw new HarnessError("INTEGRITY", "skill source changed during identity validation");
  return { root, runtimeVersion, digest };
}
