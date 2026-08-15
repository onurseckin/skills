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
