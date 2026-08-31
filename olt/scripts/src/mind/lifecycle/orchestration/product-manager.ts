/**
 * Mind Product Manager Autonomous Expansion & Anti-Stagnation Loop.
 * Governs Mode A (Creative Product Manager) autonomous expansion when queues are clear,
 * synthesizing grounded feature proposals, enforcing anti-stagnation invariants,
 * and maintaining non-zero progress.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  readTaskQueue,
  enqueueTasksBatch,
  type NewTaskQueueInput,
  type TaskQueueItem,
} from "../../../task/queue/index.ts";
import { readFeedbackQueue, resolveCanonicalFeedbackQueuePath } from "../../feedback/queue/index.ts";
import { auditDefectLog } from "../../defects/index.ts";
import {
  findRepoRoot,
  isTestEnvironment,
  resolveScratchDir,
  resolveCapsulesDir,
} from "../../../core/shared/paths.ts";
import {
  detectRepositoryStructure,
  type DetectedRepositoryStructure,
} from "../../tasks/smart/executor/evolution/self-evolution.ts";
import { enrichTaskPlanWithExactAnchors } from "../../tasks/smart/planner/anti-batching.ts";
import { assertAntiBatchingRule } from "../../tasks/smart/planner/partitioning.ts";
import { computeMacroMetrics } from "../../tasks/smart/planner/index.ts";
import type { SmartTaskPlan } from "../../tasks/smart/planner/models.ts";
import { stageTasksForMultiOrchestratorExecution } from "../../tasks/smart/executor/invariants.ts";
import { evaluateAntiStagnation, recordNonZeroProgress } from "./anti-stagnation.ts";
import type {
  GroundedFeatureProposal,
  MindExecutionMode,
  MindProductManagerOptions,
  ProductManagerEvaluationResult,
  ProductManagerExpansionResult,
} from "./types.ts";

function resolveFeedbackFile(options: MindProductManagerOptions): string | undefined {
  if (options.feedbackQueuePath && existsSync(options.feedbackQueuePath)) {
    return options.feedbackQueuePath;
  }
  if (options.repoRoot) {
    const candidate = join(options.repoRoot, ".olt", "backlog.jsonl");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function evaluateMindMode(
  options: MindProductManagerOptions = {},
): ProductManagerEvaluationResult {
  const queue = readTaskQueue(options.queuePath);
  const activeTasks = queue.filter(
    (t) =>
      t.status === "PENDING" ||
      t.status === "ADMITTED" ||
      t.status === "IN_PROGRESS" ||
      t.status === "RUNNING" ||
      t.status === "VALIDATING",
  );

  const fbFile = resolveFeedbackFile(options);
  const feedbacks = readFeedbackQueue(fbFile);
  const pendingFeedbacks = feedbacks.filter((f) => f.status === "PENDING");

  const targetRoots = options.capsulesDir
    ? [options.capsulesDir]
    : [isTestEnvironment() ? resolveScratchDir() : resolveCapsulesDir()];
  const defectAudit = auditDefectLog(targetRoots);
  const openDefects = defectAudit.defects.filter((d) => d.status === "open");

  let mode: MindExecutionMode;
  let reason: string;
  let recommendedAction: string;
  let nextCommand: string;

  if (activeTasks.length > 0) {
    mode = "QUEUE_ACTIVE_EXECUTION";
    reason = `Queue has ${activeTasks.length} active task(s) currently in progress or awaiting validation.`;
    recommendedAction = "SUPERVISE_ACTIVE_WAVES";
    nextCommand = "bun harness.ts queue:wave";
  } else if (pendingFeedbacks.length > 0) {
    mode = "MODE_B_EXTERNAL_INTAKE";
    reason = `Found ${pendingFeedbacks.length} pending feedback item(s) awaiting intake and triage.`;
    recommendedAction = "PROCESS_FEEDBACK_INTAKE";
    nextCommand = "bun harness.ts mind:self-evolve";
  } else {
    mode = "MODE_A_CREATIVE_PRODUCT_MANAGER";
    reason =
      "Task queue and feedback intake are clear or fully converged. Engaging Mode A Creative Product Manager for autonomous expansion and roadmap evolution.";
    recommendedAction = "EXECUTE_AUTONOMOUS_PRODUCT_EXPANSION";
    nextCommand = "bun harness.ts mind:self-evolve";
  }

  const antiStagnationState = evaluateAntiStagnation(
    {
      synthesizedCount: 0,
      enqueuedCount: 0,
      openDefectsCount: openDefects.length,
      feedbackCount: pendingFeedbacks.length,
    },
    {
      memoryPath: options.memoryPath,
      now: options.now,
    },
  );

  return {
    mode,
    reason,
    queueCount: queue.length,
    feedbackCount: pendingFeedbacks.length,
    openDefectsCount: openDefects.length,
    activeTasksCount: activeTasks.length,
    antiStagnationState,
    recommendedAction,
    nextCommand,
  };
}

export function discoverGroundedFeatures(
  structure: DetectedRepositoryStructure,
  charterGoals?: readonly string[] | undefined,
  maxProposals = 5,
): readonly GroundedFeatureProposal[] {
  const proposals: GroundedFeatureProposal[] = [];
  const goals = charterGoals && charterGoals.length > 0 ? charterGoals : ["G1", "G2", "G3"];

  // Step 1: Baseline Quality & Invariant Hygiene
  const testDir = structure.hasTests ? `${structure.tests[0] ?? "tests"}/` : "tests/";
  proposals.push({
    id: "prop-step-1-invariant-hygiene",
    title: "Baseline Quality & Invariant Hygiene Assurance",
    statement:
      "Enforce 0 any, 0 compiler suppressions (@ts-ignore, @ts-expect-error, eslint-disable), and 100% strict TypeScript types across all source and test modules.",
    charterGoals: [goals[0] ?? "G1"],
    writeScope: [testDir],
    gate: structure.hasTests
      ? `bun test ${structure.tests[0]} && bun run typecheck`
      : "bun test tests/unit && bun run typecheck",
    acceptanceCriteria: [
      "0 TypeScript any annotations across all files",
      "0 linter or compiler suppressions",
      "All unit test suites pass cleanly with exit code 0",
    ],
    priority: "HIGH",
    rationale:
      "Step 1 Baseline Quality: Continuous type soundness and regression immunity under charter goal G1.",
    step: "step_1_baseline_quality",
    estimatedEffort: 3,
    dependencies: [],
  });

  // Step 2: Product & UX Quality Audit
  const clientScope: string[] = [];
  if (structure.hasApps) {
    clientScope.push(structure.apps[0] ? `${structure.apps[0]}/` : "apps/");
  } else if (structure.hasPackages) {
    clientScope.push(structure.packages[0] ? `${structure.packages[0]}/` : "packages/");
  } else if (structure.hasSrc) {
    clientScope.push(structure.src[0] ? `${structure.src[0]}/` : "src/");
  } else {
    clientScope.push("apps/");
  }

  proposals.push({
    id: "prop-step-2-product-ux-perfection",
    title: "Product & UX Quality Perfection across Multi-Tier Viewports",
    statement:
      "Inspect screens, responsive tiers (desktop, tablet, mobile), optical rhythm, APCA contrast ratios, and runtime interaction latency.",
    charterGoals: [goals[1] ?? "G2"],
    writeScope: clientScope,
    gate: structure.hasTests
      ? `bun test ${structure.tests[0]} && bun run typecheck`
      : "bun test && bun run typecheck",
    acceptanceCriteria: [
      "Audit responsive layout balance and optical spacing across client surfaces",
      "Verify APCA lightness contrast (Lc >= 60) and ergonomic touch targets (>= 44x44px)",
      "Catalog UI/UX polish improvements and interaction smoothness",
    ],
    priority: "HIGH",
    rationale:
      "Step 2 Product & UX Quality: Multi-viewport visual verification and interface ergonomics under charter goal G2.",
    step: "step_2_product_ux_audit",
    estimatedEffort: 3,
    dependencies: ["prop-step-1-invariant-hygiene"],
  });

  // Step 3: Autonomous Creative Ideation
  proposals.push({
    id: "prop-step-3-creative-roadmap-ideation",
    title: "Autonomous Creative Ideation & Feature Roadmap Authoring",
    statement:
      "Conceive high-leverage forward-looking features, radical first-principles simplifications, and author structured PLAN.md roadmaps in docs/planning/.",
    charterGoals: [goals[2] ?? "G3"],
    writeScope: ["docs/planning/PLAN.md", "docs/planning/"],
    gate: structure.hasTests
      ? `bun test ${structure.tests[0]} && bun run typecheck`
      : "bun test && bun run typecheck",
    acceptanceCriteria: [
      "Conceive ambitious product features and toolchain expansions from first principles",
      "Author structured PLAN.md roadmap in docs/planning/ with architecture, milestones, and gates",
      "Align feature proposals with strategic charter goals without idle standby",
    ],
    priority: "MEDIUM",
    rationale:
      "Step 3 Autonomous Creative Ideation: First-principles product manager innovation under charter goal G3.",
    step: "step_3_creative_ideation",
    estimatedEffort: 3,
    dependencies: ["prop-step-2-product-ux-perfection"],
  });

  return proposals.slice(0, maxProposals);
}

export function runMindProductManagerLoop(
  options: MindProductManagerOptions = {},
): ProductManagerExpansionResult {
  const structure = detectRepositoryStructure(options.repoRoot ?? options.workspaceRoot);
  const maxProposals = options.maxProposals ?? 5;
  const proposals = discoverGroundedFeatures(structure, options.charterGoals, maxProposals);

  const synthesizedTasks: SmartTaskPlan[] = proposals.map((prop, idx) => {
    const taskPlan: SmartTaskPlan = {
      id: `task-${idx + 1}-${prop.id.replace(/^prop-/, "")}`,
      label: `${prop.title} (${prop.step})`,
      write_scope: [...prop.writeScope],
      gate: prop.gate,
      charter_goals: [...prop.charterGoals],
      acceptance_criteria: [...prop.acceptanceCriteria],
      dependencies: idx > 0 ? [`task-${idx}-${proposals[idx - 1]!.id.replace(/^prop-/, "")}`] : [],
      source_type: "self_evolution",
      priority: prop.priority,
      rationale: prop.rationale,
      assigned_tier:
        prop.step === "step_1_baseline_quality"
          ? "Tier_3_Implementer"
          : prop.step === "step_2_product_ux_audit"
            ? "Tier_2_Coordinator"
            : "Tier_1_Orchestrator",
      assigned_implementer: `implementer-${prop.id.replace(/^prop-/, "")}`,
      assigned_validator: `validator-${prop.id.replace(/^prop-/, "")}`,
      metadata: {
        step: prop.step,
        feature_id: prop.id,
        statement: prop.statement,
        assigned_implementer: `implementer-${prop.id.replace(/^prop-/, "")}`,
        assigned_validator: `validator-${prop.id.replace(/^prop-/, "")}`,
      },
    };
    return enrichTaskPlanWithExactAnchors(taskPlan);
  });

  assertAntiBatchingRule(synthesizedTasks);

  let stagedTasks: readonly SmartTaskPlan[] = synthesizedTasks;
  let multiOrchPlan = undefined;
  if (
    (options.orchestratorCount && options.orchestratorCount > 1) ||
    (options.orchestratorIds && options.orchestratorIds.length > 0)
  ) {
    const staged = stageTasksForMultiOrchestratorExecution(synthesizedTasks, {
      orchestratorIds: options.orchestratorIds,
      maxOrchestrators: options.orchestratorCount,
    });
    stagedTasks = staged.staged_tasks;
    multiOrchPlan = staged.plan;
  }

  let enqueuedTasks: readonly TaskQueueItem[] = [];
  if (options.autoEnqueue !== false) {
    const batchInputs: NewTaskQueueInput[] = stagedTasks.map((t) => ({
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
    enqueuedTasks = enqueueTasksBatch(batchInputs, options.queuePath);
  }

  const antiStagnationState = evaluateAntiStagnation(
    {
      synthesizedCount: stagedTasks.length,
      enqueuedCount: enqueuedTasks.length,
      openDefectsCount: 0,
      feedbackCount: 0,
    },
    {
      memoryPath: options.memoryPath,
      now: options.now,
    },
  );

  const summary = `Mode A Creative Product Manager synthesized ${stagedTasks.length} grounded feature task(s) following the 3-step evolutionary flow with 0 idle stagnation.`;

  recordNonZeroProgress(summary, antiStagnationState, {
    memoryPath: options.memoryPath,
    charterGoals: options.charterGoals,
  });

  const macroMetrics = multiOrchPlan
    ? multiOrchPlan.macro_metrics
    : computeMacroMetrics(stagedTasks);

  return {
    mode: "MODE_A_CREATIVE_PRODUCT_MANAGER",
    proposals,
    synthesizedTasks: stagedTasks,
    enqueuedTasks,
    antiStagnationState,
    cognitiveProgressLogged: true,
    summary,
    macroMetrics: {
      work: macroMetrics.work,
      span: macroMetrics.span,
      idealConcurrency: macroMetrics.parallelism,
    },
  };
}
