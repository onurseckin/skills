import type { DomPhysicsSnapshot } from "../types.ts";
import { detectLayoutShiftBetweenSnapshots } from "./detector.ts";
import { resolveLayoutShiftTrackerOptions } from "./options.ts";
import { buildCumulativeLayoutShiftReport } from "./session-windows.ts";
import type {
  CumulativeLayoutShiftReport,
  LayoutShiftEntry,
  LayoutShiftTrackerOptions,
  ResolvedLayoutShiftTrackerOptions,
} from "./types.ts";

/**
 * Stateful layout shift tracker to measure and aggregate shifts during live capture runs.
 */
export class LayoutShiftTracker {
  private readonly entries: LayoutShiftEntry[] = [];
  private readonly options: ResolvedLayoutShiftTrackerOptions;
  private lastUserInputTime = 0;

  constructor(options?: LayoutShiftTrackerOptions) {
    this.options = resolveLayoutShiftTrackerOptions(options);
  }

  public recordUserInput(timestamp?: number): void {
    this.lastUserInputTime = timestamp ?? Date.now();
  }

  public hadRecentInput(timestamp?: number): boolean {
    const now = timestamp ?? Date.now();
    return now - this.lastUserInputTime < this.options.userInputWindowMs;
  }

  public recordShiftEntry(entry: LayoutShiftEntry): void {
    this.entries.push(entry);
  }

  public trackSnapshotDiff(
    previousSnapshot: DomPhysicsSnapshot,
    currentSnapshot: DomPhysicsSnapshot,
    timestamp?: number,
  ): LayoutShiftEntry {
    const time = timestamp ?? Date.now();
    const isRecent = this.hadRecentInput(time);
    const entry = detectLayoutShiftBetweenSnapshots(previousSnapshot, currentSnapshot, {
      ...this.options,
      timestamp: time,
      hadRecentInput: isRecent,
    });
    this.entries.push(entry);
    return entry;
  }

  public getEntries(): readonly LayoutShiftEntry[] {
    return [...this.entries];
  }

  public generateReport(): CumulativeLayoutShiftReport {
    return buildCumulativeLayoutShiftReport(this.entries, this.options);
  }

  public reset(): void {
    this.entries.length = 0;
    this.lastUserInputTime = 0;
  }
}
