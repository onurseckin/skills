import { basename, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { loadRun } from "../engine/store/load.ts";
import {
  generateTrailingValueSeries,
  extractTrailingValueSeriesFromState,
  extractTrailingValueSeriesFromEvents,
  type TrailingValueSeries,
  type TrailingValuePoint,
} from "./interval.ts";

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
  readonly proposedAt?: string | undefined;
  readonly commandSource?: string | undefined;
  readonly eventIndex?: number | undefined;
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

function parseNowIso(nowInput?: number | Date | string): string {
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

function normalizeCommandString(command: readonly string[] | string): string {
  return Array.isArray(command) ? command.join(" ") : String(command);
}

export function extractRunSignals(
  state: Record<string, unknown>,
  runId?: string,
): {
  readonly findings: readonly DigestFinding[];
  readonly gates: readonly DigestFailingGate[];
  readonly escalations: readonly DigestEscalation[];
  readonly declinedCandidates: readonly DigestDeclinedCandidate[];
  readonly openProposals: readonly DigestOpenProposal[];
} {
  const findings: DigestFinding[] = [];
  const gates: DigestFailingGate[] = [];
  const escalations: DigestEscalation[] = [];
  const declinedCandidates: DigestDeclinedCandidate[] = [];
  const openProposals: DigestOpenProposal[] = [];

  // 1. Escalations
  if (Array.isArray(state.escalations)) {
    for (const esc of state.escalations) {
      if (typeof esc === "object" && esc !== null) {
        const escObj = esc as Record<string, unknown>;
        if (escObj.resolved_at === null || escObj.resolved_at === undefined) {
          const id = typeof escObj.id === "string" ? escObj.id : "escalation";
          const taskId = typeof escObj.task_id === "string" ? escObj.task_id : undefined;
          const reason =
            typeof escObj.reason === "string" ? escObj.reason : "unknown escalation reason";
          const evidence = typeof escObj.evidence === "string" ? escObj.evidence : undefined;
          const escalatedAt =
            typeof escObj.escalated_at === "string" ? escObj.escalated_at : undefined;
          const commandSource =
            typeof escObj.command_id === "string"
              ? escObj.command_id
              : typeof escObj.command_source === "string"
                ? escObj.command_source
                : undefined;
          const eventIndex =
            typeof escObj.event_index === "number"
              ? escObj.event_index
              : typeof escObj.event_sequence === "number"
                ? escObj.event_sequence
                : undefined;

          escalations.push({
            escalationId: id,
            taskId,
            runId,
            reason,
            evidence,
            escalatedAt,
            commandSource,
            eventIndex,
          });
        }
      }
    }
  }

  // 2. Tasks: findings and task-level escalations
  if (typeof state.tasks === "object" && state.tasks !== null) {
    const tasksObj = state.tasks as Record<string, Record<string, unknown>>;
    for (const [taskId, task] of Object.entries(tasksObj)) {
      if (task.status === "escalated") {
        const alreadyListed = escalations.some(
          (e) =>
            (e.taskId === taskId || e.escalationId === taskId) && (!runId || e.runId === runId),
        );
        if (!alreadyListed) {
          const escId =
            typeof task.escalation_id === "string" ? task.escalation_id : `esc-${taskId}`;
          const reason =
            typeof task.escalation_reason === "string" ? task.escalation_reason : "task escalated";
          const evidence =
            typeof task.escalation_evidence === "string" ? task.escalation_evidence : undefined;
          const commandSource =
            typeof task.last_command_id === "string"
              ? task.last_command_id
              : typeof task.command_id === "string"
                ? task.command_id
                : typeof task.command_source === "string"
                  ? task.command_source
                  : undefined;
          const eventIndex =
            typeof task.event_index === "number"
              ? task.event_index
              : typeof task.event_sequence === "number"
                ? task.event_sequence
                : undefined;

          escalations.push({
            escalationId: escId,
            taskId,
            runId,
            reason,
            evidence,
            commandSource,
            eventIndex,
          });
        }
      }

      // Check open findings
      const openFindingIds = Array.isArray(task.open_finding_ids) ? task.open_finding_ids : [];
      const taskFindings = Array.isArray(task.findings)
        ? (task.findings as readonly Record<string, unknown>[])
        : [];
      const stateFindings = Array.isArray(state.findings)
        ? (state.findings as readonly Record<string, unknown>[])
        : typeof state.findings === "object" && state.findings !== null
          ? (Object.values(state.findings) as readonly Record<string, unknown>[])
          : [];

      if (openFindingIds.length > 0) {
        for (const findingId of openFindingIds) {
          if (typeof findingId !== "string") continue;
          const match =
            taskFindings.find((f) => f.id === findingId) ??
            stateFindings.find((f) => f.id === findingId);

          if (match) {
            const obs = typeof match.observation === "string" ? match.observation : "open finding";
            const rem = typeof match.remediation === "string" ? match.remediation : undefined;
            const reval =
              typeof match.revalidation === "string"
                ? match.revalidation
                : typeof match.revalidation_gate === "string"
                  ? match.revalidation_gate
                  : undefined;
            const sev = typeof match.severity === "string" ? match.severity : undefined;
            let cmdSrc =
              typeof match.command_id === "string"
                ? match.command_id
                : typeof match.command_source === "string"
                  ? match.command_source
                  : undefined;

            if (!cmdSrc && Array.isArray(match.evidence)) {
              for (const ev of match.evidence) {
                if (typeof ev === "object" && ev !== null) {
                  const evObj = ev as Record<string, unknown>;
                  if (typeof evObj.command_id === "string") {
                    cmdSrc = evObj.command_id;
                    break;
                  }
                }
              }
            }

            const evIdx =
              typeof match.event_index === "number"
                ? match.event_index
                : typeof match.event_sequence === "number"
                  ? match.event_sequence
                  : undefined;

            findings.push({
              findingId,
              taskId,
              runId,
              severity: sev,
              observation: obs,
              remediation: rem,
              revalidationGate: reval,
              commandSource: cmdSrc,
              eventIndex: evIdx,
            });
          } else {
            findings.push({
              findingId,
              taskId,
              runId,
              observation: "open review finding awaiting remediation",
            });
          }
        }
      } else if (task.status === "changes_requested") {
        findings.push({
          findingId: `finding-${taskId}`,
          taskId,
          runId,
          observation:
            typeof task.reason === "string"
              ? task.reason
              : "task in changes_requested state awaiting repair",
          commandSource:
            typeof task.last_command_id === "string"
              ? task.last_command_id
              : typeof task.command_id === "string"
                ? task.command_id
                : undefined,
          eventIndex:
            typeof task.event_index === "number"
              ? task.event_index
              : typeof task.event_sequence === "number"
                ? task.event_sequence
                : undefined,
        });
      }
    }
  }

  // 3. Gates
  const gateItems: Record<string, unknown>[] = [];
  if (typeof state.gates === "object" && state.gates !== null) {
    if (Array.isArray(state.gates)) {
      gateItems.push(...(state.gates as Record<string, unknown>[]));
    } else {
      gateItems.push(...(Object.values(state.gates) as Record<string, unknown>[]));
    }
  }
  if (
    typeof state.graph === "object" &&
    state.graph !== null &&
    Array.isArray((state.graph as Record<string, unknown>).gates)
  ) {
    for (const g of (state.graph as Record<string, unknown>).gates as Record<string, unknown>[]) {
      if (!gateItems.some((item) => item.id === g.id)) {
        gateItems.push(g);
      }
    }
  }

  for (const gate of gateItems) {
    const isFailed =
      gate.status === "failed" || (typeof gate.exit_code === "number" && gate.exit_code !== 0);

    if (isFailed) {
      const gateId = typeof gate.id === "string" ? gate.id : "gate";
      const taskId = typeof gate.task_id === "string" ? gate.task_id : undefined;
      const cmd =
        Array.isArray(gate.command) || typeof gate.command === "string"
          ? (gate.command as readonly string[] | string)
          : Array.isArray(gate.argv)
            ? (gate.argv as readonly string[])
            : "unknown-gate-command";
      const exitCode = typeof gate.exit_code === "number" ? gate.exit_code : undefined;
      const snippet =
        typeof gate.failure_snippet === "string"
          ? gate.failure_snippet
          : typeof gate.failure_output === "string"
            ? gate.failure_output
            : undefined;
      const commandSource =
        typeof gate.command_id === "string"
          ? gate.command_id
          : typeof gate.command_source === "string"
            ? gate.command_source
            : undefined;
      const eventIndex =
        typeof gate.event_index === "number"
          ? gate.event_index
          : typeof gate.event_sequence === "number"
            ? gate.event_sequence
            : undefined;

      gates.push({
        gateId,
        taskId,
        runId,
        command: cmd,
        exitCode,
        failureSnippet: snippet,
        commandSource,
        eventIndex,
      });
    }
  }

  // 4. Candidates and Proposals (Mind state or root state)
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const rawCandidates: Record<string, unknown>[] = [];

  if (Array.isArray(mindState.candidates)) {
    rawCandidates.push(...(mindState.candidates as Record<string, unknown>[]));
  } else if (typeof mindState.candidates === "object" && mindState.candidates !== null) {
    rawCandidates.push(...(Object.values(mindState.candidates) as Record<string, unknown>[]));
  }

  if (Array.isArray(state.candidates)) {
    for (const c of state.candidates as Record<string, unknown>[]) {
      if (!rawCandidates.some((item) => item.id === c.id)) {
        rawCandidates.push(c);
      }
    }
  } else if (typeof state.candidates === "object" && state.candidates !== null) {
    for (const c of Object.values(state.candidates) as Record<string, unknown>[]) {
      if (!rawCandidates.some((item) => item.id === c.id)) {
        rawCandidates.push(c);
      }
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
    if (typeof cand.witness === "string") {
      witnessCmd = cand.witness;
    } else if (typeof cand.witness === "object" && cand.witness !== null) {
      const wObj = cand.witness as Record<string, unknown>;
      if (typeof wObj.command_id === "string") {
        witnessCmd = wObj.command_id;
      }
    } else if (typeof cand.witness_command_id === "string") {
      witnessCmd = cand.witness_command_id;
    } else if (typeof cand.command_id === "string") {
      witnessCmd = cand.command_id;
    } else if (typeof cand.command_source === "string") {
      witnessCmd = cand.command_source;
    }

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
            commandSource: cmdSrc,
            eventIndex: evIdx,
          });
        }
      }
    }
  }

  return {
    findings,
    gates,
    escalations,
    declinedCandidates,
    openProposals,
  };
}

