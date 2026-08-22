import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";
import type { JsonObject, JsonValue } from "../contracts/json.ts";

export type CapsuleExecutionStatus =
  | "pending"
  | "ready"
  | "running"
  | "converged"
  | "failed"
  | "blocked"
  | "cancelled";

export type AntiSequentialityViolationType =
  | "ARTIFICIAL_SEQUENTIAL_BOTTLENECK"
  | "UNJUSTIFIED_DEPENDENCY"
  | "SCOPE_COLLISION_WITHOUT_WORKTREE_ISOLATION"
  | "CAPACITY_STARVATION_NEGLECT"
  | "BATCHED_MONOLITH_VIOLATION";

export interface AntiSequentialityViolation {
  readonly type: AntiSequentialityViolationType;
  readonly capsuleIds: readonly string[];
  readonly message: string;
  readonly remedy: string;
}

export interface AntiSequentialityReport {
  readonly compliant: boolean;
  readonly violations: readonly AntiSequentialityViolation[];
  readonly parallelismRatio: number;
  readonly concurrencyFactor: number;
  readonly independentLanesCount: number;
  readonly criticalPathLength: number;
  readonly totalCapsules: number;
  readonly diagnostics: readonly string[];
}

export interface CapsuleSpec {
  readonly id: string;
  readonly repoPath: string;
  readonly capsulePath?: string | undefined;
  readonly writeScope: readonly string[];
  readonly dependencies?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly prompt?: string | undefined;
  readonly worktreePath?: string | undefined;
  readonly metadata?: Readonly<Record<string, JsonValue>> | undefined;
}

export interface CapsuleExecutionResult {
  readonly capsuleId: string;
  readonly status: CapsuleExecutionStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly gatePassed?: boolean | undefined;
  readonly findingsCount?: number | undefined;
  readonly summary?: string | undefined;
  readonly error?: string | undefined;
}

export interface CapsuleExecutionInput {
  readonly spec: CapsuleSpec;
  readonly signal: AbortSignal;
}

export interface CapsuleExecutor {
  executeCapsule(input: CapsuleExecutionInput): Promise<CapsuleExecutionResult>;
}

export interface CapsuleStateChangeEvent {
  readonly capsuleId: string;
  readonly previousStatus: CapsuleExecutionStatus;
  readonly newStatus: CapsuleExecutionStatus;
  readonly timestamp: string;
  readonly reason?: string | undefined;
  readonly error?: string | undefined;
}

export interface MultiCapsuleOrchestratorOptions {
  readonly maxParallelCapsules?: number | undefined;
  readonly strictAntiSequentiality?: boolean | undefined;
  readonly allowScopeOverlapInIsolatedWorktrees?: boolean | undefined;
  readonly executor?: CapsuleExecutor | undefined;
  readonly outputDir?: string | undefined;
  readonly actor?: string | undefined;
  readonly onCapsuleStateChange?: ((event: CapsuleStateChangeEvent) => void) | undefined;
  readonly onAntiSequentialityViolation?: ((violation: AntiSequentialityViolation) => void) | undefined;
}

export interface MultiCapsuleSummary extends JsonObject {
  totalCapsules: number;
  convergedCount: number;
  failedCount: number;
  blockedCount: number;
  cancelledCount: number;
  overallStatus: "converged" | "failed" | "partial" | "cancelled";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  concurrencyLimit: number;
  independentWavesCount: number;
  results: Record<string, CapsuleExecutionResult>;
  antiSequentialityReport: AntiSequentialityReport;
  markdownSummary: string;
}

/**
 * Validates scope overlap between two lists of paths/globs.
 * Returns true if there is any shared path or prefix.
 */
