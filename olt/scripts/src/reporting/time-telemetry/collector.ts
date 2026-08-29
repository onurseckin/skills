/**
 * Omnipresent Time Telemetry Collector
 */
import { randomUUID } from "node:crypto";
import type { JsonValue } from "../../core/contracts/index.ts";
import {
  calculateDrift,
  calculateDuration,
  getDualTime,
  type DualTimeRecord,
} from "../../core/dual-time/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { buildTimeTelemetryReport } from "./report-builder.ts";
import { ActionSpan } from "./span.ts";
import {
  isHarnessActionTimeRecord,
  type ActionExecutionStatus,
  type HarnessActionTimeRecord,
  type StartActionSpanOptions,
  type TelemetryFilter,
  type TimeTelemetryReport,
} from "./types.ts";

export { validateTimeTelemetryHealth } from "./health.ts";
export { buildTimeTelemetryReport } from "./report-builder.ts";

/**
 * Omnipresent Time Telemetry Collector managing active action spans and historical action records.
 */
export class OmnipresentTelemetryCollector {
  private readonly _activeSpans = new Map<string, ActionSpan>();
  private readonly _completedRecords: HarnessActionTimeRecord[] = [];
  private readonly _defaultTimezone?: string | undefined;

  public constructor(options?: { defaultTimezone?: string }) {
    this._defaultTimezone = options?.defaultTimezone;
  }

  public startSpan(
    actionName: string,
    actor: string,
    options?: StartActionSpanOptions,
  ): ActionSpan {
    const span = new ActionSpan(actionName, actor, {
      ...(this._defaultTimezone !== undefined ? { timezone: this._defaultTimezone } : {}),
      ...options,
    });
    this._activeSpans.set(span.actionId, span);
    return span;
  }

