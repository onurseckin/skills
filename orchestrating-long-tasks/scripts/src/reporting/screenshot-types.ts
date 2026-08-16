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
  timestamp: string;
  viewports: Record<string, ViewportMetrics>;
  layoutOverflows: OverflowViolation[];
  textClippings: ClippingViolation[];
  collisions: StackingViolation[];
  metadata?: Record<string, unknown> | undefined;
}

export interface ScreenshotRecord {
  name: string;
  original_path: string;
  evidence_path: string;
  report_path: string;
  command_id?: string | undefined;
  task_id?: string | undefined;
  actor?: string | undefined;
  size_bytes?: number | undefined;
  timestamp: string;
  dimensions?: { width: number; height: number } | undefined;
  mime_type?: string | undefined;
  overwrite?: boolean | undefined;
}

export interface ScreenshotIngestOptions {
  runRoot: string;
  commandId?: string | undefined;
  taskId?: string | undefined;
  actor?: string | undefined;
  searchDirs?: string[] | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  explicitPaths?: string[] | undefined;
  overwrite?: boolean | undefined;
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
  overwrite?: boolean | undefined;
}

export interface ScreenshotQueryOptions {
  taskId?: string | undefined;
  commandId?: string | undefined;
  actor?: string | undefined;
}

export interface EvidenceManifestData {
  screenshots: ScreenshotRecord[];
  updated_at: string;
}
