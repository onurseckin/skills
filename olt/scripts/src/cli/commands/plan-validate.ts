import { readFileSync } from "node:fs";
import { HarnessError } from "../../core/errors/index.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { publishPlanValidatorRolePacket } from "../../packets/plan-validator-grant.ts";
import { recordGrantInspections } from "../../packets/role-grant.ts";
import { beginPlanValidation } from "../../workflow/plan-review/begin-plan-validation.ts";
import { recordPlanReview } from "../../workflow/plan-review/record-plan-review.ts";
import { formatPlanReviewBrief, formatPlanValidateStartBrief } from "../formatters/index.ts";
import { integerFlag, textFlag, type Flags } from "../options.ts";

function readFindingsInput(raw: string | undefined, file: string | undefined): unknown {
  const content = raw ?? (file === undefined ? undefined : readFindingsFile(file));
  if (content === undefined) return [];
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--findings is not valid JSON; pass a JSON array of {id, severity, observation, remediation}",
    );
  }
}

function readFindingsFile(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch (error) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `cannot read --findings-file: ${path}: ${String(error)}`,
    );
  }
}

function commaSeparated(raw: string | undefined): string[] {
  return raw === undefined || raw.trim() === ""
    ? []
    : raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function readDependencyEdgesReviewed(raw: string | undefined): { from: string; to: string }[] {
  return commaSeparated(raw).map((pair) => {
    const sep = pair.indexOf(":");
    if (sep <= 0 || sep === pair.length - 1) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--dependency-edges-reviewed entries must be "<from>:<to>", got "${pair}"`,
      );
    }
    return { from: pair.slice(0, sep).trim(), to: pair.slice(sep + 1).trim() };
  });
}

export async function planValidateStartCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const validator = textFlag(flags, "validator")!;
  const leaseDuration = integerFlag(flags, "lease-duration", { minimum: 5, maximum: 86_400 });

  recordGrantInspections(run, validator);
  const result = beginPlanValidation(
    workflowPort(run),
    validator,
    leaseDuration === undefined ? {} : { leaseSeconds: leaseDuration },
  );
  const assignment = result.state.plan_validation;
  if (!assignment || assignment.validator_id !== validator) {
    throw new HarnessError("INTEGRITY", "plan validation produced no assignment");
  }

  const published = await publishPlanValidatorRolePacket({
    runRoot: run,
    port: workflowPort(run),
    validatorId: validator,
    token: result.token,
  });

  const totalTasks = Object.keys(result.state.tasks).length;
  const markdown = formatPlanValidateStartBrief({
    runId: run,
    validator,
    token: result.token,
    graphRevision: assignment.graph_revision,
    totalTasks,
  });

  return {
    markdown,
    run_root: run,
    token: result.token,
    graph_revision: assignment.graph_revision,
    plan_digest: assignment.plan_digest,
    packet_id: published.record.id,
    packet_path: published.markdownPath,
    role_contract_sha256: published.packet.metadata.role_contract_sha256,
  };
}

export async function planReviewCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const validator = textFlag(flags, "validator")!;
  const token = textFlag(flags, "token")!;
  const status = textFlag(flags, "status")!;
  if (status !== "approved" && status !== "changes_requested") {
    throw new HarnessError("INVALID_ARGUMENT", "--status must be approved or changes_requested");
  }
  const summary = textFlag(flags, "summary")!;
  const decompositionAnswer = textFlag(flags, "decomposition-answer")!;
  const dependencyAnswer = textFlag(flags, "dependency-answer")!;
  const gateAnswer = textFlag(flags, "gate-answer")!;
  const stragglerAnswer = textFlag(flags, "straggler-answer")!;
  const findingsRaw = textFlag(flags, "findings", false);
  const findingsFile = textFlag(flags, "findings-file", false);
  if (status === "approved" && (findingsRaw !== undefined || findingsFile !== undefined)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--status approved cannot carry findings; record them with --status changes_requested",
    );
  }
  if (status === "changes_requested" && findingsRaw === undefined && findingsFile === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--status changes_requested requires --findings or --findings-file naming the defects in the plan",
    );
  }
  const findings = status === "approved" ? [] : readFindingsInput(findingsRaw, findingsFile);
  const checkIds = commaSeparated(textFlag(flags, "checks", false));
  const dependencyEdgesReviewed = readDependencyEdgesReviewed(
    textFlag(flags, "dependency-edges-reviewed", false),
  );
  const gateIdsReviewed = commaSeparated(textFlag(flags, "gate-ids-reviewed", false));

  const state0 = workflowPort(run).read();
  const assignment = state0.plan_validation;
  const graphRevision = assignment?.graph_revision ?? state0.graph_revision ?? 1;
  const packetId = assignment?.packet_id;
  const packet = packetId === undefined ? undefined : state0.packets?.[packetId];

  const reviewPayload: Record<string, unknown> = {
    validator_token: token,
    graph_revision: graphRevision,
    plan_digest: assignment?.plan_digest,
    status,
    summary,
    decomposition_answer: decompositionAnswer,
    dependency_answer: dependencyAnswer,
    gate_answer: gateAnswer,
    straggler_answer: stragglerAnswer,
    findings,
    checks: checkIds,
    dependency_edges_reviewed: dependencyEdgesReviewed,
    gate_ids_reviewed: gateIdsReviewed,
    ...(packet ? { packet_id: packet.id, packet_sha256: packet.packet_sha256 } : {}),
  };

  const state = recordPlanReview(workflowPort(run), validator, reviewPayload);
  const review = state.plan_review;
  if (!review || review.validator_id !== validator) {
    throw new HarnessError("INTEGRITY", "plan review produced no recorded verdict");
  }

  const markdown = formatPlanReviewBrief({
    runId: run,
    validator,
    status: review.status,
    graphRevision: review.graph_revision,
    findingsCount: review.findings.length,
    summary: review.summary,
    dependencyEdgesReviewed: review.dependency_edges_reviewed.length,
    gateIdsReviewed: review.gate_ids_reviewed.length,
  });

  return {
    markdown,
    run_root: run,
    verdict: review.status,
    graph_revision: review.graph_revision,
    findings: review.findings,
    review_sha256: review.review_sha256,
    plan_review: review,
  };
}
