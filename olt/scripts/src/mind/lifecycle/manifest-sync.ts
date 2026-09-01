// @ts-nocheck
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { JsonValue } from "../../core/contracts/json.ts";
import { atomicWriteJson } from "../../core/durable-write.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { canonicalJsonBytes } from "../../core/json.ts";
import type { OrchestratorRegistrationRecord } from "./orchestration/index.ts";

export interface ManifestSyncOptions {
  readonly manifestPath?: string | undefined;
  readonly runRoot?: string | undefined;
}

export interface ManifestValidateOptions extends ManifestSyncOptions {
  readonly assert?: boolean | undefined;
}

export interface ManifestSyncResult {
  readonly updatedManifest: Record<string, unknown>;
  readonly pin: string;
}

export interface ManifestValidateResult {
  readonly valid: boolean;
  readonly expectedPin: string;
  readonly actualPin?: string | undefined;
  readonly error?: string | undefined;
}

export function resolveManifestPath(runId: string, options?: ManifestSyncOptions): string {
  if (options?.manifestPath) {
    return resolve(options.manifestPath);
  }
  if (options?.runRoot) {
    const root = options.runRoot;
    if (root.endsWith("manifest.json")) {
      return resolve(root);
    }
    if (root.endsWith(runId)) {
      return resolve(root, "manifest.json");
    }
    return resolve(root, ".olt", "capsules", runId, "manifest.json");
  }
  return resolve(process.cwd(), ".olt", "capsules", runId, "manifest.json");
}

export function computeManifestSha256Pin(
  manifestContent: string | Record<string, unknown> | Uint8Array,
): string {
  if (manifestContent instanceof Uint8Array) {
    return createHash("sha256").update(manifestContent).digest("hex");
  }
  if (typeof manifestContent === "string") {
    try {
      const parsed: unknown = JSON.parse(manifestContent);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const canonical = canonicalJsonBytes(parsed as JsonValue);
        return createHash("sha256").update(canonical).digest("hex");
      }
    } catch {
      // Not valid JSON object; hash raw UTF-8 string bytes
    }
    return createHash("sha256").update(manifestContent, "utf8").digest("hex");
  }
  const canonical = canonicalJsonBytes(manifestContent as JsonValue);
  return createHash("sha256").update(canonical).digest("hex");
}

export function computeMerkleGenesisBinding(
  record: OrchestratorRegistrationRecord,
  manifestBytes: Uint8Array | string,
): string {
  const manifestSha256 =
    typeof manifestBytes === "string" && /^[0-9a-f]{64}$/i.test(manifestBytes)
      ? manifestBytes.toLowerCase()
      : computeManifestSha256Pin(manifestBytes);

  const recordBytes = canonicalJsonBytes(record as unknown as JsonValue);
  const hash = createHash("sha256");
  hash.update(recordBytes);
  hash.update(":");
  hash.update(manifestSha256);
  return hash.digest("hex");
}

export function syncOrchestratorToManifest(
  record: OrchestratorRegistrationRecord,
  options?: ManifestSyncOptions,
): ManifestSyncResult {
  const targetPath = resolveManifestPath(record.run_id, options);
  const parentDir = dirname(targetPath);

  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  let baseManifest: Record<string, unknown> = {};
  if (existsSync(targetPath)) {
    try {
      const raw = readFileSync(targetPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        baseManifest = parsed as Record<string, unknown>;
      }
    } catch {
      baseManifest = {};
    }
  }

  const preBindingManifest: Record<string, unknown> = {
    ...baseManifest,
    run_id: record.run_id,
    orchestrator_id: record.orchestrator_id,
    orchestrator_pid: record.pid,
    conversation_id: record.conversation_id,
  };

  const manifestBasePin = computeManifestSha256Pin(preBindingManifest);
  const genesisBinding = computeMerkleGenesisBinding(record, manifestBasePin);

  const updatedManifest: Record<string, unknown> = {
    ...preBindingManifest,
    orchestrator_binding_sha256: genesisBinding,
  };

  const pin = computeManifestSha256Pin(updatedManifest);

  atomicWriteJson(targetPath, updatedManifest as JsonValue);

  return {
    updatedManifest,
    pin,
  };
}

