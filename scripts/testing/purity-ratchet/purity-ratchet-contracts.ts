import type { PurityViolation } from "../guardrails/index.ts";
import type { PurityBaselineEntry } from "../purity-baseline/index.ts";

export type PurityRatchetMode = "ratchet" | "strict";

export type PurityRatchetFormat = "markdown" | "json" | "jsonl";

export type { PurityBaseline, PurityBaselineEntry } from "../purity-baseline/index.ts";

export interface PurityRatchetDelta {
  readonly file: string;
  readonly rule: string;
  readonly observed: number;
  readonly baseline: number;
}

export interface PurityRatchetDeltaSet {
  readonly added: readonly PurityRatchetDelta[];
  readonly worsened: readonly PurityRatchetDelta[];
  readonly resolved: readonly PurityRatchetDelta[];
}

export interface PurityAuditSnapshot {
  readonly scannedFiles: number;
  readonly violations: readonly PurityViolation[];
}

export type PurityAuditPort = () => PurityAuditSnapshot;

export interface PurityRatchetOptions {
  readonly repoRoot: string;
  readonly mode: PurityRatchetMode;
  readonly baselinePath?: string;
  readonly audit?: PurityAuditPort;
}

export interface PurityRatchetReport {
  readonly mode: PurityRatchetMode;
  readonly scannedFiles: number;
  readonly totalViolations: number;
  readonly current: readonly PurityBaselineEntry[];
  readonly baselineDelta: PurityRatchetDeltaSet;
  readonly passed: boolean;
}
