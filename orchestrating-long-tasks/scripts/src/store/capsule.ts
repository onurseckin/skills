import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Manifest } from "../contracts/capsule.ts";
import { atomicWriteBytes, atomicWriteJson, fsyncDirectory } from "../core/durable-write.ts";
import { safeRepoPath } from "../core/paths.ts";
import { sha256Bytes } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { captureAssurance, isCaptureMode } from "./assurance.ts";
import { FORMAT_VERSION, MANIFEST_SCHEMA, RUN_ID_PATTERN, RUNTIME_VERSION } from "./constants.ts";
import { initialCapsuleDirectories, renderLayoutReadme } from "./layout.ts";
import { initialState } from "./state.ts";
import { writeIndex } from "./capsule-index.ts";
import { writeTrace } from "./trace.ts";

export interface InitRunOptions {
  runtimeSource?: string;
  beforeRuntimeSourceRecheck?: () => void;
}

export function initRun(
  repoRoot: string,
  runId: string,
  prompt: Uint8Array,
  captureMode: string,
  sourceVerified: boolean,
  _options: InitRunOptions = {},
): string {
  if (!RUN_ID_PATTERN.test(runId))
    throw new HarnessError("INVALID_ARGUMENT", "run_id must be a 1-128 character slug");
  if (!isCaptureMode(captureMode))
    throw new HarnessError("INVALID_ARGUMENT", `unsupported capture_mode: ${captureMode}`);
  if (!(prompt instanceof Uint8Array))
    throw new HarnessError("INVALID_ARGUMENT", "prompt must be bytes");
  if (typeof sourceVerified !== "boolean")
    throw new HarnessError("INVALID_ARGUMENT", "source_verified must be a bool");
  const assurance = captureAssurance(captureMode, sourceVerified);
  if (!existsSync(repoRoot) || !lstatSync(repoRoot).isDirectory())
    throw new HarnessError("INVALID_ARGUMENT", `repo_root must be a directory: ${repoRoot}`);
  const repo = realpathSync(repoRoot);
  const capsulesRoot = safeRepoPath(repo, ".capsules");
  mkdirSync(capsulesRoot, { recursive: true, mode: 0o755 });
  fsyncDirectory(repo);
  const runRoot = safeRepoPath(repo, join(".capsules", runId));
  mkdirSync(runRoot, { mode: 0o755 });
  fsyncDirectory(capsulesRoot);
  try {
    for (const directory of initialCapsuleDirectories())
      mkdirSync(join(runRoot, directory), { mode: 0o755 });
    fsyncDirectory(runRoot);
    atomicWriteBytes(join(runRoot, "prompt.md"), prompt, { mode: 0o444 });
    const manifest: Manifest = {
      schema: MANIFEST_SCHEMA,
      version: FORMAT_VERSION,
      run_id: runId,
      capsule_id: randomUUID().replaceAll("-", ""),
      prompt_sha256: sha256Bytes(prompt),
      prompt_bytes: prompt.byteLength,
      capture_mode: captureMode,
      source_verified: sourceVerified,
      assurance,
      created_at: new Date().toISOString(),
      bun_version: Bun.version,
      runtime_version: RUNTIME_VERSION,
    };
    atomicWriteJson(join(runRoot, "manifest.json"), manifest);
    atomicWriteBytes(join(runRoot, "events.jsonl"), new Uint8Array());
    const state = initialState();
    atomicWriteJson(join(runRoot, "state.json"), state);
    // The layout note, the catalogue and the step trace exist from the first moment, so a capsule
    // is never a directory a reader has to guess the shape of.
    atomicWriteBytes(
      join(runRoot, "README.md"),
      new TextEncoder().encode(renderLayoutReadme(runId)),
    );
    writeIndex(runRoot, state);
    writeTrace(runRoot, []);
    return runRoot;
  } catch (error) {
    rmSync(runRoot, { recursive: true, force: true });
    fsyncDirectory(capsulesRoot);
    throw error;
  }
}
