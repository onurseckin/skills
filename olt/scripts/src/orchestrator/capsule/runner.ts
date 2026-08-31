import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { SplitChannelDefectRouter } from "../../reporting/split-channel-defect-router.ts";
import { OrchestratorCompanionAuditor } from "../companion-auditor.ts";
import { MultiCapsuleDAG } from "./dag.ts";
import { hasScopeOverlap, validateAntiSequentiality } from "./anti-sequentiality.ts";
import { formatMultiCapsuleMarkdownSummary } from "./formatter.ts";
import type {
  AntiSequentialityViolation,
  BehavioralForensicsReport,
  CapsuleExecutionResult,
  CapsuleExecutionStatus,
  CapsuleExecutor,
  CapsuleSpec,
  CapsuleStateChangeEvent,
  MultiCapsuleOrchestratorOptions,
  MultiCapsuleSummary,
} from "./types.ts";

export class TrueMultiCapsuleOrchestrator {
  public static readonly DEFAULT_MAX_PARALLEL = 4;

  public readonly maxParallelCapsules: number;
  public readonly strictAntiSequentiality: boolean;
  public readonly allowScopeOverlapInIsolatedWorktrees: boolean;
  public readonly outputDir: string | undefined;
  public readonly actor: string | undefined;
  public readonly skillAuditorCompanion: boolean;
  public readonly strictAuditorPolicy: boolean;

  private readonly executor: CapsuleExecutor | undefined;
  private readonly onCapsuleStateChange?: ((event: CapsuleStateChangeEvent) => void) | undefined;
  private readonly onAntiSequentialityViolation?:
    | ((violation: AntiSequentialityViolation) => void)
    | undefined;
  private readonly onBehavioralForensics?:
    | ((report: BehavioralForensicsReport) => void)
    | undefined;

  public constructor(options: MultiCapsuleOrchestratorOptions = {}) {
    const configuredMax =
      options.maxParallelCapsules ?? TrueMultiCapsuleOrchestrator.DEFAULT_MAX_PARALLEL;
    this.maxParallelCapsules = Math.max(1, configuredMax);
    this.strictAntiSequentiality = options.strictAntiSequentiality ?? false;
    this.allowScopeOverlapInIsolatedWorktrees =
      options.allowScopeOverlapInIsolatedWorktrees ?? true;
    this.skillAuditorCompanion = options.skillAuditorCompanion !== false;
    this.strictAuditorPolicy = options.strictAuditorPolicy === true;
    this.executor = options.executor;
    this.outputDir = options.outputDir;
    this.actor = options.actor;
    this.onCapsuleStateChange = options.onCapsuleStateChange;
    this.onAntiSequentialityViolation = options.onAntiSequentialityViolation;
    this.onBehavioralForensics = options.onBehavioralForensics;
  }

  public async orchestrate(specs: readonly CapsuleSpec[]): Promise<MultiCapsuleSummary> {
    if (specs.length === 0)
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Cannot orchestrate an empty set of capsule specs",
      );

    const startTime = Date.now();
    const startedAt = new Date(startTime).toISOString();
    const firstSpec = specs[0];
    const targetRepoRoot = firstSpec !== undefined ? firstSpec.repoPath : process.cwd();
    const companionPairing = OrchestratorCompanionAuditor.pairCompanion(targetRepoRoot, {
      strictPolicy: this.strictAuditorPolicy,
    });

    const antiSeqReport = validateAntiSequentiality(specs, {
      maxParallelCapsules: this.maxParallelCapsules,
      allowScopeOverlapInIsolatedWorktrees: this.allowScopeOverlapInIsolatedWorktrees,
    });

