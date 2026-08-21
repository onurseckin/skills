import { extractDomPhysics } from "./dom-physics-extractor.ts";
import {
  buildCumulativeLayoutShiftReport,
  detectLayoutShiftBetweenSnapshots,
  LayoutShiftTracker,
  resolveLayoutShiftTrackerOptions,
  type CumulativeLayoutShiftReport,
  type LayoutShiftEntry,
  type LayoutShiftTrackerOptions,
  type ResolvedLayoutShiftTrackerOptions,
  type UnstableElementDisplacement,
} from "./layout-shift-tracker.ts";
import type {
  CapturePageDriver,
  DomPhysicsSnapshot,
  ExtractedElementPhysics,
} from "./types.ts";

export type SyntheticDomEventType =
  | "click"
  | "dblclick"
  | "hover"
  | "mouseenter"
  | "mouseleave"
  | "scroll"
  | "focus"
  | "blur"
  | "keypress"
  | "keydown"
  | "keyup"
  | "input"
  | "resize"
  | "mediaQuery"
  | "wait"
  | "custom";

export type ExpectedShiftBehavior =
  | "feedback_only"
  | "layout_expansion"
  | "modal_open"
  | "navigation"
  | "no_shift";

export interface SyntheticDomEvent {
  readonly id?: string | undefined;
  readonly type: SyntheticDomEventType;
  readonly selector?: string | undefined;
  readonly coordinates?: { readonly x: number; readonly y: number } | undefined;
  readonly scrollDelta?: { readonly deltaX: number; readonly deltaY: number } | undefined;
  readonly scrollTarget?: { readonly x: number; readonly y: number } | undefined;
  readonly key?: string | undefined;
  readonly text?: string | undefined;
  readonly keyCode?: number | undefined;
  readonly viewport?: { readonly width: number; readonly height: number } | undefined;
  readonly mediaQuery?: { readonly query: string; readonly matches: boolean } | undefined;
  readonly delayMs?: number | undefined;
  readonly expectedBehavior?: ExpectedShiftBehavior | undefined;
  readonly description?: string | undefined;
  readonly customAction?: ((driver: CapturePageDriver) => Promise<void>) | undefined;
}

export interface UnexpectedShiftDefect {
  readonly eventIndex: number;
  readonly eventType: SyntheticDomEventType;
  readonly selector?: string | undefined;
  readonly shiftScore: number;
  readonly impactFraction: number;
  readonly distanceFraction: number;
  readonly rootCauses: readonly UnstableElementDisplacement[];
  readonly message: string;
  readonly severity: "minor" | "moderate" | "critical";
}

export interface DomEventStepResult {
  readonly stepIndex: number;
  readonly event: SyntheticDomEvent;
  readonly executedAt: string;
  readonly durationMs: number;
  readonly prePhysics: DomPhysicsSnapshot;
  readonly postPhysics: DomPhysicsSnapshot;
  readonly shiftEntry: LayoutShiftEntry;
  readonly isExpectedShift: boolean;
  readonly defect?: UnexpectedShiftDefect | undefined;
  readonly success: boolean;
  readonly error?: string | undefined;
}

export interface DomEventSimulationReport {
  readonly sessionId: string;
  readonly totalEvents: number;
  readonly successfulEvents: number;
  readonly failedEvents: number;
  readonly stepResults: readonly DomEventStepResult[];
  readonly clsReport: CumulativeLayoutShiftReport;
  readonly unexpectedShifts: readonly UnexpectedShiftDefect[];
  readonly passed: boolean;
  readonly durationMs: number;
  readonly summary: string;
}

export interface DomSimulationOptions {
  readonly settleDelayMs?: number | undefined;
  readonly clsThreshold?: number | undefined;
  readonly failOnUnexpectedShift?: boolean | undefined;
  readonly trackerOptions?: LayoutShiftTrackerOptions | undefined;
}

export interface ResolvedDomSimulationOptions {
  readonly settleDelayMs: number;
  readonly clsThreshold: number;
  readonly failOnUnexpectedShift: boolean;
  readonly trackerOptions: ResolvedLayoutShiftTrackerOptions;
}

