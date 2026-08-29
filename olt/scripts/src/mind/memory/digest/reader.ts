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
import type {
  DigestFinding,
  DigestFailingGate,
  DigestEscalation,
  DigestDeclinedCandidate,
  DigestOpenProposal,
  MemoryDigest,
  MemoryDigestOptions,
} from "./types.ts";
import { extractCandidateAndProposalSignals } from "./candidates.ts";

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
    if (Array.isArray(state.gates)) gateItems.push(...(state.gates as Record<string, unknown>[]));
    else gateItems.push(...(Object.values(state.gates) as Record<string, unknown>[]));
  }
  if (
    typeof state.graph === "object" &&
    state.graph !== null &&
    Array.isArray((state.graph as Record<string, unknown>).gates)
  ) {
    for (const g of (state.graph as Record<string, unknown>).gates as Record<string, unknown>[]) {
      if (!gateItems.some((item) => item.id === g.id)) gateItems.push(g);
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

  // 4. Candidates and Proposals
  extractCandidateAndProposalSignals(state, declinedCandidates, openProposals);

  return { findings, gates, escalations, declinedCandidates, openProposals };
}

export function readMemoryDigest(options: MemoryDigestOptions = {}): MemoryDigest {
  const runId = options.runId ?? "mind";
  const state = options.state ?? {};
  const extracted = extractRunSignals(state, runId);
  const trailingSeries = options.trailingSeries ?? generateTrailingValueSeries([]);
  return {
    runId,
    generatedAt: new Date().toISOString(),
    findings: extracted.findings,
    gates: extracted.gates,
    escalations: extracted.escalations,
    declinedCandidates: extracted.declinedCandidates,
    openProposals: extracted.openProposals,
    trailingSeries,
  };
}