export function hasScopeOverlap(scopeA: readonly string[], scopeB: readonly string[]): boolean {
  for (const pathA of scopeA) {
    const normA = pathA.trim().replace(/\/+$/, "");
    if (!normA) continue;
    for (const pathB of scopeB) {
      const normB = pathB.trim().replace(/\/+$/, "");
      if (!normB) continue;
      if (normA === normB || normA.startsWith(`${normB}/`) || normB.startsWith(`${normA}/`)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Dependency Graph & Wave Partitioning for Multi-Capsule Execution.
 */
export class MultiCapsuleDAG {
  private readonly specsMap: Map<string, CapsuleSpec> = new Map();
  private readonly adjacency: Map<string, Set<string>> = new Map(); // id -> dependent IDs
  private readonly reverseAdjacency: Map<string, Set<string>> = new Map(); // id -> prerequisite IDs

  public constructor(specs: readonly CapsuleSpec[]) {
    if (specs.length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "At least one capsule specification is required");
    }

    for (const spec of specs) {
      if (!spec.id || !spec.id.trim()) {
        throw new HarnessError("INVALID_ARGUMENT", "Capsule spec must contain a non-empty id");
      }
      if (this.specsMap.has(spec.id)) {
        throw new HarnessError("INVALID_ARGUMENT", `Duplicate capsule id: ${spec.id}`);
      }
      this.specsMap.set(spec.id, spec);
      this.adjacency.set(spec.id, new Set());
      this.reverseAdjacency.set(spec.id, new Set());
    }

    for (const spec of specs) {
      const deps = spec.dependencies ?? [];
      for (const depId of deps) {
        if (!this.specsMap.has(depId)) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `Capsule '${spec.id}' references undeclared dependency '${depId}'`,
          );
        }
        if (depId === spec.id) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `Capsule '${spec.id}' cannot depend on itself`,
          );
        }
        const adj = this.adjacency.get(depId);
        if (adj) adj.add(spec.id);
        const rev = this.reverseAdjacency.get(spec.id);
        if (rev) rev.add(depId);
      }
    }

    this.assertAcyclic();
  }

  public getSpecs(): readonly CapsuleSpec[] {
    return Array.from(this.specsMap.values());
  }

  public getSpec(id: string): CapsuleSpec | undefined {
    return this.specsMap.get(id);
  }

  public getDependencies(id: string): readonly string[] {
    const deps = this.reverseAdjacency.get(id);
    return deps ? Array.from(deps) : [];
  }

  public getDependents(id: string): readonly string[] {
    const dependents = this.adjacency.get(id);
    return dependents ? Array.from(dependents) : [];
  }

  private assertAcyclic(): void {
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const dfs = (node: string, path: readonly string[]): void => {
      visiting.add(node);
      const nextNodes = this.adjacency.get(node) ?? new Set();
      for (const next of nextNodes) {
        if (visiting.has(next)) {
          const cycle = [...path, next].join(" -> ");
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `Circular dependency detected in multi-capsule DAG: ${cycle}`,
          );
        }
        if (!visited.has(next)) {
          dfs(next, [...path, next]);
        }
      }
      visiting.delete(node);
      visited.add(node);
    };

    for (const id of this.specsMap.keys()) {
      if (!visited.has(id)) {
        dfs(id, [id]);
      }
    }
  }

  /**
   * Computes independent parallel waves of execution.
   * Wave 0 contains capsules with no dependencies.
   * Wave k contains capsules whose dependencies are in waves < k.
   */
  public computeParallelWaves(): readonly (readonly CapsuleSpec[])[] {
    const waves: CapsuleSpec[][] = [];
    const assigned = new Map<string, number>();

    const getWaveLevel = (id: string, visited: Set<string>): number => {
      if (assigned.has(id)) return assigned.get(id) ?? 0;
      const deps = this.reverseAdjacency.get(id) ?? new Set();
      if (deps.size === 0) {
        assigned.set(id, 0);
        return 0;
      }
      let maxDepWave = -1;
      for (const dep of deps) {
        if (!visited.has(dep)) {
          visited.add(dep);
          const depLevel = getWaveLevel(dep, visited);
          if (depLevel > maxDepWave) maxDepWave = depLevel;
        }
      }
      const level = maxDepWave + 1;
      assigned.set(id, level);
      return level;
    };

    for (const id of this.specsMap.keys()) {
      getWaveLevel(id, new Set([id]));
    }

    for (const [id, level] of assigned.entries()) {
      while (waves.length <= level) {
        waves.push([]);
      }
      const spec = this.specsMap.get(id);
      if (spec) {
        const targetWave = waves[level];
        if (targetWave) targetWave.push(spec);
      }
    }

    // Sort capsules in each wave by priority descending
    for (const wave of waves) {
      wave.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }

    return waves;
  }

  public getCriticalPathLength(): number {
    return this.computeParallelWaves().length;
  }
}

/**
 * Analyzes multi-capsule configurations and plans for Anti-Sequentiality violations.
 */
