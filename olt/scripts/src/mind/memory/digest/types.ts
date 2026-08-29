import { basename, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { loadRun } from "../../../engine/store/index.ts";
import {
  generateTrailingValueSeries,
  extractTrailingValueSeriesFromState,
  extractTrailingValueSeriesFromEvents,
  type TrailingValueSeries,
  type TrailingValuePoint,
} from "../../lifecycle/interval/index.ts";

export interface FormatDigestOptions {
  readonly title?: string | undefined;
  readonly explicitEmptyUnasked?: boolean | undefined;
  readonly includeTrailingValueSeries?: boolean | undefined;
}

export interface MemoryDigestOptions {
  readonly runId?: string | undefined;
  readonly state?: Record<string, unknown> | undefined;
  readonly trailingSeries?: TrailingValueSeries | undefined;
}

export interface DigestFinding {
  readonly findingId: string;
  readonly taskId?: string | undefined;
  readonly runId?: string | undefined;
  readonly severity?: "critical" | "important" | "minor" | string | undefined;
  readonly observation: string;
  readonly remediation?: string | undefined;
  readonly revalidationGate?: string | undefined;
  readonly commandSource?: string | undefined;
  readonly eventIndex?: number | undefined;
}

export interface DigestFailingGate {
  readonly gateId: string;
  readonly taskId?: string | undefined;
  readonly runId?: string | undefined;
  readonly command: readonly string[] | string;
  readonly exitCode?: number | undefined;
  readonly failureSnippet?: string | undefined;
  readonly commandSource?: string | undefined;
  readonly eventIndex?: number | undefined;
}

export interface DigestEscalation {
  readonly escalationId: string;
  readonly taskId?: string | undefined;
  readonly runId?: string | undefined;
  readonly reason: string;
  readonly evidence?: string | undefined;
  readonly escalatedAt?: string | undefined;
  readonly commandSource?: string | undefined;
  readonly eventIndex?: number | undefined;
}

export interface DigestDeclinedCandidate {
  readonly candidateId: string;
  readonly statement: string;
  readonly rationale?: string | undefined;
  readonly declineReason: string;
  readonly charterGoalId?: string | undefined;
  readonly witnessCommandId?: string | undefined;
  readonly commandSource?: string | undefined;
  readonly eventIndex?: number | undefined;
  readonly declinedAt?: string | undefined;
}

export interface DigestOpenProposal {
  readonly proposalId: string;
  readonly statement: string;
  readonly rationale: string;
  readonly charterGoalId?: string | undefined;
  readonly requirementId?: string | undefined;
  readonly witnessCommandId?: string | undefined;
  readonly proposedAt?: string | undefined;
  readonly commandSource?: string | undefined;
  readonly eventIndex?: number | undefined;
}

export interface MemoryDigest {
  readonly runId: string;
  readonly generatedAt: string;
  readonly findings: readonly DigestFinding[];
  readonly gates: readonly DigestFailingGate[];
  readonly escalations: readonly DigestEscalation[];
  readonly declinedCandidates: readonly DigestDeclinedCandidate[];
  readonly openProposals: readonly DigestOpenProposal[];
  readonly trailingSeries: TrailingValueSeries;
}

export interface EscalationDigestData {
  readonly generatedAt: string;
  readonly runId: string;
  readonly openFindings: readonly DigestFinding[];
  readonly failingGates: readonly DigestFailingGate[];
  readonly escalations: readonly DigestEscalation[];
  readonly declinedCandidates: readonly DigestDeclinedCandidate[];
  readonly openProposals: readonly DigestOpenProposal[];
  readonly trailingValueSeries: TrailingValueSeries;
  readonly totalSignalsCount: number;
}

export type OwnerDigestData = EscalationDigestData;

export interface BuildEscalationDigestOptions {
  readonly runId?: string | undefined;
  readonly now?: Date | string | number | undefined;
  readonly openFindings?: readonly DigestFinding[] | undefined;
  readonly failingGates?: readonly DigestFailingGate[] | undefined;
  readonly escalations?: readonly DigestEscalation[] | undefined;
  readonly declinedCandidates?: readonly DigestDeclinedCandidate[] | undefined;
  readonly openProposals?: readonly DigestOpenProposal[] | undefined;
  readonly trailingValueSeries?:
    | TrailingValueSeries
    | readonly number[]
    | readonly TrailingValuePoint[]
    | undefined;
  readonly events?: readonly Record<string, unknown>[] | undefined;
  readonly state?: Record<string, unknown> | undefined;
  readonly liveRuns?:
    | readonly {
        readonly runId: string;
        readonly runRoot?: string | undefined;
        readonly state?: Record<string, unknown> | undefined;
      }[]
    | undefined;
  readonly capsulesDir?: string | undefined;
  readonly mindRunRoot?: string | undefined;
  readonly windowSize?: number | undefined;
}

export type BuildOwnerDigestOptions = BuildEscalationDigestOptions;

export function parseNowIso(nowInput?: number | Date | string): string {
  if (typeof nowInput === "number") {
    return new Date(nowInput).toISOString();
  }
  if (nowInput instanceof Date) {
    return nowInput.toISOString();
  }
  if (typeof nowInput === "string") {
    const parsed = Date.parse(nowInput);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return new Date().toISOString();
}

export function normalizeCommandString(command: readonly string[] | string): string {
  return Array.isArray(command) ? command.join(" ") : String(command);
}
