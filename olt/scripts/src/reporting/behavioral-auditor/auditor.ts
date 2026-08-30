import type {
  AgentGrantRecord,
  CommandRecord,
  JsonObject,
  RunState,
} from "../../core/contracts/index.ts";
import { isJsonObject } from "../../core/contracts/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import { auditCoordinatorCodeWriting } from "./audit-coordinator.ts";
import { auditImplementerSelfGradingAndTopology } from "./audit-implementer.ts";
import { auditOrchestratorDirectImplementation } from "./audit-orchestrator.ts";
import { auditSubagentPulseTermination } from "./audit-pulse.ts";
import { evidenceUnavailable } from "./predicates.ts";
import type { BehavioralFinding } from "./types.ts";

export { auditCoordinatorCodeWriting } from "./audit-coordinator.ts";
export { auditOrchestratorDirectImplementation } from "./audit-orchestrator.ts";
export { auditImplementerSelfGradingAndTopology } from "./audit-implementer.ts";
export { auditSubagentPulseTermination } from "./audit-pulse.ts";

function deduplicateFindings(findings: readonly BehavioralFinding[]): BehavioralFinding[] {
  const seen = new Set<string>();
  const deduplicated: BehavioralFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.agent_id}::${finding.violation_type}::${finding.observation}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(finding);
    }
  }
  return deduplicated;
}

export function auditBehavioralHealth(
  capsuleRoot: string,
  state?: RunState | JsonObject | null,
): BehavioralFinding[] {
  let resolvedState: JsonObject | null = isJsonObject(state) ? (state as JsonObject) : null;
  let loadedEvents: JsonObject[] = [];

  if (capsuleRoot) {
    try {
      const loaded = loadRun(capsuleRoot, false);
      resolvedState = loaded.state as unknown as JsonObject;
      loadedEvents = (loaded.events ?? []) as unknown as JsonObject[];
    } catch (error) {
      return [evidenceUnavailable(error)];
    }
  }

  if (!resolvedState) return [];

  const findings: BehavioralFinding[] = [];
  const roleMap = new Map<string, string>();
  let grants: AgentGrantRecord[] = [];
  try {
    grants = readAgentLedger(resolvedState);
    for (const grant of grants) {
      roleMap.set(grant.id, grant.role);
    }
  } catch (error) {
    findings.push(evidenceUnavailable(error));
  }

  const rawTasks = resolvedState.tasks;
  const tasks: TaskRecord[] = isJsonObject(rawTasks)
    ? Object.values(rawTasks)
        .filter(isJsonObject)
        .map((t) => t as unknown as TaskRecord)
    : [];

  const rawCommands = resolvedState.commands;
  const commands: CommandRecord[] = isJsonObject(rawCommands)
    ? Object.values(rawCommands)
        .filter(isJsonObject)
        .map((c) => c as unknown as CommandRecord)
    : [];

  auditCoordinatorCodeWriting(roleMap, grants, commands, tasks, findings);
  auditOrchestratorDirectImplementation(roleMap, grants, commands, tasks, findings);
  auditImplementerSelfGradingAndTopology(roleMap, tasks, commands, loadedEvents, findings);
  auditSubagentPulseTermination(roleMap, resolvedState, commands, findings);

  return deduplicateFindings(findings);
}