    if (antiSeqReport.violations.length > 0) {
      for (const v of antiSeqReport.violations) {
        this.onAntiSequentialityViolation?.(v);
        SplitChannelDefectRouter.routeDefect({
          currentRepoRoot: targetRepoRoot,
          domain: "skill-framework",
          defect: {
            error_code: "FALSE_SERIALIZATION",
            title: `Anti-Sequentiality Violation: ${v.type}`,
            description: v.message,
            actor: "multi-capsule-orchestrator",
            context: { capsuleIds: v.capsuleIds, remedy: v.remedy },
          },
        });
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
    const statuses = new Map<string, CapsuleExecutionStatus>();
    const results = new Map<string, CapsuleExecutionResult>();
    const activeCapsules = new Set<string>();
    const activeScopes = new Map<string, readonly string[]>();
    const abortControllers = new Map<string, AbortController>();

    for (const spec of specs) statuses.set(spec.id, "pending");

    const updateStatus = (
      capsuleId: string,
      newStatus: CapsuleExecutionStatus,
      reason?: string,
      error?: string,
    ): void => {
      const prev = statuses.get(capsuleId) ?? "pending";
      statuses.set(capsuleId, newStatus);
      if (this.onCapsuleStateChange !== undefined && prev !== newStatus) {
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

    const isReadyToRun = (spec: CapsuleSpec): boolean => {
      if (statuses.get(spec.id) !== "pending") return false;
      for (const depId of spec.dependencies ?? []) {
        if (statuses.get(depId) !== "converged") return false;
      }
      return true;
    };

    const hasFailedDependency = (spec: CapsuleSpec): boolean => {
      for (const depId of spec.dependencies ?? []) {
        const depStatus = statuses.get(depId);
        if (depStatus === "failed" || depStatus === "blocked" || depStatus === "cancelled")
          return true;
      }
      return false;
    };

    const hasActiveScopeConflict = (spec: CapsuleSpec): boolean => {
      if (this.allowScopeOverlapInIsolatedWorktrees && spec.worktreePath?.trim()) return false;
      for (const [activeId, scopes] of activeScopes.entries()) {
        const activeSpec = dag.getSpec(activeId);
        if (
          this.allowScopeOverlapInIsolatedWorktrees &&
          activeSpec?.worktreePath?.trim() &&
          spec.worktreePath?.trim() &&
          activeSpec.worktreePath.trim() !== spec.worktreePath.trim()
        )
          continue;
        if (hasScopeOverlap(spec.writeScope, scopes)) return true;
      }
      return false;
    };

    let executionError: Error | null = null;

    const runDispatchLoop = async (): Promise<void> => {
      const pendingQueue = new Set(specs.map((s) => s.id));
      for (;;) {
        if (pendingQueue.size === 0 && activeCapsules.size === 0) break;

        for (const specId of Array.from(pendingQueue)) {
          const spec = dag.getSpec(specId);
          if (spec && hasFailedDependency(spec)) {
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

        const readyToDispatch: CapsuleSpec[] = [];
        for (const specId of pendingQueue) {
          const spec = dag.getSpec(specId);
          if (spec && isReadyToRun(spec) && !hasActiveScopeConflict(spec))
            readyToDispatch.push(spec);
        }

        readyToDispatch.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        const availableSlots = this.maxParallelCapsules - activeCapsules.size;
        const toDispatch = readyToDispatch.slice(0, Math.max(0, availableSlots));

        for (const spec of toDispatch) {
          pendingQueue.delete(spec.id);
          activeCapsules.add(spec.id);
          activeScopes.set(spec.id, spec.writeScope);
          updateStatus(spec.id, "running");

          const controller = new AbortController();
          abortControllers.set(spec.id, controller);

          void (async (capsuleSpec: CapsuleSpec, signal: AbortSignal) => {
            const capStart = Date.now();
            const capStartIso = new Date(capStart).toISOString();
            let res: CapsuleExecutionResult;
            try {
              if (this.executor) {
                res = await this.executor.executeCapsule({ spec: capsuleSpec, signal });
              } else {
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

        if (activeCapsules.size > 0) await new Promise<void>((resolve) => setTimeout(resolve, 20));
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
    if (failedCount > 0 && convergedCount > 0) overallStatus = "partial";
    else if (failedCount > 0 || blockedCount === specs.length) overallStatus = "failed";
    else if (cancelledCount > 0 && convergedCount === 0) overallStatus = "cancelled";

    const behavioralForensicsSummary = OrchestratorCompanionAuditor.executeForensics(
      targetRepoRoot,
      { now: completedAt },
    );
    this.onBehavioralForensics?.(behavioralForensicsSummary);

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
      companionPairing,
      behavioralForensicsSummary,
    };

    summary.markdownSummary = formatMultiCapsuleMarkdownSummary(summary);

    if (this.outputDir) {
      try {
        if (!existsSync(this.outputDir)) mkdirSync(this.outputDir, { recursive: true });
        writeFileSync(
          join(this.outputDir, "multi-capsule-summary.json"),
          JSON.stringify(summary, null, 2) + "\n",
          "utf-8",
        );
        writeFileSync(
          join(this.outputDir, "multi-capsule-summary.md"),
          summary.markdownSummary,
          "utf-8",
        );
      } catch {}
    }

    if (executionError) throw executionError;
    return summary;
  }
}
