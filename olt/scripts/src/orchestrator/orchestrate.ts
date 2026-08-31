import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { capturePromptWithTimeout } from "../cli/prompt-capture.ts";
import { HarnessError } from "../core/errors/index.ts";
import { loadRun } from "../engine/store/index.ts";
import { formatOrchestrateBrief } from "../cli/formatters/index.ts";
import { textFlag, boolFlag, type CommandContext, type Flags } from "../cli/options.ts";
import { firstAvailableRunId, deriveRunId } from "../cli/commands/orchestrate-slug.ts";
import { planInitCommand } from "../cli/commands/plan.ts";
import { findRepoRoot, resolveCapsulesDir } from "../core/shared/paths.ts";
import { PolicyDiscoveryEngine } from "../engine/policy-discovery.ts";
import type { RepoPolicy } from "../policy/types/index.ts";

function promptText(prompt: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(prompt);
}

export interface OrchestrateOptions {
  readonly repoRoot?: string | undefined;
  readonly prompt?: string | Uint8Array | undefined;
  readonly runId?: string | undefined;
}

export interface OrchestrateResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly run_id: string;
  readonly run_id_derived: boolean;
  readonly manifest: unknown;
  readonly policy?: RepoPolicy | undefined;
}

export function ensureOrchestrationGovernance(repoRoot: string): RepoPolicy {
  return PolicyDiscoveryEngine.ensurePolicyCalibrated(repoRoot);
}

export async function orchestrateCommand(
  flags: Flags,
  context: CommandContext = {},
): Promise<Record<string, unknown>> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  let repoRoot: string;
  try {
    repoRoot = findRepoRoot(repo);
  } catch {
    repoRoot = resolve(repo);
  }

  // Inspect if .olt/policy.json exists; if missing or uncalibrated, trigger discovery/calibration
  const calibratedPolicy = PolicyDiscoveryEngine.ensurePolicyCalibrated(repoRoot);

  const inlinePrompt = context.inlinePrompt;
  const fromFile = textFlag(flags, "prompt-file", false);
  const promptStdin = boolFlag(flags, "prompt-stdin");

  let capturedText: string;
  if (inlinePrompt) {
    capturedText = inlinePrompt;
  } else if (context.stdin) {
    capturedText = new TextDecoder("utf-8").decode(context.stdin);
  } else if (!promptStdin && fromFile === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "the prompt is unavailable");
  } else {
    capturedText = await capturePromptWithTimeout(inlinePrompt, {
      ...(fromFile !== undefined ? { promptFile: fromFile } : {}),
      promptStdin,
    });
  }

  const prompt = new TextEncoder().encode(capturedText);

  const sourceCaptureMode: "argv" | "file" | "stdin" =
    inlinePrompt !== undefined ? "argv" : fromFile !== undefined ? "file" : "stdin";

  const explicitRunId = textFlag(flags, "run", false) ?? textFlag(flags, "run-id", false);
  const runIdWasDerived = explicitRunId === undefined;
  const runId = runIdWasDerived
    ? firstAvailableRunId(deriveRunId(promptText(prompt)), (candidate) =>
        existsSync(join(resolveCapsulesDir(repoRoot), candidate)),
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
    { ...passthrough, ...captureModeOverride, run: runId, repo: repoRoot },
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
    policy: calibratedPolicy,
  };
}
