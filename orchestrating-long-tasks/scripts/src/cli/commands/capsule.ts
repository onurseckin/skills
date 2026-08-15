import { fileURLToPath } from "node:url";
import { readBoundedBytes } from "../../core/json.ts";
import { initRun, loadRun, recoverProjection, verifyIntegrity } from "../../store/index.ts";
import { actorFlag, assertFlags, boolFlag, textFlag, type Flags } from "../options.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { readPlanObject } from "../../graph/read-plan.ts";
import { validateGraph } from "../../graph/validate-graph.ts";
import { validateRequirements } from "../../requirements/validate-requirements.ts";
import { ensureHarnessIgnored } from "../git-ignore.ts";
import { initializePlannerPacket } from "../../packets/planner-packet.ts";

const runtimeRoot = fileURLToPath(new URL("../../..", import.meta.url));

export interface CommandContext {
  stdin?: Uint8Array;
  executingRuntime?: string;
}

export async function initCommand(
  flags: Flags,
  context: CommandContext,
): Promise<Record<string, unknown>> {
  assertFlags(flags, [
    "repo",
    "run-id",
    "prompt-file",
    "prompt-stdin",
    "capture-mode",
    "source-verified",
    "runtime-source",
  ]);
  const fromFile = textFlag(flags, "prompt-file", false);
  const fromStdin = boolFlag(flags, "prompt-stdin");
  if ((fromFile === undefined) === !fromStdin) {
    throw new HarnessError("INVALID_ARGUMENT", "provide exactly one prompt source");
  }
  const prompt =
    fromFile === undefined ? context.stdin : readBoundedBytes(fromFile, 64 * 1024 * 1024);
  if (prompt === undefined)
    throw new HarnessError("INVALID_ARGUMENT", "prompt stdin is unavailable");
  const repo = textFlag(flags, "repo")!;
  const ignore_assurance = ensureHarnessIgnored(repo);
  const sourceVerified = boolFlag(flags, "source-verified");
  const runtimeSource = textFlag(flags, "runtime-source", false);
  const runRoot = initRun(
    repo,
    textFlag(flags, "run-id")!,
    prompt,
    textFlag(flags, "capture-mode")!,
    sourceVerified,
    runtimeSource === undefined ? {} : { runtimeSource },
  );
  const planner = await initializePlannerPacket(runRoot, "planner");
  return {
    run_root: runRoot,
    manifest: loadRun(runRoot).manifest,
    ignore_assurance,
    planner_packet: planner.markdownPath,
  };
}

export async function validateCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "requirements", "graph"]);
  const run = textFlag(flags, "run")!;
  const integrityIssues = verifyIntegrity(run);
  const requirementsPath = textFlag(flags, "requirements", false);
  const graphPath = textFlag(flags, "graph", false);
  if ((requirementsPath === undefined) !== (graphPath === undefined)) {
    throw new HarnessError("INVALID_ARGUMENT", "requirements and graph must be provided together");
  }
  const planIssues: string[] = [];
  if (requirementsPath !== undefined && graphPath !== undefined && integrityIssues.length === 0) {
    const loaded = loadRun(run);
    const prompt = new TextDecoder("utf-8", { fatal: true }).decode(loaded.prompt);
    const requirements = await readPlanObject(requirementsPath, "requirements plan");
    const graph = await readPlanObject(graphPath, "graph plan");
    planIssues.push(
      ...validateRequirements(prompt, requirements),
      ...validateGraph(graph, requirements),
    );
  }
  const issues = [...integrityIssues, ...planIssues];
  return {
    run_root: run,
    valid: issues.length === 0,
    integrity_issues: integrityIssues,
    plan_issues: planIssues,
  };
}

export function projectionRecoveryCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "actor"]);
  const run = textFlag(flags, "run")!;
  return { run_root: run, state: recoverProjection(run, actorFlag(flags)) };
}
