import type { CaptureRecord } from "../store/captures.ts";

export interface ViewportMetrics {
  width: number;
  height: number;
  devicePixelRatio?: number | undefined;
  scrollWidth?: number | undefined;
  scrollHeight?: number | undefined;
}

export interface OverflowViolation {
  element: string;
  selector?: string | undefined;
  scrollWidth: number;
  clientWidth: number;
  delta: number;
  viewport?: string | undefined;
}

export interface ClippingViolation {
  element: string;
  selector?: string | undefined;
  text?: string | undefined;
  scrollWidth: number;
  clientWidth: number;
  viewport?: string | undefined;
}

export interface StackingViolation {
  elements: string[];
  selectors?: string[] | undefined;
  zIndex?: number | undefined;
  overlapArea?: number | undefined;
  viewport?: string | undefined;
}

export interface VisualMetricsReport {
  /** When the report says it was produced. Absent when the file carried no timestamp of its own. */
  timestamp?: string | undefined;
  viewports: Record<string, ViewportMetrics>;
  layoutOverflows: OverflowViolation[];
  textClippings: ClippingViolation[];
  collisions: StackingViolation[];
  metadata?: Record<string, unknown> | undefined;
}

/**
 * A screenshot is a capture like any other: its bytes live once in `blobs/`, `path` is the readable
 * name that links to them, and the ledger in `captures.json` is the one home for the record.
 */
export type ScreenshotRecord = CaptureRecord;

/**
 * `startedAt` bounds attribution. A file that already existed when the command started was not
 * produced by it, and claiming it would attribute one stale image to every command in the run.
 * Paths the caller names explicitly, and paths the command printed, are the command's own claim.
 */
export interface ScreenshotIngestOptions {
  runRoot: string;
  commandId?: string | undefined;
  taskId?: string | undefined;
  actor?: string | undefined;
  searchDirs?: string[] | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  explicitPaths?: string[] | undefined;
  startedAt?: string | null | undefined;
}

export interface VisualReportIngestOptions {
  runRoot: string;
  commandId?: string | undefined;
  taskId?: string | undefined;
  actor?: string | undefined;
  searchDirs?: string[] | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  explicitPaths?: string[] | undefined;
  startedAt?: string | null | undefined;
}

export interface ScreenshotQueryOptions {
  taskId?: string | undefined;
  commandId?: string | undefined;
  actor?: string | undefined;
}
