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
    text: "Did unknown admitted candidate cite a charter goal that does not exist?",
  },
  {
    id: "Q4",
    key: "value_consistency",
    text: "Is the trailing value series consistent with the work the ledger claims?",
  },
  {
    id: "Q5",
    key: "scope_violations",
    text: "Did unknownthing change outside a declared write scope?",
  },
  {
    id: "Q6",
    key: "never_unattended",
    text: "Did unknown pulse take an action on the never-unattended list?",
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