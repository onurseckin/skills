import { readPlanObject } from "../../graph/read-plan.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { packetEvidenceIssues } from "../../reporting/packet-evidence.ts";
import { verifyCommandRecord } from "../../runner/verify-command.ts";
import { beginCompletenessCritic } from "../../workflow/completion/begin-completeness-critic.ts";
import type { CompletionArtifactRequirements } from "../../workflow/completion/artifact-verification.ts";
import { completeRun } from "../../workflow/completion/complete-run.ts";
import { recordCompletionRemediation } from "../../workflow/completion/record-completion-remediation.ts";
import { recordCompletionReview } from "../../workflow/completion/record-completion-review.ts";
import type { PacketRecord, WorkflowState } from "../../workflow/types.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { dirname } from "node:path";
import { loadRun } from "../../store/index.ts";
import { recordRepositoryInspection } from "../../packets/repository-inspection.ts";
import { inspectRepositoryBinding } from "../../packets/repository-identity.ts";
import type { RepositoryBinding } from "../../contracts/repository.ts";
import { actorFlag, assertFlags, textFlag, type Flags } from "../options.ts";

export function beginCriticCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "critic"]);
  const run = textFlag(flags, "run")!;
  recordRepositoryInspection(run, textFlag(flags, "critic")!, "current");
  const result = beginCompletenessCritic(workflowPort(run), textFlag(flags, "critic")!);
  return {
    run_root: run,
    token: result.token,
    critic: result.state.completion_critic!,
  };
}

export async function completionReviewCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "critic", "token", "review"]);
  const run = textFlag(flags, "run")!;
  const review = await readPlanObject(textFlag(flags, "review")!, "completion review");
  review.critic_token = textFlag(flags, "token")!;
  const state = recordCompletionReview(
    workflowPort(run),
    textFlag(flags, "critic")!,
    review,
    (expected) => liveRepositoryBinding(run, expected),
  );
  return { run_root: run, review: state.completion_review! };
}

export async function completionRemediationCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "actor", "remediation"]);
  const run = textFlag(flags, "run")!;
  const remediation = await readPlanObject(
    textFlag(flags, "remediation")!,
    "completion remediation",
  );
  const state = recordCompletionRemediation(workflowPort(run), actorFlag(flags), remediation);
  return {
    run_root: run,
    remediation: state.completion_remediations?.at(-1) ?? null,
  };
}

function verifyCompletionArtifacts(
  run: string,
  state: Readonly<WorkflowState>,
  requirements: CompletionArtifactRequirements,
) {
  const issues: string[] = [];
  for (const id of requirements.command_ids) {
    const command = state.commands[id];
    if (!command) issues.push(`command ${id}: missing durable command record`);
    else
      issues.push(...verifyCommandRecord(run, command).map((issue) => `command ${id}: ${issue}`));
  }
  issues.push(...packetEvidenceIssues(run, state.packets ?? ({} as Record<string, PacketRecord>)));
  if (issues.length > 0) {
    throw new HarnessError(
      "INTEGRITY",
      `completion artifact verification failed: ${issues.join("; ")}`,
    );
  }
  return {
    verified_at: new Date().toISOString(),
    command_ids: requirements.command_ids,
    packets: requirements.packets,
    repository_binding: liveRepositoryBinding(run, requirements.repository_binding),
  };
}

function liveRepositoryBinding(run: string, expected: Readonly<RepositoryBinding>) {
  void expected;
  const repository = dirname(dirname(loadRun(run).runRoot));
  return inspectRepositoryBinding(repository);
}

export function completeCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "actor"]);
  const run = textFlag(flags, "run")!;
  const state = completeRun(workflowPort(run), actorFlag(flags), (lockedState, requirements) =>
    verifyCompletionArtifacts(run, lockedState, requirements),
  );
  return { run_root: run, completion: state.completion_result! };
}
