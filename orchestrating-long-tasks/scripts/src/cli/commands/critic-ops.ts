import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { RepositoryBinding } from "../../contracts/repository.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { readPlanObject } from "../../graph/read-plan.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { inspectRepositoryBinding } from "../../packets/repository-identity.ts";
import {
  publishCriticRolePacket,
  repositoryEvidenceCommandIds,
} from "../../packets/critic-grant.ts";
import { recordGrantInspections } from "../../packets/role-grant.ts";
import { loadRun } from "../../store/index.ts";
import { tokenDigest } from "../../workflow/lease/token.ts";
import { beginCompletenessCritic } from "../../workflow/completion/begin-completeness-critic.ts";
import { parseRawFindings } from "../../workflow/completion/parse-raw-findings.ts";
import { parseRawProofs } from "../../workflow/completion/parse-raw-proofs.ts";
import { observeCapsuleIntegrity } from "../../workflow/completion/integrity-evidence.ts";
import { recordCompletionReview } from "../../workflow/completion/record-completion-review.ts";
import { recordCompletionRemediation } from "../../workflow/completion/record-completion-remediation.ts";
import { authoritativeRepositoryCommand } from "../../workflow/completion/repository-evidence.ts";
import type { CompletionFinding } from "../../workflow/completion/types.ts";
import {
  formatCriticRejectBrief,
  formatCriticReviewBrief,
  formatCriticStartBrief,
} from "../formatters/index.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { listFlag, textFlag, type Flags } from "../options.ts";
import { queryScreenshots } from "../../reporting/screenshot-store.ts";

function liveRepositoryBinding(run: string, expected: Readonly<RepositoryBinding>) {
  void expected;
  const repository = dirname(dirname(loadRun(run).runRoot));
  return inspectRepositoryBinding(repository);
}

export async function criticStartCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const critic = textFlag(flags, "critic")!;
  const repositoryCommandIds = listFlag(flags, "repository-command-ids");

  recordGrantInspections(run, critic);
  const result = beginCompletenessCritic(workflowPort(run), critic);
  const published = await publishCriticRolePacket({
    runRoot: run,
    port: workflowPort(run),
    criticId: critic,
    token: result.token,
    ...(repositoryCommandIds === undefined ? {} : { repositoryCommandIds }),
  });
  const tasks = Object.values(result.state.tasks);
  const satisfiedCount = tasks.filter((t) => t.status === "done").length;
  const totalReqs = result.state.requirements.length;
  const evidencedReqs = result.state.requirements.filter(
    (r) => r.status === "satisfied" || r.evidence.length > 0,
  ).length;

  const finalGates = result.state.gates
    .filter((gate) => gate.scope === "run" && gate.mandatory)
    .map((gate) => (Array.isArray(gate.command) ? gate.command.join(" ") : gate.command));

  const markdown = formatCriticStartBrief({
    critic,
    token: result.token,
    tasksSatisfied: satisfiedCount,
    totalTasks: tasks.length,
    reqsEvidenced: evidencedReqs,
    totalReqs,
    finalGates,
  });

  return {
    markdown,
    run_root: run,
    token: result.token,
    critic: result.state.completion_critic,
    packet_id: published.record.id,
    packet_path: published.markdownPath,
    role_contract_sha256: published.packet.metadata.role_contract_sha256,
  };
}

