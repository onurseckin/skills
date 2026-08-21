import type { JsonObject, JsonValue } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { verifyDefectWitness } from "../../mind/witness.ts";
import { loadRun } from "../../store/load.ts";
import { transact } from "../../store/transaction.ts";
import { findGrant, readAgentLedger } from "../../workflow/agents/ledger.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import {
  listFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../options.ts";

export interface MindCandidate extends JsonObject {
  readonly id: string;
  readonly kind: "defect" | "proposal";
  readonly statement: string;
  readonly witness_command_id: string | null;
  readonly charter_goal_ids: string[];
  readonly falsifier_argv: string[] | null;
  readonly falsifier_exit: number | null;
  readonly write_scope: string[];
  readonly rationale?: string;
  readonly status: "open" | "admitted" | "declined" | "proposed" | "needs_authority";
  readonly created_at: string;
  readonly decided_at: string | null;
  readonly decline_reason: string | null;
  readonly gate_failed: string | null;
  readonly objective_run_id: string | null;
}

export interface MindCandidateResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly candidate_id: string;
  readonly candidate: MindCandidate;
}

export function formatMindCandidateBrief(params: {
  readonly candidateId: string;
  readonly kind: string;
  readonly statement: string;
  readonly witnessCommandId: string | null;
  readonly charterGoals: readonly string[];
  readonly writeScope: readonly string[];
}): string {
  const lines = [
    `### Mind Candidate Recorded: ${params.candidateId}`,
    `- **Kind**: ${params.kind}`,
    `- **Statement**: ${params.statement}`,
    params.witnessCommandId
      ? `- **Witness**: \`${params.witnessCommandId}\``
      : `- **Witness**: none (proposal)`,
    `- **Charter Goals**: ${params.charterGoals.join(", ")}`,
    `- **Write Scope**: ${params.writeScope.map((s) => `\`${s}\``).join(", ")}`,
    `- **Status**: open (ready for admission review)`,
  ];
  return enforceLineLimit(lines.join("\n"), 25);
}

export function mindCandidateCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", true)!;
  const kind = textFlag(flags, "kind", true)!;
  const statement = textFlag(flags, "statement", true)!;
  const witness = textFlag(flags, "witness", false);
  const falsifier = textFlag(flags, "falsifier", false);
  const rationale = textFlag(flags, "rationale", false);

  const rawCharterGoals = listFlag(flags, "charter-goal", true)!;
  const charterGoals = [...rawCharterGoals];
  const rawWriteScope = listFlag(flags, "write-scope", true)!;
  const writeScope = [...rawWriteScope];

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

  // 2. Validate kind
  if (kind !== "defect" && kind !== "proposal") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid candidate kind '${kind}'; must be 'defect' or 'proposal'`,
    );
  }

  // 3. Check charter goal alignment
  const mind = (state.mind ?? {}) as Record<string, unknown>;
  const charter = (mind.charter ?? {}) as Record<string, unknown>;
  const pinnedGoals = (Array.isArray(charter.goals) ? charter.goals : []) as string[];

  for (const goal of charterGoals) {
    if (!pinnedGoals.includes(goal)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `charter goal '${goal}' does not exist in pinned charter goals: [${pinnedGoals.join(", ")}]; cite a goal defined in the pinned charter`,
      );
    }
  }

  let falsifierArgv: string[] | null = null;
  let falsifierExit: number | null = null;
  let witnessCommandId: string | null = null;

  if (kind === "defect") {
    if (!witness) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "defect candidate requires --witness <command-id>; proposal candidates do not",
      );
    }
    witnessCommandId = witness;

    // Verify defect witness
    const verification = verifyDefectWitness(witness, run);
    falsifierExit = verification.exitCode;

    if (falsifier && falsifier.trim()) {
      falsifierArgv = falsifier.trim().split(/\s+/);
    } else if (verification.commandRecord.argv && verification.commandRecord.argv.length > 0) {
      falsifierArgv = [...verification.commandRecord.argv];
    } else if (
      verification.commandRecord.execution_argv &&
      verification.commandRecord.execution_argv.length > 0
    ) {
      falsifierArgv = [...verification.commandRecord.execution_argv];
    } else {
      falsifierArgv = [witness];
    }
  } else {
    // Proposal kind
    if (witness) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "proposal candidates must not provide a --witness flag; proposals are defined by having no witness",
      );
    }

    // Check open proposal cap
    const rawCandidates = (Array.isArray(state.candidates) ? state.candidates : []) as Record<string, unknown>[];
    const openProposals = rawCandidates.filter(
      (c) =>
        c.kind === "proposal" &&
        (c.status === "open" ||
          c.status === "needs_authority" ||
          c.status === "proposed"),
    );
    const maxOpenProposals =
      ((state.budget as Record<string, unknown> | undefined)?.max_open_proposals as number | undefined) ?? 5;

    if (openProposals.length >= maxOpenProposals) {
      throw new HarnessError(
        "INVALID_STATE",
        `open proposals cap reached (${openProposals.length}/${maxOpenProposals}); cannot open more proposals until existing proposals are decided`,
      );
    }
  }

  // 4. Generate next candidate ID
  const existingCandidates = (Array.isArray(state.candidates) ? state.candidates : []) as Record<string, unknown>[];
  let candidateIndex = existingCandidates.length + 1;
  let candidateId = `cand-${candidateIndex}`;
  while (existingCandidates.some((c) => c.id === candidateId)) {
    candidateIndex++;
    candidateId = `cand-${candidateIndex}`;
  }

  const candidate: MindCandidate = {
    id: candidateId,
    kind,
    statement,
    witness_command_id: witnessCommandId,
    charter_goal_ids: charterGoals,
    falsifier_argv: falsifierArgv,
    falsifier_exit: falsifierExit,
    write_scope: writeScope,
    ...(rationale ? { rationale } : {}),
    status: "open",
    created_at: new Date().toISOString(),
    decided_at: null,
    decline_reason: null,
    gate_failed: null,
    objective_run_id: null,
  };

  transact(
    loaded.runRoot,
    actor,
    "mind-candidate-opened",
    {
      candidate_id: candidate.id,
      kind: candidate.kind,
      witness_command_id: candidate.witness_command_id,
      charter_goal_ids: [...candidate.charter_goal_ids],
      write_scope: [...candidate.write_scope],
    },
    (draft) => {
      const candidates = Array.isArray(draft.candidates) ? [...draft.candidates] : [];
      candidates.push(candidate);
      draft.candidates = candidates;
    },
  );

  const markdown = formatMindCandidateBrief({
    candidateId: candidate.id,
    kind: candidate.kind,
    statement: candidate.statement,
    witnessCommandId: candidate.witness_command_id,
    charterGoals: candidate.charter_goal_ids,
    writeScope: candidate.write_scope,
  });

  return {
    markdown,
    run_root: run,
    candidate_id: candidate.id,
    candidate,
  };
}
