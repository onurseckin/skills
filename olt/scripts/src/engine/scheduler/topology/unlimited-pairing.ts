import { applicableValidatorDomains, ValidatorDomain } from "../../../core/contracts";
import { HarnessError } from "../../../core/errors";
import { isRecord } from "../../store/layout/layout-json.ts";
import { ScheduledTask } from "../conflict/rank";
import { PairValidatorsOptions, ValidatorPairingRecord, UnboundedWavePartition, DepthMetrics, UnlimitedDepthSchedulerConfig, DepthInvariantValidationResult } from "./unlimited-types";
import { conflicting } from "./unlimited-utils";

export function pairValidatorsStrictly(
  tasks: readonly ScheduledTask[],
  options: PairValidatorsOptions = {},
): ValidatorPairingRecord[] {
  const strictness = options.pairingStrictness !== undefined ? options.pairingStrictness : "strict";
  const records: ValidatorPairingRecord[] = [];

  const getReqTexts = (taskId: string): readonly string[] => {
    if (!options.requirementTexts) return [];
    if (options.requirementTexts instanceof Map) {
      const texts = options.requirementTexts.get(taskId);
      return Array.isArray(texts) ? texts : [];
    }
    if (isRecord(options.requirementTexts)) {
      const val = options.requirementTexts[taskId];
      return Array.isArray(val) ? val : [];
    }
    return [];
  };

  const getImplementer = (taskId: string): string | null => {
    if (!options.assignedImplementers) return null;
    if (options.assignedImplementers instanceof Map) {
      const impl = options.assignedImplementers.get(taskId);
      return typeof impl === "string" ? impl : null;
    }
    if (isRecord(options.assignedImplementers)) {
      const val = options.assignedImplementers[taskId];
      return typeof val === "string" ? val : null;
    }
    return null;
  };

  for (const task of tasks) {
    const reqTexts = getReqTexts(task.id);
    const applicable = applicableValidatorDomains(task.write_scope, reqTexts);
    const assignedImplementer = getImplementer(task.id);

    let paired: ValidatorDomain[];
    if (strictness === "relaxed") {
      paired = applicable.length > 0 ? [applicable[0]!] : ["code-quality"];
    } else {
      paired = [...applicable];
    }

    const isPaired = applicable.length > 0 && paired.length === applicable.length;
    const reason = isPaired
      ? `Strictly paired ${paired.length} validator domain(s): ${paired.join(", ")}`
      : `Partial validator pairing (${paired.length}/${applicable.length} domains)`;

    records.push({
      taskId: task.id,
      assignedImplementer,
      applicableDomains: applicable,
      pairedValidatorDomains: paired,
      isPaired,
      pairingStrictness: strictness,
      reason,
    });
  }

  return records;
}
export function assertUnboundedConcurrencySafety(
  waves: readonly UnboundedWavePartition[],
  maxParallel?: number | null | undefined,
): void {
  for (const wave of waves) {
    if (
      maxParallel !== undefined &&
      maxParallel !== null &&
      Number.isFinite(maxParallel) &&
      maxParallel > 0 &&
      wave.taskIds.length > maxParallel
    ) {
      throw new HarnessError(
        "INVALID_STATE",
        `Wave ${wave.wave} task count ${wave.taskIds.length} exceeds max_parallel limit ${maxParallel}`,
      );
    }

    const taskCount = wave.tasks.length;
    for (let i = 0; i < taskCount; i++) {
      const left = wave.tasks[i]!;
      for (let j = i + 1; j < taskCount; j++) {
        const right = wave.tasks[j]!;
        if (conflicting(left, right)) {
          throw new HarnessError(
            "INVALID_STATE",
            `Concurrency safety violation in wave ${wave.wave}: tasks ${left.id} and ${right.id} conflict on write or resource scope`,
          );
        }
      }
    }
  }
}
export function validateDepthInvariants(
  metrics: DepthMetrics,
  config?: UnlimitedDepthSchedulerConfig | undefined,
): DepthInvariantValidationResult {
  const violations: string[] = [];

  if (metrics.maxWaveDepth < 0) {
    violations.push("maxWaveDepth must be non-negative");
  }

  if (metrics.criticalPathLength < 0) {
    violations.push("criticalPathLength must be non-negative");
  }

  if (metrics.totalTasks > 0 && metrics.maxWaveDepth === 0) {
    violations.push("maxWaveDepth must be > 0 when totalTasks > 0");
  }

  if (metrics.criticalPathLength > metrics.totalTasks) {
    violations.push("criticalPathLength cannot exceed totalTasks");
  }

  if (metrics.validatorPairingRate < 0 || metrics.validatorPairingRate > 1) {
    violations.push("validatorPairingRate must be between 0.0 and 1.0");
  }

  if (
    config?.require_strict_validator_pairing !== false &&
    metrics.totalTasks > 0 &&
    metrics.validatorPairingRate < 1.0
  ) {
    violations.push("strict validator pairing rate must be 1.0 (100% paired)");
  }

  if (metrics.totalTasks > 0 && !metrics.unboundedSafetyVerified) {
    violations.push("unbounded concurrency safety must be verified");
  }

  if (
    config?.max_depth !== undefined &&
    config.max_depth !== null &&
    Number.isFinite(config.max_depth) &&
    metrics.maxWaveDepth > config.max_depth
  ) {
    violations.push(
      `maxWaveDepth ${metrics.maxWaveDepth} exceeds configured max_depth ${config.max_depth}`,
    );
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
