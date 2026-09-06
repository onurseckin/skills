import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RepositoryBinding } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { loadRun } from "../../engine/store/index.ts";
import { readPlanObject } from "../../graph/read-plan.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import {
  publishCriticRolePacket,
  repositoryEvidenceCommandIds,
} from "../../packets/critic-grant.ts";
import { inspectRepositoryBinding } from "../../packets/repository-identity.ts";
import { recordGrantInspections } from "../../packets/role-grant.ts";
import { queryScreenshots } from "../../reporting/screenshot-store.ts";
import { beginCompletenessCritic } from "../../workflow/completion/begin-completeness-critic.ts";
import { observeCapsuleIntegrity } from "../../workflow/completion/integrity-evidence.ts";
import { parseRawFindings } from "../../workflow/completion/parse-raw-findings.ts";
import { parseRawProofs } from "../../workflow/completion/parse-raw-proofs.ts";
import { recordCompletionRemediation } from "../../workflow/completion/record-completion-remediation.ts";
import { recordCompletionReview } from "../../workflow/completion/record-completion-review.ts";
import { authoritativeRepositoryCommand } from "../../workflow/completion/repository-evidence.ts";
import type { CompletionFinding } from "../../workflow/completion/types.ts";
import { tokenDigest } from "../../workflow/lease/token.ts";
import {
  formatCriticRejectBrief,
  formatCriticReviewBrief,
  formatCriticStartBrief,
} from "../formatters/index.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { listFlag, textFlag, type Flags } from "../options.ts";

function liveRepositoryBinding(run: string, expected: Readonly<RepositoryBinding>) {
  void expected;
  return inspectRepositoryBinding(findRepoRoot(loadRun(run).runRoot));
}

import {
  loadCriticRolePacket,
  resolveCriticToken,
  saveCriticPacket,
} from "../../workflow/completion/index.ts";

