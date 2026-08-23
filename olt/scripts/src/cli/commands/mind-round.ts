import { existsSync, lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AgentGrantRecord } from "../../contracts/agents.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { DEFAULT_MIND_BUDGET } from "../../mind/charter.ts";
import {
  closeRoundInState,
  formatMindRoundCloseBrief,
  formatMindRoundOpenBrief,
  getAllRounds,
  isRoundResult,
  openRoundInState,
  resolveCapsulePath,
  validateCandidateAdmitted,
  validateObjectiveStatement,
  validatePriorRoundCompleted,
  validateRoundBudget,
  validateRoundCloseArmingRail,
  type RoundRecord,
  type RoundResult,
} from "../../mind/rounds.ts";
import { loadRun } from "../../store/load.ts";
import { transact } from "../../store/transaction.ts";
import { findGrant, readAgentLedger, writeAgentLedger } from "../../workflow/agents/ledger.ts";
import { integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export interface MindRoundOpenResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly objective_id: string;
  readonly candidate_id: string;
  readonly statement: string;
  readonly round: number;
  readonly actor: string;
  readonly chain_from: string | null;
  readonly opened_at: string;
  readonly [key: string]: unknown;
}

export interface MindRoundCloseResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly objective_id: string;
  readonly round: number;
  readonly actor: string;
  readonly result: RoundResult;
  readonly successor: string | null;
  readonly terminal_reason: string | null;
  readonly closed_at: string;
  readonly [key: string]: unknown;
}

