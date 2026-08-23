import { join } from "node:path";
import { readCanonicalObject } from "../core/json.ts";
import { validateSkillSource } from "./source-validation.ts";
import { INSTALL_SCHEMA, INSTALL_VERSION, SKILL_NAME } from "./constants.ts";
import { verifiedManifestPayload } from "./manifest-integrity.ts";
import { treeDigest } from "./tree-digest.ts";

export { INSTALL_SCHEMA, INSTALL_VERSION, SKILL_NAME } from "./constants.ts";

export interface InstallationManifest {
  schema: typeof INSTALL_SCHEMA;
  version: typeof INSTALL_VERSION;
  skill_name: typeof SKILL_NAME;
  runtime_version: string;
  source_sha256: string;
  installed_at: string;
  clients: string[];
  metadata_sha256: string;
}

export function installationManifest(value: unknown): InstallationManifest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const payload = verifiedManifestPayload(item);
  return payload ? (item as unknown as InstallationManifest) : null;
}

export async function readInstallationManifest(root: string): Promise<InstallationManifest | null> {
  try {
    return installationManifest(
      readCanonicalObject(join(root, "installation.json"), "installation manifest", {
        maxBytes: 16 * 1024,
        maxDepth: 4,
      }),
    );
  } catch {
    return null;
  }
}

export async function identifiedInstallation(root: string): Promise<boolean> {
  const manifest = await readInstallationManifest(root);
  if (!manifest) return false;
  try {
    const source = await validateSkillSource(root);
    const contentDigest = await treeDigest(root, new Set(["installation.json"]));
    return (
      source.runtimeVersion === manifest.runtime_version && contentDigest === manifest.source_sha256
    );
  } catch {
    return false;
  }
}