export function buildEscalationDigest(
  options: BuildEscalationDigestOptions = {},
): EscalationDigestData {
  const generatedAt = parseNowIso(options.now);
  const runId = options.runId ?? (options.mindRunRoot ? basename(options.mindRunRoot) : "mind");

  const findingsMap = new Map<string, DigestFinding>();
  const gatesMap = new Map<string, DigestFailingGate>();
  const escalationsMap = new Map<string, DigestEscalation>();
  const declinedMap = new Map<string, DigestDeclinedCandidate>();
  const proposalsMap = new Map<string, DigestOpenProposal>();

  const registerFinding = (f: DigestFinding): void => {
    const key = `${f.runId ?? ""}:${f.taskId ?? ""}:${f.findingId}`;
    if (!findingsMap.has(key)) findingsMap.set(key, f);
  };
  const registerGate = (g: DigestFailingGate): void => {
    const key = `${g.runId ?? ""}:${g.gateId}`;
    if (!gatesMap.has(key)) gatesMap.set(key, g);
  };
  const registerEscalation = (e: DigestEscalation): void => {
    const key = `${e.runId ?? ""}:${e.escalationId}`;
    if (!escalationsMap.has(key)) escalationsMap.set(key, e);
  };
  const registerDeclined = (d: DigestDeclinedCandidate): void => {
    if (!declinedMap.has(d.candidateId)) declinedMap.set(d.candidateId, d);
  };
  const registerProposal = (p: DigestOpenProposal): void => {
    if (!proposalsMap.has(p.proposalId)) proposalsMap.set(p.proposalId, p);
  };

  // 1. Explicit items passed in options
  if (options.openFindings) {
    for (const f of options.openFindings) registerFinding(f);
  }
  if (options.failingGates) {
    for (const g of options.failingGates) registerGate(g);
  }
  if (options.escalations) {
    for (const e of options.escalations) registerEscalation(e);
  }
  if (options.declinedCandidates) {
    for (const d of options.declinedCandidates) registerDeclined(d);
  }
  if (options.openProposals) {
    for (const p of options.openProposals) registerProposal(p);
  }

  // 2. Extract from primary state object
  if (options.state) {
    const extracted = extractRunSignals(options.state, runId);
    for (const f of extracted.findings) registerFinding(f);
    for (const g of extracted.gates) registerGate(g);
    for (const e of extracted.escalations) registerEscalation(e);
    for (const d of extracted.declinedCandidates) registerDeclined(d);
    for (const p of extracted.openProposals) registerProposal(p);
  }

  // 3. Extract from liveRuns list
  if (options.liveRuns) {
    for (const lr of options.liveRuns) {
      if (lr.state) {
        const extracted = extractRunSignals(lr.state, lr.runId);
        for (const f of extracted.findings) registerFinding(f);
        for (const g of extracted.gates) registerGate(g);
        for (const e of extracted.escalations) registerEscalation(e);
        for (const d of extracted.declinedCandidates) registerDeclined(d);
        for (const p of extracted.openProposals) registerProposal(p);
      } else if (lr.runRoot && existsSync(lr.runRoot)) {
        try {
          const loaded = loadRun(lr.runRoot, false);
          const extracted = extractRunSignals(loaded.state as Record<string, unknown>, lr.runId);
          for (const f of extracted.findings) registerFinding(f);
          for (const g of extracted.gates) registerGate(g);
          for (const e of extracted.escalations) registerEscalation(e);
          for (const d of extracted.declinedCandidates) registerDeclined(d);
          for (const p of extracted.openProposals) registerProposal(p);
        } catch {
          // ignore unreadable run
        }
      }
    }
  }

  // 4. Extract from capsulesDir if provided
  if (options.capsulesDir && existsSync(options.capsulesDir)) {
    try {
      const entries = readdirSync(options.capsulesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (entry.name.startsWith(".")) continue;
        const targetPath = join(options.capsulesDir, entry.name);
        try {
          const loaded = loadRun(targetPath, false);
          const extracted = extractRunSignals(loaded.state as Record<string, unknown>, entry.name);
          for (const f of extracted.findings) registerFinding(f);
          for (const g of extracted.gates) registerGate(g);
          for (const e of extracted.escalations) registerEscalation(e);
          for (const d of extracted.declinedCandidates) registerDeclined(d);
          for (const p of extracted.openProposals) registerProposal(p);
        } catch {
          // ignore unreadable directory
        }
      }
    } catch {
      // ignore
    }
  }

  // 5. Extract from mindRunRoot if provided and not already done
  if (options.mindRunRoot && existsSync(options.mindRunRoot) && !options.state) {
    try {
      const loaded = loadRun(options.mindRunRoot, false);
      const extracted = extractRunSignals(
        loaded.state as Record<string, unknown>,
        basename(options.mindRunRoot),
      );
      for (const f of extracted.findings) registerFinding(f);
      for (const g of extracted.gates) registerGate(g);
      for (const e of extracted.escalations) registerEscalation(e);
      for (const d of extracted.declinedCandidates) registerDeclined(d);
      for (const p of extracted.openProposals) registerProposal(p);
    } catch {
      // ignore
    }
  }

  // 6. Extract Trailing Value Series
  const windowSize = options.windowSize ?? 20;
  let trailingValueSeries: TrailingValueSeries;
  if (options.trailingValueSeries) {
    if (
      typeof options.trailingValueSeries === "object" &&
      options.trailingValueSeries !== null &&
      "rawValues" in options.trailingValueSeries &&
      "formattedSeries" in options.trailingValueSeries
    ) {
      trailingValueSeries = options.trailingValueSeries as TrailingValueSeries;
    } else if (Array.isArray(options.trailingValueSeries)) {
      const arr = options.trailingValueSeries;
      if (arr.length === 0) {
        trailingValueSeries = generateTrailingValueSeries([], windowSize);
      } else if (typeof arr[0] === "number") {
        const points: TrailingValuePoint[] = (arr as readonly number[]).map((val, idx) => ({
          pulseId: `pulse-${idx + 1}`,
          outcome: val > 0 ? "advance" : "quiescent",
          value: val,
        }));
        trailingValueSeries = generateTrailingValueSeries(points, windowSize);
      } else {
        trailingValueSeries = generateTrailingValueSeries(
          arr as readonly TrailingValuePoint[],
          windowSize,
        );
      }
    } else {
      trailingValueSeries = generateTrailingValueSeries([], windowSize);
    }
  } else if (options.events && Array.isArray(options.events)) {
    trailingValueSeries = extractTrailingValueSeriesFromEvents(options.events, windowSize);
  } else if (options.state) {
    trailingValueSeries = extractTrailingValueSeriesFromState(options.state, windowSize);
  } else if (options.mindRunRoot && existsSync(options.mindRunRoot)) {
    try {
      const loaded = loadRun(options.mindRunRoot, false);
      trailingValueSeries = extractTrailingValueSeriesFromState(
        loaded.state as Record<string, unknown>,
        windowSize,
      );
    } catch {
      trailingValueSeries = generateTrailingValueSeries([], windowSize);
    }
  } else {
    trailingValueSeries = generateTrailingValueSeries([], windowSize);
  }

  // Deterministic sorting
  const sortedFindings = [...findingsMap.values()].sort((a, b) =>
    (a.findingId + (a.taskId ?? "")).localeCompare(b.findingId + (b.taskId ?? "")),
  );
  const sortedGates = [...gatesMap.values()].sort((a, b) =>
    (a.gateId + (a.taskId ?? "")).localeCompare(b.gateId + (b.taskId ?? "")),
  );
  const sortedEscalations = [...escalationsMap.values()].sort((a, b) =>
    (a.escalationId + (a.taskId ?? "")).localeCompare(b.escalationId + (b.taskId ?? "")),
  );
  const sortedDeclined = [...declinedMap.values()].sort((a, b) =>
    a.candidateId.localeCompare(b.candidateId),
  );
  const sortedProposals = [...proposalsMap.values()].sort((a, b) =>
    a.proposalId.localeCompare(b.proposalId),
  );

  const totalSignalsCount =
    sortedFindings.length +
    sortedGates.length +
    sortedEscalations.length +
    sortedDeclined.length +
    sortedProposals.length;

  return {
    generatedAt,
    runId,
    openFindings: sortedFindings,
    failingGates: sortedGates,
    escalations: sortedEscalations,
    declinedCandidates: sortedDeclined,
    openProposals: sortedProposals,
    trailingValueSeries,
    totalSignalsCount,
  };
}

