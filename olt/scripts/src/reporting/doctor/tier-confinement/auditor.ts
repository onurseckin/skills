import { existsSync } from "node:fs";
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  AgentGrantRecord,
  CommandRecord,
  JsonObject,
  RunState,
} from "../../../core/contracts/index.ts";
import { isJsonObject } from "../../../core/contracts/index.ts";
import type { TaskRecord } from "../../../workflow/types.ts";
import { readAgentLedger } from "../../../workflow/agents/ledger.ts";
import { loadRun } from "../../../engine/store/index.ts";
import { deduplicateFindings } from "./constants.ts";
import {
  auditCoordinatorConfinement,
  auditCrossTierSpawning,
  auditSupervisorCodeContamination,
} from "./audit-supervisor.ts";
import { auditOrchestratorConfinement } from "./audit-orchestrator.ts";
import { auditImplementerConfinement } from "./audit-implementer.ts";
import { auditPulseTerminationConfinement } from "./audit-pulse.ts";
import type { GitDiffRecord, TierConfinementFinding, TierConfinementSummary } from "./types.ts";

export function auditTierConfinement(
  capsuleRoot: string,
  state?: RunState | JsonObject | null,
  gitDiffs?: readonly (string | GitDiffRecord)[],
): TierConfinementFinding[] {
  let resolvedState: JsonObject | null = isJsonObject(state) ? (state as JsonObject) : null;
  let loadedEvents: JsonObject[] = [];

  if (capsuleRoot && existsSync(capsuleRoot)) {
    try {
      const loaded = loadRun(capsuleRoot, false);
      if (!resolvedState) {
        resolvedState = loaded.state as unknown as JsonObject;
      }
      loadedEvents = (loaded.events ?? []) as unknown as JsonObject[];
    } catch {

    }
  }

  if (!resolvedState) return [];

  const roleMap = new Map<string, string>();
  let grants: AgentGrantRecord[] = [];
  try {
    grants = readAgentLedger(resolvedState);
    for (const grant of grants) {
      roleMap.set(grant.id, grant.role);
    }
  } catch {

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

  const findings: TierConfinementFinding[] = [];

  auditCrossTierSpawning(roleMap, grants, findings);
  auditCoordinatorConfinement(roleMap, grants, commands, tasks, findings);
  auditOrchestratorConfinement(roleMap, grants, commands, tasks, findings);
  auditImplementerConfinement(roleMap, tasks, commands, loadedEvents, findings);
  auditPulseTerminationConfinement(roleMap, resolvedState, commands, findings);
  auditSupervisorCodeContamination(roleMap, grants, commands, tasks, gitDiffs, findings);

  return deduplicateFindings(findings);
}

export function summarizeTierConfinement(
  findings: readonly TierConfinementFinding[],
): TierConfinementSummary {
  const issues = findings.map(
    (f) =>
      `tier-confinement [${f.severity}] (Tier ${f.tier} ${f.role}/${f.agent_id}): ${f.observation}`,
  );
  return {
    healthy: findings.length === 0,
    violation_count: findings.length,
    findings: [...findings],
    issues,
  };
}

export function assertSupervisorRoleConfinement(findings: readonly TierConfinementFinding[]): void {
  const supervisorViolations = findings.filter(
    (f) =>
      f.violation_type === "coordinator_code_writing" ||
      f.violation_type === "orchestrator_direct_implementation" ||
      f.violation_type === "supervisor_code_contamination",
  );

  if (supervisorViolations.length > 0) {
    const details = supervisorViolations
      .map((v) => `[Tier ${v.tier} ${v.role}/${v.agent_id}]: ${v.observation}`)
      .join("; ");
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Supervisor code editing contamination detected: ${details}. Supervisors are strictly forbidden from writing code and must delegate implementation exclusively to Tier 3 Implementers via invoke_subagent.`,
    );
  }
}
