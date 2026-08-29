import { basename, dirname, join, resolve } from "node:path";
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

export const PROHIBITED_COMMAND_PATTERNS = [
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