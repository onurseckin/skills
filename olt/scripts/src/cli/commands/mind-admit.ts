import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { JsonObject, JsonValue } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { parseCharter } from "../../mind/charter.ts";
import {
  evaluateAdmissionGates,
  type AdmissionGateVerdict,
  type CandidateRecord,
} from "../../mind/gates.ts";
import { loadRun } from "../../store/load.ts";
import { transact } from "../../store/transaction.ts";
import { findGrant, readAgentLedger } from "../../workflow/agents/ledger.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export interface MindAdmitResult {
  markdown: string;
  run_root: string;
  candidate_id: string;
  actor: string;
  admitted_at: string;
  verdicts: readonly AdmissionGateVerdict[];
  falsifier_exit_observed: number | null;
}

export function formatMindAdmitBrief(params: {
  candidateId: string;
  runRoot: string;
  actor: string;
  statement: string;
  admittedAt: string;
  falsifierExitObserved: number | null;
  verdicts: readonly AdmissionGateVerdict[];
}): string {
  const lines = [
    `### Candidate Admitted: \`${params.candidateId}\``,
    `- **Capsule**: \`${params.runRoot}\``,
    `- **Actor**: \`${params.actor}\``,
    `- **Statement**: ${params.statement}`,
    `- **Admitted At**: \`${params.admittedAt}\``,
    `- **Falsifier Exit**: ${params.falsifierExitObserved ?? "n/a"}`,
    `- **Gates Evaluated**: 6/6 passed`,
  ];
  for (const v of params.verdicts) {
    lines.push(`  - Gate ${v.gateNumber} (${v.name}): PASSED`);
  }
  return enforceLineLimit(lines.join("\n"), 30);
}

function resolveCharterContext(
  state: Record<string, unknown>,
  repoRoot: string,
): {
  goals: ReadonlySet<string>;
  nonGoals: readonly string[];
  repoRoots: readonly string[];
} {
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const charterRecord = (mindState.charter ?? {}) as Record<string, unknown>;

  // 1. Try reading from charter file on disk
  const charterRel =
    typeof charterRecord.source_path === "string"
      ? charterRecord.source_path
      : "docs/mind/CHARTER.md";
  const charterFullPath = resolve(repoRoot, charterRel);

  if (existsSync(charterFullPath)) {
    try {
      const charterText = readFileSync(charterFullPath, "utf-8");
      const parsed = parseCharter(charterText);
      return {
        goals: new Set(parsed.goalIds),
        nonGoals: parsed.nonGoals,
        repoRoots: parsed.repoRoots,
      };
    } catch {
      // ignore parse error and fallback to state
    }
  }

  // 2. Fallback to state.mind.charter
  const goalsFromState = Array.isArray(charterRecord.goals)
    ? (charterRecord.goals as readonly (string | { id?: string })[]).map((g) =>
        typeof g === "string" ? g : typeof g?.id === "string" ? g.id : "G1",
      )
    : ["G1"];

  const nonGoalsFromState = Array.isArray(charterRecord.non_goals)
    ? (charterRecord.non_goals as readonly string[])
    : [];

  const repoRootsFromState = Array.isArray(charterRecord.repo_roots)
    ? (charterRecord.repo_roots as readonly string[])
    : ["."];

  return {
    goals: new Set(goalsFromState),
    nonGoals: nonGoalsFromState,
    repoRoots: repoRootsFromState,
  };
}

