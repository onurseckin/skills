import type { CapsuleMode } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { readBoundedBytes } from "../../core/json.ts";
import { assertInstalledRuntimeFresh } from "../../installer/runtime-freshness.ts";
import { initCapsuleRun, loadRun } from "../../engine/store/index.ts";
import { formatCapsuleInitBrief } from "../formatters/index.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export async function runInitCommand(
  flags: Flags,
  context: CommandContext = {},
): Promise<Record<string, unknown>> {
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const runId = runFlag !== undefined ? runFlag : runIdFlag;
  if (!runId) {
    throw new HarnessError("INVALID_ARGUMENT", "must provide --run or --run-id");
  }

  const fromFile = textFlag(flags, "prompt-file", false);
  let prompt: string | Uint8Array | undefined = textFlag(flags, "prompt", false);
  if (prompt === undefined && fromFile !== undefined) {
    prompt = readBoundedBytes(fromFile, 64 * 1024 * 1024);
  } else if (prompt === undefined) {
    if (boolFlag(flags, "prompt-stdin")) {
      prompt = context.stdin;
    } else if (context.stdin !== undefined) {
      prompt = context.stdin;
    }
  }

  const repoFlag = textFlag(flags, "repo", false);
  const repo = repoFlag !== undefined ? repoFlag : process.cwd();

  const mode = textFlag(flags, "mode", false) as CapsuleMode | undefined;

  const captureModeFlag = textFlag(flags, "capture-mode", false);
  const captureMode =
    captureModeFlag !== undefined
      ? captureModeFlag
      : fromFile !== undefined
        ? "file"
        : prompt !== undefined
          ? "argv"
          : context.stdin !== undefined
            ? "stdin"
            : "file";

  const sourceVerified =
    flags["source-verified"] === undefined ? undefined : boolFlag(flags, "source-verified");

  const runtimeSourceFlag = textFlag(flags, "runtime-source", false);
  const runtimeSource =
    runtimeSourceFlag !== undefined
      ? runtimeSourceFlag
      : boolFlag(flags, "no-runtime-pin")
        ? undefined
        : context.executingRuntime;

  if (runtimeSource !== undefined && runtimeSource === context.executingRuntime) {
    await assertInstalledRuntimeFresh(runtimeSource);
  }

  const allowExisting =
    flags["allow-existing"] === undefined ? true : boolFlag(flags, "allow-existing");

  const result = initCapsuleRun(runId, {
    ...(repo !== undefined ? { repo } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(captureMode !== undefined ? { captureMode } : {}),
    ...(sourceVerified !== undefined ? { sourceVerified } : {}),
    ...(runtimeSource !== undefined ? { runtimeSource } : {}),
    allowExisting,
  });

  const loaded = loadRun(result.runRoot);
  const manifest = loaded.manifest;

  const markdown = formatCapsuleInitBrief({
    runId: manifest.run_id,
    runRoot: result.runRoot,
    promptSha256: manifest.prompt_sha256,
    ...(manifest.prompt_bytes !== undefined ? { promptBytes: manifest.prompt_bytes } : {}),
    assurance: manifest.assurance,
    ...(manifest.bun_version !== undefined ? { bunVersion: manifest.bun_version } : {}),
    ...(manifest.runtime_sha256 !== undefined && manifest.runtime_files !== undefined
      ? { runtimePin: { sha256: manifest.runtime_sha256, files: manifest.runtime_files } }
      : {}),
  });

  return {
    markdown,
    run_root: result.runRoot,
    run_id: runId,
    manifest,
    existed: result.existed,
  };
}
