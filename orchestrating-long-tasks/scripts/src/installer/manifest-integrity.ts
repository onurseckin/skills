import { canonicalJsonBytes, sha256Bytes } from "../core/json.ts";
import type { JsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { CLIENT_NAMES, INSTALL_SCHEMA, INSTALL_VERSION, SKILL_NAME } from "./constants.ts";

export interface ManifestPayload extends JsonObject {
  schema: typeof INSTALL_SCHEMA;
  version: typeof INSTALL_VERSION;
  skill_name: typeof SKILL_NAME;
  runtime_version: string;
  source_sha256: string;
  installed_at: string;
  clients: string[];
}

function payload(value: Record<string, unknown>): ManifestPayload | null {
  const clients = value.clients;
  if (
    value.schema !== INSTALL_SCHEMA ||
    value.version !== INSTALL_VERSION ||
    value.skill_name !== SKILL_NAME ||
    typeof value.runtime_version !== "string" ||
    !/^[0-9a-f]{64}$/u.test(String(value.source_sha256)) ||
    typeof value.installed_at !== "string" ||
    Number.isNaN(Date.parse(value.installed_at)) ||
    !Array.isArray(clients) ||
    clients.some((client) => typeof client !== "string" || !CLIENT_NAMES.has(client)) ||
    new Set(clients).size !== clients.length ||
    clients.some((client, index) => index > 0 && String(clients[index - 1]) > String(client))
  ) {
    return null;
  }
  return {
    schema: INSTALL_SCHEMA,
    version: INSTALL_VERSION,
    skill_name: SKILL_NAME,
    runtime_version: value.runtime_version,
    source_sha256: String(value.source_sha256),
    installed_at: value.installed_at,
    clients: clients as string[],
  };
}

export function sealInstallationManifest(value: Record<string, unknown>): JsonObject {
  const manifest = payload(value);
  if (!manifest) throw new HarnessError("INTEGRITY", "installation metadata is invalid");
  return { ...manifest, metadata_sha256: sha256Bytes(canonicalJsonBytes(manifest)) };
}

export function verifiedManifestPayload(value: Record<string, unknown>): ManifestPayload | null {
  const manifest = payload(value);
  if (
    !manifest ||
    typeof value.metadata_sha256 !== "string" ||
    value.metadata_sha256 !== sha256Bytes(canonicalJsonBytes(manifest))
  ) {
    return null;
  }
  const allowed = new Set([...Object.keys(manifest), "metadata_sha256"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  return manifest;
}
