import { assertAntiBatchingRule } from "./partitioning.ts";
import { enrichTaskPlanWithExactAnchors } from "./anti-batching.ts";
import {
  sanitizeSlug,
  deriveWriteScopeForCategory,
  deriveGateForCategory,
} from "../executor/orchestrator.ts";
import type { SmartTaskPlan, ScopeCollision } from "./models.ts";
import type { TaskPriority } from "../../../../task/queue/index.ts";
export function partitionCandidatesStrictly(
  candidates: readonly {
    readonly id: string;
    readonly title?: string | undefined;
    readonly statement?: string | undefined;
    readonly category?: string | undefined;
    readonly write_scope?: readonly string[] | undefined;
    readonly gate?: string | undefined;
    readonly priority?: TaskPriority | undefined;
  }[],
  options: {
    readonly charterGoals?: readonly string[] | undefined;
    readonly baseIdPrefix?: string | undefined;
  } = {},
): readonly SmartTaskPlan[] {
  const prefix = options.baseIdPrefix ?? "candidate-task";
  const tasks: SmartTaskPlan[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]!;
    const slug = sanitizeSlug(cand.id);
    const label = cand.title ?? cand.statement ?? `Defect Candidate ${cand.id}`;
    const category = cand.category ?? "CORE_ENGINE";
    const scope =
      cand.write_scope && cand.write_scope.length > 0
        ? cand.write_scope
        : deriveWriteScopeForCategory(category, cand.id);
    const gate = cand.gate ?? deriveGateForCategory(category, scope);
    const taskId = `${prefix}-${i + 1}-${slug}`;

    const dependencies: string[] = [];
    for (const prev of tasks) {
      if (detectScopeOverlap(scope, prev.write_scope).length > 0) {
        dependencies.push(prev.id);
      }
    }

    const rawPlan: SmartTaskPlan = {
      id: taskId,
      label,
      write_scope: scope,
      gate,
      charter_goals:
        options.charterGoals && options.charterGoals.length > 0 ? options.charterGoals : ["G1"],
      acceptance_criteria: [
        `Strictly isolate and satisfy candidate: ${label}`,
        `Pass gate: ${gate}`,
        "Enforce 1:1 implementer-validator isolation",
      ],
      dependencies,
      source_type: "plan_enhancement",
      priority: cand.priority ?? "HIGH",
      rationale: `Partitioned 1:1 from defect candidate [${cand.id}]`,
      assigned_tier: "Tier_3_Implementer",
      assigned_implementer: `implementer-${slug}`,
      assigned_validator: `validator-${slug}`,
      candidate_id: cand.id,
      metadata: {
        candidate_id: cand.id,
        assigned_implementer: `implementer-${slug}`,
        assigned_validator: `validator-${slug}`,
      },
    };

    tasks.push(enrichTaskPlanWithExactAnchors(rawPlan));
  }

  assertAntiBatchingRule(tasks);
  return tasks;
}

/**
 * Normalizes a scope path for comparison (handling trailing slashes and relative prefixes).
 */
export function normalizeScopePath(path: string): string {
  let p = path.trim().replace(/^\.\//, "");
  while (p.endsWith("/") && p.length > 1) {
    p = p.slice(0, -1);
  }
  return p;
}

/**
 * Checks whether two individual write scope paths overlap or contain each other.
 */
export function pathsOverlap(p1: string, p2: string): boolean {
  const norm1 = normalizeScopePath(p1);
  const norm2 = normalizeScopePath(p2);

  if (norm1 === norm2) {
    return true;
  }

  if (norm1.startsWith(norm2 + "/") || norm2.startsWith(norm1 + "/")) {
    return true;
  }

  return false;
}

/**
 * Detects whether two sets of write scopes have any overlapping files or directories.
 * Returns the list of overlapping paths.
 */
export function detectScopeOverlap(
  scopeA: readonly string[],
  scopeB: readonly string[],
): readonly string[] {
  const overlaps: string[] = [];
  for (const a of scopeA) {
    for (const b of scopeB) {
      if (pathsOverlap(a, b)) {
        overlaps.push(a === b ? a : `${a} <-> ${b}`);
      }
    }
  }
  return overlaps;
}

/**
 * Calculates all scope collisions across a set of task plans.
 */
export function calculateScopeCollisions(
  plans: readonly SmartTaskPlan[],
): readonly ScopeCollision[] {
  const collisionMap = new Map<string, Set<string>>();

  for (let i = 0; i < plans.length; i++) {
    const planA = plans[i]!;
    for (const scopeA of planA.write_scope) {
      const normA = normalizeScopePath(scopeA);

      for (let j = 0; j < plans.length; j++) {
        const planB = plans[j]!;
        for (const scopeB of planB.write_scope) {
          if (pathsOverlap(normA, scopeB)) {
            const list = collisionMap.get(normA) ?? new Set<string>();
            list.add(planA.id);
            list.add(planB.id);
            collisionMap.set(normA, list);
          }
        }
      }
    }
  }

  const collisions: ScopeCollision[] = [];
  for (const [scope, taskSet] of collisionMap.entries()) {
    if (taskSet.size > 1) {
      collisions.push({
        scope,
        task_ids: Array.from(taskSet).sort(),
      });
    }
  }

  return collisions;
}

/**
 * Detects write scope collisions among a set of task plans (alias to calculateScopeCollisions).
 */
export function detectScopeCollisions(plans: readonly SmartTaskPlan[]): readonly ScopeCollision[] {
  return calculateScopeCollisions(plans);
}

/**
 * Computes Work ($W$), Critical Span ($S$), Concurrency Factor ($P = W / S$), and Efficiency ($E = P / \text{optimalLanes}$)
 * based on Brent's Theorem Work/Span metrics.
 */
