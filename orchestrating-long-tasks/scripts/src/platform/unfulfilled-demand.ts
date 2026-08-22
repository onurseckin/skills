import type { JsonObject, JsonValue } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import type { UnfulfilledDemandItem, UnfulfilledDemandPushbackReport } from "./types.ts";

export interface UnfulfilledDemandEvaluationOptions {
  readonly targetTaskIds?: readonly string[];
  readonly targetWave?: number;
  readonly strictGates?: boolean;
  readonly strictCandidates?: boolean;
}

export function evaluateUnfulfilledDemands(
  state: JsonObject,
  options?: UnfulfilledDemandEvaluationOptions,
): UnfulfilledDemandPushbackReport {
  const unfulfilledItems: UnfulfilledDemandItem[] = [];
  const remediationPlan: string[] = [];

  const rawTasks = (
    typeof state.tasks === "object" && state.tasks !== null ? state.tasks : {}
  ) as Record<string, unknown>;

  const graph =
    typeof state.graph === "object" && state.graph !== null
      ? (state.graph as Record<string, unknown>)
      : {};

  const graphNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const graphGates = Array.isArray(graph.gates) ? graph.gates : [];

  const candidateList = Array.isArray(state.candidates) ? state.candidates : [];

  const tasksInState: Record<
    string,
    {
      status: string;
      write_scope: string[];
      label?: string | undefined;
      lease?: Record<string, unknown> | undefined;
    }
  > = {};

  for (const [taskId, rawTask] of Object.entries(rawTasks)) {
    if (typeof rawTask === "object" && rawTask !== null) {
      const taskObj = rawTask as Record<string, unknown>;
      tasksInState[taskId] = {
        status: typeof taskObj.status === "string" ? taskObj.status : "unknown",
        write_scope: Array.isArray(taskObj.write_scope) ? (taskObj.write_scope as string[]) : [],
        label: typeof taskObj.label === "string" ? taskObj.label : undefined,
        lease:
          typeof taskObj.lease === "object" && taskObj.lease !== null
            ? (taskObj.lease as Record<string, unknown>)
            : undefined,
      };
    }
  }

  for (const node of graphNodes) {
    if (typeof node === "object" && node !== null) {
      const nodeObj = node as Record<string, unknown>;
      if (nodeObj.type === "task" && typeof nodeObj.id === "string") {
        const taskId = nodeObj.id;
        if (!tasksInState[taskId]) {
          tasksInState[taskId] = {
            status: typeof nodeObj.status === "string" ? nodeObj.status : "proposed",
            write_scope: Array.isArray(nodeObj.write_scope)
              ? (nodeObj.write_scope as string[])
              : [],
            label: typeof nodeObj.label === "string" ? nodeObj.label : undefined,
          };
        }
      }
    }
  }

  const allTaskIds = Object.keys(tasksInState);
  const totalPlanned = allTaskIds.length;

  const targetIds =
    options?.targetTaskIds && options.targetTaskIds.length > 0
      ? new Set(options.targetTaskIds)
      : null;

  for (const [taskId, taskInfo] of Object.entries(tasksInState)) {
    if (targetIds && !targetIds.has(taskId)) {
      continue;
    }

    const status = taskInfo.status;
    const isFulfilled = status === "done" || status === "validated";

    if (!isFulfilled) {
      const assignedAgent =
        typeof taskInfo.lease?.agent_id === "string" ? taskInfo.lease.agent_id : undefined;

      let rootCause = `Task '${taskId}' is in non-terminal status '${status}'.`;
      let blockingReason = `Advancement blocked: Planned task '${taskId}' must reach 'validated' or 'done' status.`;
      let remediation = `bun harness.ts task:claim --task ${taskId} --agent <agent-id> --role implementer && bun harness.ts task:submit --task ${taskId} ...`;

      if (status === "proposed" || status === "ready") {
        rootCause = `Task '${taskId}' was planned in graph but never claimed by an implementer.`;
        remediation = `Claim and execute task: bun harness.ts task:claim --task ${taskId} --agent impl-${taskId} --role implementer`;
      } else if (status === "leased" || status === "running") {
        rootCause = `Task '${taskId}' is currently leased by agent '${assignedAgent ?? "unknown"}' but submission evidence was never recorded.`;
        remediation = `Submit completed task: bun harness.ts task:submit --task ${taskId} --agent ${assignedAgent ?? "worker"} --token <token> --summary "<summary>"`;
      } else if (status === "changes_requested") {
        rootCause = `Task '${taskId}' has open validator findings and requires implementer repair.`;
        remediation = `Assign repairer and remediate findings: bun harness.ts task:assign-repairer --task ${taskId} --repairer rep-${taskId}`;
      } else if (status === "validating" || status === "submitted") {
        rootCause = `Task '${taskId}' is awaiting independent validator sign-off.`;
        remediation = `Complete validator review: bun harness.ts task:review --task ${taskId} --status approved --validator val-${taskId} --domain code-quality`;
      } else if (status === "stale") {
        rootCause = `Task '${taskId}' lease expired before completion.`;
        remediation = `Recover expired task: bun harness.ts recover --task ${taskId}`;
      }

      unfulfilledItems.push({
        id: taskId,
        kind: "task",
        label: taskInfo.label ?? taskId,
        status,
        writeScope: taskInfo.write_scope,
        ...(assignedAgent ? { assignedAgentId: assignedAgent } : {}),
        rootCause,
        blockingReason,
        remediation,
      });

      remediationPlan.push(`[Task ${taskId}] ${remediation}`);
    }
  }

  const topology =
    typeof state.topology === "object" && state.topology !== null
      ? (state.topology as Record<string, unknown>)
      : null;

  if (topology && Array.isArray(topology.waves)) {
    for (const waveEntry of topology.waves) {
      if (typeof waveEntry === "object" && waveEntry !== null) {
        const waveObj = waveEntry as Record<string, unknown>;
        const waveNum = typeof waveObj.wave === "number" ? waveObj.wave : 0;
        const taskIdsInWave = Array.isArray(waveObj.task_ids) ? (waveObj.task_ids as string[]) : [];

        if (options?.targetWave !== undefined && waveNum !== options.targetWave) {
          continue;
        }

        const unfulfilledInWave = taskIdsInWave.filter((id) => {
          const t = tasksInState[id];
          return !t || (t.status !== "done" && t.status !== "validated");
        });

        if (unfulfilledInWave.length > 0) {
          unfulfilledItems.push({
            id: `lane-wave-${waveNum}`,
            kind: "lane",
            label: `Wave ${waveNum} Lane`,
            status: "blocked",
            writeScope: unfulfilledInWave.flatMap((id) => tasksInState[id]?.write_scope ?? []),
            rootCause: `Wave ${waveNum} lane has ${unfulfilledInWave.length} unfulfilled tasks: [${unfulfilledInWave.join(", ")}].`,
            blockingReason: `Wave ${waveNum} lane cannot advance until all lane tasks converge.`,
            remediation: `Fulfill all tasks in Wave ${waveNum}: ${unfulfilledInWave.join(", ")}`,
          });
        }
      }
    }
  }

  if (options?.strictGates) {
    for (const gate of graphGates) {
      if (typeof gate === "object" && gate !== null) {
        const gateObj = gate as Record<string, unknown>;
        const gateId = typeof gateObj.id === "string" ? gateObj.id : "unknown-gate";
        const isMandatory = gateObj.mandatory === true;

        if (isMandatory && gateObj.status !== "passed") {
          unfulfilledItems.push({
            id: gateId,
            kind: "gate",
            label: `Mandatory Gate ${gateId}`,
            status: typeof gateObj.status === "string" ? gateObj.status : "pending",
            writeScope: [],
            rootCause: `Mandatory gate '${gateId}' has not passed with exit code 0.`,
            blockingReason: `Gate verification is mandatory before run sign-off.`,
            remediation: `Execute and prove gate: bun harness.ts gate:prove --gate ${gateId}`,
          });
        }
      }
    }
  }

  if (options?.strictCandidates) {
    for (const cand of candidateList) {
      if (typeof cand === "object" && cand !== null) {
        const candObj = cand as Record<string, unknown>;
        const candId = typeof candObj.id === "string" ? candObj.id : "unknown-candidate";
        const candStatus = typeof candObj.status === "string" ? candObj.status : "unknown";

        if (candStatus === "admitted") {
          const hasLinkedCompletedTask = allTaskIds.some((id) => {
            const t = tasksInState[id];
            return t?.status === "done" || t?.status === "validated";
          });

          if (!hasLinkedCompletedTask && allTaskIds.length === 0) {
            unfulfilledItems.push({
              id: candId,
              kind: "action",
              label: `Admitted Candidate ${candId}`,
              status: "admitted_unplanned",
              writeScope: Array.isArray(candObj.write_scope)
                ? (candObj.write_scope as string[])
                : [],
              rootCause: `Candidate '${candId}' was admitted by authority but no execution tasks were planned or completed.`,
              blockingReason: `Admitted candidates in Harness memory must be planned and fulfilled.`,
              remediation: `Compile plan to fulfill admitted candidate: bun harness.ts plan:compile`,
            });
          }
        }
      }
    }
  }

  const hasUnfulfilledDemands = unfulfilledItems.length > 0;
  const blockingPushbackMessage = hasUnfulfilledDemands
    ? [
        `[AGGRESSIVE UNFULFILLED-DEMAND PUSHBACK]`,
        `Engine execution halted: ${unfulfilledItems.length} planned action(s)/lane(s)/task(s) in Harness memory remain unfulfilled.`,
        `Advancement is strictly blocked until root causes are isolated and full completion is enforced.`,
        "",
        `### Unfulfilled Demand Details:`,
        ...unfulfilledItems.map(
          (item, idx) =>
            `${idx + 1}. [${item.kind.toUpperCase()} ${item.id}] Status: ${item.status}\n   - Root Cause: ${item.rootCause}\n   - Blocking Reason: ${item.blockingReason}\n   - Remediation: ${item.remediation}`,
        ),
      ].join("\n")
    : undefined;

  return {
    hasUnfulfilledDemands,
    totalPlanned,
    totalUnfulfilled: unfulfilledItems.length,
    unfulfilledItems,
    ...(blockingPushbackMessage ? { blockingPushbackMessage } : {}),
    remediationPlan,
    checkedAt: new Date().toISOString(),
  };
}

export function assertNoUnfulfilledDemands(
  state: JsonObject,
  options?: UnfulfilledDemandEvaluationOptions,
): void {
  const report = evaluateUnfulfilledDemands(state, options);
  if (report.hasUnfulfilledDemands) {
    const errorIssues: JsonValue[] = report.unfulfilledItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      status: item.status,
      root_cause: item.rootCause,
      remediation: item.remediation,
    }));

    throw new HarnessError(
      "INVALID_STATE",
      report.blockingPushbackMessage ?? "Unfulfilled demands detected in harness memory.",
      errorIssues,
      3,
      report.remediationPlan.join("\n"),
    );
  }
}
