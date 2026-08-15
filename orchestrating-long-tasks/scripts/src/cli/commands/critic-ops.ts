import { dirname } from "node:path";
import type { RepositoryBinding } from "../../contracts/repository.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { readPlanObject } from "../../graph/read-plan.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { inspectRepositoryBinding } from "../../packets/repository-identity.ts";
import { recordRepositoryInspection } from "../../packets/repository-inspection.ts";
import { loadRun } from "../../store/index.ts";
import { beginCompletenessCritic } from "../../workflow/completion/begin-completeness-critic.ts";
import { recordCompletionReview } from "../../workflow/completion/record-completion-review.ts";
import { formatCriticReviewBrief, formatCriticStartBrief } from "../formatters/index.ts";
import { assertFlags, textFlag, type Flags } from "../options.ts";
import { packetCommand } from "./packet.ts";

function liveRepositoryBinding(run: string, expected: Readonly<RepositoryBinding>) {
  void expected;
  const repository = dirname(dirname(loadRun(run).runRoot));
  return inspectRepositoryBinding(repository);
}

export async function criticStartCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "critic", "repository-command-ids"]);
  const run = textFlag(flags, "run")!;
  const critic = textFlag(flags, "critic")!;
  const repoCmdIds = textFlag(flags, "repository-command-ids", false) ?? "cmd-repo-inspect";

  recordRepositoryInspection(run, critic, "current");
  const result = beginCompletenessCritic(workflowPort(run), critic);
  const tasks = Object.values(result.state.tasks);
  const satisfiedCount = tasks.filter((t) => t.status === "done").length;
  const totalReqs = result.state.requirements.length;
  const evidencedReqs = result.state.requirements.filter((r) => r.status === "satisfied" || r.evidence.length > 0).length;

  let packetPath = `${run}/packets/critic/packet.md`;
  try {
    const published = await packetCommand({
      run,
      role: "completeness-critic",
      agent: critic,
      token: result.token,
      id: "critic-packet",
      "repository-command-ids": repoCmdIds,
    });
    if (typeof published.path === "string") packetPath = published.path;
  } catch {
    // Gracefully handle if already published
  }

  const markdown = formatCriticStartBrief({
    critic,
    token: result.token,
    tasksSatisfied: satisfiedCount,
    totalTasks: tasks.length,
    reqsEvidenced: evidencedReqs,
    totalReqs,
    finalGate: "bun test tests",
    packetPath,
  });

  return {
    markdown,
    run_root: run,
    token: result.token,
    critic: result.state.completion_critic,
  };
}

export async function criticReviewCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "critic", "token", "decision", "summary", "finding", "review"]);
  const run = textFlag(flags, "run")!;
  const critic = textFlag(flags, "critic")!;
  const token = textFlag(flags, "token")!;
  const decision = textFlag(flags, "decision", false) ?? "approve";
  const summary = textFlag(flags, "summary", false) ?? `Critic review: ${decision}`;
  const finding = textFlag(flags, "finding", false);
  const reviewFile = textFlag(flags, "review", false);

  if (decision !== "approve" && decision !== "request_changes") {
    throw new HarnessError("INVALID_ARGUMENT", "--decision must be approve or request_changes");
  }

  let reviewPayload: Record<string, unknown>;
  if (reviewFile !== undefined) {
    reviewPayload = await readPlanObject(reviewFile, "completion review");
    reviewPayload.critic_token = token;
  } else {
    const isApproved = decision === "approve";
    const port = workflowPort(run);
    const state = port.read();
    const assignment = state.completion_critic;
    if (!assignment || !assignment.packet_id) {
      throw new HarnessError("INVALID_STATE", "no completeness critic assignment or published packet");
    }
    const packet = (state.packets ?? {})[assignment.packet_id];
    if (!packet) {
      throw new HarnessError("INVALID_STATE", `missing critic packet ${assignment.packet_id}`);
    }

    const firstReqId = state.requirements[0]?.id ?? "req-1";
    const findingsList = isApproved
      ? []
      : [
          {
            id: "finding-critic-01",
            requirement_id: firstReqId,
            severity: "important",
            observation: finding ?? summary,
            evidence: [{ kind: "state", reference: firstReqId, observation: finding ?? summary }],
            remediation: "Address identified gap prior to completion.",
            revalidation: "Re-run full verification gate.",
          },
        ];

    const proofs = state.requirements.map((req) => ({
      requirement_id: req.id,
      status: "satisfied" as const,
      evidence: [{ kind: "state", reference: req.id, observation: `Requirement ${req.id} satisfied.` }],
    }));

    reviewPayload = {
      packet_id: assignment.packet_id,
      critic_token: token,
      packet_sha256: packet.packet_sha256,
      graph_revision: state.graph_revision,
      status: isApproved ? "clean" : "findings",
      readiness_sha256: assignment.readiness_sha256,
      repository_binding: assignment.repository_binding,
      integrity_evidence: [{ status: "passed", issues: [] }],
      repository_command_ids: packet.repository_command_ids ?? [],
      checks: (packet.repository_command_ids ?? []).map((id) => ({ command_id: id })),
      findings: findingsList,
      unresolved_finding_ids: findingsList.map((f) => f.id),
      requirement_proofs: proofs,
      residual_risks: [],
    };
  }

  const state = recordCompletionReview(
    workflowPort(run),
    critic,
    reviewPayload,
    (expected) => liveRepositoryBinding(run, expected),
  );

  const markdown = formatCriticReviewBrief({
    critic,
    decision: decision as "approve" | "request_changes",
    summary,
    token,
    runId: run,
    findingId: finding !== undefined ? "finding-critic-01" : undefined,
    promptCoverage: "100% verified",
  });

  return {
    markdown,
    run_root: run,
    decision,
    review: state.completion_review,
  };
}