export function validateAntiSequentiality(
  specs: readonly CapsuleSpec[],
  options?: {
    readonly maxParallelCapsules?: number | undefined;
    readonly allowScopeOverlapInIsolatedWorktrees?: boolean | undefined;
  } | undefined,
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
  const maxParallel = options?.maxParallelCapsules ?? totalCapsules;
  const allowOverlapInWorktrees = options?.allowScopeOverlapInIsolatedWorktrees ?? true;

  // 1. Check for Scope Collisions in the same wave (parallel candidates)
  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w] ?? [];
    for (let i = 0; i < wave.length; i++) {
      for (let j = i + 1; j < wave.length; j++) {
        const capA = wave[i];
        const capB = wave[j];
        if (!capA || !capB) continue;

        if (hasScopeOverlap(capA.writeScope, capB.writeScope)) {
          const bothHaveWorktrees =
            Boolean(capA.worktreePath?.trim()) &&
            Boolean(capB.worktreePath?.trim()) &&
            capA.worktreePath?.trim() !== capB.worktreePath?.trim();

          if (!bothHaveWorktrees || !allowOverlapInWorktrees) {
            violations.push({
              type: "SCOPE_COLLISION_WITHOUT_WORKTREE_ISOLATION",
              capsuleIds: [capA.id, capB.id],
              message: `Capsules '${capA.id}' and '${capB.id}' in Wave ${w} share mutable write scope but do not possess isolated worktrees.`,
              remedy: `Assign distinct write scopes or configure separate worktree paths for each capsule.`,
            });
          }
        }
      }
    }
  }

  // 2. Check for Artificial Sequential Bottlenecks (unjustified dependencies)
  for (const spec of specs) {
    const deps = spec.dependencies ?? [];
    for (const depId of deps) {
      const depSpec = dag.getSpec(depId);
      if (depSpec) {
        // If scopes do not overlap and there's no logical reason, flag if suspected false dependency
        const overlaps = hasScopeOverlap(spec.writeScope, depSpec.writeScope);
        if (!overlaps && spec.metadata?.["pure_parallel"] === true) {
          violations.push({
            type: "UNJUSTIFIED_DEPENDENCY",
            capsuleIds: [spec.id, depId],
            message: `Capsule '${spec.id}' declares dependency on '${depId}' despite pure parallel declaration and non-overlapping write scopes.`,
            remedy: `Remove unjustified dependency to allow concurrent parallel execution.`,
          });
        }
      }
    }
  }

  // 3. Check for Capacity Starvation Neglect (concurrency configured to 1 when multiple independent lanes exist)
  const maxWaveBreadth = Math.max(...waves.map((wave) => wave.length));
  if (maxParallel === 1 && maxWaveBreadth > 1 && totalCapsules > 1) {
    violations.push({
      type: "CAPACITY_STARVATION_NEGLECT",
      capsuleIds: specs.map((s) => s.id),
      message: `Max concurrency is restricted to 1 despite ${maxWaveBreadth} independent parallel lanes available in DAG.`,
      remedy: `Increase maxParallelCapsules (e.g. to ${maxWaveBreadth}) to unlock parallel acceleration.`,
    });
  }

  // Calculate Amdahl parallelism metrics
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

/**
 * Asserts that the capsule set strictly passes Anti-Sequentiality validation.
 */
export function assertAntiSequentiality(
  specs: readonly CapsuleSpec[],
  options?: {
    readonly maxParallelCapsules?: number | undefined;
    readonly allowScopeOverlapInIsolatedWorktrees?: boolean | undefined;
  } | undefined,
): void {
  const report = validateAntiSequentiality(specs, options);
  if (!report.compliant) {
    const errorDetails = report.violations
      .map((v) => `[${v.type}] on (${v.capsuleIds.join(", ")}): ${v.message}`)
      .join("; ");
    throw new HarnessError(
      "INVALID_STATE",
      `Anti-Sequentiality Engine Violation: ${errorDetails}`,
    );
  }
}

/**
 * Formats a Markdown summary for multi-capsule execution.
 */
