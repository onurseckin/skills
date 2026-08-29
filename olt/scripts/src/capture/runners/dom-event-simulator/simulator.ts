import { extractDomPhysics } from "../dom-physics-extractor.ts";
import { LayoutShiftTracker } from "../layout-shift-tracker.ts";
import type { CapturePageDriver } from "../types.ts";
import { simulateDomEvent } from "./dispatchers.ts";
import { classifyLayoutShift } from "./evaluator.ts";
import { resolveDomSimulationOptions } from "./options.ts";
import type {
  DomEventSimulationReport,
  DomEventStepResult,
  DomSimulationOptions,
  ResolvedDomSimulationOptions,
  SyntheticDomEvent,
  UnexpectedShiftDefect,
} from "./types.ts";

/**
 * Real DOM Event Simulator & Interaction-Triggered Layout Shift Runner.
 */
export class DomEventSimulator {
  private readonly tracker: LayoutShiftTracker;
  private readonly options: ResolvedDomSimulationOptions;

  constructor(options?: DomSimulationOptions) {
    this.options = resolveDomSimulationOptions(options);
    this.tracker = new LayoutShiftTracker(this.options.trackerOptions);
  }

  /**
   * Executes a synthetic event sequence with pre/post shift measurement.
   */
  public async executeSequence(
    driver: CapturePageDriver,
    events: readonly SyntheticDomEvent[],
    options?: DomSimulationOptions,
  ): Promise<DomEventSimulationReport> {
    const mergedOptions: ResolvedDomSimulationOptions = resolveDomSimulationOptions({
      settleDelayMs: options?.settleDelayMs ?? this.options.settleDelayMs,
      clsThreshold: options?.clsThreshold ?? this.options.clsThreshold,
      failOnUnexpectedShift: options?.failOnUnexpectedShift ?? this.options.failOnUnexpectedShift,
      trackerOptions: {
        ...this.options.trackerOptions,
        ...options?.trackerOptions,
      },
    });

    this.tracker.reset();
    const sessionId = `sim-${Date.now()}`;
    const startTime = Date.now();

    const stepResults: DomEventStepResult[] = [];
    const unexpectedShifts: UnexpectedShiftDefect[] = [];
    let successfulEvents = 0;
    let failedEvents = 0;

    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;
      const stepStartTime = Date.now();

      // 1. Measure Pre-Event DOM Physics
      const prePhysics = await extractDomPhysics(driver);

      // 2. Mark user input timestamp if event is an interactive gesture
      const isInput =
        event.type === "click" ||
        event.type === "dblclick" ||
        event.type === "keypress" ||
        event.type === "keydown" ||
        event.type === "input";

      if (isInput) {
        this.tracker.recordUserInput(stepStartTime);
      }

      let success = true;
      let error: string | undefined;

      // 3. Dispatch simulated DOM event
      try {
        await simulateDomEvent(driver, event);

        // Allow layout settle delay
        if (mergedOptions.settleDelayMs > 0) {
          if (driver.waitForTimeout) {
            await driver.waitForTimeout(mergedOptions.settleDelayMs);
          } else {
            await new Promise((res) => setTimeout(res, mergedOptions.settleDelayMs));
          }
        }
      } catch (err) {
        success = false;
        error = err instanceof Error ? err.message : String(err);
      }

      if (success) {
        successfulEvents++;
      } else {
        failedEvents++;
      }

      // 4. Measure Post-Event DOM Physics
      const postPhysics = await extractDomPhysics(driver);
      const stepEndTime = Date.now();

      // 5. Track Layout Shift between pre and post state
      const shiftEntry = this.tracker.trackSnapshotDiff(prePhysics, postPhysics, stepEndTime);

      // 6. Classify shift (Intentional feedback vs Unexpected shift defect)
      const { isExpected, defect } = classifyLayoutShift(event, shiftEntry, i);

      if (!isExpected && defect) {
        unexpectedShifts.push(defect);
      }

      stepResults.push({
        stepIndex: i,
        event,
        executedAt: new Date(stepStartTime).toISOString(),
        durationMs: Math.max(0, stepEndTime - stepStartTime),
        prePhysics,
        postPhysics,
        shiftEntry,
        isExpectedShift: isExpected,
        ...(defect !== undefined ? { defect } : {}),
        success,
        ...(error !== undefined ? { error } : {}),
      });
    }

    const durationMs = Date.now() - startTime;
    const clsReport = this.tracker.generateReport();

    const passed =
      unexpectedShifts.filter((d) => d.severity === "critical").length === 0 &&
      clsReport.clsScore <= mergedOptions.clsThreshold &&
      (!mergedOptions.failOnUnexpectedShift || unexpectedShifts.length === 0);

    const summary = passed
      ? `DOM Event Simulation Passed: ${events.length} events executed (${successfulEvents} ok, ${failedEvents} failed). CLS: ${clsReport.clsScore.toFixed(4)} (${clsReport.rating}), unexpected shifts: ${unexpectedShifts.length}.`
      : `DOM Event Simulation Flagged Defects: ${unexpectedShifts.length} unexpected layout shifts detected (CLS: ${clsReport.clsScore.toFixed(4)}).`;

    return {
      sessionId,
      totalEvents: events.length,
      successfulEvents,
      failedEvents,
      stepResults,
      clsReport,
      unexpectedShifts,
      passed,
      durationMs,
      summary,
    };
  }
}
