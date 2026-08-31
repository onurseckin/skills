import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CapsuleMode } from "../../../core/contracts/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { resolveCapsulesDir } from "./paths.ts";
import { normalizeRunId } from "./run-id.ts";
import { initRun, type RuntimeLinkMode } from "./capsule.ts";

export interface InitCapsuleRunOptions {
  readonly repo?: string;
  readonly mode?: CapsuleMode;
  readonly prompt?: string | Uint8Array;
  readonly captureMode?: string;
  readonly sourceVerified?: boolean;
  readonly runtimeSource?: string;
  readonly runtimeLinkMode?: RuntimeLinkMode;
  readonly beforeRuntimeSourceRecheck?: () => void;
  readonly allowExisting?: boolean;
}

export function initCapsuleRun(
  runId: string,
  options: InitCapsuleRunOptions = {},
): { readonly runRoot: string; readonly existed: boolean } {
  const repo = options.repo !== undefined ? options.repo : process.cwd();
  runId = normalizeRunId(runId);
  const capsulesRoot = resolveCapsulesDir(repo);
  const runRoot = join(capsulesRoot, runId);

  if (existsSync(runRoot) && existsSync(join(runRoot, "state.json"))) {
    if (options.allowExisting === true) {
      return { runRoot, existed: true };
    }
    throw new HarnessError("INVALID_STATE", `capsule run already exists: ${runId}`);
  }

  let promptBytes: Uint8Array;
  if (options.prompt instanceof Uint8Array) {
    promptBytes = options.prompt;
  } else if (typeof options.prompt === "string") {
    promptBytes = new TextEncoder().encode(options.prompt);
  } else {
    promptBytes = new TextEncoder().encode(`Run ${runId}`);
  }

  const captureMode = options.captureMode !== undefined ? options.captureMode : "file";
  const sourceVerified = options.sourceVerified !== undefined ? options.sourceVerified : true;

  initRun(repo, runId, promptBytes, captureMode, sourceVerified, {
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    ...(options.runtimeSource !== undefined ? { runtimeSource: options.runtimeSource } : {}),
    ...(options.runtimeLinkMode !== undefined ? { runtimeLinkMode: options.runtimeLinkMode } : {}),
    ...(options.beforeRuntimeSourceRecheck !== undefined
      ? { beforeRuntimeSourceRecheck: options.beforeRuntimeSourceRecheck }
      : {}),
  });

  mkdirSync(join(runRoot, "evidence"), { recursive: true, mode: 0o755 });

  return { runRoot, existed: false };
}

export function ensureCapsuleInitialized(runId: string, repo?: string): string {
  return initCapsuleRun(
    runId,
    repo !== undefined ? { repo, allowExisting: true } : { allowExisting: true },
  ).runRoot;
}
