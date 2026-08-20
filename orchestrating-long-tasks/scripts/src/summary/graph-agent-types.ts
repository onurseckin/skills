import type { AgentModelTier, ThinkingLevel } from "../contracts/agents.ts";
import type { EvidenceClass, Evidenced } from "../contracts/evidence.ts";
import type { JsonObject } from "../contracts/json.ts";
import type { ToolCategory } from "../contracts/taxonomy.ts";

/** The role a node's agent held, taken from the grant ledger or the position in the workflow. */
export type NodeRole =
  | "coordinator"
  | "planner"
  | "implementer"
  | "validator"
  | "repairer"
  | "completeness-critic"
  | "sub-implementer"
  | "sub-validator"
  | "sub-investigator";

/**
 * One command the harness itself ran and timed for this node, with its output carried whole. The
 * `*Bytes` fields are the runner's own measurement of the log file, so a reader can tell a log that
 * was genuinely empty from one this export could not open, and `*Truncated` marks the only case in
 * which the text below is shorter than the file: a log so large that reading it would exhaust
 * memory. That flag is never set silently — an unflagged log is the complete one.
 *
 * The category, the tool and the extras are what the caller declared this command to be, never
 * anything read out of the argv, and `evidence` labels them apart from the harness's own readings.
 */
export interface NodeScript {
  commandId: string;
  argv: string[];
  /** What the runner actually spawned, when it differs from the requested argv. */
  executionArgv?: string[] | undefined;
  cwd?: string | undefined;
  cwdRelative?: string | undefined;
  repositoryRoot?: string | undefined;
  exitCode: number | null;
  signal?: string | undefined;
  signalsSent?: string[] | undefined;
  timeoutKind?: string | undefined;
  status?: string | undefined;
  startedAt: string;
  finishedAt?: string | undefined;
  durationMs?: number | undefined;
  gateId?: string | undefined;
  taskId?: string | undefined;
  actor?: string | undefined;
  logPath?: string | undefined;
  fingerprint?: string | undefined;
  assurance?: string | undefined;
  attemptCount?: number | undefined;
  retryExhausted?: boolean | undefined;
  evidenceIssues?: string[] | undefined;
  preflightFailure?: string | undefined;
  /** The complete recorded stdout. Named for the field the renderer already reads. */
  stdoutTail?: string | undefined;
  /** The complete recorded stderr. Named for the field the renderer already reads. */
  stderrTail?: string | undefined;
  stdoutBytes?: number | undefined;
  stderrBytes?: number | undefined;
  stdoutSha256?: string | undefined;
  stderrSha256?: string | undefined;
  stdoutTruncated?: boolean | undefined;
  stderrTruncated?: boolean | undefined;
  /**
   * The command record as the harness wrote it, so a field added to the record later reaches the
   * export without anyone remembering to map it. The child's environment is deliberately the one
   * thing withheld: it carries the live ownership token the runner issues, and a credential in a
   * file meant for a browser is a credential that has left the capsule.
   */
  record?: JsonObject | undefined;
  category?: ToolCategory | undefined;
  tool?: string | undefined;
  extras?: Record<string, unknown> | undefined;
  evidence_class: EvidenceClass;
  /** Provenance of the declared fields, keyed by the field name it labels. */
  evidence?: Record<string, EvidenceClass> | undefined;
}

export interface BrowserTestViewport {
  width: number;
  height: number;
}

export interface NamedBrowserTestViewport extends BrowserTestViewport {
  name: string;
}

/**
 * One automated browser run recorded against the node whose agent drove it. The clock and the exit
 * status are the harness's own readings; the browser, viewport, test file and artefact paths are
 * what the runner's report claimed, and `evidence` says which is which per field. A field no source
 * reported is absent, never defaulted — an unknown viewport is unknown.
 *
 * Screenshots are deliberately not here: evidence lives once, in `node.assets`.
 */
export interface BrowserTestRun {
  /** The recorded command this run belongs to, which is also what gives the node ownership of it. */
  commandId: string;
  /** The kind of tool this was. A run is recorded only when a browser-automation report was read. */
  category?: ToolCategory | undefined;
  runner?: string | undefined;
  testFile?: string | undefined;
  browser?: string | undefined;
  status?: string | undefined;
  durationMs?: number | undefined;
  /** Present only when the run declared exactly one viewport; several land in `viewports`. */
  viewport?: BrowserTestViewport | undefined;
  viewports?: NamedBrowserTestViewport[] | undefined;
  traces?: string[] | undefined;
  videos?: string[] | undefined;
  /** The report the tool-reported fields were read from. */
  reportPath?: string | undefined;
  /** What this runner reported that no other runner in its category would, under its own names. */
  extras?: Record<string, unknown> | undefined;
  evidence: Record<string, EvidenceClass>;
}

/**
 * One tool the node's agent was granted or reported using. The category is the generic vocabulary,
 * the name is the open instance, and the extras hold what only this tool reports. Never inferred
 * from the argv, and the category is never read out of the name.
 */
export interface NodeTool {
  name: string;
  category?: ToolCategory | undefined;
  type?: "generic" | "custom" | undefined;
  firstReportedAt?: string | undefined;
  extras?: Record<string, unknown> | undefined;
  evidence_class: EvidenceClass;
}

/**
 * Per-agent telemetry, sourced only from the grant ledger. A field the host never reported has no
 * entry here at all — the node then simply has no model, which is the truthful rendering.
 */
export interface NodeTelemetry {
  agentId?: string | undefined;
  role?: NodeRole | undefined;
  host?: string | undefined;
  provider?: Evidenced<string> | undefined;
  /** The model string exactly as the host reported it. Never parsed and never matched against. */
  model?: Evidenced<string> | undefined;
  modelTier?: Evidenced<AgentModelTier> | undefined;
  thinkingLevel?: Evidenced<ThinkingLevel> | undefined;
  contextWindow?: Evidenced<number> | undefined;
  tokensIn?: Evidenced<number> | undefined;
  tokensOut?: Evidenced<number> | undefined;
  /** Counters only some providers keep, under the names those providers reported them by. */
  tokenExtras?: Record<string, Evidenced<number>> | undefined;
  grantStatus?: string | undefined;
}
