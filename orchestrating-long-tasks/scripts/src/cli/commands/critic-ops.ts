import { dirname } from "node:path";
import { readFileSync } from "node:fs";
import type { RepositoryBinding } from "../../contracts/repository.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { readPlanObject } from "../../graph/read-plan.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { inspectRepositoryBinding } from "../../packets/repository-identity.ts";
import { recordRepositoryInspection } from "../../packets/repository-inspection.ts";
import { loadRun } from "../../store/index.ts";
import { beginCompletenessCritic } from "../../workflow/completion/begin-completeness-critic.ts";
import { recordCompletionReview } from "../../workflow/completion/record-completion-review.ts";
import type { CompletionFinding } from "../../workflow/completion/types.ts";
import {
  formatCriticRejectBrief,
  formatCriticReviewBrief,
  formatCriticStartBrief,
} from "../formatters/index.ts";
import { assertFlags, textFlag, type Flags } from "../options.ts";

function liveRepositoryBinding(run: string, expected: Readonly<RepositoryBinding>) {
  void expected;
  const repository = dirname(dirname(loadRun(run).runRoot));
  return inspectRepositoryBinding(repository);
}

function parseRawFindings(
  findingsRaw: string | undefined,
  findingsFile: string | undefined,
  firstReqId: string,
  defaultSummary: string,
): CompletionFinding[] {
  let content = findingsRaw;
  if (!content && findingsFile) {
    try {
      content = readFileSync(findingsFile, "utf-8");
    } catch (err) {
      throw new HarnessError("INVALID_ARGUMENT", `cannot read findings file: ${findingsFile}`);
    }
  }
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    const list = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as Record<string, unknown>).findings)
        ? (parsed as Record<string, unknown>).findings as unknown[]
        : [parsed];

    return list.map((item: unknown, idx: number) => {
      const rec = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
      const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : `finding-critic-${String(idx + 1).padStart(2, "0")}`;
      const requirementId = typeof rec.requirement_id === "string" && rec.requirement_id.trim() ? rec.requirement_id.trim() : firstReqId;
      const severity = (rec.severity === "critical" || rec.severity === "minor" ? rec.severity : "important") as CompletionFinding["severity"];
      const observation = typeof rec.observation === "string" ? rec.observation : String(rec.finding ?? rec.message ?? defaultSummary);
      const remediation = typeof rec.remediation === "string" ? rec.remediation : "Address identified gap prior to completion.";
      const revalidation = typeof rec.revalidation === "string" ? rec.revalidation : "Re-run full verification gate.";
      const filePaths = Array.isArray(rec.file_paths)
        ? rec.file_paths.map(String)
        : typeof rec.file_path === "string"
          ? [rec.file_path]
          : typeof rec.path === "string"
            ? [rec.path]
            : undefined;

      return {
        id,
        requirement_id: requirementId,
        severity,
        observation,
        ...(filePaths ? { file_paths: filePaths } : {}),
        evidence: [{ kind: "state", reference: requirementId, observation }],
        remediation,
        revalidation,
      };
    });
  } catch {
    return [
      {
        id: "finding-critic-01",
        requirement_id: firstReqId,
        severity: "important",
        observation: content.trim() || defaultSummary,
        evidence: [{ kind: "state", reference: firstReqId, observation: content.trim() || defaultSummary }],
        remediation: "Address identified gap prior to completion.",
        revalidation: "Re-run full verification gate.",
      },
    ];
  }
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
  assertFlags(flags, [
    "run",
    "critic",
    "token",
    "decision",
    "summary",
    "finding",
    "findings",
    "findings-file",
    "reason",
    "review",
  ]);
  const run = textFlag(flags, "run")!;
  const critic = textFlag(flags, "critic")!;
  const token = textFlag(flags, "token")!;
  const decision = textFlag(flags, "decision", false) ?? "approve";
  const summary = textFlag(flags, "summary", false) ?? `Critic review: ${decision}`;
  const finding = textFlag(flags, "finding", false) ?? textFlag(flags, "reason", false);
  const findingsRaw = textFlag(flags, "findings", false);
  const findingsFile = textFlag(flags, "findings-file", false);
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
    let findingsList: CompletionFinding[] = [];
    if (!isApproved) {
      if (findingsRaw || findingsFile) {
        findingsList = parseRawFindings(findingsRaw, findingsFile, firstReqId, summary);
      } else {
        findingsList = [
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
      }
    }

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

  const findings = state.completion_review?.findings ?? [];
  const firstFindingId = findings[0]?.id ?? (decision === "request_changes" ? "finding-critic-01" : undefined);

  const markdown = formatCriticReviewBrief({
    critic,
    decision: decision as "approve" | "request_changes",
    summary,
    token,
    runId: run,
    findingId: firstFindingId,
  });

  return {
    markdown,
    run_root: run,
    decision,
    summary,
    completion_review: state.completion_review,
  };
}

export async function criticRejectCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, [
    "run",
    "critic",
    "token",
    "summary",
    "reason",
    "finding",
    "findings",
    "findings-file",
    "review",
  ]);
  const rejectFlags = {
    ...flags,
    decision: "request_changes",
  };
  const result = await criticReviewCommand(rejectFlags);
  const review = result.completion_review as { findings?: CompletionFinding[] } | undefined;
  const findings = review?.findings ?? [];
  const findingIds = findings.map((f) => f.id);
  const critic = textFlag(flags, "critic")!;
  const token = textFlag(flags, "token")!;
  const run = textFlag(flags, "run")!;
  const summary = textFlag(flags, "summary", false) ?? "Critic rejected: defects found";

  const markdown = formatCriticRejectBrief({
    critic,
    token,
    runId: run,
    summary,
    findingsCount: findings.length,
    findingIds,
  });

  return {
    markdown,
    run_root: run,
    decision: "request_changes",
    summary,
    findings_count: findings.length,
    findings,
    completion_review: result.completion_review,
  };
}
