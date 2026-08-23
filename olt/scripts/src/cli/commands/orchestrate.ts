import { existsSync } from "node:fs";
import { join } from "node:path";
import { capturePromptWithTimeout } from "../prompt-capture.ts";
import { readBoundedBytes } from "../../core/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun } from "../../store/index.ts";
import { formatOrchestrateBrief } from "../formatters/index.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";
import { firstAvailableRunId, deriveRunId } from "./orchestrate-slug.ts";
import { planInitCommand } from "./plan.ts";
import { resolveCapsulesDir } from "../../shared/paths.ts";

function promptText(prompt: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(prompt);
}

export async function orchestrateCommand(
  flags: Flags,
  context: CommandContext = {},
): Promise<Record<string, unknown>> {
  const inlinePrompt = context.inlinePrompt;
  const fromFile = textFlag(flags, "prompt-file", false);
  const promptStdin = textFlag(flags, "prompt-stdin", false) !== undefined;

  const capturedText = await capturePromptWithTimeout(inlinePrompt, {
    ...(fromFile !== undefined ? { promptFile: fromFile } : {}),
    promptStdin: promptStdin || context.stdin !== undefined,
  });

  const prompt = new TextEncoder().encode(capturedText);

  const sourceCaptureMode: "argv" | "file" | "stdin" =
    inlinePrompt !== undefined ? "argv" : fromFile !== undefined ? "file" : "stdin";

  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const explicitRunId = textFlag(flags, "run", false) ?? textFlag(flags, "run-id", false);
  const runIdWasDerived = explicitRunId === undefined;
  const runId = runIdWasDerived
    ? firstAvailableRunId(deriveRunId(promptText(prompt)), (candidate) =>
        existsSync(join(resolveCapsulesDir(repo), candidate)),
      )
    : explicitRunId;

  const {
    "prompt-file": _promptFile,
    "prompt-stdin": _promptStdin,
    run: _run,
    "run-id": _runId,
    ...passthrough
  } = flags;
  const captureModeOverride = Object.hasOwn(passthrough, "capture-mode")
    ? {}
    : { "capture-mode": sourceCaptureMode };
  const initResult = await planInitCommand(
    { ...passthrough, ...captureModeOverride, run: runId },
    { ...context, stdin: prompt },
  );
  const runRoot = String(initResult.run_root);
  const manifest = loadRun(runRoot).manifest;

  const markdown = formatOrchestrateBrief({
    runId,
    runRoot,
    promptSha256: manifest.prompt_sha256,
    promptBytes: manifest.prompt_bytes,
    runIdWasDerived,
  });

  return {
    markdown,
    run_root: runRoot,
    run_id: runId,
    run_id_derived: runIdWasDerived,
    manifest,
  };
}
