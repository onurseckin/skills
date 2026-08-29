import type { DigestDeclinedCandidate, DigestOpenProposal } from "./types.ts";

export function extractCandidateAndProposalSignals(
  state: Record<string, unknown>,
  declinedCandidates: DigestDeclinedCandidate[],
  openProposals: DigestOpenProposal[],
): void {
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const rawCandidates: Record<string, unknown>[] = [];

  if (Array.isArray(mindState.candidates)) {
    rawCandidates.push(...(mindState.candidates as Record<string, unknown>[]));
  } else if (typeof mindState.candidates === "object" && mindState.candidates !== null) {
    rawCandidates.push(...(Object.values(mindState.candidates) as Record<string, unknown>[]));
  }

  if (Array.isArray(state.candidates)) {
    for (const c of state.candidates as Record<string, unknown>[]) {
      if (!rawCandidates.some((item) => item.id === c.id)) rawCandidates.push(c);
    }
  } else if (typeof state.candidates === "object" && state.candidates !== null) {
    for (const c of Object.values(state.candidates) as Record<string, unknown>[]) {
      if (!rawCandidates.some((item) => item.id === c.id)) rawCandidates.push(c);
    }
  }

  for (const cand of rawCandidates) {
    const cid = typeof cand.id === "string" ? cand.id : "candidate";
    const stmt =
      typeof cand.statement === "string"
        ? cand.statement
        : typeof cand.title === "string"
          ? cand.title
          : typeof cand.objective === "string"
            ? cand.objective
            : cid;
    const rat = typeof cand.rationale === "string" ? cand.rationale : undefined;
    const goal =
      typeof cand.charter_goal === "string"
        ? cand.charter_goal
        : typeof cand.charter_goal_id === "string"
          ? cand.charter_goal_id
          : undefined;

    let witnessCmd: string | undefined = undefined;
    if (typeof cand.witness === "string") witnessCmd = cand.witness;
    else if (typeof cand.witness === "object" && cand.witness !== null) {
      const wObj = cand.witness as Record<string, unknown>;
      if (typeof wObj.command_id === "string") witnessCmd = wObj.command_id;
    } else if (typeof cand.witness_command_id === "string") witnessCmd = cand.witness_command_id;
    else if (typeof cand.command_id === "string") witnessCmd = cand.command_id;
    else if (typeof cand.command_source === "string") witnessCmd = cand.command_source;

    const eventIndex =
      typeof cand.event_index === "number"
        ? cand.event_index
        : typeof cand.event_sequence === "number"
          ? cand.event_sequence
          : undefined;

    const status = typeof cand.status === "string" ? cand.status : undefined;
    const kind = typeof cand.kind === "string" ? cand.kind : undefined;
    const disposition = typeof cand.disposition === "string" ? cand.disposition : undefined;

    if (status === "declined" || disposition === "declined") {
      const declineReason =
        typeof cand.decline_reason === "string"
          ? cand.decline_reason
          : typeof cand.declined_reason === "string"
            ? cand.declined_reason
            : typeof cand.reason === "string"
              ? cand.reason
              : "declined against charter criteria";
      const declinedAt = typeof cand.declined_at === "string" ? cand.declined_at : undefined;
      declinedCandidates.push({
        candidateId: cid,
        statement: stmt,
        rationale: rat,
        declineReason,
        charterGoalId: goal,
        witnessCommandId: witnessCmd,
        commandSource: witnessCmd,
        eventIndex,
        declinedAt,
      });
    } else if (
      kind === "proposal" ||
      status === "proposed" ||
      status === "needs_authority" ||
      disposition === "needs_authority"
    ) {
      const proposalRationale = rat ?? "novel proposal awaiting owner authority decision";
      const reqId = typeof cand.requirement_id === "string" ? cand.requirement_id : undefined;
      const proposedAt =
        typeof cand.proposed_at === "string"
          ? cand.proposed_at
          : typeof cand.created_at === "string"
            ? cand.created_at
            : undefined;

      openProposals.push({
        proposalId: cid,
        statement: stmt,
        rationale: proposalRationale,
        charterGoalId: goal,
        requirementId: reqId,
        proposedAt,
        witnessCommandId: witnessCmd,
        commandSource: witnessCmd,
        eventIndex,
      });
    }
  }

  // 5. Requirements with needs_authority disposition
  if (typeof state.requirements === "object" && state.requirements !== null) {
    const reqList: Record<string, unknown>[] = Array.isArray(state.requirements)
      ? (state.requirements as Record<string, unknown>[])
      : Array.isArray((state.requirements as Record<string, unknown>).requirements)
        ? ((state.requirements as Record<string, unknown>).requirements as Record<
            string,
            unknown
          >[])
        : (Object.values(state.requirements) as Record<string, unknown>[]);

    for (const req of reqList) {
      if (req.disposition === "needs_authority") {
        const reqId = typeof req.id === "string" ? req.id : "requirement";
        const alreadyProposed = openProposals.some(
          (p) => p.proposalId === reqId || p.requirementId === reqId,
        );
        if (!alreadyProposed) {
          const stmt =
            typeof req.instruction === "string"
              ? req.instruction
              : typeof req.statement === "string"
                ? req.statement
                : typeof req.label === "string"
                  ? req.label
                  : reqId;
          const rat =
            typeof req.rationale === "string"
              ? req.rationale
              : "requirement paused for owner authority decision";
          const goal = typeof req.charter_goal === "string" ? req.charter_goal : undefined;
          const cmdSrc =
            typeof req.command_id === "string"
              ? req.command_id
              : typeof req.command_source === "string"
                ? req.command_source
                : undefined;
          const evIdx =
            typeof req.event_index === "number"
              ? req.event_index
              : typeof req.event_sequence === "number"
                ? req.event_sequence
                : undefined;

          openProposals.push({
            proposalId: reqId,
            statement: stmt,
            rationale: rat,
            charterGoalId: goal,
            requirementId: reqId,
            witnessCommandId: cmdSrc,
            commandSource: cmdSrc,
            eventIndex: evIdx,
          });
        }
      }
    }
  }
}
