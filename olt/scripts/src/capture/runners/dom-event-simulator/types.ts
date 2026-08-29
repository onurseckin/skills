import type {
  CumulativeLayoutShiftReport,
  LayoutShiftEntry,
  LayoutShiftTrackerOptions,
  ResolvedLayoutShiftTrackerOptions,
  UnstableElementDisplacement,
} from "../layout-shift-tracker.ts";
import type { CapturePageDriver, DomPhysicsSnapshot } from "../types.ts";

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
