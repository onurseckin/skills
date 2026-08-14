import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import type { Manifest } from "../contracts/capsule.ts";
import { atomicWriteBytes, atomicWriteJson, fsyncDirectory } from "../core/durable-write.ts";
import { safeRepoPath } from "../core/paths.ts";
import { pinnedRuntimeVersion } from "../core/runtime-identity.ts";
import { copyPinnedRuntime } from "../core/runtime-tree.ts";
import { sha256Bytes } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { captureAssurance, isCaptureMode } from "./assurance.ts";
import {
  FORMAT_VERSION,
  MANIFEST_SCHEMA,
  RUN_ID_PATTERN,
  RUNTIME_ENTRYPOINT,
  RUNTIME_VERSION,
} from "./constants.ts";
import { initialState } from "./state.ts";

export interface InitRunOptions {
  runtimeSource?: string;
  beforeRuntimeSourceRecheck?: () => void;
}

function runtimeSource(repo: string, value: string): string {
  const raw = value.startsWith("/") ? value : safeRepoPath(repo, value);
  if (!existsSync(raw))
    throw new HarnessError("INVALID_ARGUMENT", `runtime_source does not exist: ${value}`);
  const metadata = lstatSync(raw);
  if (metadata.isSymbolicLink() || !metadata.isDirectory())
    throw new HarnessError("INVALID_ARGUMENT", `runtime_source must be a real directory: ${value}`);
  const source = realpathSync(raw);
  const harness = join(repo, ".harness");
  const fromHarness = relative(harness, source);
  if (source === repo || fromHarness === "" || !fromHarness.startsWith("..")) {
    throw new HarnessError(
      "PATH_SAFETY",
      "runtime_source cannot be the repository root or .harness",
    );
  }
  return source;
}

export function initRun(
  repoRoot: string,
  runId: string,
  prompt: Uint8Array,
  captureMode: string,
  sourceVerified: boolean,
  options: InitRunOptions = {},
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
  const source =
    options.runtimeSource === undefined ? undefined : runtimeSource(repo, options.runtimeSource);
  const harnessRoot = safeRepoPath(repo, ".harness");
  mkdirSync(harnessRoot, { recursive: true, mode: 0o755 });
  fsyncDirectory(repo);
  const runRoot = safeRepoPath(repo, join(".harness", runId));
  mkdirSync(runRoot, { mode: 0o755 });
  fsyncDirectory(harnessRoot);
  try {
    for (const directory of ["packets", "evidence", "findings", "commands"])
      mkdirSync(join(runRoot, directory), { mode: 0o755 });
    fsyncDirectory(runRoot);
    let runtimeSha: string | undefined;
    let runtimeFiles = 0;
    let runtimeVersion: string = RUNTIME_VERSION;
    if (source !== undefined) {
      const copyOptions =
        options.beforeRuntimeSourceRecheck === undefined
          ? {}
          : { beforeSourceRecheck: options.beforeRuntimeSourceRecheck };
      const pinned = copyPinnedRuntime(source, join(runRoot, "runtime"), copyOptions);
      runtimeSha = pinned.digest;
      runtimeFiles = pinned.fileCount;
      const entrypoint = join(runRoot, RUNTIME_ENTRYPOINT);
      if (!existsSync(entrypoint) || !lstatSync(entrypoint).isFile())
        throw new HarnessError("INTEGRITY", "runtime source is missing harness.ts entrypoint");
      runtimeVersion = pinnedRuntimeVersion(join(runRoot, "runtime"));
    }
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
      runtime_files: runtimeFiles,
      runtime_entrypoint: RUNTIME_ENTRYPOINT,
      bun_version: Bun.version,
      bun_compatibility: "same-major-not-older",
      runtime_version: runtimeVersion,
      ...(runtimeSha === undefined ? {} : { runtime_sha256: runtimeSha }),
    };
    atomicWriteJson(join(runRoot, "manifest.json"), manifest);
    atomicWriteBytes(join(runRoot, "events.jsonl"), new Uint8Array());
    atomicWriteJson(join(runRoot, "state.json"), initialState());
    return runRoot;
  } catch (error) {
    rmSync(runRoot, { recursive: true, force: true });
    fsyncDirectory(harnessRoot);
    throw error;
  }
}
