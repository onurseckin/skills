import type { EvidenceClass } from "../core/contracts/evidence.ts";
import type { CategoryExtras, ToolCategory } from "../core/contracts/taxonomy.ts";

export interface BrowserRunViewport {
  width: number;
  height: number;
}

export interface NamedBrowserRunViewport extends BrowserRunViewport {
  name: string;
}

export interface BrowserRunRecord {
  command_id: string;
  task_id?: string | undefined;
  actor?: string | undefined;
  report_path?: string | undefined;
  category?: ToolCategory | undefined;
  runner?: string | undefined;
  test_file?: string | undefined;
  browser?: string | undefined;
  status?: string | undefined;
  duration_ms?: number | undefined;
  viewport?: BrowserRunViewport | undefined;
  viewports?: NamedBrowserRunViewport[] | undefined;
  traces?: string[] | undefined;
  videos?: string[] | undefined;
  extras?: CategoryExtras | undefined;
  evidence_classes: Record<string, EvidenceClass>;
}

export interface BrowserRunQueryOptions {
  commandId?: string | undefined;
  taskId?: string | undefined;
}

export interface BrowserRunIngestOptions {
  runRoot: string;
  commandId: string;
  taskId?: string | undefined;
  actor?: string | undefined;
  searchDirs?: string[] | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  explicitPaths?: string[] | undefined;
  startedAt?: string | null | undefined;
  finishedAt?: string | null | undefined;
  exitCode?: number | null | undefined;
}
