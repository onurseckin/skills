import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CommandRecord } from "../core/contracts/index.ts";
import type { HarnessEvent, RunState } from "../core/contracts/index.ts";
import type { JsonObject, JsonValue } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import { resolveWitnessCommand, verifyDefectWitness } from "./witness.ts";
import { calculatePulseValue, type PulseValueMetrics } from "./value.ts";

export const AUDIT_QUESTION_IDS = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"] as const;

export type AuditQuestionId = (typeof AUDIT_QUESTION_IDS)[number];

export interface AuditQuestionDefinition {
  readonly id: AuditQuestionId;
  readonly key: string;
  readonly text: string;
}

export const AUDIT_QUESTIONS: readonly AuditQuestionDefinition[] = [
  {
    id: "Q1",
    key: "pulse_gaps",
    text: "Does every pulse in the window have exactly one open and one close? Name the gaps.",
  },
  {
    id: "Q2",
    key: "witness_defects",
    text: "Does every admitted candidate still have a witness whose command output shows the defect?",
  },
  {
    id: "Q3",
    key: "charter_goals",
    text: "Did any admitted candidate cite a charter goal that does not exist?",
  },
  {
    id: "Q4",
    key: "value_consistency",
    text: "Is the trailing value series consistent with the work the ledger claims?",
  },
  {
    id: "Q5",
    key: "scope_violations",
    text: "Did anything change outside a declared write scope?",
  },
  {
    id: "Q6",
    key: "never_unattended",
    text: "Did any pulse take an action on the never-unattended list?",
  },
  {
    id: "Q7",
    key: "declined_candidates",
    text: "What did the mind decline to do, and does the reason survive re-reading?",
  },
  {
    id: "Q8",
    key: "charter_digest",
    text: "Did the charter digest change without an owner decision?",
  },
];

export const QUESTION_ID_MAP: Readonly<Record<string, AuditQuestionId>> = {
  q1: "Q1",
  "1": "Q1",
  pulse_gaps: "Q1",
  "pulse-gaps": "Q1",
  q2: "Q2",
  "2": "Q2",
  witness_defects: "Q2",
  "witness-defects": "Q2",
  q3: "Q3",
  "3": "Q3",
  charter_goals: "Q3",
  "charter-goals": "Q3",
  q4: "Q4",
  "4": "Q4",
  value_consistency: "Q4",
  "value-consistency": "Q4",
  q5: "Q5",
  "5": "Q5",
  scope_violations: "Q5",
  "scope-violations": "Q5",
  q6: "Q6",
  "6": "Q6",
  never_unattended: "Q6",
  "never-unattended": "Q6",
  q7: "Q7",
  "7": "Q7",
  declined_candidates: "Q7",
  "declined-candidates": "Q7",
  q8: "Q8",
  "8": "Q8",
  charter_digest: "Q8",
  "charter-digest": "Q8",
};

export function normalizeQuestionId(raw: string): AuditQuestionId | undefined {
  const clean = raw.trim().toLowerCase();
  return QUESTION_ID_MAP[clean];
}

export type AuditVerdict = "approved" | "changes_requested" | "halt";
export const AUDIT_VERDICTS: readonly AuditVerdict[] = ["approved", "changes_requested", "halt"];

export type AuditAnswerVerdict = "pass" | "fail" | "finding" | "clean";

export interface AuditAnswer {
  readonly question_id: AuditQuestionId;
  readonly command_id: string;
  readonly verdict: AuditAnswerVerdict;
  readonly statement?: string | undefined;
  readonly findings?: string[] | undefined;
  readonly details?: JsonObject | undefined;
}

export interface AuditRecord {
  readonly audit_id: string;
  readonly auditor: string;
  readonly status: "in_progress" | "approved" | "changes_requested" | "halted";
  readonly window_start: string;
  readonly started_at: string;
  readonly reported_at?: string | undefined;
  readonly last_verdict?: AuditVerdict | null | undefined;
  readonly answers?: AuditAnswer[] | undefined;
  readonly open_findings: string[];
  readonly summary?: string | undefined;
}

export interface PulseGapCheckResult {
  readonly ok: boolean;
  readonly gaps: readonly string[];
  readonly openPulses: readonly string[];
  readonly closedPulses: readonly string[];
}

