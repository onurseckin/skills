import { evaluateHierarchyScaling } from "../../../../graph/parallel-decoupler.ts";
import { enrichTaskPlanWithExactAnchors } from "../planner/anti-batching.ts";
import { assertAntiBatchingRule } from "../planner/partitioning.ts";
import { readCognitiveMemory } from "../planner/memory.ts";
import { detectScopeOverlap } from "../planner/collisions.ts";
import { computeMacroMetrics } from "../planner/index.ts";
import type {
  SmartTaskPlan,
  SmartWavePlanResult,
  SmartTaskSynthesisResult,
} from "../planner/models.ts";
import { synthesizeSmartTasksFromFeedbackQueue } from "./evolution.ts";
import { updateCognitiveMemory } from "../../../memory/core/index.ts";
import {
  resolveCompletedTasksLedgerPath,
  recordCompletedTasksBatch,
} from "../../../archival/completed/index.ts";
import { updateOrPruneFeedbackItems } from "../../../feedback/queue/index.ts";
import { auditDefectLog } from "../../../defects/index.ts";
import {
  isTestEnvironment,
  resolveScratchDir,
  resolveCapsulesDir,
} from "../../../../core/shared/paths.ts";
import { enqueueTasksBatch, type NewTaskQueueInput } from "../../../../task/queue/index.ts";
import {
  sanitizeSlug,
  deriveWriteScopeForCategory,
  deriveGateForCategory,
} from "./orchestrator.ts";

