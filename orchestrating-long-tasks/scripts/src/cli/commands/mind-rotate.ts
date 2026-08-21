import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";
import { rotateMindGeneration } from "../../mind/rotate.ts";

export interface MindRotateCommandResult {
  readonly markdown: string;
  readonly source_run_root: string;
  readonly source_run_id: string;
  readonly target_run_root: string;
  readonly target_run_id: string;
  readonly source_generation: number;
  readonly target_generation: number;
  readonly charter_sha256: string;
  readonly charter_source_path: string;
  readonly previous_event_head: string | null;
  readonly pulse_counter: number;
  readonly carried_candidates_count: number;
  readonly open_candidates_count: number;
  readonly declined_candidates_count: number;
  readonly rotated_at: string;
  readonly [key: string]: unknown;
}

export function formatMindRotateBrief(params: {
  readonly sourceRunId: string;
  readonly targetRunId: string;
  readonly sourceGeneration: number;
  readonly targetGeneration: number;
  readonly targetRunRoot: string;
  readonly charterSha256: string;
  readonly pulseCounter: number;
  readonly carriedCandidatesCount: number;
  readonly openCandidatesCount: number;
  readonly declinedCandidatesCount: number;
  readonly previousEventHead: string | null;
  readonly rotatedAt: string;
}): string {
  const lines = [
    `### Mind Rotated: Generation ${params.sourceGeneration} → ${params.targetGeneration}`,
    `- **Source Capsule**: \`${params.sourceRunId}\` (sealed with status \`rotated\`)`,
    `- **Successor Capsule**: \`${params.targetRunId}\` at \`${params.targetRunRoot}\``,
    `- **Charter SHA-256**: \`${params.charterSha256}\` (pinned across boundary)`,
    `- **Pulse Counter**: ${params.pulseCounter} (preserved)`,
    `- **Candidates Carried Forward**: ${params.carriedCandidatesCount} (${params.openCandidatesCount} open/admitted, ${params.declinedCandidatesCount} declined)`,
    `- **Previous Event Head**: \`${params.previousEventHead ?? "none"}\``,
    `- **Status**: Successor ready for wake (\`mind:wake --run ${params.targetRunRoot}\`).`,
  ];
  return enforceLineLimit(lines.join("\n"), 30);
}

export function mindRotateCommand(
  flags: Flags,
  _context?: CommandContext,
): MindRotateCommandResult {
  const run = textFlag(flags, "run", true)!;
  const nextRun = textFlag(flags, "next-run", false);
  const actor = textFlag(flags, "actor", false) ?? "owner";
  const now = textFlag(flags, "now", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);

  const result = rotateMindGeneration({
    sourceRunRoot: run,
    nextRunId: nextRun,
    actor,
    now,
    capsulesDir,
  });

  const markdown = formatMindRotateBrief({
    sourceRunId: result.sourceRunId,
    targetRunId: result.targetRunId,
    sourceGeneration: result.sourceGeneration,
    targetGeneration: result.targetGeneration,
    targetRunRoot: result.targetRunRoot,
    charterSha256: result.charterSha256,
    pulseCounter: result.pulseCounter,
    carriedCandidatesCount: result.carriedCandidates.length,
    openCandidatesCount: result.openCandidatesCount,
    declinedCandidatesCount: result.declinedCandidatesCount,
    previousEventHead: result.previousEventHead,
    rotatedAt: result.rotatedAt,
  });

  return {
    markdown,
    source_run_root: result.sourceRunRoot,
    source_run_id: result.sourceRunId,
    target_run_root: result.targetRunRoot,
    target_run_id: result.targetRunId,
    source_generation: result.sourceGeneration,
    target_generation: result.targetGeneration,
    charter_sha256: result.charterSha256,
    charter_source_path: result.charterSourcePath,
    previous_event_head: result.previousEventHead,
    pulse_counter: result.pulseCounter,
    carried_candidates_count: result.carriedCandidates.length,
    open_candidates_count: result.openCandidatesCount,
    declined_candidates_count: result.declinedCandidatesCount,
    rotated_at: result.rotatedAt,
  };
}