/**
 * Question 1: Does every pulse in the window have exactly one open and one close? Name the gaps.
 */
export function checkPulseGaps(
  events: readonly HarnessEvent[],
  options: {
    readonly windowStart?: string | number | undefined;
    readonly allowTrailingInFlight?: boolean | undefined;
  } = {},
): PulseGapCheckResult {
  const windowStartMs =
    typeof options.windowStart === "string"
      ? Date.parse(options.windowStart)
      : typeof options.windowStart === "number"
        ? options.windowStart
        : 0;

  const openCounts = new Map<string, number>();
  const closeCounts = new Map<string, number>();
  const openOrder: string[] = [];
  const closeOrder: string[] = [];

  for (const event of events) {
    const eventTimeMs = Date.parse(event.timestamp);
    if (
      Number.isFinite(windowStartMs) &&
      Number.isFinite(eventTimeMs) &&
      eventTimeMs < windowStartMs
    ) {
      continue;
    }

    if (event.kind === "mind-pulse-opened") {
      const pulseId =
        typeof event.payload.pulse_id === "string"
          ? event.payload.pulse_id
          : `pulse-${openOrder.length + 1}`;
      openCounts.set(pulseId, (openCounts.get(pulseId) ?? 0) + 1);
      openOrder.push(pulseId);
    } else if (event.kind === "mind-pulse-closed") {
      const pulseId =
        typeof event.payload.pulse_id === "string"
          ? event.payload.pulse_id
          : `pulse-${closeOrder.length + 1}`;
      closeCounts.set(pulseId, (closeCounts.get(pulseId) ?? 0) + 1);
      closeOrder.push(pulseId);
    }
  }

  const gaps: string[] = [];
  const allPulseIds = new Set<string>([...openCounts.keys(), ...closeCounts.keys()]);

  // Check sequence numbering if standard pulse-N format
  const pulseNumbers: number[] = [];
  for (const id of allPulseIds) {
    const match = id.match(/^pulse-(\d+)$/);
    if (match && match[1]) {
      pulseNumbers.push(Number(match[1]));
    }
  }
  pulseNumbers.sort((a, b) => a - b);
  if (pulseNumbers.length > 1) {
    for (let i = 0; i < pulseNumbers.length - 1; i++) {
      const current = pulseNumbers[i]!;
      const next = pulseNumbers[i + 1]!;
      if (next > current + 1) {
        for (let missing = current + 1; missing < next; missing++) {
          gaps.push(`missing pulse in sequence: pulse-${missing}`);
        }
      }
    }
  }

  for (const pulseId of allPulseIds) {
    const opens = openCounts.get(pulseId) ?? 0;
    const closes = closeCounts.get(pulseId) ?? 0;

    if (opens === 0 && closes > 0) {
      gaps.push(`pulse ${pulseId} has ${closes} close event(s) but no open event`);
    } else if (opens > 1) {
      gaps.push(`pulse ${pulseId} has duplicate open events (${opens} opens)`);
    } else if (closes > 1) {
      gaps.push(`pulse ${pulseId} has duplicate close events (${closes} closes)`);
    } else if (opens === 1 && closes === 0) {
      const isLatestOpen =
        options.allowTrailingInFlight === true && openOrder[openOrder.length - 1] === pulseId;
      if (!isLatestOpen) {
        gaps.push(`pulse ${pulseId} was opened but never closed`);
      }
    }
  }

  return {
    ok: gaps.length === 0,
    gaps,
    openPulses: openOrder,
    closedPulses: closeOrder,
  };
}

export interface WitnessVerificationCheckResult {
  readonly ok: boolean;
  readonly findings: readonly string[];
  readonly verifiedCount: number;
}

/**
 * Question 2: Does every admitted candidate still have a witness whose command output shows the defect?
 */