export function validateCapsuleManifestBinding(
  record: OrchestratorRegistrationRecord,
  options?: ManifestValidateOptions,
): ManifestValidateResult {
  const targetPath = resolveManifestPath(record.run_id, options);

  if (!existsSync(targetPath)) {
    const errorMsg = `MANIFEST_DESYNC_ERROR: Manifest file not found at ${targetPath}`;
    if (options?.assert) {
      throw new HarnessError("INTEGRITY", errorMsg);
    }
    return {
      valid: false,
      expectedPin: record.manifest_sha256,
      error: errorMsg,
    };
  }

  let manifest: Record<string, unknown>;
  try {
    const raw = readFileSync(targetPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Manifest root is not a valid JSON object");
    }
    manifest = parsed as Record<string, unknown>;
  } catch (err) {
    const errorMsg = `MANIFEST_DESYNC_ERROR: Corrupt or unreadable manifest at ${targetPath}: ${String(err)}`;
    if (options?.assert) {
      throw new HarnessError("INTEGRITY", errorMsg);
    }
    return {
      valid: false,
      expectedPin: record.manifest_sha256,
      error: errorMsg,
    };
  }

  if (
    manifest.orchestrator_id !== undefined &&
    manifest.orchestrator_id !== record.orchestrator_id
  ) {
    const errorMsg = `MANIFEST_DESYNC_ERROR: orchestrator_id mismatch: manifest has '${String(manifest.orchestrator_id)}' but record has '${record.orchestrator_id}'`;
    if (options?.assert) {
      throw new HarnessError("INTEGRITY", errorMsg);
    }
    return {
      valid: false,
      expectedPin: record.manifest_sha256,
      actualPin: computeManifestSha256Pin(manifest),
      error: errorMsg,
    };
  }

  if (manifest.run_id !== undefined && manifest.run_id !== record.run_id) {
    const errorMsg = `MANIFEST_DESYNC_ERROR: run_id mismatch: manifest has '${String(manifest.run_id)}' but record has '${record.run_id}'`;
    if (options?.assert) {
      throw new HarnessError("INTEGRITY", errorMsg);
    }
    return {
      valid: false,
      expectedPin: record.manifest_sha256,
      actualPin: computeManifestSha256Pin(manifest),
      error: errorMsg,
    };
  }

  if (
    manifest.conversation_id !== undefined &&
    manifest.conversation_id !== record.conversation_id
  ) {
    const errorMsg = `MANIFEST_DESYNC_ERROR: conversation_id mismatch: manifest has '${String(manifest.conversation_id)}' but record has '${record.conversation_id}'`;
    if (options?.assert) {
      throw new HarnessError("INTEGRITY", errorMsg);
    }
    return {
      valid: false,
      expectedPin: record.manifest_sha256,
      actualPin: computeManifestSha256Pin(manifest),
      error: errorMsg,
    };
  }

  const actualPin = computeManifestSha256Pin(manifest);

  if (
    record.manifest_sha256 &&
    record.manifest_sha256.length > 0 &&
    record.manifest_sha256 !== actualPin
  ) {
    const errorMsg = `MANIFEST_DESYNC_ERROR: manifest pin mismatch: expected '${record.manifest_sha256}' but computed '${actualPin}'`;
    if (options?.assert) {
      throw new HarnessError("INTEGRITY", errorMsg);
    }
    return {
      valid: false,
      expectedPin: record.manifest_sha256,
      actualPin,
      error: errorMsg,
    };
  }

  return {
    valid: true,
    expectedPin: record.manifest_sha256 || actualPin,
    actualPin,
  };
}
