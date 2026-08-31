import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluateHierarchyScaling } from "../../../../../graph/parallel-decoupler.ts";
import { enrichTaskPlanWithExactAnchors } from "../../planner/anti-batching.ts";
import { assertAntiBatchingRule } from "../../planner/partitioning.ts";
import { detectScopeOverlap } from "../../planner/collisions.ts";
import { computeMacroMetrics } from "../../planner/index.ts";
import type { SmartTaskPlan, SmartTaskSynthesisResult } from "../../planner/models.ts";
import { updateCognitiveMemory } from "../../../../memory/core/index.ts";
import { auditDefectLog } from "../../../../defects/index.ts";
import {
  findRepoRoot,
  isTestEnvironment,
  resolveScratchDir,
  resolveCapsulesDir,
} from "../../../../../core/shared/paths.ts";
import { enqueueTasksBatch, type NewTaskQueueInput } from "../../../../../task/queue/index.ts";
import {
  sanitizeSlug,
  deriveWriteScopeForCategory,
  deriveGateForCategory,
} from "../orchestrator.ts";

export interface DetectedRepositoryStructure {
  readonly repoRoot: string;
  readonly apps: readonly string[];
  readonly packages: readonly string[];
  readonly src: readonly string[];
  readonly tests: readonly string[];
  readonly docs: readonly string[];
  readonly planning: readonly string[];
  readonly hasApps: boolean;
  readonly hasPackages: boolean;
  readonly hasSrc: boolean;
  readonly hasTests: boolean;
  readonly hasDocs: boolean;
  readonly hasPlanning: boolean;
}

export function detectRepositoryStructure(customRoot?: string): DetectedRepositoryStructure {
  let root = customRoot ? resolve(customRoot) : undefined;
  if (!root || !existsSync(root)) {
    try {
      root = findRepoRoot();
    } catch {
      root = process.cwd();
    }
  }

  const listSubdirs = (relDir: string): string[] => {
    const full = join(root, relDir);
    if (!existsSync(full)) return [];
    try {
      return readdirSync(full, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith("."))
        .map((dirent) => `${relDir}/${dirent.name}`);
    } catch {
      return [];
    }
  };

  const hasDir = (relDir: string): boolean => existsSync(join(root, relDir));

  const appDirs = hasDir("apps")
    ? ["apps", ...listSubdirs("apps")]
    : hasDir("app")
      ? ["app", ...listSubdirs("app")]
      : [];

  const pkgDirs = hasDir("packages")
    ? ["packages", ...listSubdirs("packages")]
    : hasDir("pkg")
      ? ["pkg", ...listSubdirs("pkg")]
      : hasDir("modules")
        ? ["modules", ...listSubdirs("modules")]
        : [];

  const srcDirs = hasDir("src")
    ? ["src", ...listSubdirs("src")]
    : hasDir("lib")
      ? ["lib", ...listSubdirs("lib")]
      : hasDir("olt/scripts/src")
        ? ["olt/scripts/src"]
        : [];

  const testDirs = hasDir("tests")
    ? ["tests", ...listSubdirs("tests")]
    : hasDir("test")
      ? ["test", ...listSubdirs("test")]
      : hasDir("spec")
        ? ["spec", ...listSubdirs("spec")]
        : [];

  const docDirs = hasDir("docs")
    ? ["docs", ...listSubdirs("docs")]
    : hasDir("documentation")
      ? ["documentation"]
      : [];

  const planningDirs = hasDir("docs/planning")
    ? ["docs/planning"]
    : hasDir("planning")
      ? ["planning"]
      : [];

  return {
    repoRoot: root,
    apps: appDirs,
    packages: pkgDirs,
    src: srcDirs,
    tests: testDirs,
    docs: docDirs,
    planning: planningDirs,
    hasApps: appDirs.length > 0,
    hasPackages: pkgDirs.length > 0,
    hasSrc: srcDirs.length > 0,
    hasTests: testDirs.length > 0,
    hasDocs: docDirs.length > 0,
    hasPlanning: planningDirs.length > 0,
  };
}

