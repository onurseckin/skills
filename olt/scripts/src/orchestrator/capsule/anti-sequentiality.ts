import { HarnessError } from "../../core/errors/index.ts";
import { MultiCapsuleDAG } from "./dag.ts";
import type { AntiSequentialityReport, AntiSequentialityViolation, CapsuleSpec } from "./types.ts";

export function hasScopeOverlap(scopeA: readonly string[], scopeB: readonly string[]): boolean {
  for (const pathA of scopeA) {
    const normA = pathA.trim().replace(/\/+$/, "");
    if (!normA) continue;
    for (const pathB of scopeB) {
      const normB = pathB.trim().replace(/\/+$/, "");
      if (!normB) continue;
      let isOverlap = false;
      if (normA === normB) isOverlap = true;
      if (normA.startsWith(`${normB}/`)) isOverlap = true;
      if (normB.startsWith(`${normA}/`)) isOverlap = true;
      if (isOverlap) {
        return true;
      }
    }
  }
  return false;
}

export function validateAntiSequentiality(
  specs: readonly CapsuleSpec[],
  options?:
    | {
        readonly maxParallelCapsules?: number | undefined;
        readonly allowScopeOverlapInIsolatedWorktrees?: boolean | undefined;
      }
    | undefined,
): AntiSequentialityReport {
  const violations: AntiSequentialityViolation[] = [];
  const diagnostics: string[] = [];

  if (specs.length === 0) {
    return {
      compliant: true,
      violations: [],
      parallelismRatio: 1.0,
      concurrencyFactor: 1.0,
      independentLanesCount: 0,
      criticalPathLength: 0,
      totalCapsules: 0,
      diagnostics: ["Empty capsule specification set."],
    };
  }

  const dag = new MultiCapsuleDAG(specs);
  const waves = dag.computeParallelWaves();
  const criticalPathLength = waves.length;
  const totalCapsules = specs.length;
  const maxParallel =
    options !== undefined && options.maxParallelCapsules !== undefined
      ? options.maxParallelCapsules
      : totalCapsules;
  const allowOverlapInWorktrees =
    options !== undefined && options.allowScopeOverlapInIsolatedWorktrees !== undefined
      ? options.allowScopeOverlapInIsolatedWorktrees
      : true;

  for (let w = 0; w < waves.length; w++) {
    const waveEntry = waves[w];
    const wave = waveEntry !== undefined ? waveEntry : [];
    for (let i = 0; i < wave.length; i++) {
      for (let j = i + 1; j < wave.length; j++) {
        const capA = wave[i];
        const capB = wave[j];
        if (!capA || !capB) continue;

        if (hasScopeOverlap(capA.writeScope, capB.writeScope)) {
          let bothHaveWorktrees = false;
          if (capA.worktreePath !== undefined && capA.worktreePath.trim().length > 0) {
            if (capB.worktreePath !== undefined && capB.worktreePath.trim().length > 0) {
              if (capA.worktreePath.trim() !== capB.worktreePath.trim()) {
                bothHaveWorktrees = true;
              }
            }
          }

          let isCollision = false;
          if (!bothHaveWorktrees) isCollision = true;
          else if (!allowOverlapInWorktrees) isCollision = true;

          if (isCollision) {
            violations.push({
              type: "SCOPE_COLLISION_WITHOUT_WORKTREE_ISOLATION",
              capsuleIds: [capA.id, capB.id],
              message: `Capsules '${capA.id}' and '${capB.id}' in Wave ${w} share mutable write scope but do not possess isolated worktrees.`,
              remedy:
                "Assign distinct write scopes or configure separate worktree paths for each capsule.",
            });
          }
        }
      }
    }
  }

  for (const spec of specs) {
    const deps = spec.dependencies !== undefined ? spec.dependencies : [];
    for (const depId of deps) {
      const depSpec = dag.getSpec(depId);
      if (depSpec) {
        const overlaps = hasScopeOverlap(spec.writeScope, depSpec.writeScope);
        if (!overlaps && spec.metadata?.["pure_parallel"] === true) {
          violations.push({
            type: "UNJUSTIFIED_DEPENDENCY",
            capsuleIds: [spec.id, depId],
            message: `Capsule '${spec.id}' declares dependency on '${depId}' despite pure parallel declaration and non-overlapping write scopes.`,
            remedy: "Remove unjustified dependency to allow concurrent parallel execution.",
          });
        }
      }
    }
  }

  const maxWaveBreadth = Math.max(...waves.map((wave) => wave.length));
  if (maxParallel === 1 && maxWaveBreadth > 1 && totalCapsules > 1) {
    violations.push({
      type: "CAPACITY_STARVATION_NEGLECT",
      capsuleIds: specs.map((s) => s.id),
      message: `Max concurrency is restricted to 1 despite ${maxWaveBreadth} independent parallel lanes available in DAG.`,
      remedy: `Increase maxParallelCapsules (e.g. to ${maxWaveBreadth}) to unlock parallel acceleration.`,
    });
  }

  const parallelismRatio = totalCapsules / Math.max(1, criticalPathLength);
  const concurrencyFactor = Math.min(maxParallel, maxWaveBreadth);
  const independentLanesCount = maxWaveBreadth;

  diagnostics.push(
    `Total Capsules: ${totalCapsules}`,
    `Critical Path Waves: ${criticalPathLength}`,
    `Max Wave Breadth: ${maxWaveBreadth}`,
    `Parallelism Speedup Ratio: ${parallelismRatio.toFixed(2)}x`,
    `Violations Detected: ${violations.length}`,
  );

  return {
    compliant: violations.length === 0,
    violations,
    parallelismRatio,
    concurrencyFactor,
    independentLanesCount,
    criticalPathLength,
    totalCapsules,
    diagnostics,
  };
}

export function assertAntiSequentiality(
  specs: readonly CapsuleSpec[],
  options?:
    | {
        readonly maxParallelCapsules?: number | undefined;
        readonly allowScopeOverlapInIsolatedWorktrees?: boolean | undefined;
      }
    | undefined,
): void {
  const report = validateAntiSequentiality(specs, options);
  if (!report.compliant) {
    const errorDetails = report.violations
      .map((v) => `[${v.type}] on (${v.capsuleIds.join(", ")}): ${v.message}`)
      .join("; ");
    throw new HarnessError("INVALID_STATE", `Anti-Sequentiality Engine Violation: ${errorDetails}`);
  }
}
