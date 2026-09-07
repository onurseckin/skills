import { randomUUID } from "node:crypto";
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

export function initVirtualCapsule(
  vfs: VirtualMemoryFS,
  repoRoot: string,
  runId = "mind-run-01",
  options: VirtualCapsuleInitOptions = {},
): string {
  const capsulesRoot = `${repoRoot}/.olt/capsules`;
  const runRoot = `${capsulesRoot}/${runId}`;
  const promptText = options.promptText ?? "system prompt";

  vfs.mkdirSync(`${repoRoot}/.git`, { recursive: true });
  vfs.mkdirSync(`${repoRoot}/olt/scripts`, { recursive: true });
  vfs.writeFileSync(`${repoRoot}/olt/scripts/harness.ts`, "");
  vfs.mkdirSync(`${repoRoot}/olt/agents`, { recursive: true });

  vfs.mkdirSync(`${runRoot}/blobs`, { recursive: true });
  vfs.mkdirSync(`${runRoot}/commands`, { recursive: true });
  vfs.mkdirSync(`${runRoot}/packets`, { recursive: true });
  vfs.mkdirSync(`${runRoot}/reports`, { recursive: true });

  const promptBytes = new TextEncoder().encode(promptText);
  vfs.writeFileSync(`${runRoot}/prompt.md`, promptBytes, { mode: 0o444 });

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

  const state = {
    ...initialState(),
  };
  vfs.writeFileSync(`${runRoot}/state.json`, canonicalJsonBytes(state));

  vfs.writeFileSync(`${runRoot}/events.jsonl`, "");

  return runRoot;
}