export interface SynthesizeSelfEvolutionOptions {
  readonly repoRoot?: string | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly capsulesDir?: string | undefined;
  readonly queuePath?: string | undefined;
  readonly charterGoals?: readonly string[] | undefined;
  readonly maxTasks?: number | undefined;
  readonly autoEnqueue?: boolean | undefined;
  readonly cognitiveMemoryPath?: string | undefined;
}

export function synthesizeSmartTasksFromSelfEvolution(
  options: SynthesizeSelfEvolutionOptions = {},
): SmartTaskSynthesisResult {
  const maxTasks = options.maxTasks ?? 5;
  const targetRoots = options.capsulesDir
    ? [options.capsulesDir]
    : [isTestEnvironment() ? resolveScratchDir() : resolveCapsulesDir()];
  const defectAudit = auditDefectLog(targetRoots);
  const openDefects = defectAudit.defects.filter((b) => b.status === "open");

  const structure = detectRepositoryStructure(options.repoRoot ?? options.workspaceRoot);

  const selfTasks: SmartTaskPlan[] = [];

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

  // 3-Step Creative Product Manager Flow

  // Step 1: Baseline Quality & Invariant Hygiene (0 any, 0 suppressions, typecheck, lint)
  const testRoot = structure.hasTests ? `${structure.tests[0] ?? "tests"}/` : "tests/";
  const step1Scope = [testRoot];
  const step1Gate = structure.hasTests
    ? `bun test ${structure.tests[0]} && bun run typecheck`
    : "bun test tests/unit && bun run typecheck";

  selfTasks.push({
    id: `task-${selfTasks.length + 1}-invariant-hardening`,
    label: "Step 1: Baseline Quality & Invariant Hygiene Assurance (0 any, 0 suppressions)",
    write_scope: step1Scope,
    gate: step1Gate,
    charter_goals:
      options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G1"],
    acceptance_criteria: [
      "0 TypeScript any across all modules and test suites",
      "0 compiler or linter suppressions",
      "All unit tests pass with exit code 0 and typecheck verification succeeds",
    ],
    dependencies: selfTasks
      .filter((prev) => detectScopeOverlap(step1Scope, prev.write_scope).length > 0)
      .map((prev) => prev.id),
    source_type: "self_evolution",
    priority: "HIGH",
    rationale:
      "Step 1 Baseline Quality & Invariant Hygiene: Continuous invariant hardening enforcing zero compiler suppressions and deterministic typed schemas.",
    assigned_tier: "Tier_3_Implementer",
    assigned_implementer: "implementer-invariant-hardening",
    assigned_validator: "validator-invariant-hardening",
    metadata: {
      step: "step_1_baseline_quality",
      assigned_implementer: "implementer-invariant-hardening",
      assigned_validator: "validator-invariant-hardening",
    },
  });

  // Step 2: Product & UX Quality Audit (inspecting screens, responsive tiers, interaction feel, performance across apps/ and packages/)
  const step2Scope: string[] = [];
  if (structure.hasApps) {
    step2Scope.push(structure.apps[0] ? `${structure.apps[0]}/` : "apps/");
  } else if (structure.hasPackages) {
    step2Scope.push(structure.packages[0] ? `${structure.packages[0]}/` : "packages/");
  } else if (structure.hasSrc) {
    step2Scope.push(structure.src[0] ? `${structure.src[0]}/` : "src/");
  } else {
    step2Scope.push("apps/");
  }

  const step2Gate = structure.hasTests
    ? `bun test ${structure.tests[0]} && bun run typecheck`
    : "bun test && bun run typecheck";

  selfTasks.push({
    id: `task-${selfTasks.length + 1}-product-ux-quality-audit`,
    label:
      "Step 2: Product & UX Quality Audit (Screens, Responsive Tiers, Interaction Feel, Performance)",
    write_scope: step2Scope,
    gate: step2Gate,
    charter_goals:
      options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G2"],
    acceptance_criteria: [
      "Audit client screens, responsive layout tiers (mobile, tablet, desktop), and interaction feel",
      "Verify smooth state transitions, layout responsiveness, and performance invariants across client surfaces",
      "Catalog UI/UX polish improvements, interaction fluidity, and accessibility standards",
    ],
    dependencies: selfTasks
      .filter((prev) => detectScopeOverlap(step2Scope, prev.write_scope).length > 0)
      .map((prev) => prev.id),
    source_type: "self_evolution",
    priority: "HIGH",
    rationale:
      "Step 2 Product & UX Quality Audit: Autonomous inspection of screens, responsive tiers, interaction feel, and runtime performance across apps and packages.",
    assigned_tier: "Tier_2_Coordinator",
    assigned_implementer: "implementer-product-ux-audit",
    assigned_validator: "validator-product-ux-audit",
    metadata: {
      step: "step_2_product_ux_audit",
      assigned_implementer: "implementer-product-ux-audit",
      assigned_validator: "validator-product-ux-audit",
    },
  });

  // Step 3: Autonomous Creative Ideation (conceiving new features, authoring structured PLAN.md roadmaps in docs/planning/)
  const step3Scope = ["docs/planning/PLAN.md", "docs/planning/"];
  const step3Gate = structure.hasTests
    ? `bun test ${structure.tests[0]} && bun run typecheck`
    : "bun test && bun run typecheck";

  selfTasks.push({
    id: `task-${selfTasks.length + 1}-autonomous-creative-ideation`,
    label:
      "Step 3: Autonomous Creative Ideation & Feature Roadmap Authoring (docs/planning/PLAN.md)",
    write_scope: step3Scope,
    gate: step3Gate,
    charter_goals:
      options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G3"],
    acceptance_criteria: [
      "Conceive high-leverage product features, architectural evolutions, and user capability enhancements",
      "Author structured PLAN.md roadmap in docs/planning/ with architecture, milestones, and acceptance criteria",
      "Align creative ideation with charter goals and autonomous Product Manager directives",
    ],
    dependencies: selfTasks
      .filter((prev) => detectScopeOverlap(step3Scope, prev.write_scope).length > 0)
      .map((prev) => prev.id),
    source_type: "self_evolution",
    priority: "MEDIUM",
    rationale:
      "Step 3 Autonomous Creative Ideation: Conceive new high-leverage features and author structured roadmap PLAN.md in docs/planning/.",
    assigned_tier: "Tier_1_Orchestrator",
    assigned_implementer: "implementer-creative-ideation",
    assigned_validator: "validator-creative-ideation",
    metadata: {
      step: "step_3_creative_ideation",
      assigned_implementer: "implementer-creative-ideation",
      assigned_validator: "validator-creative-ideation",
    },
  });

  const enrichedSelfTasks = selfTasks.map((t) => enrichTaskPlanWithExactAnchors(t));
  const selectedSelfTasks = enrichedSelfTasks.slice(0, maxTasks);
  assertAntiBatchingRule(selectedSelfTasks);

  try {
    updateCognitiveMemory(
      (curr) => ({
        ...curr,
        strategic_focus: [
          "3-Step Creative Product Manager Flow (Hygiene, UX Audit, Creative Ideation)",
          "Step 1: Baseline Quality & Invariant Hygiene (0 any, 0 suppressions, strict typecheck)",
          "Step 2: Product & UX Quality Audit across Apps and Packages",
          "Step 3: Autonomous Creative Ideation & Feature Roadmaps in docs/planning/",
          "Continuous Atomic Admission-to-Dispatch Chaining (Zero Paused Admitted)",
        ],
        active_hypotheses: [
          {
            id: "hyp-creative-pm-flow",
            statement:
              "Autonomous 3-step creative cycle (invariant hygiene, UX audit, roadmap ideation) drives continuous product-market fit without regressions.",
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
  } catch {}

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
    summary: `Autonomous self-evolution synthesized ${selectedSelfTasks.length} isolated task(s) on empty queue with 1:1 implementer-validator mapping following the 3-step creative PM flow.`,
    source_items_count: openDefects.length,
    anti_batching_enforced: true,
    hierarchy_scaling: hierarchyScaling,
    fast_path_compaction: hierarchyScaling.fastPath,
    ...(enqueuedCount > 0 ? { enqueued_count: enqueuedCount } : {}),
  };
}
