import type { Finding } from "../../../core/contracts/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { isRecord } from "../../../requirements/predicates.ts";
import type { TaskRecord } from "../../../workflow/types.ts";
import type {
  CriticFindingDetail,
  ImplementerValidatorBinding,
  PairAssignmentStrategy,
} from "./critic-types.ts";

export function deriveCounterfactualRequirement(
  observation: string,
  remediation: string,
  explicitCounterfactual?: string,
): string {
  if (explicitCounterfactual && explicitCounterfactual.trim()) {
    return explicitCounterfactual.trim();
  }
  return `Counterfactual Requirement: Implementation must specifically resolve and prevent recurrence of: "${observation.trim()}". Concrete fix applied: "${remediation.trim()}".`;
}

export function normalizeCriticFinding(raw: unknown): CriticFindingDetail | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const requirement_id =
    typeof raw.requirement_id === "string"
      ? raw.requirement_id.trim()
      : typeof raw.req_id === "string"
        ? raw.req_id.trim()
        : "";
  const observation = typeof raw.observation === "string" ? raw.observation.trim() : "";
  const remediation = typeof raw.remediation === "string" ? raw.remediation.trim() : "";

  if (!id || !requirement_id || !observation || !remediation) {
    return null;
  }

  const rawSeverity = typeof raw.severity === "string" ? raw.severity.toLowerCase() : "important";
  const severity: "critical" | "important" | "minor" =
    rawSeverity === "critical" ? "critical" : rawSeverity === "minor" ? "minor" : "important";

  const counterfactual = deriveCounterfactualRequirement(
    observation,
    remediation,
    typeof raw.counterfactualRequirement === "string" ? raw.counterfactualRequirement : undefined,
  );

  const revalidation =
    typeof raw.revalidation === "string" && raw.revalidation.trim()
      ? raw.revalidation.trim()
      : typeof raw.gate === "string" && raw.gate.trim()
        ? raw.gate.trim()
        : `bun test tests/unit`;

  const affectedFilePaths: string[] = [];
  if (Array.isArray(raw.file_paths)) {
    for (const p of raw.file_paths) {
      if (typeof p === "string" && p.trim()) affectedFilePaths.push(p.trim());
    }
  } else if (Array.isArray(raw.affected_files)) {
    for (const p of raw.affected_files) {
      if (typeof p === "string" && p.trim()) affectedFilePaths.push(p.trim());
    }
  }

  const evidence: Record<string, unknown>[] = [];
  if (Array.isArray(raw.evidence)) {
    for (const e of raw.evidence) {
      if (isRecord(e)) evidence.push(e);
    }
  }

  return {
    id,
    requirement_id,
    severity,
    observation,
    counterfactualRequirement: counterfactual,
    evidence,
    remediation,
    revalidation,
    status: "open",
    affectedFilePaths,
  };
}

export function selectImplementerValidatorPair(
  task: TaskRecord,
  currentRound: number,
  strategy: PairAssignmentStrategy = "same_author",
  availableImplementers?: readonly string[] | undefined,
  availableValidators?: readonly string[] | undefined,
): ImplementerValidatorBinding {
  if (currentRound < 1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `currentRound must be positive, got ${currentRound}`,
    );
  }
  const originalImplementer =
    typeof task.original_implementer === "string" ? task.original_implementer : "implementer-1";
  const originalValidator = "validator-1";

  if (strategy === "same_author") {
    const foundValidator =
      availableValidators && availableValidators.length > 0
        ? availableValidators.find((v) => v !== originalImplementer)
        : undefined;
    const validatorId =
      foundValidator !== undefined
        ? foundValidator
        : originalValidator === originalImplementer
          ? "validator-independent"
          : originalValidator;

    return {
      implementerId:
        typeof task.repair_assignee === "string" ? task.repair_assignee : originalImplementer,
      validatorId,
      isReplacementPair: false,
    };
  }

  const implementerPool = availableImplementers ?? ["implementer-repair-lead", "implementer-alt"];
  const validatorPool = availableValidators ?? ["validator-senior", "validator-independent"];

  const foundImp = implementerPool.find(
    (imp) => imp !== originalImplementer && imp !== task.repair_assignee,
  );
  const replacementImplementer =
    foundImp !== undefined
      ? foundImp
      : implementerPool[0] !== undefined
        ? implementerPool[0]
        : "implementer-replacement";

  const foundVal = validatorPool.find(
    (v) => v !== replacementImplementer && v !== originalImplementer,
  );
  const replacementValidator =
    foundVal !== undefined
      ? foundVal
      : validatorPool[0] !== undefined
        ? validatorPool[0]
        : "validator-replacement";

  return {
    implementerId: replacementImplementer,
    validatorId: replacementValidator,
    isReplacementPair: true,
  };
}

export function detectDeterministicRepeat(
  priorFindings: readonly Finding[] | undefined,
  newFinding: CriticFindingDetail,
): boolean {
  if (!priorFindings || priorFindings.length === 0) return false;
  return priorFindings.some(
    (prior) =>
      prior.id === newFinding.id ||
      (prior.requirement_id === newFinding.requirement_id &&
        prior.observation.trim().toLowerCase() === newFinding.observation.trim().toLowerCase() &&
        prior.status === "open"),
  );
}

export function matchTasksForFinding(
  tasks: Record<string, TaskRecord>,
  finding: CriticFindingDetail,
): TaskRecord[] {
  const matched: TaskRecord[] = [];

  for (const task of Object.values(tasks)) {
    if (task.requirement_ids.includes(finding.requirement_id)) {
      matched.push(task);
    }
  }
  if (matched.length > 0) return matched;

  for (const task of Object.values(tasks)) {
    const hasPathMatch =
      finding.affectedFilePaths.some((p) => task.write_scope.includes(p)) ||
      task.write_scope.some(
        (scope) =>
          finding.observation.includes(scope) ||
          finding.remediation.includes(scope) ||
          finding.counterfactualRequirement.includes(scope),
      );
    if (hasPathMatch) {
      matched.push(task);
    }
  }
  if (matched.length > 0) return matched;

  const candidateTasks = Object.values(tasks).filter(
    (t) => t.status === "done" || t.status === "validated" || t.status === "changes_requested",
  );
  return candidateTasks.length > 0 ? [candidateTasks[0]!] : Object.values(tasks);
}
