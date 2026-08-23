import { HarnessError } from "../../core/errors/harness-error.ts";
import { authoritativeRepositoryCommand } from "../completion/repository-evidence.ts";
import { jsonDigest } from "../completion/completion-review-digest.ts";
import { tokenMatches } from "../lease/token.ts";
import { requireText, utc } from "../task-state.ts";
import {
  systemClock,
  type Clock,
  type PlanDependencyEdge,
  type PlanFinding,
  type PlanReview,
  type TransactionPort,
  type WorkflowState,
} from "../types.ts";
import { currentPlanDigest } from "./plan-digest.ts";

function stringId(value: unknown, index: number, field: string): string {
  return requireText(value, `${field}[${index}]`);
}

function duplicateFreeIds(ids: readonly string[], field: string): void {
  if (new Set(ids).size !== ids.length)
    throw new HarnessError("INVALID_ARGUMENT", `${field} must be duplicate-free`);
}

function optionalCommandIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HarnessError("INVALID_ARGUMENT", "checks must be an array");
  const ids = value.map((entry, index) => stringId(entry, index, "checks"));
  duplicateFreeIds(ids, "checks");
  return ids;
}

function edgeKey(edge: { from: string; to: string }): string {
  return `${edge.from}->${edge.to}`;
}

function dependencyEdgesReviewedFrom(value: unknown): PlanDependencyEdge[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new HarnessError("INVALID_ARGUMENT", "dependency_edges_reviewed must be an array");
  const edges = value.map((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `dependency_edges_reviewed[${index}] must be an object`,
      );
    const entry = raw as Record<string, unknown>;
    return {
      from: requireText(entry.from, `dependency_edges_reviewed[${index}].from`),
      to: requireText(entry.to, `dependency_edges_reviewed[${index}].to`),
    };
  });
  const keys = edges.map(edgeKey);
  if (new Set(keys).size !== keys.length)
    throw new HarnessError("INVALID_ARGUMENT", "dependency_edges_reviewed must be duplicate-free");
  return edges;
}

function gateIdsReviewedFrom(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new HarnessError("INVALID_ARGUMENT", "gate_ids_reviewed must be an array");
  const ids = value.map((entry, index) => stringId(entry, index, "gate_ids_reviewed"));
  duplicateFreeIds(ids, "gate_ids_reviewed");
  return ids;
}

function realDependencyEdges(state: WorkflowState): PlanDependencyEdge[] {
  return Object.values(state.tasks).flatMap((task) =>
    task.dependencies.map((dep) => ({ from: task.id, to: dep })),
  );
}

function assertDependencyEdgeCoverage(
  real: readonly PlanDependencyEdge[],
  claimed: readonly PlanDependencyEdge[],
): void {
  const realKeys = new Set(real.map(edgeKey));
  const claimedKeys = new Set(claimed.map(edgeKey));
  const missing = real.filter((edge) => !claimedKeys.has(edgeKey(edge)));
  if (missing.length > 0)
    throw new HarnessError(
      "INVALID_STATE",
      `dependency_edges_reviewed omits real edges the compiled plan declares: ` +
        `${missing.map((e) => `${e.from}->${e.to}`).join(", ")}`,
    );
  const unknown = claimed.filter((edge) => !realKeys.has(edgeKey(edge)));
  if (unknown.length > 0)
    throw new HarnessError(
      "INVALID_STATE",
      `dependency_edges_reviewed names edges the compiled plan does not declare: ` +
        `${unknown.map((e) => `${e.from}->${e.to}`).join(", ")}`,
    );
}

function assertGateCoverage(real: readonly string[], claimed: readonly string[]): void {
  const claimedSet = new Set(claimed);
  const missing = real.filter((id) => !claimedSet.has(id));
  if (missing.length > 0)
    throw new HarnessError(
      "INVALID_STATE",
      `gate_ids_reviewed omits mandatory gates from the compiled plan: ${missing.join(", ")}`,
    );
  const realSet = new Set(real);
  const unknown = claimed.filter((id) => !realSet.has(id));
  if (unknown.length > 0)
    throw new HarnessError(
      "INVALID_STATE",
      `gate_ids_reviewed names gates the compiled plan does not declare: ${unknown.join(", ")}`,
    );
}

function findingsFrom(value: unknown): PlanFinding[] {
  if (!Array.isArray(value))
    throw new HarnessError("INVALID_ARGUMENT", "findings must be an array");
  return value.map((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new HarnessError("INVALID_ARGUMENT", `findings[${index}] must be an object`);
    const entry = raw as Record<string, unknown>;
    const id = requireText(entry.id, `findings[${index}].id`);
    const severity = entry.severity;
    if (severity !== "critical" && severity !== "important" && severity !== "minor")
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `findings[${index}].severity must be critical, important or minor`,
      );
    const observation = requireText(entry.observation, `findings[${index}].observation`);
    const remediation = requireText(entry.remediation, `findings[${index}].remediation`);
    const invariant =
      typeof entry.invariant === "string" && entry.invariant.trim() !== ""
        ? entry.invariant
        : undefined;
    return {
      id,
      severity,
      observation,
      remediation,
      ...(invariant === undefined ? {} : { invariant }),
    };
  });
}