export function formatMultiCapsuleSummary(summary: MultiCapsuleSummary): string {
  const statusIcon =
    summary.overallStatus === "converged"
      ? "🟢 CONVERGED"
      : summary.overallStatus === "partial"
        ? "🟡 PARTIAL"
        : summary.overallStatus === "cancelled"
          ? "⚪ CANCELLED"
          : "🔴 FAILED";

  const lines: string[] = [
    `# Multi-Capsule Parallel Orchestration Summary`,
    ``,
    `**Overall Status**: ${statusIcon}`,
    `**Duration**: ${(summary.durationMs / 1000).toFixed(2)}s`,
    `**Concurrency Limit**: ${summary.concurrencyLimit}`,
    `**Total Capsules**: ${summary.totalCapsules} | **Converged**: ${summary.convergedCount} | **Failed**: ${summary.failedCount} | **Blocked**: ${summary.blockedCount} | **Cancelled**: ${summary.cancelledCount}`,
    ``,
    `## Anti-Sequentiality Audit`,
    `- **Compliant**: ${summary.antiSequentialityReport.compliant ? "✅ Yes" : "❌ No"}`,
    `- **Parallelism Speedup Ratio**: ${summary.antiSequentialityReport.parallelismRatio.toFixed(2)}x`,
    `- **Critical Path Waves**: ${summary.antiSequentialityReport.criticalPathLength}`,
    `- **Independent Lanes**: ${summary.antiSequentialityReport.independentLanesCount}`,
    ``,
  ];

  if (summary.antiSequentialityReport.violations.length > 0) {
    lines.push(`### Detected Anti-Sequentiality Violations`);
    for (const v of summary.antiSequentialityReport.violations) {
      lines.push(`- **[${v.type}]** Capsules: \`${v.capsuleIds.join(", ")}\``);
      lines.push(`  - *Issue*: ${v.message}`);
      lines.push(`  - *Remedy*: ${v.remedy}`);
    }
    lines.push(``);
  }

  lines.push(`## Capsule Execution Table`);
  lines.push(`| Capsule ID | Status | Duration | Gate | Summary |`);
  lines.push(`| :--- | :--- | :--- | :--- | :--- |`);

  for (const [id, res] of Object.entries(summary.results)) {
    const gateCol = res.gatePassed === undefined ? "N/A" : res.gatePassed ? "✅ Pass" : "❌ Fail";
    const sumCol = res.summary ? res.summary.replace(/\|/g, "\\|") : (res.error ?? "Completed");
    lines.push(
      `| \`${id}\` | **${res.status.toUpperCase()}** | ${(res.durationMs / 1000).toFixed(2)}s | ${gateCol} | ${sumCol} |`,
    );
  }

  lines.push(``);
  return lines.join("\n");
}

/**
 * True Multi-Capsule Parallel Orchestration & Anti-Sequentiality Engine.
 */
export class TrueMultiCapsuleOrchestrator {
  public static readonly DEFAULT_MAX_PARALLEL = 4;

  public readonly maxParallelCapsules: number;
  public readonly strictAntiSequentiality: boolean;
  public readonly allowScopeOverlapInIsolatedWorktrees: boolean;
  public readonly outputDir: string | undefined;
  public readonly actor: string | undefined;

  private readonly executor: CapsuleExecutor | undefined;
  private readonly onCapsuleStateChange?: ((event: CapsuleStateChangeEvent) => void) | undefined;
  private readonly onAntiSequentialityViolation?: ((violation: AntiSequentialityViolation) => void) | undefined;

  public constructor(options: MultiCapsuleOrchestratorOptions = {}) {
    this.maxParallelCapsules = Math.max(1, options.maxParallelCapsules ?? TrueMultiCapsuleOrchestrator.DEFAULT_MAX_PARALLEL);
    this.strictAntiSequentiality = options.strictAntiSequentiality ?? false;
    this.allowScopeOverlapInIsolatedWorktrees = options.allowScopeOverlapInIsolatedWorktrees ?? true;
    this.executor = options.executor;
    this.outputDir = options.outputDir;
    this.actor = options.actor;
    this.onCapsuleStateChange = options.onCapsuleStateChange;
    this.onAntiSequentialityViolation = options.onAntiSequentialityViolation;
  }

  /**
   * Executes a fleet of capsules in parallel with DAG dependency ordering,
   * continuous anti-batching dispatch, scope protection, and failure isolation.
   */
  public async orchestrate(specs: readonly CapsuleSpec[]): Promise<MultiCapsuleSummary> {
    if (specs.length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "Cannot orchestrate an empty set of capsule specs");
    }

    const startTime = Date.now();
    const startedAt = new Date(startTime).toISOString();

    // 1. Anti-Sequentiality Validation
    const antiSeqReport = validateAntiSequentiality(specs, {
      maxParallelCapsules: this.maxParallelCapsules,
      allowScopeOverlapInIsolatedWorktrees: this.allowScopeOverlapInIsolatedWorktrees,
    });

    if (this.onAntiSequentialityViolation && antiSeqReport.violations.length > 0) {
      for (const v of antiSeqReport.violations) {
        this.onAntiSequentialityViolation(v);
      }
    }