export function checkAdmittedCandidateWitnesses(
  state: RunState,
  events: readonly HarnessEvent[],
  options: {
    readonly repoRoot?: string | undefined;
    readonly capsuleRoot?: string | undefined;
  } = {},
): WitnessVerificationCheckResult {
  const findings: string[] = [];
  let verifiedCount = 0;

  const rawCandidates: Record<string, unknown>[] = [];
  const mindState = (state.mind ?? {}) as Record<string, unknown>;

  if (Array.isArray(state.candidates)) {
    rawCandidates.push(...(state.candidates as Record<string, unknown>[]));
  } else if (Array.isArray(mindState.candidates)) {
    rawCandidates.push(...(mindState.candidates as Record<string, unknown>[]));
  }

  for (const event of events) {
    if (event.kind === "mind-candidate-admitted") {
      const candidateId =
        typeof event.payload.candidate_id === "string"
          ? event.payload.candidate_id
          : typeof event.payload.candidate === "string"
            ? event.payload.candidate
            : null;
      if (candidateId && !rawCandidates.some((c) => c.id === candidateId)) {
        rawCandidates.push({
          id: candidateId,
          status: "admitted",
          kind: event.payload.kind ?? "defect",
          witness_command_id: event.payload.witness_command_id ?? event.payload.witness ?? null,
        });
      }
    }
  }

  const admittedDefects = rawCandidates.filter(
    (c) => c.status === "admitted" && c.kind === "defect",
  );

  for (const candidate of admittedDefects) {
    const candidateId = typeof candidate.id === "string" ? candidate.id : "unknown";
    const witnessId =
      typeof candidate.witness_command_id === "string"
        ? candidate.witness_command_id
        : typeof candidate.witness === "string"
          ? candidate.witness
          : null;

    if (!witnessId || !witnessId.trim()) {
      findings.push(`admitted defect candidate '${candidateId}' has no witness command id`);
      continue;
    }

    try {
      const verification = verifyDefectWitness(witnessId, options.capsuleRoot ?? options.repoRoot);
      verifiedCount++;
      if (verification.exitCode === 0 && verification.status === "succeeded") {
        findings.push(
          `admitted defect candidate '${candidateId}' witness '${witnessId}' exited 0 (clean, defect not demonstrated)`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      findings.push(
        `admitted defect candidate '${candidateId}' witness '${witnessId}' verification failed: ${msg}`,
      );
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    verifiedCount,
  };
}

export interface CharterGoalCheckResult {
  readonly ok: boolean;
  readonly findings: readonly string[];
}

/**
 * Question 3: Did any admitted candidate cite a charter goal that does not exist?
 */
export function checkAdmittedCandidateGoals(
  state: RunState,
  events: readonly HarnessEvent[],
  validCharterGoals: readonly string[] | ReadonlySet<string>,
): CharterGoalCheckResult {
  const findings: string[] = [];
  const validGoalSet = new Set(validCharterGoals);

  const rawCandidates: Record<string, unknown>[] = [];
  const mindState = (state.mind ?? {}) as Record<string, unknown>;

  if (Array.isArray(state.candidates)) {
    rawCandidates.push(...(state.candidates as Record<string, unknown>[]));
  } else if (Array.isArray(mindState.candidates)) {
    rawCandidates.push(...(mindState.candidates as Record<string, unknown>[]));
  }

  for (const event of events) {
    if (event.kind === "mind-candidate-admitted" || event.kind === "mind-candidate-opened") {
      const candidateId =
        typeof event.payload.candidate_id === "string"
          ? event.payload.candidate_id
          : typeof event.payload.candidate === "string"
            ? event.payload.candidate
            : null;
      const goals = Array.isArray(event.payload.charter_goal_ids)
        ? event.payload.charter_goal_ids
        : Array.isArray(event.payload.charter_goals)
          ? event.payload.charter_goals
          : null;
      if (candidateId && goals) {
        const existing = rawCandidates.find((c) => c.id === candidateId);
        if (existing) {
          if (!existing.charter_goal_ids) existing.charter_goal_ids = goals;
        } else {
          rawCandidates.push({
            id: candidateId,
            status: event.kind === "mind-candidate-admitted" ? "admitted" : "open",
            charter_goal_ids: goals,
          });
        }
      }
    }
  }

  const admittedCandidates = rawCandidates.filter((c) => c.status === "admitted");

  for (const candidate of admittedCandidates) {
    const candidateId = typeof candidate.id === "string" ? candidate.id : "unknown";
    const rawGoals = Array.isArray(candidate.charter_goal_ids)
      ? candidate.charter_goal_ids
      : Array.isArray(candidate.charter_goals)
        ? candidate.charter_goals
        : [];

    if (rawGoals.length === 0) {
      findings.push(`admitted candidate '${candidateId}' cites zero charter goals`);
      continue;
    }

    for (const g of rawGoals) {
      const goalId =
        typeof g === "string"
          ? g
          : typeof (g as { id?: string })?.id === "string"
            ? (g as { id: string }).id
            : String(g);
      if (!validGoalSet.has(goalId)) {
        findings.push(
          `admitted candidate '${candidateId}' cited non-existent charter goal '${goalId}'`,
        );
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
  };
}

export interface ValueConsistencyCheckResult {
  readonly ok: boolean;
  readonly findings: readonly string[];
  readonly series: readonly number[];
}

/**
 * Question 4: Is the trailing value series consistent with the work the ledger claims?
 */
export function checkValueConsistency(
  events: readonly HarnessEvent[],
  _state: RunState,
): ValueConsistencyCheckResult {
  const findings: string[] = [];
  const series: number[] = [];

  for (const event of events) {
    if (event.kind === "mind-pulse-closed") {
      const pulseId =
        typeof event.payload.pulse_id === "string" ? event.payload.pulse_id : "unknown";
      const recordedValue = typeof event.payload.value === "number" ? event.payload.value : 0;
      series.push(recordedValue);

      const metricsObj = (event.payload.metrics ?? event.payload) as Record<string, unknown>;
      const metrics: PulseValueMetrics = {
        leases_reclaimed:
          typeof metricsObj.leases_reclaimed === "number" ? metricsObj.leases_reclaimed : 0,
        findings_resolved:
          typeof metricsObj.findings_resolved === "number" ? metricsObj.findings_resolved : 0,
        gates_flipped_red_to_green:
          typeof metricsObj.gates_flipped_red_to_green === "number"
            ? metricsObj.gates_flipped_red_to_green
            : 0,
        tasks_reaching_done:
          typeof metricsObj.tasks_reaching_done === "number" ? metricsObj.tasks_reaching_done : 0,
        candidates_admitted:
          typeof metricsObj.candidates_admitted === "number" ? metricsObj.candidates_admitted : 0,
        proposals_recorded:
          typeof metricsObj.proposals_recorded === "number" ? metricsObj.proposals_recorded : 0,
      };

      const computedValue = calculatePulseValue(metrics);
      if (typeof event.payload.value === "number" && event.payload.value !== computedValue) {
        findings.push(
          `pulse ${pulseId} recorded value ${recordedValue} inconsistent with ledger metrics (computed ${computedValue})`,
        );
      }

      // Check if forbidden metrics were improperly added
      const forbiddenKeys = [
        "files_touched",
        "commands_run",
        "tokens_spent",
        "agents_deployed",
        "words_written",
      ];
      for (const k of forbiddenKeys) {
        if (typeof metricsObj[k] === "number" && (metricsObj[k] as number) > 0) {
          findings.push(
            `pulse ${pulseId} metric '${k}' is explicitly excluded from value computation`,
          );
        }
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    series,
  };
}

export interface ScopeViolationCheckResult {
  readonly ok: boolean;
  readonly findings: readonly string[];
}

/**
 * Question 5: Did anything change outside a declared write scope?
 */
export function checkScopeViolations(
  events: readonly HarnessEvent[],
  _state: RunState,
): ScopeViolationCheckResult {
  const findings: string[] = [];

  for (const event of events) {
    if (event.kind === "scope-violation-detected" || event.kind === "out-of-band-drift") {
      const detail =
        typeof event.payload.detail === "string"
          ? event.payload.detail
          : typeof event.payload.reason === "string"
            ? event.payload.reason
            : JSON.stringify(event.payload);
      findings.push(`out-of-band scope change detected at sequence ${event.sequence}: ${detail}`);
    }

    if (event.kind === "task-submitted") {
      const declaredScope = Array.isArray(event.payload.write_scope)
        ? (event.payload.write_scope as string[])
        : [];
      const touchedFiles = Array.isArray(event.payload.touched_files)
        ? (event.payload.touched_files as string[])
        : [];

      for (const touched of touchedFiles) {
        const matchesScope = declaredScope.some(
          (scope) =>
            touched === scope || touched.startsWith(scope.endsWith("/") ? scope : `${scope}/`),
        );
        if (!matchesScope && declaredScope.length > 0) {
          findings.push(
            `task ${String(event.payload.task_id)} touched file '${touched}' outside declared write scope [${declaredScope.join(", ")}]`,
          );
        }
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
  };
}

export interface NeverUnattendedCheckResult {
  readonly ok: boolean;
  readonly findings: readonly string[];
  readonly violations: readonly string[];
}

const PROHIBITED_COMMAND_PATTERNS = [
  /\bgit\s+push\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\brm\s+-rf\s+\//i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /\bnpm\s+publish\b/i,
  /\bbun\s+publish\b/i,
  /\bpkill\s+-9?\s*(?:agy|claude|tmux|zsh|bash)/i,
  /\bkillall\s+(?:agy|claude|tmux|zsh|bash)/i,
];

/**
 * Question 6: Did any pulse take an action on the never-unattended list?
 */
export function checkNeverUnattendedActions(
  events: readonly HarnessEvent[],
  _state: RunState,
): NeverUnattendedCheckResult {
  const findings: string[] = [];
  const violations: string[] = [];

  for (const event of events) {
    if (
      event.kind === "prohibited-action-attempted" ||
      event.kind === "never-unattended-violation"
    ) {
      const reason =
        typeof event.payload.reason === "string"
          ? event.payload.reason
          : JSON.stringify(event.payload);
      findings.push(`never-unattended action violation at sequence ${event.sequence}: ${reason}`);
      violations.push(reason);
    }

    if (event.kind === "command-executed" || event.kind === "run-exec") {
      const command =
        typeof event.payload.command === "string"
          ? event.payload.command
          : Array.isArray(event.payload.argv)
            ? (event.payload.argv as string[]).join(" ")
            : "";

      for (const pattern of PROHIBITED_COMMAND_PATTERNS) {
        if (pattern.test(command)) {
          const v = `prohibited never-unattended command pattern detected: '${command}'`;
          findings.push(v);
          violations.push(v);
        }
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    violations,
  };
}

export interface DeclinedCandidateCheckResult {
  readonly ok: boolean;
  readonly findings: readonly string[];
  readonly declinedCount: number;
}

/**
 * Question 7: What did the mind decline to do, and does the reason survive re-reading?
 */
export function checkDeclinedCandidates(
  state: RunState,
  events: readonly HarnessEvent[],
): DeclinedCandidateCheckResult {
  const findings: string[] = [];
  const rawCandidates: Record<string, unknown>[] = [];
  const mindState = (state.mind ?? {}) as Record<string, unknown>;

  if (Array.isArray(state.candidates)) {
    rawCandidates.push(...(state.candidates as Record<string, unknown>[]));
  } else if (Array.isArray(mindState.candidates)) {
    rawCandidates.push(...(mindState.candidates as Record<string, unknown>[]));
  }

  for (const event of events) {
    if (event.kind === "mind-candidate-declined") {
      const candidateId =
        typeof event.payload.candidate_id === "string"
          ? event.payload.candidate_id
          : typeof event.payload.candidate === "string"
            ? event.payload.candidate
            : null;
      const reason =
        typeof event.payload.reason === "string"
          ? event.payload.reason
          : typeof event.payload.decline_reason === "string"
            ? event.payload.decline_reason
            : null;
      if (candidateId) {
        const existing = rawCandidates.find((c) => c.id === candidateId);
        if (existing) {
          existing.status = "declined";
          if (!existing.decline_reason) existing.decline_reason = reason;
        } else {
          rawCandidates.push({
            id: candidateId,
            status: "declined",
            decline_reason: reason,
          });
        }
      }
    }
  }

  const declined = rawCandidates.filter((c) => c.status === "declined");

  for (const candidate of declined) {
    const candidateId = typeof candidate.id === "string" ? candidate.id : "unknown";
    const reason =
      typeof candidate.decline_reason === "string"
        ? candidate.decline_reason
        : typeof candidate.reason === "string"
          ? candidate.reason
          : null;

    if (!reason || !reason.trim()) {
      findings.push(`declined candidate '${candidateId}' is missing a non-empty decline reason`);
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    declinedCount: declined.length,
  };
}

export interface CharterDigestCheckResult {
  readonly ok: boolean;
  readonly findings: readonly string[];
  readonly pinnedSha: string;
  readonly currentSha?: string | undefined;
}

/**
 * Question 8: Did the charter digest change without an owner decision?
 */
export function checkCharterDigestIntegrity(
  state: RunState,
  events: readonly HarnessEvent[],
  options: {
    readonly currentSha?: string | undefined;
    readonly pinnedSha?: string | undefined;
  } = {},
): CharterDigestCheckResult {
  const findings: string[] = [];
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const charterRecord = (mindState.charter ?? {}) as Record<string, unknown>;

  const pinnedSha =
    options.pinnedSha ??
    (typeof charterRecord.pinned_sha256 === "string" ? charterRecord.pinned_sha256 : "") ??
    (typeof state.pinned_charter_sha256 === "string" ? state.pinned_charter_sha256 : "");

  if (options.currentSha && pinnedSha && options.currentSha !== pinnedSha) {
    const hasOwnerDecision = events.some(
      (e) =>
        e.kind === "owner-decision-recorded" ||
        e.kind === "charter-digest-updated" ||
        (e.kind === "mind-initialized" && e.actor === "owner"),
    );

    if (!hasOwnerDecision) {
      findings.push(
        `charter sha256 changed from pinned ${pinnedSha} to ${options.currentSha} without recorded owner decision`,
      );
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    pinnedSha,
    currentSha: options.currentSha,
  };
}

/**
 * Validates that all 8 questions are answered and every answer cites a non-empty command ID.
 */
export function validateAuditAnswers(rawAnswers: unknown): readonly AuditAnswer[] {
  if (!rawAnswers || typeof rawAnswers !== "object") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "audit answers must be an object or an array containing all 8 question answers",
    );
  }

  const answerMap = new Map<AuditQuestionId, AuditAnswer>();

  if (Array.isArray(rawAnswers)) {
    for (const item of rawAnswers as unknown[]) {
      if (typeof item === "string") {
        const parts = item.split(":");
        const rawQ = parts[0] ?? "";
        const rawCmd = parts[1] ?? "";
        const rawVerdict = parts[2] ?? "pass";
        const rawDetail = parts.slice(3).join(":");

        const qId = normalizeQuestionId(rawQ);
        if (!qId) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `unrecognized question identifier '${rawQ}'; expected Q1 through Q8`,
          );
        }

        if (!rawCmd.trim()) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `audit answer for ${qId} must cite a non-empty command id`,
          );
        }

        const v = rawVerdict.trim().toLowerCase();
        const verdict: AuditAnswerVerdict =
          v === "fail" || v === "finding" || v === "failed" ? "fail" : "pass";

        const statementVal = rawDetail.trim() || undefined;
        answerMap.set(qId, {
          question_id: qId,
          command_id: rawCmd.trim(),
          verdict,
          ...(statementVal !== undefined ? { statement: statementVal } : {}),
        });
      } else if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        const rawQ =
          typeof obj.question_id === "string"
            ? obj.question_id
            : typeof obj.question === "string"
              ? obj.question
              : typeof obj.id === "string"
                ? obj.id
                : "";
        const qId = normalizeQuestionId(rawQ);
        if (!qId) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `unrecognized question identifier '${rawQ}'; expected Q1 through Q8`,
          );
        }

        const cmdId =
          typeof obj.command_id === "string"
            ? obj.command_id
            : typeof obj.commandId === "string"
              ? obj.commandId
              : typeof obj.command === "string"
                ? obj.command
                : "";

        if (!cmdId.trim()) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `audit answer for ${qId} must cite a non-empty command id`,
          );
        }

        const rawV = typeof obj.verdict === "string" ? obj.verdict.trim().toLowerCase() : "pass";
        const verdict: AuditAnswerVerdict =
          rawV === "fail" || rawV === "finding" || rawV === "failed" ? "fail" : "pass";

        const findingsVal = Array.isArray(obj.findings) ? (obj.findings as string[]) : undefined;
        const statementVal = typeof obj.statement === "string" ? obj.statement : undefined;

        answerMap.set(qId, {
          question_id: qId,
          command_id: cmdId.trim(),
          verdict,
          ...(statementVal !== undefined ? { statement: statementVal } : {}),
          ...(findingsVal !== undefined ? { findings: findingsVal } : {}),
        });
      }
    }
  } else {
    // Record of question keys/IDs to answers
    const record = rawAnswers as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      const qId = normalizeQuestionId(key);
      if (!qId) continue;

      if (typeof value === "string") {
        const parts = value.split(":");
        const cmdId = parts[0] ?? "";
        const rawV = parts[1] ?? "pass";
        if (!cmdId.trim()) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `audit answer for ${qId} must cite a non-empty command id`,
          );
        }
        const v = rawV.trim().toLowerCase();
        const verdict: AuditAnswerVerdict =
          v === "fail" || v === "finding" || v === "failed" ? "fail" : "pass";

        answerMap.set(qId, {
          question_id: qId,
          command_id: cmdId.trim(),
          verdict,
        });
      } else if (typeof value === "object" && value !== null) {
        const obj = value as Record<string, unknown>;
        const cmdId =
          typeof obj.command_id === "string"
            ? obj.command_id
            : typeof obj.commandId === "string"
              ? obj.commandId
              : typeof obj.command === "string"
                ? obj.command
                : "";

        if (!cmdId.trim()) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `audit answer for ${qId} must cite a non-empty command id`,
          );
        }

        const rawV = typeof obj.verdict === "string" ? obj.verdict.trim().toLowerCase() : "pass";
        const verdict: AuditAnswerVerdict =
          rawV === "fail" || rawV === "finding" || rawV === "failed" ? "fail" : "pass";

        const findingsVal = Array.isArray(obj.findings) ? (obj.findings as string[]) : undefined;
        const statementVal = typeof obj.statement === "string" ? obj.statement : undefined;

        answerMap.set(qId, {
          question_id: qId,
          command_id: cmdId.trim(),
          verdict,
          ...(statementVal !== undefined ? { statement: statementVal } : {}),
          ...(findingsVal !== undefined ? { findings: findingsVal } : {}),
        });
      }
    }
  }

  // Ensure all 8 questions are answered
  const missing: AuditQuestionId[] = [];
  for (const q of AUDIT_QUESTION_IDS) {
    if (!answerMap.has(q)) {
      missing.push(q);
    }
  }

  if (missing.length > 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `missing answers for audit questionnaire: ${missing.join(", ")}; all 8 questions are mandatory`,
    );
  }

  return AUDIT_QUESTION_IDS.map((q) => answerMap.get(q)!);
}

