import type { LayoutShiftEntry } from "../layout-shift-tracker.ts";
import type { ExtractedElementPhysics } from "../types.ts";
import type {
  ExpectedShiftBehavior,
  SyntheticDomEvent,
  UnexpectedShiftDefect,
} from "./types.ts";

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

  const behavior: ExpectedShiftBehavior =
    event.expectedBehavior !== undefined ? event.expectedBehavior : "feedback_only";

  // If explicit no_shift requested, a shift > 0.001 is a defect
  if (behavior === "no_shift") {
    const severity =
      shiftEntry.score > 0.1 ? "critical" : shiftEntry.score > 0.02 ? "moderate" : "minor";
    const targetDescriptor = event.selector !== undefined ? event.selector : event.type;
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
        message: `Unexpected layout shift (score: ${shiftEntry.score.toFixed(4)}) on event '${event.type}' (${targetDescriptor}), expected zero shift.`,
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
    const targetDescriptor = event.selector !== undefined ? event.selector : event.type;
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
        message: `Interactive event '${event.type}' on '${targetDescriptor}' triggered unexpected layout shift (score: ${shiftEntry.score.toFixed(4)}), displacing ${shiftEntry.sources.length} elements.`,
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