    if (this.strictAntiSequentiality && !antiSeqReport.compliant) {
      const details = antiSeqReport.violations
        .map((v) => `[${v.type}] on (${v.capsuleIds.join(", ")}): ${v.message}`)
        .join("; ");
      throw new HarnessError(
        "INVALID_STATE",
        `Strict Anti-Sequentiality violation prevents orchestration: ${details}`,
      );
    }

    const dag = new MultiCapsuleDAG(specs);
    const waves = dag.computeParallelWaves();

    // Tracking state
    const statuses = new Map<string, CapsuleExecutionStatus>();
    const results = new Map<string, CapsuleExecutionResult>();
    const activeCapsules = new Set<string>();
    const activeScopes = new Map<string, readonly string[]>(); // capsuleId -> scopes
    const abortControllers = new Map<string, AbortController>();

    for (const spec of specs) {
      statuses.set(spec.id, "pending");
    }

    const updateStatus = (
      capsuleId: string,
      newStatus: CapsuleExecutionStatus,
      reason?: string,
      error?: string,
    ): void => {
      const prev = statuses.get(capsuleId) ?? "pending";
      statuses.set(capsuleId, newStatus);
      if (this.onCapsuleStateChange && prev !== newStatus) {
        this.onCapsuleStateChange({
          capsuleId,
          previousStatus: prev,
          newStatus,
          timestamp: new Date().toISOString(),
          reason,
          error,
        });
      }
    };

    // Helper to evaluate if capsule is ready to run
    const isReadyToRun = (spec: CapsuleSpec): boolean => {
      if (statuses.get(spec.id) !== "pending") return false;
      const deps = spec.dependencies ?? [];
      for (const depId of deps) {
        const depStatus = statuses.get(depId);
        if (depStatus !== "converged") {
          return false;
        }
      }
      return true;
    };

    // Helper to check if capsule has failed dependencies
    const hasFailedDependency = (spec: CapsuleSpec): boolean => {
      const deps = spec.dependencies ?? [];
      for (const depId of deps) {
        const depStatus = statuses.get(depId);
        if (depStatus === "failed" || depStatus === "blocked" || depStatus === "cancelled") {
          return true;
        }
      }
      return false;
    };

    // Helper to check scope conflicts with currently active capsules
    const hasActiveScopeConflict = (spec: CapsuleSpec): boolean => {
      if (this.allowScopeOverlapInIsolatedWorktrees && spec.worktreePath?.trim()) {
        return false;
      }
      for (const [activeId, scopes] of activeScopes.entries()) {
        const activeSpec = dag.getSpec(activeId);
        if (
          this.allowScopeOverlapInIsolatedWorktrees &&
          activeSpec?.worktreePath?.trim() &&
          spec.worktreePath?.trim() &&
          activeSpec.worktreePath.trim() !== spec.worktreePath.trim()
        ) {
          continue;
        }
        if (hasScopeOverlap(spec.writeScope, scopes)) {
          return true;
        }
      }
      return false;
    };

    let executionError: Error | null = null;