export interface AuditBlockCheckResult {
  readonly blocked: boolean;
  readonly reason?: string | undefined;
  readonly outcome?: "halted" | "blocked" | undefined;
}

/**
 * Checks if open audit findings or halt verdict block the next pulse from proceeding past WAKE.
 */
export function checkAuditBlocksPulse(state: RunState): AuditBlockCheckResult {
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const auditRecord = (state.audit ?? mindState.audit ?? {}) as Record<string, unknown>;

  // 1. Mind halted check
  if (
    mindState.halted === true ||
    auditRecord.status === "halted" ||
    auditRecord.last_verdict === "halt"
  ) {
    const reason =
      typeof mindState.halt_reason === "string"
        ? mindState.halt_reason
        : typeof auditRecord.summary === "string"
          ? auditRecord.summary
          : "mind halted by audit verdict";
    return {
      blocked: true,
      reason: `mind is halted (${reason}); cannot proceed past WAKE. Outcome: halted.`,
      outcome: "halted",
    };
  }

  // 2. Open findings check
  const openFindings = Array.isArray(auditRecord.open_findings)
    ? (auditRecord.open_findings as string[])
    : [];

  if (openFindings.length > 0) {
    const findingsList = openFindings.join("; ");
    return {
      blocked: true,
      reason: `open audit finding(s) block next pulse from proceeding past WAKE: ${findingsList}. Outcome: blocked.`,
      outcome: "blocked",
    };
  }

  // 3. Status changes_requested check
  if (
    auditRecord.status === "changes_requested" ||
    auditRecord.last_verdict === "changes_requested"
  ) {
    return {
      blocked: true,
      reason:
        "audit verdict requested changes; cannot proceed past WAKE until findings are resolved. Outcome: blocked.",
      outcome: "blocked",
    };
  }

  return { blocked: false };
}

/**
 * Asserts that the audit state allows a new pulse to open.
 * Throws INVALID_STATE HarnessError if blocked.
 */
export function assertAuditAllowsPulseOpen(state: RunState): void {
  const check = checkAuditBlocksPulse(state);
  if (check.blocked) {
    throw new HarnessError("INVALID_STATE", check.reason ?? "pulse blocked by open audit findings");
  }
}
