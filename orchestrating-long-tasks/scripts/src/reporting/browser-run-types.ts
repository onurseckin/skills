import type { EvidenceClass } from "../contracts/evidence.ts";
import type { CategoryExtras, ToolCategory } from "../contracts/taxonomy.ts";

export interface BrowserRunViewport {
  width: number;
  height: number;
}

/** A viewport the report gave a name to, kept only when a run declared more than one. */
export interface NamedBrowserRunViewport extends BrowserRunViewport {
  name: string;
}

/**
 * What a browser or visual suite run left behind, as facts rather than assumptions. Every field is
 * optional because a runner that never reported one leaves it absent: the harness measures the
 * clock and the exit status itself, and reads everything else out of the tool's own report file.
 * Nothing here is inferred from an argv, a file name or a directory name.
 */
export interface BrowserRunRecord {
  command_id: string;
  task_id?: string | undefined;
  actor?: string | undefined;
  /** The report the harness read the tool-reported fields from, so a claim can be traced back. */
  report_path?: string | undefined;
  /**
   * The generic kind of tool this was. It follows from the ingestion path — a record exists only
   * because a browser-automation report was read — not from anything in the runner's name.
   */
  category?: ToolCategory | undefined;
  /** The runner as it named itself. An open instance string, never matched against a known list. */
  runner?: string | undefined;
  test_file?: string | undefined;
  browser?: string | undefined;
  status?: string | undefined;
  duration_ms?: number | undefined;
  /** Set only when the run declared exactly one viewport; several land in `viewports` instead. */
  viewport?: BrowserRunViewport | undefined;
  viewports?: NamedBrowserRunViewport[] | undefined;
  traces?: string[] | undefined;
  videos?: string[] | undefined;
  /**
   * What this report carried that the generic fields have no home for, under the names the report
   * used. Kept so a runner reporting something unusual loses none of it.
   */
  extras?: CategoryExtras | undefined;
  /** How each recorded field came to be known, keyed by the field name it labels. */
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
  /** Harness clock readings for the command that drove the run. */
  startedAt?: string | null | undefined;
  finishedAt?: string | null | undefined;
  exitCode?: number | null | undefined;
}