export function mindAdmitCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", true)!;
  const candidateId = textFlag(flags, "candidate", true)!;
  const now = textFlag(flags, "now", false);

  const nowIso = now ?? new Date().toISOString();
  const loaded = loadRun(run, false);
  const state = loaded.state;

  // 1. Enforce acting agent role grant
  const ledger = readAgentLedger(state);
  const grant = findGrant(ledger, actor);
  if (!grant) {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${actor} holds no grant; register it with agent:register first`,
    );
  }
  if (grant.role !== "mind" && grant.role !== "coordinator") {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${actor} holds role '${grant.role}'; role 'mind' is required for candidate admission`,
    );
  }

  // 2. Check if mind is halted
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  if (mindState.halted === true) {
    const haltReason =
      typeof mindState.halt_reason === "string" ? mindState.halt_reason : "unknown reason";
    throw new HarnessError(
      "INVALID_STATE",
      `mind is halted (${haltReason}); cannot admit candidate. Outcome: halted.`,
    );
  }

  // 3. Pulse open check
  const pulseState = (state.pulse ?? {}) as Record<string, unknown>;
  const openPulse = pulseState.open as Record<string, unknown> | null | undefined;
  if (!openPulse || typeof openPulse !== "object") {
    throw new HarnessError(
      "INVALID_STATE",
      "no active pulse is open; open a pulse first with mind:pulse-open",
    );
  }

  // 4. Candidate lookup
  const candidates = (
    Array.isArray(state.candidates)
      ? (state.candidates as unknown as readonly CandidateRecord[])
      : []
  ) as readonly CandidateRecord[];
  const candidate = candidates.find((c) => c.id === candidateId);
  if (!candidate) {
    throw new HarnessError("INVALID_ARGUMENT", `unknown candidate '${candidateId}'`);
  }
  if (candidate.status === "admitted") {
    throw new HarnessError("INVALID_STATE", `candidate '${candidateId}' is already admitted`);
  }
  if (candidate.status === "declined") {
    throw new HarnessError(
      "INVALID_STATE",
      `candidate '${candidateId}' was permanently declined (${candidate.decline_reason ?? "unknown"})`,
    );
  }

  // 5. Resolve charter details
  const repoRoot = dirname(dirname(loaded.runRoot));
  const charterContext = resolveCharterContext(state, repoRoot);

  // 6. Evaluate all six admission gates
  const evaluation = evaluateAdmissionGates(candidate, {
    runRoot: loaded.runRoot,
    repoRoot,
    actor,
    state,
    charterGoals: charterContext.goals,
    charterNonGoals: charterContext.nonGoals,
    repoRoots: charterContext.repoRoots,
  });

  if (!evaluation.admitted) {
    const failing = evaluation.failingGate!;
    const issueObj: JsonObject = {
      gate_id: failing.gateId,
      gate_number: failing.gateNumber,
      name: failing.name,
      reason: failing.reason ?? null,
      repair_argv: failing.repairArgv ?? null,
    };
    throw new HarnessError(
      "INVALID_STATE",
      `admission gate ${failing.gateId} (${failing.name}) refused: ${failing.reason}`,
      [issueObj],
      3,
      failing.repairArgv,
    );
  }

  // 7. Transact mind-candidate-admitted
  transact(
    run,
    actor,
    "mind-candidate-admitted",
    {
      candidate_id: candidateId,
      verdicts: evaluation.verdicts.map((v) => ({
        gate_id: v.gateId,
        gate_number: v.gateNumber,
        name: v.name,
        passed: v.passed,
      })),
      falsifier_exit_observed: evaluation.falsifierExitObserved ?? null,
      admitted_at: nowIso,
    },
    (working) => {
      const workingCandidates = (
        Array.isArray(working.candidates) ? working.candidates : []
      ) as Record<string, unknown>[];
      const target = workingCandidates.find((c) => c.id === candidateId);
      if (target) {
        target.status = "admitted";
        target.decided_at = nowIso;
        target.falsifier_exit = evaluation.falsifierExitObserved ?? null;
        target.gate_failed = null;
      }
    },
  );

  const markdown = formatMindAdmitBrief({
    candidateId,
    runRoot: loaded.runRoot,
    actor,
    statement: candidate.statement,
    admittedAt: nowIso,
    falsifierExitObserved: evaluation.falsifierExitObserved ?? null,
    verdicts: evaluation.verdicts,
  });

  return {
    markdown,
    run_root: loaded.runRoot,
    candidate_id: candidateId,
    actor,
    admitted_at: nowIso,
    verdicts: evaluation.verdicts,
    falsifier_exit_observed: evaluation.falsifierExitObserved ?? null,
  };
}

export async function mindDeclineCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<{
  readonly markdown: string;
  readonly run_root: string;
  readonly candidate_id: string;
  readonly actor: string;
  readonly reason: string;
}> {
  const run = textFlag(flags, "run");
  const actor = textFlag(flags, "actor");
  const candidateId = textFlag(flags, "candidate");
  const reason = textFlag(flags, "reason");

  if (!run) throw new HarnessError("INVALID_ARGUMENT", "--run is required");
  if (!actor) throw new HarnessError("INVALID_ARGUMENT", "--actor is required");
  if (!candidateId) throw new HarnessError("INVALID_ARGUMENT", "--candidate is required");
  if (!reason) throw new HarnessError("INVALID_ARGUMENT", "--reason is required");

  const loaded = loadRun(run);
  const nowIso = new Date().toISOString();

  const candidates = (Array.isArray(loaded.state.candidates)
    ? loaded.state.candidates
    : []) as unknown as CandidateRecord[];
  const target = candidates.find((c) => c.id === candidateId);
  if (!target) {
    throw new HarnessError("INVALID_STATE", `candidate ${candidateId} not found in state`);
  }
  if (
    target.status !== "proposed" &&
    target.status !== "candidate" &&
    target.status !== undefined
  ) {
    throw new HarnessError(
      "INVALID_STATE",
      `candidate ${candidateId} is already decided (status: ${target.status})`,
    );
  }

  transact(
    run,
    actor,
    "mind-candidate-declined",
    {
      candidate_id: candidateId,
      reason,
      declined_at: nowIso,
    },
    (working) => {
      const workingCandidates = (
        Array.isArray(working.candidates) ? working.candidates : []
      ) as Record<string, unknown>[];
      const found = workingCandidates.find((c) => c.id === candidateId);
      if (found) {
        found.status = "declined";
        found.decided_at = nowIso;
        found.decline_reason = reason;
      }
    },
  );

  const markdown = `### Candidate Declined: \`${candidateId}\`\n- **Actor**: \`${actor}\`\n- **Reason**: ${reason}\n`;

  return {
    markdown,
    run_root: loaded.runRoot,
    candidate_id: candidateId,
    actor,
    reason,
  };
}