export const buildOwnerDigest = buildEscalationDigest;

function formatCitation(options: {
  readonly commandSource?: string | undefined;
  readonly witnessCommandId?: string | undefined;
  readonly eventIndex?: number | undefined;
}): string {
  const parts: string[] = [];
  const cmd = options.witnessCommandId ?? options.commandSource;
  if (cmd) {
    parts.push(options.witnessCommandId ? `witness: \`${cmd}\`` : `source: \`${cmd}\``);
  }
  if (typeof options.eventIndex === "number") {
    parts.push(`event: #${options.eventIndex}`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function formatFindingLine(f: DigestFinding): string {
  const taskPart = f.taskId ? ` (task \`${f.taskId}\`)` : f.runId ? ` (run \`${f.runId}\`)` : "";
  const severityPart = f.severity ? ` [${f.severity}]` : "";
  const remPart = f.remediation ? ` — Remediation: ${f.remediation}` : "";
  const revalPart = f.revalidationGate ? ` — Revalidation: \`${f.revalidationGate}\`` : "";
  const citation = formatCitation({ commandSource: f.commandSource, eventIndex: f.eventIndex });
  return `  - \`[${f.findingId}]\`${severityPart}${taskPart}: ${f.observation}${remPart}${revalPart}${citation}`;
}

function formatGateLine(g: DigestFailingGate): string {
  const cmdStr = normalizeCommandString(g.command);
  const taskPart = g.taskId ? ` (task \`${g.taskId}\`)` : g.runId ? ` (run \`${g.runId}\`)` : "";
  const exitPart = typeof g.exitCode === "number" ? ` (exit code ${g.exitCode})` : "";
  const snippetPart = g.failureSnippet ? ` — ${g.failureSnippet}` : "";
  const citation = formatCitation({ commandSource: g.commandSource, eventIndex: g.eventIndex });
  return `  - \`${g.gateId}\`${taskPart}: \`${cmdStr}\`${exitPart}${snippetPart}${citation}`;
}

function formatEscalationLine(e: DigestEscalation): string {
  const taskPart = e.taskId ? ` (task \`${e.taskId}\`)` : e.runId ? ` (run \`${e.runId}\`)` : "";
  const evPart = e.evidence ? ` — ${e.evidence}` : "";
  const citation = formatCitation({ commandSource: e.commandSource, eventIndex: e.eventIndex });
  return `  - \`${e.escalationId}\`${taskPart}: ${e.reason}${evPart}${citation}`;
}

function formatDeclinedCandidateLine(c: DigestDeclinedCandidate): string {
  const meta: string[] = [];
  if (c.charterGoalId) meta.push(`goal: \`${c.charterGoalId}\``);
  const cmd = c.witnessCommandId ?? c.commandSource;
  if (cmd) meta.push(`witness: \`${cmd}\``);
  if (typeof c.eventIndex === "number") meta.push(`event: #${c.eventIndex}`);
  const metaStr = meta.length > 0 ? ` (${meta.join(", ")})` : "";
  return `  - \`${c.candidateId}\`: "${c.statement}" — Reason: ${c.declineReason}${metaStr}`;
}

function formatOpenProposalLine(p: DigestOpenProposal): string {
  const meta: string[] = [];
  if (p.charterGoalId) meta.push(`goal: \`${p.charterGoalId}\``);
  if (p.requirementId) meta.push(`requirement: \`${p.requirementId}\``);
  if (p.commandSource) meta.push(`source: \`${p.commandSource}\``);
  if (typeof p.eventIndex === "number") meta.push(`event: #${p.eventIndex}`);
  const metaStr = meta.length > 0 ? ` (${meta.join(", ")})` : "";
  return `  - \`${p.proposalId}\`: "${p.statement}" — Rationale: ${p.rationale}${metaStr}`;
}

export interface FormatDigestOptions {
  readonly title?: string | undefined;
  readonly includeTrailingValueSeries?: boolean | undefined;
  readonly explicitEmptyUnasked?: boolean | undefined;
}

export function formatOwnerDigestMarkdown(
  digest: EscalationDigestData,
  options: FormatDigestOptions = {},
): string {
  const title = options.title ?? "Owner Digest";
  const explicitEmptyUnasked = options.explicitEmptyUnasked ?? true;
  const includeTrailingValueSeries = options.includeTrailingValueSeries ?? true;

  const hasUnasked = digest.declinedCandidates.length > 0 || digest.openProposals.length > 0;

  const unaskedLines: string[] = [];
  if (!hasUnasked && explicitEmptyUnasked) {
    unaskedLines.push("No unasked actions or proposals in this period.");
  } else {
    unaskedLines.push(`- **Declined candidates**: ${digest.declinedCandidates.length}`);
    if (digest.declinedCandidates.length === 0) {
      unaskedLines.push("  - none");
    } else {
      unaskedLines.push(...digest.declinedCandidates.map(formatDeclinedCandidateLine));
    }
    unaskedLines.push(
      `- **Open proposals (needs authority decision)**: ${digest.openProposals.length}`,
    );
    if (digest.openProposals.length === 0) {
      unaskedLines.push("  - none");
    } else {
      unaskedLines.push(...digest.openProposals.map(formatOpenProposalLine));
    }
  }

  const trailing = digest.trailingValueSeries;
  const trailingLines: string[] = [];
  if (includeTrailingValueSeries && trailing) {
    trailingLines.push(
      "",
      "## Trailing value series",
      "",
      `- **Raw series**: \`${trailing.formattedSeries}\``,
      `- **Total value**: ${trailing.totalValue}`,
      `- **Trailing zero streak**: ${trailing.trailingZeroStreak}`,
    );
    if (trailing.isFlatZero && trailing.rawValues.length >= 5) {
      trailingLines.push(
        `> ⚠️ **Flat Zero Series**: All ${trailing.rawValues.length} recent pulses produced 0 value. A long flat zero is either a healthy repository or a broken mind, and only a human can tell which.`,
      );
    }
  }

  const lines: string[] = [
    `### ${title}: \`${digest.runId}\``,
    `- **Generated**: ${digest.generatedAt}`,
    `- **Open findings**: ${digest.openFindings.length}`,
    ...(digest.openFindings.length === 0
      ? ["  - none"]
      : digest.openFindings.map(formatFindingLine)),
    `- **Failing gates**: ${digest.failingGates.length}`,
    ...(digest.failingGates.length === 0 ? ["  - none"] : digest.failingGates.map(formatGateLine)),
    `- **Escalations (needs human decision)**: ${digest.escalations.length}`,
    ...(digest.escalations.length === 0
      ? ["  - none"]
      : digest.escalations.map(formatEscalationLine)),
    "",
    "## What I would have done without asking",
    "",
    ...unaskedLines,
    ...trailingLines,
  ];

  return lines.join("\n");
}

export function formatEscalationDigestMarkdown(
  digest: EscalationDigestData,
  options: FormatDigestOptions = {},
): string {
  const title = options.title ?? "Escalation Digest";
  const explicitEmptyUnasked = options.explicitEmptyUnasked ?? false;
  const includeTrailing =
    options.includeTrailingValueSeries ??
    (digest.trailingValueSeries !== undefined && digest.trailingValueSeries.rawValues.length > 0);

  return formatOwnerDigestMarkdown(digest, {
    title,
    explicitEmptyUnasked,
    includeTrailingValueSeries: includeTrailing,
  });
}
