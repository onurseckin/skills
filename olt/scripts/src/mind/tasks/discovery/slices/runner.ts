import type {
  TaskDiscoveryOptions,
  TaskDiscoveryResult,
  DiscoveredTaskPlan,
  TaskQueueItem,
  NewTaskQueueInput,
} from "../types.ts";
import { performDiscoveryScans } from "./scans.ts";
import { proposeCandidateEvolutions } from "../scanners/index.ts";
import { synthesizeTaskFromDiscovery } from "./engine.ts";
import { enqueueTasksBatch } from "../../../../task/queue/index.ts";

export type { TaskQueueItem, NewTaskQueueInput };

export function discoverTasks(options: TaskDiscoveryOptions = {}): TaskDiscoveryResult {
  const scans = performDiscoveryScans(options);
  const {
    rawDiscoveries,
    openDefects,
    findings,
    existingTaskIds,
    existingTaskLabels,
    nowIso,
    maxTasks,
  } = scans;

  const candidateProposals = proposeCandidateEvolutions({
    codeQuality: findings.codeQuality,
    testCoverage: findings.testCoverage,
    cognitiveGaps: findings.cognitiveGaps,
    dormantCriteria: findings.dormantCriteria,
    architecturalHealth: findings.architecturalHealth,
    feedbackPending: findings.feedbackPending,
    openDefects,
  });

  const synthesizedPlans: DiscoveredTaskPlan[] = [];
  let planIndex = 1;

  for (const disc of rawDiscoveries) {
    if (synthesizedPlans.length >= maxTasks) break;
    const plan = synthesizeTaskFromDiscovery(disc, planIndex);
    const labelLower = plan.label.toLowerCase().trim();
    if (!existingTaskIds.has(plan.id) && !existingTaskLabels.has(labelLower)) {
      synthesizedPlans.push(plan);
      planIndex++;
    }
  }

  if (synthesizedPlans.length === 0) {
    const hardeningScope = [
      "olt/scripts/src/mind/tasks/discovery/runner.ts",
      "tests/unit/mind/task-discovery.test.ts",
    ];
    const fallbackPlan: DiscoveredTaskPlan = {
      id: `task-p49-discovery-hardening-${Date.now().toString().slice(-6)}`,
      label: "Perpetual Invariant Hardening & Zero-Suppression Assurance",
      write_scope: hardeningScope,
      gate: "bun test tests/unit/mind/task-discovery.test.ts && bun run typecheck",
      charter_goals: ["G1"],
      acceptance_criteria: [
        "Maintain 100% strict TypeScript types across mind engine",
        "0 compiler suppressions and strict invariant compliance",
        "All mind discovery unit tests pass cleanly",
      ],
      dependencies: [],
      source_type: "self_evolution",
      priority: "HIGH",
      rationale:
        "Autonomic perpetual self-evolution maintaining continuous invariant hardening and type safety.",
      assigned_tier: "Tier_3_Implementer",
      assigned_implementer: "implementer-p49-hardening",
      assigned_validator: "validator-p49-hardening",
      metadata: {
        discovery_category: "CONTINUOUS_HARDENING",
        assigned_implementer: "implementer-p49-hardening",
        assigned_validator: "validator-p49-hardening",
      },
    };
    synthesizedPlans.push(fallbackPlan);
  }

  let enqueuedTasks: readonly TaskQueueItem[] = [];
  if (options.autoEnqueue) {
    const batchInputs: NewTaskQueueInput[] = synthesizedPlans.map((p) => ({
      id: p.id,
      title: p.label,
      description: p.rationale,
      priority: p.priority,
      write_scope: p.write_scope,
      gate: p.gate,
      charter_goals: p.charter_goals,
      acceptance_criteria: p.acceptance_criteria,
      dependencies: p.dependencies,
      source_type: p.source_type,
      assigned_tier: p.assigned_tier,
      metadata: p.metadata,
    }));
    enqueuedTasks = enqueueTasksBatch(batchInputs, options.taskQueuePath);
  }

  const codeQualityCount = findings.codeQuality.length;
  const testCoverageCount = findings.testCoverage.length;
  const cognitiveGapCount = findings.cognitiveGaps.length;
  const dormantCriteriaCount = findings.dormantCriteria.length;
  const architecturalHealthCount = findings.architecturalHealth.length;
  const feedbackCount = findings.feedbackPending.length;
  const defectCount = openDefects.length;

  const totalFindings =
    codeQualityCount +
    testCoverageCount +
    cognitiveGapCount +
    dormantCriteriaCount +
    architecturalHealthCount +
    feedbackCount +
    defectCount;

  const summary = `Mind Task Discovery: identified ${totalFindings} finding(s) across code quality (${codeQualityCount}), test coverage (${testCoverageCount}), cognitive gaps (${cognitiveGapCount}), dormant criteria (${dormantCriteriaCount}), architectural health (${architecturalHealthCount}), feedback (${feedbackCount}), and defects (${defectCount}). Synthesized ${synthesizedPlans.length} actionable task(s).`;

  return {
    scannedAt: nowIso,
    findings,
    discoveries: rawDiscoveries,
    candidateProposals,
    synthesizedPlans,
    enqueuedTasks,
    stats: {
      totalFindings,
      codeQualityCount,
      testCoverageCount,
      cognitiveGapCount,
      dormantCriteriaCount,
      architecturalHealthCount,
      feedbackCount,
      defectCount,
      synthesizedCount: synthesizedPlans.length,
      enqueuedCount: enqueuedTasks.length,
    },
    summary,
  };
}