export function synthesizeSmartTasksFromSelfEvolution(
  options: {
    readonly capsulesDir?: string | undefined;
    readonly queuePath?: string | undefined;
    readonly charterGoals?: readonly string[] | undefined;
    readonly maxTasks?: number | undefined;
    readonly autoEnqueue?: boolean | undefined;
    readonly cognitiveMemoryPath?: string | undefined;
  } = {},
): SmartTaskSynthesisResult {
  const maxTasks = options.maxTasks ?? 5;
  const targetRoots = options.capsulesDir
    ? [options.capsulesDir]
    : [isTestEnvironment() ? resolveScratchDir() : resolveCapsulesDir()];
  const defectAudit = auditDefectLog(targetRoots);
  const openDefects = defectAudit.defects.filter((b) => b.status === "open");

  const selfTasks: SmartTaskPlan[] = [];

  // 1. Open defect remediation
  if (openDefects.length > 0) {
    const defect = openDefects[0]!;
    const defectSlug = sanitizeSlug(defect.id);
    const defectScope = deriveWriteScopeForCategory("CORE_ENGINE", defect.id);
    const defectGate = deriveGateForCategory("CORE_ENGINE", defectScope);

    selfTasks.push({
      id: `task-1-defect-${defectSlug}`,
      label: `Automated Defect Remediation (${defect.category})`,
      write_scope: defectScope,
      gate: defectGate,
      charter_goals:
        options.charterGoals && options.charterGoals.length > 0
          ? [options.charterGoals[0]!]
          : ["G2"],
      acceptance_criteria: [
        `Remediate open defect ${defect.id}: ${(defect.observation ?? defect.description ?? "Observed defect").slice(0, 100)}`,
        `Pass gate: ${defectGate}`,
        "Verify regression immunity in unit test suite",
      ],
      dependencies: [],
      source_type: "defect_remediation",
      priority: "CRITICAL",
      rationale: `Autonomous remediation for open defect ${defect.id}: ${defect.observation ?? defect.description ?? "Defect remediation"}`,
      assigned_tier: "Tier_3_Implementer",
      assigned_implementer: `implementer-defect-${defectSlug}`,
      assigned_validator: `validator-defect-${defectSlug}`,
      candidate_id: defect.id,
      metadata: {
        candidate_id: defect.id,
        assigned_implementer: `implementer-defect-${defectSlug}`,
        assigned_validator: `validator-defect-${defectSlug}`,
      },
    });
  }

  // 2. Code Quality & Zero-Suppression Assurance
  const hardeningScope = [
    "olt/scripts/src/mind/smart-task-manager.ts",
    "olt/scripts/src/mind/task-queue.ts",
    "tests/unit/mind/smart-task-manager.test.ts",
    "tests/unit/mind/task-queue.test.ts",
  ];
  selfTasks.push({
    id: `task-${selfTasks.length + 1}-invariant-hardening`,
    label: "Continuous Invariant Hardening & Zero-Suppression Assurance",
    write_scope: hardeningScope,
    gate: "bun test tests/unit/mind && bun run typecheck",
    charter_goals:
      options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G1"],
    acceptance_criteria: [
      "0 TypeScript any across all modules",
      "0 compiler or linter suppressions",
      "All unit tests pass with exit code 0",
    ],
    dependencies: selfTasks
      .filter((prev) => detectScopeOverlap(hardeningScope, prev.write_scope).length > 0)
      .map((prev) => prev.id),
    source_type: "self_evolution",
    priority: "HIGH",
    rationale:
      "Continuous invariant hardening maintaining zero compiler suppressions and deterministic typed schemas.",
    assigned_tier: "Tier_3_Implementer",
    assigned_implementer: "implementer-invariant-hardening",
    assigned_validator: "validator-invariant-hardening",
    metadata: {
      assigned_implementer: "implementer-invariant-hardening",
      assigned_validator: "validator-invariant-hardening",
    },
  });

  // 3. Charter Gap Analysis & Cognitive Flavor Checks
  const charterGapScope = [
    "olt/agents/mind.yaml",
    "olt/scripts/src/mind/cognitive-flavor.ts",
    "tests/unit/mind/cognitive-flavor.test.ts",
  ];
  selfTasks.push({
    id: `task-${selfTasks.length + 1}-charter-gap-analysis`,
    label: "Charter Gap Analysis & Cognitive Flavor Posture Verification",
    write_scope: charterGapScope,
    gate: "bun test tests/unit/mind/cognitive-flavor.test.ts && bun run typecheck",
    charter_goals:
      options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G1"],
    acceptance_criteria: [
      "Perform cognitive flavor gap analysis across 4 tiers",
      "Ensure alignment with Mind Charter invariants and strategic altitude",
    ],
    dependencies: selfTasks
      .filter((prev) => detectScopeOverlap(charterGapScope, prev.write_scope).length > 0)
      .map((prev) => prev.id),
    source_type: "self_evolution",
    priority: "HIGH",
    rationale:
      "Autonomous charter gap analysis verifying cognitive flavor alignments and macro objectives.",
    assigned_tier: "Tier_2_Coordinator",
    assigned_implementer: "implementer-charter-gap",
    assigned_validator: "validator-charter-gap",
    metadata: {
      assigned_implementer: "implementer-charter-gap",
      assigned_validator: "validator-charter-gap",
    },
  });

  // 4. Historical Defect Regression & Brent's Theorem Work/Span (P = W/S) Optimization
  const brentOptimizationScope = [
    "olt/scripts/src/mind/strategic-purpose.ts",
    "tests/unit/mind/strategic-purpose.test.ts",
  ];
  selfTasks.push({
    id: `task-${selfTasks.length + 1}-brent-work-span-optimization`,
    label: "Macro DAG Work/Span (P = W/S) Optimization & Historical Defect Regression Immunity",
    write_scope: brentOptimizationScope,
    gate: "bun test tests/unit/mind/strategic-purpose.test.ts && bun run typecheck",
    charter_goals:
      options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G2"],
    acceptance_criteria: [
      "Optimize Work/Span parallelism P = W/S across topological DAG waves",
      "Verify historical defect regression immunity across test suites",
    ],
    dependencies: selfTasks
      .filter((prev) => detectScopeOverlap(brentOptimizationScope, prev.write_scope).length > 0)
      .map((prev) => prev.id),
    source_type: "self_evolution",
    priority: "MEDIUM",
    rationale:
      "Brent's theorem Work/Span (P = W/S) parallelism optimization preventing schedule bottlenecking.",
    assigned_tier: "Tier_1_Orchestrator",
    assigned_implementer: "implementer-brent-optimization",
    assigned_validator: "validator-brent-optimization",
    metadata: {
      assigned_implementer: "implementer-brent-optimization",
      assigned_validator: "validator-brent-optimization",
    },
  });

  // 5. Autonomic Continuous Optimization & Lean Architecture
  const autonomicOptScope = [
    "olt/scripts/src/mind/archival.ts",
    "olt/scripts/src/mind/recycler.ts",
    "tests/unit/mind/generational-archival.test.ts",
    "tests/unit/mind/recycler.test.ts",
  ];
  selfTasks.push({
    id: `task-${selfTasks.length + 1}-autonomic-optimization`,
    label: "Continuous Architecture & Lean Queue Maintenance",
    write_scope: autonomicOptScope,
    gate: "bun test tests/unit/mind && bun run typecheck",
    charter_goals:
      options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G3"],
    acceptance_criteria: [
      "Autonomic self-evolution cycle maintaining loop cadence and clean metrics",
      "Pass all mind unit tests cleanly",
    ],
    dependencies: selfTasks
      .filter((prev) => detectScopeOverlap(autonomicOptScope, prev.write_scope).length > 0)
      .map((prev) => prev.id),
    source_type: "self_evolution",
    priority: "MEDIUM",
    rationale:
      "Autonomic self-evolution cycle maintaining 0 any, 0 suppressions, and zero zombie task accumulation.",
    assigned_tier: "Tier_1_Orchestrator",
    assigned_implementer: "implementer-autonomic-optimization",
    assigned_validator: "validator-autonomic-optimization",
    metadata: {
      assigned_implementer: "implementer-autonomic-optimization",
      assigned_validator: "validator-autonomic-optimization",
    },
  });

  const enrichedSelfTasks = selfTasks.map((t) => enrichTaskPlanWithExactAnchors(t));
  const selectedSelfTasks = enrichedSelfTasks.slice(0, maxTasks);
  assertAntiBatchingRule(selectedSelfTasks);

  // Update persistent cognitive memory at .capsules/mind/memory.json
  try {
    updateCognitiveMemory(
      (curr) => ({
        ...curr,
        strategic_focus: [
          "Continuous Zero-Any & Zero-Suppression Assurance",
          "Charter Gap Analysis & Cognitive Flavor Checks",
          "Brent's Theorem Work/Span (P = W/S) Macro DAG Optimization",
          "Automated FIFO Pop & Clean-up Mechanics (Zero Zombie Accumulation)",
        ],
        active_hypotheses: [
          {
            id: "hyp-brent-parallelism",
            statement:
              "Disjoint write scope wave partitioning maximizes effective parallelism P = W/S without collision overhead.",
            confidence: 0.96,
            status: "active",
            evidence: [
              `Discovered ${selectedSelfTasks.length} self-evolution tasks across disjoint write scopes`,
            ],
            created_at: curr.last_updated,
            updated_at: new Date().toISOString(),
          },
        ],
        macro_metrics: computeMacroMetrics(selectedSelfTasks),
      }),
      options.cognitiveMemoryPath,
    );
  } catch {
    // Non-fatal cognitive memory persistence
  }

  let enqueuedCount = 0;
  if (options.autoEnqueue) {
    const batchInputs: NewTaskQueueInput[] = selectedSelfTasks.map((t) => ({
      id: t.id,
      title: t.label,
      description: t.rationale,
      priority: t.priority ?? "MEDIUM",
      write_scope: t.write_scope,
      gate: t.gate,
      charter_goals: t.charter_goals,
      acceptance_criteria: t.acceptance_criteria,
      dependencies: t.dependencies,
      source_type: t.source_type,
      assigned_tier: t.assigned_tier,
      assigned_role: t.assigned_role,
      metadata: t.metadata,
    }));
    const enqueued = enqueueTasksBatch(batchInputs, options.queuePath);
    enqueuedCount = enqueued.length;
  }

  const hierarchyScaling = evaluateHierarchyScaling({ taskCount: selectedSelfTasks.length });

  return {
    mode: "self_evolution",
    tasks: selectedSelfTasks,
    summary: `Autonomous self-evolution synthesized ${selectedSelfTasks.length} isolated task(s) on empty queue with 1:1 implementer-validator mapping.`,
    source_items_count: openDefects.length,
    anti_batching_enforced: true,
    hierarchy_scaling: hierarchyScaling,
    fast_path_compaction: hierarchyScaling.fastPath,
    ...(enqueuedCount > 0 ? { enqueued_count: enqueuedCount } : {}),
  };
}

/**
 * Autonomous Task Synthesizer implementing Dual-Intake:
 * - Mode A: Empty queue -> Autonomous Self-Evolution
 * - Mode B: Pending items -> Feedback / External Directive Expansion
 */