  public finishSpan(
    actionId: string,
    status: ActionExecutionStatus = "success",
    metadata?: Record<string, JsonValue>,
    timestamp?: Date | number | string | DualTimeRecord,
  ): HarnessActionTimeRecord {
    const span = this._activeSpans.get(actionId);
    if (!span) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `No active action span found with ID: ${actionId}`,
      );
    }

    const record = span.finish(status, metadata, timestamp);
    this._activeSpans.delete(actionId);
    this._completedRecords.push(record);
    return record;
  }

  public recordAction(record: HarnessActionTimeRecord): void {
    if (!isHarnessActionTimeRecord(record)) {
      throw new HarnessError("INVALID_ARGUMENT", "Invalid HarnessActionTimeRecord provided.");
    }
    this._completedRecords.push(record);
  }

  public recordCommandExecution(
    command: string,
    actor: string,
    startedAt: Date | number | string | DualTimeRecord,
    finishedAt: Date | number | string | DualTimeRecord,
    exitCode: number,
    details?: Record<string, JsonValue>,
  ): HarnessActionTimeRecord {
    const startDual = getDualTime(startedAt, this._defaultTimezone);
    const finishDual = getDualTime(finishedAt, this._defaultTimezone);
    const dur = calculateDuration(startDual, finishDual);
    const status: ActionExecutionStatus = exitCode === 0 ? "success" : "failure";

    const record: HarnessActionTimeRecord = {
      actionId: randomUUID(),
      actionName: "run:exec",
      category: "run",
      actor,
      tier: 3,
      status,
      startedAt: startDual,
      finishedAt: finishDual,
      durationMs: dur.duration_ms,
      durationFormatted: dur.formatted,
      metadata: {
        command,
        exitCode,
        ...(details ?? {}),
      },
    };

    this._completedRecords.push(record);
    return record;
  }

  public recordGateExecution(
    gateCommand: string,
    actor: string,
    startedAt: Date | number | string | DualTimeRecord,
    finishedAt: Date | number | string | DualTimeRecord,
    passed: boolean,
    details?: Record<string, JsonValue>,
  ): HarnessActionTimeRecord {
    const startDual = getDualTime(startedAt, this._defaultTimezone);
    const finishDual = getDualTime(finishedAt, this._defaultTimezone);
    const dur = calculateDuration(startDual, finishDual);
    const status: ActionExecutionStatus = passed ? "success" : "failure";

    const record: HarnessActionTimeRecord = {
      actionId: randomUUID(),
      actionName: "gate:check",
      category: "gate",
      actor,
      tier: 3,
      status,
      startedAt: startDual,
      finishedAt: finishDual,
      durationMs: dur.duration_ms,
      durationFormatted: dur.formatted,
      metadata: {
        gateCommand,
        passed,
        ...(details ?? {}),
      },
    };

    this._completedRecords.push(record);
    return record;
  }

  public recordWatchdogHeartbeat(
    component: string,
    actor: string,
    intervalMs: number,
    expectedTickMs: number,
    actualTick: Date | number | string | DualTimeRecord = new Date(),
    details?: Record<string, JsonValue>,
  ): HarnessActionTimeRecord {
    const actualDual = getDualTime(actualTick, this._defaultTimezone);
    const driftMs = calculateDrift(expectedTickMs, actualDual.timestamp_ms);

    const record: HarnessActionTimeRecord = {
      actionId: randomUUID(),
      actionName: `watchdog:heartbeat:${component}`,
      category: "watchdog",
      actor,
      tier: 1,
      status: "success",
      startedAt: actualDual,
      finishedAt: actualDual,
      durationMs: 0,
      durationFormatted: "0ms",
      driftMs,
      metadata: {
        component,
        intervalMs,
        expectedTickMs,
        actualTickMs: actualDual.timestamp_ms,
        ...(details ?? {}),
      },
    };

    this._completedRecords.push(record);
    return record;
  }

  public getRecords(filter?: TelemetryFilter): readonly HarnessActionTimeRecord[] {
    if (!filter) {
      return [...this._completedRecords];
    }

    const catSet = filter.category
      ? new Set(Array.isArray(filter.category) ? filter.category : [filter.category])
      : null;
    const actorSet = filter.actor
      ? new Set(
          (Array.isArray(filter.actor) ? filter.actor : [filter.actor]).map((a) => a.toLowerCase()),
        )
      : null;
    const tierSet = filter.tier
      ? new Set(Array.isArray(filter.tier) ? filter.tier : [filter.tier])
      : null;
    const statusSet = filter.status
      ? new Set(Array.isArray(filter.status) ? filter.status : [filter.status])
      : null;
    const nameSet = filter.actionName
      ? new Set(Array.isArray(filter.actionName) ? filter.actionName : [filter.actionName])
      : null;

    return this._completedRecords.filter((rec) => {
      if (catSet && !catSet.has(rec.category)) return false;
      if (actorSet && !actorSet.has(rec.actor.toLowerCase())) return false;
      if (tierSet && !tierSet.has(rec.tier)) return false;
      if (statusSet && !statusSet.has(rec.status)) return false;
      if (nameSet && !nameSet.has(rec.actionName)) return false;
      if (filter.fromMs !== undefined && rec.startedAt.timestamp_ms < filter.fromMs) return false;
      if (filter.toMs !== undefined && rec.startedAt.timestamp_ms > filter.toMs) return false;
      return true;
    });
  }

  public getActiveSpanCount(): number {
    return this._activeSpans.size;
  }

  public generateReport(options?: {
    runId?: string;
    filter?: TelemetryFilter;
    timezone?: string;
    maxRecent?: number;
  }): TimeTelemetryReport {
    const records = this.getRecords(options?.filter);
    return buildTimeTelemetryReport(records, this._activeSpans.size, {
      ...(this._defaultTimezone !== undefined ? { defaultTimezone: this._defaultTimezone } : {}),
      ...options,
    });
  }

  public clear(): void {
    this._activeSpans.clear();
    this._completedRecords.length = 0;
  }
}