export function recordPlanReview(
  port: TransactionPort,
  validatorId: string,
  value: unknown,
  clock: Clock = systemClock,
): WorkflowState {
  validatorId = requireText(validatorId, "validator_id");
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new HarnessError("INVALID_ARGUMENT", "plan review must be an object");
  const input = value as Record<string, unknown>;
  const token = requireText(input.validator_token, "validator_token");
  const summary = requireText(input.summary, "summary");
  if (input.status !== "approved" && input.status !== "changes_requested")
    throw new HarnessError("INVALID_ARGUMENT", "status must be approved or changes_requested");
  const decompositionAnswer = requireText(input.decomposition_answer, "decomposition_answer");
  const dependencyAnswer = requireText(input.dependency_answer, "dependency_answer");
  const gateAnswer = requireText(input.gate_answer, "gate_answer");
  const stragglerAnswer = requireText(input.straggler_answer, "straggler_answer");
  const graphRevision = input.graph_revision;
  if (!Number.isSafeInteger(graphRevision) || (graphRevision as number) < 1)
    throw new HarnessError("INVALID_ARGUMENT", "graph_revision must be a positive integer");
  const planDigest = requireText(input.plan_digest, "plan_digest");
  const packetId =
    typeof input.packet_id === "string" && input.packet_id.trim() !== ""
      ? input.packet_id
      : "direct";
  const packetSha = input.packet_sha256;
  if (
    packetSha !== undefined &&
    (typeof packetSha !== "string" || !/^[0-9a-f]{64}$/u.test(packetSha))
  )
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "packet_sha256 must be a sha256 digest when present",
    );
  const isApproved = input.status === "approved";
  if (isApproved && Array.isArray(input.findings) && input.findings.length > 0)
    throw new HarnessError("INVALID_ARGUMENT", "an approved review cannot carry findings");
  const findings = isApproved ? [] : findingsFrom(input.findings);
  if (!isApproved && findings.length === 0)
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "changes_requested requires at least one finding naming a defect in the plan",
    );
  const checkIds = optionalCommandIds(input.checks);
  const dependencyEdgesReviewed = dependencyEdgesReviewedFrom(input.dependency_edges_reviewed);
  const gateIdsReviewed = gateIdsReviewedFrom(input.gate_ids_reviewed);
  const now = clock.now();

  return port.transact(
    validatorId,
    "plan-reviewed",
    { packet_id: packetId, status: input.status, summary },
    (draft) => {
      const assignment = draft.plan_validation;
      if (
        !assignment ||
        assignment.validator_id !== validatorId ||
        (assignment.status !== "assigned" && assignment.status !== "packet_published") ||
        !tokenMatches(token, assignment.token_digest) ||
        Date.parse(assignment.deadline_at) <= now.valueOf()
      )
        throw new HarnessError("INVALID_STATE", "plan validator authentication is invalid");
      if (
        assignment.graph_revision !== graphRevision ||
        (draft.graph_revision ?? 1) !== graphRevision
      )
        throw new HarnessError(
          "INVALID_STATE",
          "graph revision has drifted since validation started",
        );
      const liveDigest = currentPlanDigest(draft);
      if (assignment.plan_digest !== planDigest || liveDigest !== planDigest)
        throw new HarnessError(
          "INVALID_STATE",
          "the compiled plan has changed since validation started",
        );
      const packet = draft.packets?.[packetId];
      if (packet) {
        if (packetSha === undefined)
          throw new HarnessError("INVALID_STATE", "plan review omits its published packet digest");
        if (
          packet.status !== "published" ||
          packet.role !== "plan-validator" ||
          packet.agent_id !== validatorId ||
          packet.task_id !== null ||
          packet.packet_sha256 !== packetSha ||
          packet.graph_revision !== graphRevision
        )
          throw new HarnessError(
            "INVALID_STATE",
            "plan review does not match its published packet",
          );
      }
      for (const id of checkIds) {
        const command = authoritativeRepositoryCommand(draft, id);
        if (!command || command.actor !== validatorId)
          throw new HarnessError("INVALID_STATE", `plan validator check is invalid: ${id}`);
      }
      assertDependencyEdgeCoverage(realDependencyEdges(draft), dependencyEdgesReviewed);
      assertGateCoverage(
        draft.gates.filter((gate) => gate.scope === "task").map((gate) => gate.id),
        gateIdsReviewed,
      );
      const review = {
        validator_id: validatorId,
        packet_id: packetId,
        ...(packetSha === undefined ? {} : { packet_sha256: packetSha }),
        graph_revision: graphRevision,
        plan_digest: planDigest,
        summary,
        status: input.status as "approved" | "changes_requested",
        decomposition_answer: decompositionAnswer,
        dependency_answer: dependencyAnswer,
        gate_answer: gateAnswer,
        straggler_answer: stragglerAnswer,
        findings,
        dependency_edges_reviewed: dependencyEdgesReviewed,
        gate_ids_reviewed: gateIdsReviewed,
        checks: checkIds.map((command_id) => ({ command_id })),
        reviewed_at: utc(now),
      };
      const recorded = { ...review, review_sha256: "" } as PlanReview;
      recorded.review_sha256 = jsonDigest(review);
      draft.plan_review = recorded;
      draft.plan_reviews ??= [];
      draft.plan_reviews.push(recorded);
      assignment.status = "reviewed";
      const historical = draft.plan_validation_history?.find(
        (entry) => entry.attempt === assignment.attempt && entry.validator_id === validatorId,
      );
      if (!historical)
        throw new HarnessError("INTEGRITY", "plan validation authorization history is missing");
      historical.status = "reviewed";
      historical.packet_id = packetId;
    },
  );
}
