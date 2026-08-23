import type { HarnessEvent } from "../../core/contracts/capsule.ts";

interface EventNarration {
  phase: string;
  summary: string;
}

function textField(payload: Record<string, unknown>, key: string): string | undefined {
  return typeof payload[key] === "string" ? payload[key] : undefined;
}

function numberField(payload: Record<string, unknown>, key: string): number | undefined {
  return typeof payload[key] === "number" ? payload[key] : undefined;
}

function stringListField(payload: Record<string, unknown>, key: string): string[] | undefined {
  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

function planNarration(
  event: HarnessEvent,
  p: Record<string, unknown>,
): EventNarration | undefined {
  switch (event.kind) {
    case "plan-enhanced": {
      const todos = numberField(p, "todo_count");
      const observations = numberField(p, "observation_count");
      const counted =
        todos === undefined && observations === undefined
          ? ""
          : ` (${observations ?? 0} observations, ${todos ?? 0} todos)`;
      return { phase: "planning", summary: `Plan enhanced by ${event.actor}${counted}` };
    }
    case "plan-recompiled": {
      const newTasks = stringListField(p, "new_tasks") ?? [];
      const round = numberField(p, "repair_round");
      const forRound = round === undefined ? "" : ` for repair round ${round}`;
      return {
        phase: "repair",
        summary: `Plan recompiled by ${event.actor}${forRound}: ${newTasks.length} new task(s)`,
      };
    }
    case "topology-recorded": {
      const waves = numberField(p, "wave_count");
      const tasks = numberField(p, "task_count");
      return {
        phase: "planning",
        summary: `Topology recorded by ${event.actor}: ${waves ?? "an unrecorded number of"} wave(s) over ${tasks ?? "an unrecorded number of"} task(s)`,
      };
    }
    case "plan-audited": {
      const blocking = numberField(p, "blocking_count") ?? 0;
      const tasks = numberField(p, "task_count");
      const scope = tasks === undefined ? "" : ` across ${tasks} task(s)`;
      return {
        phase: "planning",
        summary: `Plan audited by ${event.actor}: ${blocking} blocking finding(s)${scope}`,
      };
    }
    case "plan-audit-accepted": {
      const invariant = textField(p, "invariant") ?? "an unrecorded invariant";
      const reason = textField(p, "reason") ?? "no reason recorded";
      return {
        phase: "planning",
        summary: `Audit override recorded by ${event.actor} for ${invariant}: ${reason}`,
      };
    }
    default:
      return undefined;
  }
}

function agentNarration(
  event: HarnessEvent,
  p: Record<string, unknown>,
): EventNarration | undefined {
  const agentId = textField(p, "agent_id") ?? event.actor;
  switch (event.kind) {
    case "agent-registered": {
      const role = textField(p, "role") ?? "an unrecorded role";
      const host = textField(p, "host");
      return {
        phase: "system",
        summary: `Agent ${agentId} registered as ${role}${host ? ` on ${host}` : ""}`,
      };
    }
    case "agent-reported": {
      const tools = stringListField(p, "tools") ?? [];
      const tokensIn = numberField(p, "tokens_in");
      const tokensOut = numberField(p, "tokens_out");
      const parts = [
        ...(tools.length > 0 ? [`tools: ${tools.join(", ")}`] : []),
        ...(tokensIn === undefined ? [] : [`in: ${tokensIn}`]),
        ...(tokensOut === undefined ? [] : [`out: ${tokensOut}`]),
      ];
      return {
        phase: "system",
        summary: `Agent ${agentId} reported telemetry${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`,
      };
    }
    case "agent-released": {
      const reason = textField(p, "reason") ?? "no reason recorded";
      return { phase: "system", summary: `Agent ${agentId} released by ${event.actor}: ${reason}` };
    }
    default:
      return undefined;
  }
}

function branchNarration(
  event: HarnessEvent,
  p: Record<string, unknown>,
): EventNarration | undefined {
  const branchId = textField(p, "branch_id") ?? "an unrecorded branch";
  switch (event.kind) {
    case "branch-opened": {
      const parentTask = textField(p, "parent_task_id") ?? "an unrecorded task";
      const reason = textField(p, "reason") ?? "no reason recorded";
      return {
        phase: "branch",
        summary: `Branch ${branchId} opened off ${parentTask} by ${event.actor}: ${reason}`,
      };
    }
    case "branch-claimed": {
      const subTaskId = textField(p, "sub_task_id") ?? "an unrecorded sub-task";
      return {
        phase: "branch",
        summary: `Sub-task ${subTaskId} of branch ${branchId} claimed by ${event.actor}`,
      };
    }
    case "branch-submitted": {
      const subTaskId = textField(p, "sub_task_id") ?? "an unrecorded sub-task";
      const summary = textField(p, "summary") ?? "no summary recorded";
      return {
        phase: "branch",
        summary: `Sub-task ${subTaskId} of branch ${branchId} submitted by ${event.actor}: ${summary}`,
      };
    }
    case "branch-collected": {
      const summary = textField(p, "summary") ?? "no summary recorded";
      return {
        phase: "branch",
        summary: `Branch ${branchId} collected by ${event.actor}: ${summary}`,
      };
    }
    case "branch-abandoned": {
      const reason = textField(p, "reason") ?? "no reason recorded";
      return {
        phase: "branch",
        summary: `Branch ${branchId} abandoned by ${event.actor}: ${reason}`,
      };
    }
    default:
      return undefined;
  }
}

function reviewNarration(
  event: HarnessEvent,
  p: Record<string, unknown>,
): EventNarration | undefined {
  switch (event.kind) {
    case "probe-recorded": {
      const taskId = textField(p, "task_id") ?? "an unrecorded task";
      const round = numberField(p, "round");
      const findingIds = stringListField(p, "finding_ids") ?? [];
      const forRound = round === undefined ? "" : ` round ${round}`;
      return {
        phase: "validation",
        summary: `Probe recorded by ${event.actor} for task ${taskId}${forRound} (${findingIds.length} finding(s))`,
      };
    }
    case "gate-attached": {
      const taskId = textField(p, "task_id");
      const gateId = textField(p, "gate_id") ?? "an unrecorded gate";
      return {
        phase: "validation",
        summary: `Gate ${gateId} attached${taskId ? ` to task ${taskId}` : ""} by ${event.actor}`,
      };
    }
    case "critic-assigned":
      return { phase: "review", summary: `Completeness critic round assigned to ${event.actor}` };
    case "completion-reviewed": {
      const packetId = textField(p, "packet_id");
      const status = textField(p, "status");
      const reviewSummary = textField(p, "summary") ?? "no summary recorded";
      return {
        phase: "review",
        summary: `Completion review recorded by ${event.actor}${packetId ? ` (packet ${packetId})` : ""}${status ? ` [${status}]` : ""}: ${reviewSummary}`,
      };
    }
    case "completion-remediated":
      return { phase: "repair", summary: `Completion remediation recorded by ${event.actor}` };
    case "requirement-authority-decided": {
      const requirementId = textField(p, "requirement_id") ?? "an unrecorded requirement";
      const decision = textField(p, "decision") ?? "no decision recorded";
      return {
        phase: "review",
        summary: `Requirement ${requirementId} authority decision by ${event.actor}: ${decision}`,
      };
    }
    default:
      return undefined;
  }
}

function systemNarration(
  event: HarnessEvent,
  p: Record<string, unknown>,
): EventNarration | undefined {
  switch (event.kind) {
    case "packet-prepared":
    case "packet-published": {
      const packetId = textField(p, "packet_id") ?? "an unrecorded packet";
      const verb = event.kind === "packet-prepared" ? "prepared" : "published";
      return { phase: "execution", summary: `Packet ${packetId} ${verb} by ${event.actor}` };
    }
    case "repository-inspected": {
      const phase = textField(p, "phase") ?? "an unrecorded phase";
      return { phase: "system", summary: `Repository inspected (${phase}) by ${event.actor}` };
    }
    case "lease-heartbeat":
    case "lease-released": {
      const taskId = textField(p, "task_id") ?? "an unrecorded task";
      const verb = event.kind === "lease-heartbeat" ? "heartbeat recorded" : "released";
      return { phase: "execution", summary: `Lease for task ${taskId} ${verb} by ${event.actor}` };
    }
    case "stale-recovery":
      return { phase: "system", summary: `Stale lease recovery run by ${event.actor}` };
    case "replacement-repairer-assigned": {
      const taskId = textField(p, "task_id") ?? "an unrecorded task";
      const replacementId = textField(p, "replacement_id") ?? "an unrecorded agent";
      const reason = textField(p, "reason") ?? "no reason recorded";
      return {
        phase: "repair",
        summary: `Task ${taskId} reassigned to ${replacementId} by ${event.actor}: ${reason}`,
      };
    }
    case "orphan-evidence-dispositioned": {
      const orphanSha = textField(p, "orphan_sha256");
      return {
        phase: "system",
        summary: `Orphan evidence disposition recorded by ${event.actor}${orphanSha ? ` (${orphanSha.slice(0, 12)})` : ""}`,
      };
    }
    default:
      return undefined;
  }
}

export function narrateUnclassifiedEvent(event: HarnessEvent): EventNarration | undefined {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  return (
    planNarration(event, p) ??
    agentNarration(event, p) ??
    branchNarration(event, p) ??
    reviewNarration(event, p) ??
    systemNarration(event, p)
  );
}
