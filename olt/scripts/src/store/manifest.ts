import { lstatSync } from "node:fs";
import { basename } from "node:path";
import type { Manifest, IntegrityIssue } from "../contracts/capsule.ts";
import { readCanonicalObject, sha256Bytes } from "../core/json.ts";
import { readRegularFileNoFollow } from "../core/no-follow.ts";
import { captureAssurance, isCaptureMode } from "./assurance.ts";
import { compatibleBunVersion } from "./bun-compatibility.ts";
import {
  FORMAT_VERSION,
  CAPSULE_ID_PATTERN,
  MANIFEST_SCHEMA,
  RUN_ID_PATTERN,
  SHA256_PATTERN,
  type StoreLimits,
  limits,
} from "./constants.ts";
import { issue } from "./issues.ts";
import { runFilePath } from "./paths.ts";

export interface ManifestCheck {
  issues: readonly IntegrityIssue[];
  manifest?: Manifest;
  prompt?: Uint8Array;
}

export function checkManifest(runRoot: string, options: StoreLimits = {}): ManifestCheck {
  const found: IntegrityIssue[] = [];
  const configured = limits(options);
  let manifest: Manifest | undefined;
  let prompt: Uint8Array | undefined;
  try {
    manifest = readCanonicalObject(runFilePath(runRoot, "manifest.json"), "manifest.json", {
      maxBytes: configured.maxJsonBytes,
      maxDepth: configured.maxDepth,
    }) as unknown as Manifest;
  } catch (error) {
    found.push(
      issue("MANIFEST_JSON", `manifest.json is not readable canonical JSON: ${String(error)}`),
    );
  }
  try {
    const path = runFilePath(runRoot, "prompt.md");
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("not a regular file");
    prompt = readRegularFileNoFollow(path);
    if ((metadata.mode & 0o222) !== 0)
      found.push(
        issue(
          "PROMPT_MODE",
          `prompt.md is writable (write mode bits ${(metadata.mode & 0o222).toString(8)})`,
          path,
        ),
      );
  } catch (error) {
    found.push(issue("PROMPT_READ", `prompt.md is unreadable or unsafe: ${String(error)}`));
  }
  if (manifest === undefined) return { issues: found, ...(prompt === undefined ? {} : { prompt }) };
  if (
    manifest.schema !== MANIFEST_SCHEMA ||
    manifest.version !== FORMAT_VERSION ||
    typeof manifest.version !== "number"
  )
    found.push(issue("MANIFEST_SCHEMA", "manifest.json has an invalid schema or version"));
  if (!RUN_ID_PATTERN.test(manifest.run_id))
    found.push(issue("MANIFEST_RUN_ID", "manifest.json run_id is not a valid slug"));
  else if (manifest.run_id !== basename(runRoot))
    found.push(
      issue("MANIFEST_RUN_ID", "manifest.json run_id does not match the run directory name"),
    );
  if (!isCaptureMode(manifest.capture_mode))
    found.push(issue("MANIFEST_CAPTURE", "manifest.json capture_mode is not supported"));
  if (typeof manifest.capsule_id !== "string" || !CAPSULE_ID_PATTERN.test(manifest.capsule_id))
    found.push(issue("MANIFEST_CAPSULE_ID", "manifest.json capsule_id is invalid"));
  if (typeof manifest.source_verified !== "boolean")
    found.push(issue("MANIFEST_ASSURANCE", "manifest.json source_verified must be a bool"));
  else if (isCaptureMode(manifest.capture_mode)) {
    try {
      const expected = captureAssurance(manifest.capture_mode, manifest.source_verified);
      if (manifest.assurance !== expected)
        found.push(issue("MANIFEST_ASSURANCE", "manifest.json assurance contradicts capture mode"));
    } catch (error) {
      found.push(
        issue("MANIFEST_ASSURANCE", `manifest.json assurance is invalid: ${String(error)}`),
      );
    }
  }
  if (typeof manifest.prompt_sha256 !== "string" || !SHA256_PATTERN.test(manifest.prompt_sha256))
    found.push(issue("PROMPT_DIGEST", "manifest.json prompt digest is not a lowercase SHA-256"));
  if (prompt !== undefined) {
    if (
      typeof manifest.prompt_bytes !== "number" ||
      !Number.isSafeInteger(manifest.prompt_bytes) ||
      manifest.prompt_bytes !== prompt.byteLength
    )
      found.push(issue("PROMPT_SIZE", "prompt.md byte length does not match manifest.json"));
    if (manifest.prompt_sha256 !== sha256Bytes(prompt))
      found.push(issue("PROMPT_DIGEST", "prompt.md SHA-256 does not match manifest.json"));
  }
  if (typeof manifest.runtime_version === "string" && !manifest.runtime_version.trim()) {
    found.push(issue("RUNTIME_VERSION", "manifest.json runtime version must be non-blank"));
  }
  if (manifest.bun_compatibility !== undefined) {
    if (typeof manifest.bun_version !== "string" || !manifest.bun_version.trim()) {
      found.push(
        issue(
          "BUN_COMPATIBILITY",
          "manifest.json bun_version must be non-blank when a compatibility policy is recorded",
        ),
      );
    } else if (
      !compatibleBunVersion(manifest.bun_version, Bun.version, manifest.bun_compatibility)
    ) {
      found.push(
        issue(
          "BUN_COMPATIBILITY",
          `capsule was created by bun ${manifest.bun_version} under policy ${String(manifest.bun_compatibility)}; the running bun ${Bun.version} does not satisfy it`,
        ),
      );
    }
  }
  return { issues: found, manifest, ...(prompt === undefined ? {} : { prompt }) };
}
