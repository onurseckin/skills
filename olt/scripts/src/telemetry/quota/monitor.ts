/**
 * QuotaMonitor: Tier 0 autonomous quota monitor with internal scheduler cadence,
 * graceful freeze (<10%), auto-wake sentinel, zero-kill preservation, and zero main-thread chatter.
 * Invariants: 0 any, 0 suppressions, <= 400 lines.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { evaluateQuotaState } from "./evaluator.ts";
import { computeAutoWakeSentinel } from "./sentinel.ts";
import {
  DEFAULT_FREEZE_THRESHOLD,
  DEFAULT_RECOVERY_THRESHOLD,
  DEFAULT_WARNING_THRESHOLD,
  type QuotaDagSnapshot,
  type QuotaEvaluationVerdict,
  type QuotaMonitorOptions,
  type QuotaMonitorState,
  type QuotaMonitorStatus,
  type QuotaThresholdConfig,
  type SentinelWakeSchedule,
} from "./types.ts";

export class QuotaMonitor {
  private state: QuotaMonitorState = "IDLE";
  private isFrozen = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly cadenceMs: number;
  private readonly thresholds: QuotaThresholdConfig;
  private readonly storageDir: string;
  private readonly snapshotPath: string;
  private readonly onFreezeCallback?: QuotaMonitorOptions["onFreeze"] | undefined;
  private readonly onResumeCallback?: QuotaMonitorOptions["onResume"] | undefined;
  private readonly onMailboxEmitCallback?: QuotaMonitorOptions["onMailboxEmit"] | undefined;
  private readonly quotaProvider?: (() => unknown) | undefined;
  private readonly nowProvider: () => number;

  private lastCheckAt?: string | undefined;
  private lastFreezeAt?: string | undefined;
  private lastResumeAt?: string | undefined;
  private lastEvaluation?: QuotaEvaluationVerdict | undefined;
  private currentSchedule?: SentinelWakeSchedule | undefined;
  private currentSnapshot?: QuotaDagSnapshot | undefined;

  constructor(options: QuotaMonitorOptions = {}) {
    this.cadenceMs = options.cadenceMs ?? 60_000;
    this.thresholds = {
      freezeThresholdPercentage:
        options.thresholds?.freezeThresholdPercentage ?? DEFAULT_FREEZE_THRESHOLD,
      warningThresholdPercentage:
        options.thresholds?.warningThresholdPercentage ?? DEFAULT_WARNING_THRESHOLD,
      recoveryThresholdPercentage:
        options.thresholds?.recoveryThresholdPercentage ?? DEFAULT_RECOVERY_THRESHOLD,
      autoWakeBufferSeconds: options.thresholds?.autoWakeBufferSeconds ?? 60,
      safeWindowSeconds: options.thresholds?.safeWindowSeconds ?? 18_000,
      cooldownSeconds: options.thresholds?.cooldownSeconds ?? 60,
      failClosed: options.thresholds?.failClosed ?? true,
    };
    this.storageDir = options.storageDir ?? join(process.cwd(), ".olt");
    this.snapshotPath = join(this.storageDir, "quota-dag-snapshot.json");
    this.onFreezeCallback = options.onFreeze;
    this.onResumeCallback = options.onResume;
    this.onMailboxEmitCallback = options.onMailboxEmit;
    this.quotaProvider = options.quotaProvider;
    this.nowProvider = options.now ?? (() => Date.now());

    this.loadExistingSnapshot();
  }

  public getStatus(): QuotaMonitorStatus {
    return {
      state: this.state,
      isFrozen: this.isFrozen,
      lastCheckAt: this.lastCheckAt,
      lastFreezeAt: this.lastFreezeAt,
      lastResumeAt: this.lastResumeAt,
      lastEvaluation: this.lastEvaluation,
      currentSchedule: this.currentSchedule,
      activeAgentsCount: this.currentSnapshot?.activeTaskIds.length ?? 0,
    };
  }

  public getSnapshot(): QuotaDagSnapshot | undefined {
    return this.currentSnapshot;
  }

  public start(): void {
    if (this.state === "MONITORING") return;
    this.state = this.isFrozen ? "FROZEN" : "MONITORING";
    if (this.timer !== null) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.cadenceMs);
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state = "STOPPED";
  }

  public async tick(explicitTelemetry?: unknown): Promise<QuotaEvaluationVerdict> {
    const telemetry = explicitTelemetry !== undefined ? explicitTelemetry : this.sampleTelemetry();
    this.lastCheckAt = new Date(this.nowProvider()).toISOString();

    const verdict = evaluateQuotaState(telemetry, this.thresholds, {
      isCurrentlyFrozen: this.isFrozen,
      failClosed: this.thresholds.failClosed,
    });
    this.lastEvaluation = verdict;

    if (verdict.shouldFreeze) {
      if (!this.isFrozen) {
        await this.handleFreezeTransition(verdict);
      } else {
        // Idempotent maintenance while frozen: refresh sentinel if new reset time is present
        this.maintainFrozenState(verdict);
      }
    } else {
      if (this.isFrozen) {
        await this.handleResumeTransition(verdict);
      }
    }

    return verdict;
  }

  private sampleTelemetry(): unknown {
    if (this.quotaProvider) {
      try {
        return this.quotaProvider();
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private async handleFreezeTransition(verdict: QuotaEvaluationVerdict): Promise<void> {
    this.isFrozen = true;
    this.state = "FROZEN";
    const nowIso = new Date(this.nowProvider()).toISOString();
    this.lastFreezeAt = nowIso;

    // 1. Calculate sentinel wake schedule
    const sentinel = computeAutoWakeSentinel(verdict, {
      now: this.nowProvider(),
      bufferSeconds: this.thresholds.autoWakeBufferSeconds,
      safeWindowSeconds: this.thresholds.safeWindowSeconds,
    });
    this.currentSchedule = sentinel;

    // 2. Persist DAG snapshot with zero-kill state preservation
    const snapshot: QuotaDagSnapshot = {
      snapshotId: `quota-freeze-${Date.now()}`,
      createdAt: nowIso,
      frozenAt: nowIso,
      status: "active_freeze",
      triggeredByModel: verdict.constrainedModel?.modelName ?? "unknown",
      remainingQuotaPercentage: verdict.remainingPercentage,
      resetTime: verdict.resetTime,
      targetWakeupIso: sentinel.targetWakeupIso,
      activeTaskIds: this.currentSnapshot?.activeTaskIds ?? [],
      pendingTaskIds: this.currentSnapshot?.pendingTaskIds ?? [],
      completedTaskIds: this.currentSnapshot?.completedTaskIds ?? [],
      unstagedFilesCount: this.currentSnapshot?.unstagedFilesCount ?? 0,
      metadata: {
        directive: verdict.directive,
        reason: verdict.reason,
      },
    };
    this.currentSnapshot = snapshot;
    this.persistSnapshot(snapshot);

    // 3. Dispatch to internal callbacks & Mailbox IPC (Zero Main-Thread Chatter)
    if (this.onFreezeCallback) {
      try {
        await this.onFreezeCallback(verdict, sentinel);
      } catch {
        // Suppress errors to prevent supervisory crash
      }
    }

    if (this.onMailboxEmitCallback) {
      try {
        await this.onMailboxEmitCallback("quota:freeze", {
          event: "QUOTA_FREEZE_ACTIVATED",
          verdict,
          sentinel,
          snapshotId: snapshot.snapshotId,
        });
      } catch {
        // Suppress errors
      }
    }
  }

  private maintainFrozenState(verdict: QuotaEvaluationVerdict): void {
    if (verdict.resetTime && this.currentSnapshot) {
      const sentinel = computeAutoWakeSentinel(verdict, {
        now: this.nowProvider(),
        bufferSeconds: this.thresholds.autoWakeBufferSeconds,
        safeWindowSeconds: this.thresholds.safeWindowSeconds,
      });
      this.currentSchedule = sentinel;
    }
  }

  private async handleResumeTransition(verdict: QuotaEvaluationVerdict): Promise<void> {
    this.isFrozen = false;
    this.state = "MONITORING";
    const nowIso = new Date(this.nowProvider()).toISOString();
    this.lastResumeAt = nowIso;
    this.currentSchedule = undefined;

    // Archive snapshot: mark status as resumed
    if (this.currentSnapshot) {
      const updated: QuotaDagSnapshot = {
        ...this.currentSnapshot,
        resumedAt: nowIso,
        status: "resumed",
      };
      this.currentSnapshot = updated;
      this.persistSnapshot(updated);
    }

    if (this.onResumeCallback) {
      try {
        await this.onResumeCallback(verdict);
      } catch {
        // Suppress errors
      }
    }

    if (this.onMailboxEmitCallback) {
      try {
        await this.onMailboxEmitCallback("quota:resume", {
          event: "QUOTA_FREEZE_RESUMED",
          verdict,
          resumedAt: nowIso,
        });
      } catch {
        // Suppress errors
      }
    }
  }

  private persistSnapshot(snapshot: QuotaDagSnapshot): void {
    if (this.storageDir === ":memory:") return;
    try {
      if (!existsSync(this.storageDir)) {
        mkdirSync(this.storageDir, { recursive: true });
      }
      writeFileSync(this.snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
    } catch {
      // Safe write suppression
    }
  }

  private loadExistingSnapshot(): void {
    if (this.storageDir === ":memory:") return;
    try {
      if (existsSync(this.snapshotPath)) {
        const raw = readFileSync(this.snapshotPath, "utf-8");
        const parsed = JSON.parse(raw) as QuotaDagSnapshot;
        if (parsed && typeof parsed === "object") {
          this.currentSnapshot = parsed;
          if (parsed.status === "active_freeze") {
            this.isFrozen = true;
            this.lastFreezeAt = parsed.frozenAt;
          }
        }
      }
    } catch {
      // Defensive fallback
    }
  }
}