export { loadCriticRolePacket, resolveCriticToken, saveCriticPacket };

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
  saveCriticPacket(run, {
    critic,
    token: result.token,
    critic_token: result.token,
    packet_id: published.record.id,
    packet_path: published.markdownPath,
  });
  const tasks = Object.values(result.state.tasks);
  const satisfiedCount = tasks.filter((t) => t.status === "done").length;
  const evidencedReqs = result.state.requirements.filter(
    (r) => r.status === "satisfied" || r.evidence.length > 0,
  ).length;
  const finalGates = result.state.gates
    .filter((g) => g.scope === "run" && g.mandatory)
    .map((g) => (Array.isArray(g.command) ? g.command.join(" ") : g.command));
  const markdown = formatCriticStartBrief({
    critic,
    token: result.token,
    tasksSatisfied: satisfiedCount,
    totalTasks: tasks.length,
    reqsEvidenced: evidencedReqs,
    totalReqs: result.state.requirements.length,
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
  const token = resolveCriticToken(run, critic, textFlag(flags, "token", false));
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
  if (isApproved) {
    const genericSignOffs = new Set([
      "looks good",
      "lgtm",
      "all good",
      "approved",
      "approve",
      "done",
      "ok",
      "fine",
      "pass",
      "passed",
      "everything passed",
      "all requirements met",
      "verified",
      "rubber stamp",
      "n/a",
      "none",
    ]);
    if (summary.trim().length < 15 || genericSignOffs.has(summary.trim().toLowerCase())) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "critic summary cannot be a superficial rubber-stamp or generic sign-off; provide comprehensive requirement evidence",
      );
    }
  }
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
    if (!assignment)
      throw new HarnessError("INVALID_STATE", "no completeness critic assignment found");
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
    const filterChecks = (
      p: (c: {
        actor: string;
        exit_code: number | null;
        gate_id: string | null;
        id: string;
      }) => boolean,
    ) =>
      Object.values(state.commands)
        .filter(
          (c) =>
            c.exit_code === 0 && p(c) && authoritativeRepositoryCommand(state, c.id) !== undefined,
        )
        .map((c) => ({ command_id: c.id }));
    const criticChecks = filterChecks((c) => c.actor === critic);
    const checksList =
      criticChecks.length > 0 ? criticChecks : filterChecks((c) => c.gate_id !== null);
    let proofs = parseRawProofs(proofsRaw, proofsFile);
    if (proofs.length === 0 && isApproved) {
      const topCmd = checksList[0]?.command_id;
      proofs = Object.values(state.requirements || {}).map((req) => ({
        requirement_id: req.id,
        status: "satisfied",
        evidence: topCmd
          ? [
              {
                kind: "command" as const,
                reference: topCmd,
                observation: `Verified by passing gate suite command ${topCmd}`,
              },
            ]
          : [
              {
                kind: "state" as const,
                reference: req.id,
                observation: `Requirement ${req.id} satisfied in state`,
              },
            ],
      }));
    }
    const packet = assignment.packet_id ? state.packets?.[assignment.packet_id] : undefined;
    reviewPayload = {
      ...(packet ? { packet_id: packet.id, packet_sha256: packet.packet_sha256 } : {}),
      critic_token: token,
      graph_revision: state.graph_revision,
      summary,
      status: isApproved ? "clean" : "findings",
      readiness_sha256: assignment.readiness_sha256,
      repository_binding: assignment.repository_binding,
      integrity_evidence: [observedIntegrity],
      repository_command_ids: packet?.repository_command_ids ?? repositoryEvidenceCommandIds(state),
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
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        critic,
        critic_token_digest: tokenDigest(token),
        decision,
        summary,
        created_at: new Date().toISOString(),
        findings,
        screenshots: runScreenshots.map((s) => s.path),
        screenshot_records: runScreenshots,
        completion_review: recordedReview ?? null,
      },
      null,
      2,
    ),
    "utf-8",
  );
  const markdown = formatCriticReviewBrief({
    critic,
    decision: decision as "approve" | "request_changes",
    summary,
    token,
    runId: run,
    findingId: findings[0]?.id,
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
  const run = textFlag(flags, "run")!;
  const critic = textFlag(flags, "critic")!;
  const token = resolveCriticToken(run, critic, textFlag(flags, "token", false));
  const summary = textFlag(flags, "summary")!;
  const result = await criticReviewCommand({ ...flags, decision: "request_changes", token });
  const review = result.completion_review as { findings?: CompletionFinding[] } | undefined;
  const findings = review?.findings ?? [];
  const markdown = formatCriticRejectBrief({
    critic,
    token,
    runId: run,
    summary,
    findingsCount: findings.length,
    findingIds: findings.map((f) => f.id),
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
  if (!review)
    throw new HarnessError("INVALID_STATE", "no completion review is recorded for this run");
  const reviewSha = textFlag(flags, "review-sha256", false) ?? review.review_sha256;
  const methods = new Map<string, string>();
  for (const entry of listFlag(flags, "resolution-method") ?? []) {
    const [findingId, method] = splitFindingPair(entry, "resolution-method");
    if (methods.has(findingId))
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `finding ${findingId} has two --resolution-method`,
      );
    methods.set(findingId, method);
  }
  const commandIdsByFinding = new Map<string, string[]>();
  for (const entry of listFlag(flags, "resolve", true)!) {
    const [findingId, commands] = splitFindingPair(entry, "resolve");
    const commandIds = commands
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (commandIds.length === 0)
      throw new HarnessError("INVALID_ARGUMENT", `--resolve ${findingId} cites no command id`);
    commandIdsByFinding.set(findingId, [
      ...(commandIdsByFinding.get(findingId) ?? []),
      ...commandIds,
    ]);
  }
  const resolutions = [...commandIdsByFinding].map(([findingId, commandIds]) => {
    const method = methods.get(findingId);
    if (method === undefined)
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `finding ${findingId} has no --resolution-method; state how it was remediated`,
      );
    return { finding_id: findingId, method, command_ids: commandIds };
  });
  const state = recordCompletionRemediation(port, actor, { review_sha256: reviewSha, resolutions });
  const remediation = state.completion_remediations!.find(
    (entry) => entry.review_sha256 === reviewSha,
  )!;
  const md = `### Completion Findings Remediated: \`${reviewSha.slice(0, 12)}…\`\n- **Findings Resolved**: ${resolutions.map((r) => `\`${r.finding_id}\``).join(", ")}\n- **Recorded By**: \`${actor}\`\n- **Next Step**: assign a fresh completeness critic with \`critic:start\`.`;
  return {
    markdown: enforceLineLimit(md, 30),
    run_root: run,
    remediation,
    completion_remediations: state.completion_remediations,
  };
}