export const DEFAULT_DOM_SIMULATION_OPTIONS: ResolvedDomSimulationOptions = {
  settleDelayMs: 50,
  clsThreshold: 0.1,
  failOnUnexpectedShift: false,
  trackerOptions: {
    subpixelTolerance: 0.5,
    userInputWindowMs: 500,
    sessionMaxDurationMs: 5000,
    sessionMaxGapMs: 1000,
    excludeFixedSticky: true,
    excludeTransformOnly: true,
    excludeOpacityOnly: true,
    ignoreUserInputShifts: false,
  },
};

export function resolveDomSimulationOptions(
  options?: DomSimulationOptions,
): ResolvedDomSimulationOptions {
  return {
    settleDelayMs: options?.settleDelayMs ?? DEFAULT_DOM_SIMULATION_OPTIONS.settleDelayMs,
    clsThreshold: options?.clsThreshold ?? DEFAULT_DOM_SIMULATION_OPTIONS.clsThreshold,
    failOnUnexpectedShift:
      options?.failOnUnexpectedShift ?? DEFAULT_DOM_SIMULATION_OPTIONS.failOnUnexpectedShift,
    trackerOptions: resolveLayoutShiftTrackerOptions(options?.trackerOptions),
  };
}

export const DOM_EVENT_DISPATCH_SCRIPT = `
(payload) => {
  const { type, selector, text, key, scrollX, scrollY, scrollDeltaX, scrollDeltaY, mediaQuery, matches } = payload || {};
  const el = selector ? document.querySelector(selector) : document.body;

  switch (type) {
    case 'click':
    case 'dblclick':
      if (el) {
        if (typeof el.click === 'function') {
          el.click();
        } else {
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
        }
      }
      break;
    case 'hover':
    case 'mouseenter':
      if (el) {
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true }));
      }
      break;
    case 'mouseleave':
      if (el) {
        el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, cancelable: true }));
      }
      break;
    case 'scroll':
      if (scrollX !== undefined && scrollY !== undefined) {
        const target = selector ? el : window;
        if (target && typeof target.scrollTo === 'function') {
          target.scrollTo(scrollX, scrollY);
        }
      } else if (scrollDeltaX !== undefined || scrollDeltaY !== undefined) {
        const target = selector ? el : window;
        if (target && typeof target.scrollBy === 'function') {
          target.scrollBy(scrollDeltaX || 0, scrollDeltaY || 0);
        }
      }
      break;
    case 'focus':
      if (el && typeof el.focus === 'function') {
        el.focus();
        el.dispatchEvent(new FocusEvent('focus', { bubbles: false, cancelable: false }));
        el.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: false }));
      }
      break;
    case 'blur':
      if (el && typeof el.blur === 'function') {
        el.blur();
        el.dispatchEvent(new FocusEvent('blur', { bubbles: false, cancelable: false }));
        el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: false }));
      }
      break;
    case 'keypress':
    case 'keydown':
    case 'keyup':
    case 'input':
      if (el) {
        if (text !== undefined && 'value' in el) {
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (key) {
          el.dispatchEvent(new KeyboardEvent(type === 'keyup' ? 'keyup' : 'keydown', {
            key,
            bubbles: true,
            cancelable: true
          }));
        }
      }
      break;
    case 'mediaQuery':
      if (mediaQuery && mediaQuery.includes('prefers-color-scheme: dark')) {
        document.documentElement.classList.toggle('dark', Boolean(matches));
        document.documentElement.setAttribute('data-theme', matches ? 'dark' : 'light');
      } else if (mediaQuery && mediaQuery.includes('prefers-reduced-motion')) {
        document.documentElement.setAttribute('data-reduced-motion', matches ? 'true' : 'false');
      }
      break;
  }
}
`;

/**
 * Dispatches a simulated interactive event to a CapturePageDriver.
 */