export async function criticReviewCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const critic = textFlag(flags, "critic")!;
  const token = textFlag(flags, "token")!;
  const decision = textFlag(flags, "decision")!;
  const summary = textFlag(flags, "summary")!;
  const findingsRaw = textFlag(flags, "findings", false);
  const findingsFile = textFlag(flags, "findings-file", false);
  const proofsRaw = textFlag(flags, "proofs", false);
  const proofsFile = textFlag(flags, "proofs-file", false);
  const reviewFile = textFlag(flags, "review", false);

  if (decision !== "approve" && decision !== "request_changes") {
    throw new HarnessError("INVALID_ARGUMENT", "--decision must be approve or request_changes");
  }

  let reviewPayload: Record<string, unknown>;
  const isApproved = decision === "approve";

  const capsuleNow = loadRun(run);
  const observedIntegrity = observeCapsuleIntegrity(
    capsuleNow.runRoot,
    capsuleNow.state.event_head,
  );

  if (reviewFile !== undefined) {
    reviewPayload = await readPlanObject(reviewFile, "completion review");
    reviewPayload.critic_token = token;
    reviewPayload.integrity_evidence = [observedIntegrity];
    reviewPayload.summary = summary;
  } else {
    const port = workflowPort(run);
    const state = port.read();
    const assignment = state.completion_critic;
    if (!assignment) {
      throw new HarnessError("INVALID_STATE", "no completeness critic assignment found");
    }

    let findingsList: CompletionFinding[] = [];
    if (isApproved) {
      if (findingsRaw !== undefined || findingsFile !== undefined)
        throw new HarnessError(
          "INVALID_ARGUMENT",
          "--decision approve cannot carry findings; record them with --decision request_changes",
        );
    } else {
      if (findingsRaw === undefined && findingsFile === undefined)
        throw new HarnessError(
          "INVALID_ARGUMENT",
          "--decision request_changes requires --findings or --findings-file; a rejection must name the defects it found",
        );
      findingsList = parseRawFindings(findingsRaw, findingsFile);
      if (findingsList.length === 0)
        throw new HarnessError(
          "INVALID_ARGUMENT",
          "--decision request_changes requires at least one finding",
        );
    }

    const checksList = Object.values(state.commands)
      .filter(
        (c) =>
          c.actor === critic &&
          c.exit_code === 0 &&
          authoritativeRepositoryCommand(state, c.id) !== undefined,
      )
      .map((c) => ({ command_id: c.id }));

    const proofs = parseRawProofs(proofsRaw, proofsFile);

    const graphRev = state.graph_revision;

    const packet = assignment.packet_id ? state.packets?.[assignment.packet_id] : undefined;

    const repoCmds = packet?.repository_command_ids ?? repositoryEvidenceCommandIds(state);

    reviewPayload = {
      ...(packet ? { packet_id: packet.id, packet_sha256: packet.packet_sha256 } : {}),
      critic_token: token,
      graph_revision: graphRev,
      summary,
      status: isApproved ? "clean" : "findings",
      readiness_sha256: assignment.readiness_sha256,
      repository_binding: assignment.repository_binding,
      integrity_evidence: [observedIntegrity],
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

  const loaded = loadRun(run);
  const recordedReview = state.completion_review;
  const findings = recordedReview?.findings ?? [];

  const reportsDir = join(loaded.runRoot, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, "critic-review.json");
  const runScreenshots = queryScreenshots(loaded.runRoot);
  const reportData = {
    critic,
    critic_token_digest: tokenDigest(token),
    decision,
    summary,
    created_at: new Date().toISOString(),
    findings,
    screenshots: runScreenshots.map((s) => s.path),
    screenshot_records: runScreenshots,
    completion_review: recordedReview ?? null,
  };
  writeFileSync(reportPath, JSON.stringify(reportData, null, 2), "utf-8");

  const firstFindingId = findings[0]?.id;

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
    report_path: reportPath,
  };
}

export async function criticRejectCommand(flags: Flags): Promise<Record<string, unknown>> {
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
  const summary = textFlag(flags, "summary")!;

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

function splitFindingPair(entry: string, flag: string): [string, string] {
  const index = entry.indexOf("=");
  if (index <= 0 || index === entry.length - 1) {
    throw new HarnessError("INVALID_ARGUMENT", `--${flag} must be given as <finding-id>=<value>`);
  }
  return [entry.slice(0, index), entry.slice(index + 1)];
}

export function criticRemediateCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = textFlag(flags, "actor")!;
  const port = workflowPort(run);
  const review = port.read().completion_review;
  if (!review) {
    throw new HarnessError("INVALID_STATE", "no completion review is recorded for this run");
  }
  const reviewSha = textFlag(flags, "review-sha256", false) ?? review.review_sha256;

  const methods = new Map<string, string>();
  for (const entry of listFlag(flags, "resolution-method") ?? []) {
    const [findingId, method] = splitFindingPair(entry, "resolution-method");
    if (methods.has(findingId)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `finding ${findingId} has two --resolution-method`,
      );
    }
    methods.set(findingId, method);
  }

  const commandIdsByFinding = new Map<string, string[]>();
  for (const entry of listFlag(flags, "resolve", true)!) {
    const [findingId, commands] = splitFindingPair(entry, "resolve");
    const commandIds = commands
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (commandIds.length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", `--resolve ${findingId} cites no command id`);
    }
    commandIdsByFinding.set(findingId, [
      ...(commandIdsByFinding.get(findingId) ?? []),
      ...commandIds,
    ]);
  }

  const resolutions = [...commandIdsByFinding].map(([findingId, commandIds]) => {
    const method = methods.get(findingId);
    if (method === undefined) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `finding ${findingId} has no --resolution-method; state how it was remediated`,
      );
    }
    return { finding_id: findingId, method, command_ids: commandIds };
  });

  const state = recordCompletionRemediation(port, actor, {
    review_sha256: reviewSha,
    resolutions,
  });
  const remediation = state.completion_remediations!.find(
    (entry) => entry.review_sha256 === reviewSha,
  )!;
  const md = [
    `### Completion Findings Remediated: \`${reviewSha.slice(0, 12)}…\``,
    `- **Findings Resolved**: ${resolutions.map((r) => `\`${r.finding_id}\``).join(", ")}`,
    `- **Recorded By**: \`${actor}\``,
    `- **Next Step**: assign a fresh completeness critic with \`critic:start\`.`,
  ].join("\n");
  return {
    markdown: enforceLineLimit(md, 30),
    run_root: run,
    remediation,
    completion_remediations: state.completion_remediations,
  };
}