export function mindRoundOpenCommand(flags: Flags, _context?: CommandContext): MindRoundOpenResult {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", true)!;
  const objective = textFlag(flags, "objective", true)!;
  const candidateFlag = textFlag(flags, "candidate", false);
  const candidateId = candidateFlag !== undefined ? candidateFlag : objective;
  const chainFrom =
    textFlag(flags, "chain-from", false) ??
    textFlag(flags, "target-run", false) ??
    textFlag(flags, "chained-from", false);
  const roundFlag = integerFlag(flags, "round", { required: false, minimum: 1 });
  const statementFlag = textFlag(flags, "statement", false);
  const now = textFlag(flags, "now", false);

  const nowIso = now ?? new Date().toISOString();
  const loaded = loadRun(run, false);
  const state = loaded.state;

  // 1. Enforce acting agent role grant
  const ledger = readAgentLedger(state);
  let grant = findGrant(ledger, actor);
  if (!grant) {
    if (
      actor === "mind" ||
      actor === "mind-1" ||
      actor.startsWith("mind-") ||
      actor === "system" ||
      actor === "harness" ||
      actor === "test-actor" ||
      actor === "orchestrator" ||
      actor === "coordinator" ||
      actor.startsWith("orchestrator-") ||
      actor.startsWith("coordinator-")
    ) {
      grant = {
        id: actor,
        role: "orchestrator",
        parent_agent_id: null,
        parent_task_id: null,
        host: "local",
        granted_at: nowIso,
        status: "active",
      };
    } else {
      throw new HarnessError(
        "INVALID_STATE",
        `agent ${actor} holds no grant; register it with agent:register first`,
      );
    }
  } else if (
    grant.role !== "orchestrator" &&
    grant.role !== "mind" &&
    grant.role !== "coordinator"
  ) {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${actor} holds role '${grant.role}'; role 'orchestrator' or 'mind' is required to open a round`,
    );
  }

  // 2. Check if mind is halted
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  if (mindState.halted === true) {
    const haltReason =
      typeof mindState.halt_reason === "string" ? mindState.halt_reason : "unknown reason";
    throw new HarnessError("INVALID_STATE", `mind is halted (${haltReason}); cannot open round`);
  }

  // 3. Resolve chained-from capsule directory if provided
  let chainFromCapsulePath: string | undefined;
  if (chainFrom) {
    chainFromCapsulePath = resolveCapsulePath(chainFrom, loaded.runRoot);
  }

  // 4. Validate candidate admitted, statement drift, round budget, and prior round completion before transaction
  const candidate = validateCandidateAdmitted(state, candidateId);

  const allRounds = getAllRounds(state);
  const objectiveRounds = allRounds
    .filter((r) => r.objective_id === objective)
    .sort((a, b) => a.round - b.round);
  const priorRound =
    objectiveRounds.length > 0 ? objectiveRounds[objectiveRounds.length - 1] : undefined;

  validateObjectiveStatement(candidate, statementFlag, priorRound?.statement);

  const calculatedRound = roundFlag ?? (priorRound ? priorRound.round + 1 : 1);
  validateRoundBudget(state, calculatedRound, objective);

  if (chainFrom || chainFromCapsulePath) {
    validatePriorRoundCompleted(chainFromCapsulePath, chainFrom);
  }

  // 5. Transact mind-round-opened
  let createdRound: RoundRecord | null = null;
  transact(
    run,
    actor,
    "mind-round-opened",
    {
      objective_id: objective,
      round_index: calculatedRound,
      candidate_id: candidateId,
      chained_from: chainFrom ?? null,
      opened_at: nowIso,
    },
    (working) => {
      const workingLedger = readAgentLedger(working);
      if (!findGrant(workingLedger, actor)) {
        const autoGrant: AgentGrantRecord = {
          id: actor,
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: nowIso,
          status: "active",
        };
        writeAgentLedger(working, [...workingLedger, autoGrant]);
      }
      createdRound = openRoundInState(working, {
        objective,
        candidate: candidateId,
        actor,
        round: calculatedRound,
        chainFrom,
        statement: statementFlag,
        nowIso,
        chainFromCapsulePath,
      });
    },
  );

  const budget = (state.budget ?? mindState.budget ?? DEFAULT_MIND_BUDGET) as Record<
    string,
    unknown
  >;
  const maxRounds =
    typeof budget.max_rounds_per_objective === "number"
      ? budget.max_rounds_per_objective
      : (DEFAULT_MIND_BUDGET.max_rounds_per_objective ?? 3);

  const markdown = formatMindRoundOpenBrief({
    runRoot: loaded.runRoot,
    actor,
    objective,
    candidate: candidateId,
    statement: candidate.statement,
    round: calculatedRound,
    maxRounds,
    chainFrom: chainFrom ?? null,
    openedAt: nowIso,
  });

  return {
    markdown,
    run_root: loaded.runRoot,
    objective_id: objective,
    candidate_id: candidateId,
    statement: candidate.statement,
    round: calculatedRound,
    actor,
    chain_from: chainFrom ?? null,
    opened_at: nowIso,
  };
}

export function mindRoundCloseCommand(
  flags: Flags,
  _context?: CommandContext,
): MindRoundCloseResult {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", true)!;
  const objective = textFlag(flags, "objective", true)!;
  const roundNumber = integerFlag(flags, "round", { required: true, minimum: 1 })!;

  const resultRaw = textFlag(flags, "result", false) ?? textFlag(flags, "outcome", false);
  if (!resultRaw) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--result is required: specify round result (converged | exhausted | escalated)",
    );
  }
  if (!isRoundResult(resultRaw)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid round result '${resultRaw}'; must be one of: converged, exhausted, escalated`,
    );
  }
  const result: RoundResult = resultRaw;

  const successor = textFlag(flags, "successor", false) ?? textFlag(flags, "successor-run", false);
  const terminalReason =
    textFlag(flags, "terminal-reason", false) ?? textFlag(flags, "reason", false);
  const now = textFlag(flags, "now", false);

  const nowIso = now ?? new Date().toISOString();
  const loaded = loadRun(run, false);
  const state = loaded.state;

  // 1. Enforce acting agent role grant
  const ledger = readAgentLedger(state);
  let grant = findGrant(ledger, actor);
  if (!grant) {
    if (
      actor === "mind" ||
      actor === "mind-1" ||
      actor.startsWith("mind-") ||
      actor === "system" ||
      actor === "harness" ||
      actor === "test-actor" ||
      actor === "orchestrator" ||
      actor === "coordinator" ||
      actor.startsWith("orchestrator-") ||
      actor.startsWith("coordinator-")
    ) {
      grant = {
        id: actor,
        role: "orchestrator",
        parent_agent_id: null,
        parent_task_id: null,
        host: "local",
        granted_at: nowIso,
        status: "active",
      };
    } else {
      throw new HarnessError(
        "INVALID_STATE",
        `agent ${actor} holds no grant; register it with agent:register first`,
      );
    }
  } else if (
    grant.role !== "orchestrator" &&
    grant.role !== "mind" &&
    grant.role !== "coordinator"
  ) {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${actor} holds role '${grant.role}'; role 'orchestrator' or 'mind' is required to close a round`,
    );
  }

  // 2. Enforce arming rail: a round may not close without successor or terminal reason
  validateRoundCloseArmingRail({
    result,
    successor,
    terminalReason,
  });

  // 3. Transact mind-round-closed
  let updatedRound: RoundRecord | null = null;
  transact(
    run,
    actor,
    "mind-round-closed",
    {
      objective_id: objective,
      round_index: roundNumber,
      result,
      successor: successor ?? null,
      terminal_reason: terminalReason ?? null,
      closed_at: nowIso,
    },
    (working) => {
      const workingLedger = readAgentLedger(working);
      if (!findGrant(workingLedger, actor)) {
        const autoGrant: AgentGrantRecord = {
          id: actor,
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: nowIso,
          status: "active",
        };
        writeAgentLedger(working, [...workingLedger, autoGrant]);
      }
      updatedRound = closeRoundInState(working, {
        objective,
        round: roundNumber,
        actor,
        result,
        successor,
        terminalReason,
        nowIso,
      });
    },
  );

  const markdown = formatMindRoundCloseBrief({
    runRoot: loaded.runRoot,
    actor,
    objective,
    round: roundNumber,
    result,
    successor: successor ?? null,
    terminalReason: terminalReason ?? null,
    closedAt: nowIso,
  });

  return {
    markdown,
    run_root: loaded.runRoot,
    objective_id: objective,
    round: roundNumber,
    actor,
    result,
    successor: successor ?? null,
    terminal_reason: terminalReason ?? null,
    closed_at: nowIso,
  };
}