export async function simulateDomEvent(
  driver: CapturePageDriver,
  event: SyntheticDomEvent,
): Promise<void> {
  switch (event.type) {
    case "click":
    case "dblclick": {
      if (event.selector && driver.click) {
        await driver.click(event.selector);
      } else if (event.selector) {
        await driver.evaluate(DOM_EVENT_DISPATCH_SCRIPT, {
          type: event.type,
          selector: event.selector,
        });
      }
      break;
    }

    case "hover":
    case "mouseenter":
    case "mouseleave": {
      if ((event.type === "hover" || event.type === "mouseenter") && event.selector && driver.hover) {
        await driver.hover(event.selector);
      } else if (event.selector) {
        await driver.evaluate(DOM_EVENT_DISPATCH_SCRIPT, {
          type: event.type,
          selector: event.selector,
        });
      }
      break;
    }

    case "scroll": {
      await driver.evaluate(DOM_EVENT_DISPATCH_SCRIPT, {
        type: "scroll",
        selector: event.selector,
        scrollX: event.scrollTarget?.x,
        scrollY: event.scrollTarget?.y,
        scrollDeltaX: event.scrollDelta?.deltaX,
        scrollDeltaY: event.scrollDelta?.deltaY,
      });
      break;
    }

    case "focus":
    case "blur": {
      if (event.selector) {
        await driver.evaluate(DOM_EVENT_DISPATCH_SCRIPT, {
          type: event.type,
          selector: event.selector,
        });
      }
      break;
    }

    case "keypress":
    case "keydown":
    case "keyup":
    case "input": {
      if (event.text !== undefined && event.selector && driver.fill) {
        await driver.fill(event.selector, event.text);
      } else if (event.selector) {
        await driver.evaluate(DOM_EVENT_DISPATCH_SCRIPT, {
          type: event.type,
          selector: event.selector,
          text: event.text,
          key: event.key,
        });
      }
      break;
    }

    case "resize": {
      if (event.viewport) {
        await driver.setViewportSize(event.viewport);
      }
      break;
    }

    case "mediaQuery": {
      if (event.mediaQuery) {
        await driver.evaluate(DOM_EVENT_DISPATCH_SCRIPT, {
          type: "mediaQuery",
          mediaQuery: event.mediaQuery.query,
          matches: event.mediaQuery.matches,
        });
      }
      break;
    }

    case "wait": {
      const waitMs = event.delayMs ?? 100;
      if (driver.waitForTimeout) {
        await driver.waitForTimeout(waitMs);
      } else {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      break;
    }

    case "custom": {
      if (event.customAction) {
        await event.customAction(driver);
      }
      break;
    }
  }
}

/**
 * Evaluates whether an observed layout shift is intentional user feedback vs an unexpected layout shift defect.
 */
export function classifyLayoutShift(
  event: SyntheticDomEvent,
  shiftEntry: LayoutShiftEntry,
  stepIndex: number,
): { isExpected: boolean; defect?: UnexpectedShiftDefect | undefined } {
  if (shiftEntry.score < 0.001 || shiftEntry.sources.length === 0) {
    return { isExpected: true };
  }

  const behavior: ExpectedShiftBehavior = event.expectedBehavior ?? "feedback_only";

  // If explicit no_shift requested, any shift > 0.001 is a defect
  if (behavior === "no_shift") {
    const severity =
      shiftEntry.score > 0.1 ? "critical" : shiftEntry.score > 0.02 ? "moderate" : "minor";
    return {
      isExpected: false,
      defect: {
        eventIndex: stepIndex,
        eventType: event.type,
        ...(event.selector !== undefined ? { selector: event.selector } : {}),
        shiftScore: shiftEntry.score,
        impactFraction: shiftEntry.impactFraction,
        distanceFraction: shiftEntry.distanceFraction,
        rootCauses: shiftEntry.rootCauses,
        message: `Unexpected layout shift (score: ${shiftEntry.score.toFixed(4)}) on event '${event.type}' (${event.selector ?? "viewport"}), expected zero shift.`,
        severity,
      },
    };
  }

  // If layout expansion or modal open, check if root cause is the targeted element or its descendants
  if (behavior === "layout_expansion" || behavior === "modal_open") {
    const targetSel = event.selector;
    let isTargetRelated = false;

    if (!targetSel) {
      isTargetRelated = true;
    } else {
      for (const rc of shiftEntry.rootCauses) {
        if (
          rc.selector === targetSel ||
          rc.selector.includes(targetSel) ||
          targetSel.includes(rc.selector)
        ) {
          isTargetRelated = true;
          break;
        }
      }
    }

    if (isTargetRelated) {
      return { isExpected: true };
    }
  }

  // If feedback_only (e.g. hover, click on regular button, focus on input),
  // layout should NOT shift other unrelated page elements (> 0.01 score)
  if (behavior === "feedback_only" && shiftEntry.score > 0.01) {
    const severity = shiftEntry.score > 0.1 ? "critical" : "moderate";
    return {
      isExpected: false,
      defect: {
        eventIndex: stepIndex,
        eventType: event.type,
        ...(event.selector !== undefined ? { selector: event.selector } : {}),
        shiftScore: shiftEntry.score,
        impactFraction: shiftEntry.impactFraction,
        distanceFraction: shiftEntry.distanceFraction,
        rootCauses: shiftEntry.rootCauses,
        message: `Interactive event '${event.type}' on '${event.selector ?? "element"}' triggered unexpected layout shift (score: ${shiftEntry.score.toFixed(4)}), displacing ${shiftEntry.sources.length} elements.`,
        severity,
      },
    };
  }

  return { isExpected: true };
}

/**
 * Builds a standardized sequence of interactive test events based on extracted DOM elements.
 */
export function buildSyntheticInteractionPlan(
  elements: readonly ExtractedElementPhysics[],
  viewport: { width: number; height: number } = { width: 1440, height: 900 },
): readonly SyntheticDomEvent[] {
  const events: SyntheticDomEvent[] = [];

  // 1. Initial settle check
  events.push({
    type: "wait",
    delayMs: 50,
    expectedBehavior: "no_shift",
    description: "Initial page stabilization",
  });

  // 2. Interactive elements (buttons, inputs, links)
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    const role = el.role?.toLowerCase();

    if (tag === "button" || role === "button") {
      events.push({
        type: "hover",
        selector: el.selector,
        expectedBehavior: "feedback_only",
        description: `Hover test on button: ${el.selector}`,
      });
      events.push({
        type: "click",
        selector: el.selector,
        expectedBehavior: "feedback_only",
        description: `Click test on button: ${el.selector}`,
      });
    } else if (tag === "input" || tag === "textarea" || role === "textbox") {
      events.push({
        type: "focus",
        selector: el.selector,
        expectedBehavior: "feedback_only",
        description: `Focus test on input: ${el.selector}`,
      });
      events.push({
        type: "input",
        selector: el.selector,
        text: "Test Input",
        expectedBehavior: "feedback_only",
        description: `Text input test on: ${el.selector}`,
      });
      events.push({
        type: "blur",
        selector: el.selector,
        expectedBehavior: "feedback_only",
        description: `Blur test on: ${el.selector}`,
      });
    }
  }

  // 3. Scroll simulation
  events.push({
    type: "scroll",
    scrollDelta: { deltaX: 0, deltaY: 200 },
    expectedBehavior: "feedback_only",
    description: "Downwards scroll simulation",
  });
  events.push({
    type: "scroll",
    scrollTarget: { x: 0, y: 0 },
    expectedBehavior: "feedback_only",
    description: "Scroll to top simulation",
  });

  // 4. Responsive viewport resize simulation
  if (viewport.width > 600) {
    events.push({
      type: "resize",
      viewport: { width: 375, height: 667 },
      expectedBehavior: "layout_expansion",
      description: "Mobile viewport resize test",
    });
    events.push({
      type: "resize",
      viewport: { width: viewport.width, height: viewport.height },
      expectedBehavior: "layout_expansion",
      description: "Desktop viewport restore test",
    });
  }

  // 5. Dark mode media query simulation
  events.push({
    type: "mediaQuery",
    mediaQuery: { query: "(prefers-color-scheme: dark)", matches: true },
    expectedBehavior: "feedback_only",
    description: "Dark mode preference simulation",
  });

  return events;
}

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
      failOnUnexpectedShift:
        options?.failOnUnexpectedShift ?? this.options.failOnUnexpectedShift,
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
