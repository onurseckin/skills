import { existsSync } from "node:fs";
import { readBoundedBytes } from "../../core/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { AutonomousLoopRunner } from "../../orchestrator/loop-runner.ts";
import type { RoundExecutor } from "../../orchestrator/types.ts";
import {
  assertFlags,
  boolFlag,
  integerFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../options.ts";

export interface OrchestratorCommandContext extends CommandContext {
  executor?: RoundExecutor | undefined;
}

export async function orchestratorRunCommand(
  flags: Flags,
  context: OrchestratorCommandContext = {},
): Promise<Record<string, unknown>> {
  assertFlags(flags, [
    "repo",
    "prompt",
    "prompt-file",
    "prompt-stdin",
    "max-rounds",
    "capsules-dir",
    "actor",
    "run-id",
    "run",
  ]);

  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  if (!existsSync(repo)) {
    throw new HarnessError("INVALID_ARGUMENT", `repository path does not exist: ${repo}`);
  }

  const actor = textFlag(flags, "actor", false) ?? "orchestrator";
  const runId =
    textFlag(flags, "run-id", false) ??
    textFlag(flags, "run", false) ??
    `orchestrator-${Date.now()}`;
  const capsulesDir = textFlag(flags, "capsules-dir", false);

  const rawMaxRounds = integerFlag(flags, "max-rounds");
  const maxRounds = rawMaxRounds !== undefined ? Math.min(10, Math.max(1, rawMaxRounds)) : 10;

  const inlinePrompt = textFlag(flags, "prompt", false);
  const promptFile = textFlag(flags, "prompt-file", false);
  const _fromStdinFlag = boolFlag(flags, "prompt-stdin");

  let prompt: string | undefined;
  if (inlinePrompt !== undefined) {
    prompt = inlinePrompt;
  } else if (promptFile !== undefined) {
    try {
      const bytes = readBoundedBytes(promptFile, 64 * 1024 * 1024);
      prompt = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `failed to read prompt file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (context.stdin !== undefined) {
    try {
      prompt = new TextDecoder("utf-8", { fatal: true }).decode(context.stdin);
    } catch (error) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `failed to decode stdin prompt: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!prompt || prompt.trim().length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "must provide prompt via --prompt, --prompt-file, or stdin",
    );
  }

  const loopRunner = new AutonomousLoopRunner({
    baseRunId: runId,
    repoPath: repo,
    initialPrompt: prompt,
    maxRounds,
    ...(capsulesDir !== undefined ? { capsulesDir } : {}),
    actor,
    ...(context.executor !== undefined ? { executor: context.executor } : {}),
  });

  const summary = await loopRunner.run();

  return {
    markdown: summary.finalMarkdownSummary,
    loop_id: summary.loopId,
    base_run_id: summary.baseRunId,
    finalStatus: summary.finalStatus,
    final_status: summary.finalStatus,
    rounds_executed: summary.totalRoundsExecuted,
    total_rounds_executed: summary.totalRoundsExecuted,
    max_rounds_configured: summary.maxRoundsConfigured,
    overall_duration_ms: summary.overallDurationMs,
    all_gates_passed: summary.allGatesPassed,
    final_critic_decision: summary.finalCriticDecision,
    total_findings_synthesized: summary.totalFindingsSynthesized,
    telemetry: summary.rounds,
    rounds: summary.rounds,
    summary,
    run_root: loopRunner.getCapsulePath(summary.baseRunId),
    capsules_dir: loopRunner.capsulesDir,
  };
}
