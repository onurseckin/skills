/**
 * @file proposals-fixture.ts
 * In-memory test sandbox fixture and pure RAM capsule scaffolding harness for tests/mind/proposals domain.
 * Backed by VirtualMemoryFS and createVirtualFSSession with zero physical disk writes.
 */

import { randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { canonicalJsonBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import {
  FORMAT_VERSION,
  MANIFEST_SCHEMA,
  RUNTIME_VERSION,
} from "../../../olt/scripts/src/engine/store/layout/constants.ts";
import { BUN_COMPATIBILITY } from "../../../olt/scripts/src/engine/store/recovery/bun-compatibility.ts";
import { initialState } from "../../../olt/scripts/src/engine/store/capsule/state.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export interface VirtualCapsuleInitOptions {
  promptText?: string;
  runId?: string;
}

/**
 * Initializes a fully compliant, zero-disk in-memory capsule layout within VirtualMemoryFS.
 * Satisfies loadRun(), findRepoRoot(), checkManifest(), verifyCapsuleLayout(), and verifyIntegrity()
 * in microsecond time without copying pinned runtimes or invoking OS fsync.
 */
export function initVirtualCapsule(
  vfs: VirtualMemoryFS,
  repoRoot: string,
  runId = "mind-run-01",
  options: VirtualCapsuleInitOptions = {},
): string {
  const capsulesRoot = `${repoRoot}/.olt/capsules`;
  const runRoot = `${capsulesRoot}/${runId}`;
  const promptText = options.promptText ?? "system prompt";

  // 1. Repo root anchor & charter directory for findRepoRoot and resolveCharterPath
  vfs.mkdirSync(`${repoRoot}/.git`, { recursive: true });
  vfs.mkdirSync(`${repoRoot}/olt/agents`, { recursive: true });

  // 2. Initial capsule subdirectories verified by verifyCapsuleLayout
  vfs.mkdirSync(`${runRoot}/blobs`, { recursive: true });
  vfs.mkdirSync(`${runRoot}/commands`, { recursive: true });
  vfs.mkdirSync(`${runRoot}/packets`, { recursive: true });
  vfs.mkdirSync(`${runRoot}/reports`, { recursive: true });

  // 3. Prompt file: must be mode 0o444 (read-only) for checkManifest()
  const promptBytes = new TextEncoder().encode(promptText);
  vfs.writeFileSync(`${runRoot}/prompt.md`, promptBytes);
  try {
    chmodSync(`${runRoot}/prompt.md`, 0o444);
  } catch {
    // Session spy will record custom mode if active
  }

  // 4. Manifest: schema version 1, exact prompt_sha256 and byte length
  const manifest = {
    schema: MANIFEST_SCHEMA,
    version: FORMAT_VERSION,
    run_id: runId,
    capsule_id: randomUUID().replaceAll("-", ""),
    prompt_sha256: sha256Bytes(promptBytes),
    prompt_bytes: promptBytes.byteLength,
    capture_mode: "file",
    source_verified: true,
    assurance: "source-verified",
    mode: "feature",
    created_at: new Date().toISOString(),
    bun_version: Bun.version,
    bun_compatibility: BUN_COMPATIBILITY,
    runtime_version: RUNTIME_VERSION,
  };
  vfs.writeFileSync(`${runRoot}/manifest.json`, canonicalJsonBytes(manifest));

  // 5. Initial state.json (schema harness.state, revision 0, event_sequence 0)
  const state = {
    ...initialState(),
  };
  vfs.writeFileSync(`${runRoot}/state.json`, canonicalJsonBytes(state));

  // 6. Empty events.jsonl: zero events means final state matches initialState()
  vfs.writeFileSync(`${runRoot}/events.jsonl`, "");

  return runRoot;
}