    // Dispatch loop
    const runDispatchLoop = async (): Promise<void> => {
      const pendingQueue = new Set(specs.map((s) => s.id));

      while (pendingQueue.size > 0 || activeCapsules.size > 0) {
        // 1. Check for blocked capsules due to failed dependencies
        for (const specId of Array.from(pendingQueue)) {
          const spec = dag.getSpec(specId);
          if (!spec) continue;

          if (hasFailedDependency(spec)) {
            pendingQueue.delete(specId);
            updateStatus(specId, "blocked", "Dependency failed");
            const nowIso = new Date().toISOString();
            results.set(specId, {
              capsuleId: specId,
              status: "blocked",
              startedAt: nowIso,
              completedAt: nowIso,
              durationMs: 0,
              summary: "Blocked due to prerequisite failure",
            });
          }
        }

        // 2. Identify ready capsules
        const readyToDispatch: CapsuleSpec[] = [];
        for (const specId of pendingQueue) {
          const spec = dag.getSpec(specId);
          if (spec && isReadyToRun(spec) && !hasActiveScopeConflict(spec)) {
            readyToDispatch.push(spec);
          }
        }

        // Sort by priority descending
        readyToDispatch.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

        // 3. Dispatch up to available capacity (Continuous 1:1 Anti-Batching Dispatch)
        const availableSlots = this.maxParallelCapsules - activeCapsules.size;
        const toDispatch = readyToDispatch.slice(0, Math.max(0, availableSlots));

        for (const spec of toDispatch) {
          pendingQueue.delete(spec.id);
          activeCapsules.add(spec.id);
          activeScopes.set(spec.id, spec.writeScope);
          updateStatus(spec.id, "running");

          const controller = new AbortController();
          abortControllers.set(spec.id, controller);

          // Launch capsule execution in background
          void (async (capsuleSpec: CapsuleSpec, signal: AbortSignal) => {
            const capStart = Date.now();
            const capStartIso = new Date(capStart).toISOString();
            let res: CapsuleExecutionResult;

            try {
              if (this.executor) {
                res = await this.executor.executeCapsule({
                  spec: capsuleSpec,
                  signal,
                });
              } else {
                // Default mock execution
                res = {
                  capsuleId: capsuleSpec.id,
                  status: "converged",
                  startedAt: capStartIso,
                  completedAt: new Date().toISOString(),
                  durationMs: Date.now() - capStart,
                  gatePassed: true,
                  summary: `Capsule ${capsuleSpec.id} converged cleanly`,
                };
              }
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              res = {
                capsuleId: capsuleSpec.id,
                status: "failed",
                startedAt: capStartIso,
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - capStart,
                gatePassed: false,
                error: errMsg,
                summary: `Capsule execution failed: ${errMsg}`,
              };
            }

            activeCapsules.delete(capsuleSpec.id);
            activeScopes.delete(capsuleSpec.id);
            abortControllers.delete(capsuleSpec.id);
            results.set(capsuleSpec.id, res);
            updateStatus(capsuleSpec.id, res.status, res.summary, res.error);
          })(spec, controller.signal);
        }

        // If no active capsules and nothing ready but pendingQueue is non-empty, deadlock or unresolvable state
        if (activeCapsules.size === 0 && pendingQueue.size > 0 && readyToDispatch.length === 0) {
          for (const remainingId of pendingQueue) {
            updateStatus(remainingId, "blocked", "Unresolvable dependency or scope deadlock");
            const nowIso = new Date().toISOString();
            results.set(remainingId, {
              capsuleId: remainingId,
              status: "blocked",
              startedAt: nowIso,
              completedAt: nowIso,
              durationMs: 0,
              summary: "Unresolvable dependency or deadlock",
            });
          }
          pendingQueue.clear();
          break;
        }

        // Wait a short tick for state updates
        if (activeCapsules.size > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
        }
      }
    };

    try {
      await runDispatchLoop();
    } catch (err: unknown) {
      executionError = err instanceof Error ? err : new Error(String(err));
    }

    const endTime = Date.now();
    const completedAt = new Date(endTime).toISOString();
    const durationMs = endTime - startTime;

    // Aggregate statistics
    let convergedCount = 0;
    let failedCount = 0;
    let blockedCount = 0;
    let cancelledCount = 0;

    const resultsObj: Record<string, CapsuleExecutionResult> = {};
    for (const [id, res] of results.entries()) {
      resultsObj[id] = res;
      if (res.status === "converged") convergedCount++;
      else if (res.status === "failed") failedCount++;
      else if (res.status === "blocked") blockedCount++;
      else if (res.status === "cancelled") cancelledCount++;
    }

    let overallStatus: "converged" | "failed" | "partial" | "cancelled" = "converged";
    if (failedCount > 0 && convergedCount > 0) {
      overallStatus = "partial";
    } else if (failedCount > 0 || blockedCount === specs.length) {
      overallStatus = "failed";
    } else if (cancelledCount > 0 && convergedCount === 0) {
      overallStatus = "cancelled";
    }

    const summary: MultiCapsuleSummary = {
      totalCapsules: specs.length,
      convergedCount,
      failedCount,
      blockedCount,
      cancelledCount,
      overallStatus,
      startedAt,
      completedAt,
      durationMs,
      concurrencyLimit: this.maxParallelCapsules,
      independentWavesCount: waves.length,
      results: resultsObj,
      antiSequentialityReport: antiSeqReport,
      markdownSummary: "",
    };

    summary.markdownSummary = formatMultiCapsuleSummary(summary);

    if (this.outputDir) {
      try {
        if (!existsSync(this.outputDir)) {
          mkdirSync(this.outputDir, { recursive: true });
        }
        const jsonPath = join(this.outputDir, "multi-capsule-summary.json");
        const mdPath = join(this.outputDir, "multi-capsule-summary.md");
        writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + "\n", "utf-8");
        writeFileSync(mdPath, summary.markdownSummary, "utf-8");
      } catch (ioErr: unknown) {
        // Output persistence failure does not crash result
      }
    }

    if (executionError) {
      throw executionError;
    }

    return summary;
  }
}
