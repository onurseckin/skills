import { HarnessError } from "../core/errors/harness-error.ts";
import type { Finding } from "../core/contracts/workflow.ts";
import type { FindingDetail } from "../workflow/scope-partitioner.ts";
import type { SmartTaskPlan } from "../mind/smart-task-manager.ts";
import {
  assertAntiBatchingRule,
  validateAntiBatchingIsolation,
  type AntiBatchingValidationReport,
} from "../mind/smart-task-manager.ts";
import { partitionDefectsToIsolatedTasks } from "./defect-synthesizer.ts";

export interface IsolatedDefectTask {
  readonly taskId: string;
  readonly findingId: string;
  readonly writeScope: readonly string[];
  readonly dedicatedImplementer: string;
  readonly independentValidator: string;
  readonly revalidationGate: string;
}

/**
 * Asserts that defect candidates are distinct and each holds a non-empty unique identifier.
 */
export function assertDefectCandidatesIsolated(
  findings: readonly (Finding | FindingDetail)[],
): void {
  const ids = new Set<string>();
  for (const f of findings) {
    if (!f.id || typeof f.id !== "string" || !f.id.trim()) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Each defect candidate must declare a non-empty unique id",
      );
    }
    if (ids.has(f.id.trim())) {
      throw new HarnessError("INVALID_ARGUMENT", `Duplicate defect candidate id: ${f.id}`);
    }
    ids.add(f.id.trim());
  }
}

/**
 * Asserts that the assigned implementer and validator are strictly distinct and non-empty.
 */
export function assertOneToOneImplementerValidatorIsolation(
  implementerId: string,
  validatorId: string,
  taskId: string,
): void {
  if (!implementerId || !implementerId.trim()) {
    throw new HarnessError("INVALID_STATE", `Task '${taskId}' has no assigned implementer`);
  }
  if (!validatorId || !validatorId.trim()) {
    throw new HarnessError("INVALID_STATE", `Task '${taskId}' has no assigned validator`);
  }
  if (implementerId.trim() === validatorId.trim()) {
    throw new HarnessError(
      "INVALID_STATE",
      `Anti-batching violation: task '${taskId}' assigned implementer '${implementerId}' cannot validate its own task`,
    );
  }
}

/**
 * Asserts that a sign-off covering multiple requirements or feedback items carries
 * individual discriminating test proofs per item.
 */
export function assertDiscriminatingSignOffProofs(
  taskId: string,
  requirementIds: readonly string[],
  checks: readonly { command_id: string }[],
): void {
  if (requirementIds.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", `Task '${taskId}' has no requirement IDs`);
  }
  if (checks.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Sign-off on task '${taskId}' must carry at least one check proof`,
    );
  }
  if (requirementIds.length > 1 && checks.length < requirementIds.length) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Anti-batching violation: task '${taskId}' covers ${requirementIds.length} requirements but only provides ${checks.length} check(s); individual discriminating test proofs required per item`,
    );
  }
}

export {
  assertAntiBatchingRule,
  validateAntiBatchingIsolation,
  partitionDefectsToIsolatedTasks,
  type AntiBatchingValidationReport,
};
