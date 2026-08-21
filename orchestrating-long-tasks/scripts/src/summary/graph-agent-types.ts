import type { AgentModelTier, TelemetryFieldConflict, ThinkingLevel } from "../contracts/agents.ts";
import type { EvidenceClass, Evidenced } from "../contracts/evidence.ts";
import type { JsonObject } from "../contracts/json.ts";
import type { ToolCategory } from "../contracts/taxonomy.ts";
import type { ValidatorDomain } from "../contracts/workflow.ts";

export type NodeRole =
  | "coordinator"
  | "orchestrator"
  | "planner"
  | "implementer"
  | "validator"
  | "plan-validator"
  | "repairer"
  | "completeness-critic"
  | "sub-implementer"
  | "sub-validator"
  | "sub-investigator";

export type NodeValidatorDomain = ValidatorDomain | "unknown";

export interface NodeScript {
  commandId: string;
  argv: string[];
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
  stdoutTail?: string | undefined;
  stderrTail?: string | undefined;
  stdoutBytes?: number | undefined;
  stderrBytes?: number | undefined;
  stdoutSha256?: string | undefined;
  stderrSha256?: string | undefined;
  stdoutTruncated?: boolean | undefined;
  stderrTruncated?: boolean | undefined;
  record?: JsonObject | undefined;
  category?: ToolCategory | undefined;
  tool?: string | undefined;
  extras?: Record<string, unknown> | undefined;
  evidence_class: EvidenceClass;
  evidence?: Record<string, EvidenceClass> | undefined;
}

export interface BrowserTestViewport {
  width: number;
  height: number;
}

export interface NamedBrowserTestViewport extends BrowserTestViewport {
  name: string;
}

export interface BrowserTestRun {
  commandId: string;
  category?: ToolCategory | undefined;
  runner?: string | undefined;
  testFile?: string | undefined;
  browser?: string | undefined;
  status?: string | undefined;
  durationMs?: number | undefined;
  viewport?: BrowserTestViewport | undefined;
  viewports?: NamedBrowserTestViewport[] | undefined;
  traces?: string[] | undefined;
  videos?: string[] | undefined;
  reportPath?: string | undefined;
  extras?: Record<string, unknown> | undefined;
  evidence: Record<string, EvidenceClass>;
}

export interface NodeTool {
  name: string;
  category?: ToolCategory | undefined;
  type?: "generic" | "custom" | undefined;
  firstReportedAt?: string | undefined;
  extras?: Record<string, unknown> | undefined;
  evidence_class: EvidenceClass;
}

export interface NodeTelemetry {
  agentId?: string | undefined;
  role?: NodeRole | undefined;
  host?: string | undefined;
  provider?: Evidenced<string> | undefined;
  model?: Evidenced<string> | undefined;
  modelTier?: Evidenced<AgentModelTier> | undefined;
  thinkingLevel?: Evidenced<ThinkingLevel> | undefined;
  contextWindow?: Evidenced<number> | undefined;
  tokensIn?: Evidenced<number> | undefined;
  tokensOut?: Evidenced<number> | undefined;
  tokenExtras?: Record<string, Evidenced<number>> | undefined;
  grantStatus?: string | undefined;
  telemetryConflicts?: readonly TelemetryFieldConflict[] | undefined;
}
