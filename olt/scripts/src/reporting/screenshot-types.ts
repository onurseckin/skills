import type { CaptureRecord } from "../engine/store/captures.ts";

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
  timestamp?: string | undefined;
  viewports: Record<string, ViewportMetrics>;
  layoutOverflows: OverflowViolation[];
  textClippings: ClippingViolation[];
  collisions: StackingViolation[];
  metadata?: Record<string, unknown> | undefined;
}

export type ScreenshotRecord = CaptureRecord;

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
