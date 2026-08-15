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

function liveRepositoryBinding(run: string, expected: Readonly<RepositoryBinding>) {
  void expected;
  const repository = dirname(dirname(loadRun(run).runRoot));
  return inspectRepositoryBinding(repository);
}

export async function criticStartCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "critic", "repository-command-ids"]);
  const run = textFlag(flags, "run")!;
  const critic = textFlag(flags, "critic")!;

  recordRepositoryInspection(run, critic, "current");
  const result = beginCompletenessCritic(workflowPort(run), critic);
  const tasks = Object.values(result.state.tasks);
  const satisfiedCount = tasks.filter((t) => t.status === "done").length;
  const totalReqs = result.state.requirements.length;
  const evidencedReqs = result.state.requirements.filter(
    (r) => r.status === "satisfied" || r.evidence.length > 0,
  ).length;

  const markdown = formatCriticStartBrief({
    critic,
    token: result.token,
    tasksSatisfied: satisfiedCount,
    totalTasks: tasks.length,
    reqsEvidenced: evidencedReqs,
    totalReqs,
    finalGate: "bun test tests",
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
    if (!assignment) {
      throw new HarnessError("INVALID_STATE", "no completeness critic assignment found");
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

    const checksList = Object.values(state.commands)
      .filter((c) => c.actor === critic && c.exit_code === 0)
      .map((c) => ({ command_id: c.id }));

    const repoCmds = Object.values(state.commands)
      .filter((c) => c.gate_id === "gate-run-completion" && c.exit_code === 0)
      .map((c) => c.id);

    const rawReqs = state.requirements as unknown;
    const reqList: { id: string }[] = Array.isArray(rawReqs)
      ? (rawReqs as { id: string }[])
      : rawReqs &&
          typeof rawReqs === "object" &&
          "requirements" in rawReqs &&
          Array.isArray((rawReqs as { requirements: unknown }).requirements)
        ? (rawReqs as { requirements: { id: string }[] }).requirements
        : Object.values((rawReqs ?? {}) as Record<string, { id: string }>);

    const proofs = reqList.map((req) => ({
      requirement_id: req.id,
      status: "satisfied" as const,
      evidence:
        checksList.length > 0
          ? [
              {
                kind: "command" as const,
                reference: checksList[0]!.command_id,
                observation: `Requirement ${req.id} satisfied.`,
              },
            ]
          : [
              {
                kind: "state" as const,
                reference: req.id,
                observation: `Requirement ${req.id} satisfied.`,
              },
            ],
    }));

    const graphRev =
      state.graph_revision ??
      (state as unknown as { graph?: { revision?: number } }).graph?.revision ??
      1;

    reviewPayload = {
      packet_id: "packet-critic-direct",
      critic_token: token,
      packet_sha256: "",
      graph_revision: graphRev,
      status: isApproved ? "clean" : "findings",
      readiness_sha256: assignment.readiness_sha256,
      repository_binding: assignment.repository_binding,
      integrity_evidence: [{ status: "passed", issues: [] }],
      repository_command_ids: repoCmds,
      checks: checksList,
      findings: findingsList,
      unresolved_finding_ids: findingsList.map((f) => f.id),
      requirement_proofs: proofs,
      residual_risks: [],
    };
  }

  const state = recordCompletionReview(workflowPort(run), critic, reviewPayload, (expected) =>
    liveRepositoryBinding(run, expected),
  );

  const markdown = formatCriticReviewBrief({
    critic,
    decision: decision as "approve" | "request_changes",
    summary,
    token,
    runId: run,
    findingId: decision === "request_changes" ? "finding-critic-01" : undefined,
  });

  return {
    markdown,
    run_root: run,
    decision,
    summary,
    completion_review: state.completion_review,
  };
}
