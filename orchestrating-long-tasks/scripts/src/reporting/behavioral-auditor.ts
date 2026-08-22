import { existsSync } from "node:fs";
import type {
  AgentGrantRecord,
  AgentToolRef,
  AgentToolUse,
} from "../contracts/agents.ts";
import { isAgentRole } from "../contracts/packets.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import { isJsonObject, type JsonObject } from "../contracts/json.ts";
import type { TaskRecord, ValidationAttempt } from "../workflow/types.ts";
import type { RunState } from "../contracts/capsule.ts";
import { readAgentLedger } from "../workflow/agents/ledger.ts";
import { loadRun } from "../store/index.ts";

export type BehavioralViolationType =
  | "coordinator_code_writing"
  | "orchestrator_direct_implementation"
  | "implementer_self_grading"
  | "implementer_graph_mutation"
  | "subagent_pulse_termination";

export type BehavioralSeverity = "critical" | "important" | "minor";

export interface BehavioralFinding {
  agent_id: string;
  role: string;
  violation_type: BehavioralViolationType;
  severity: BehavioralSeverity;
  observation: string;
  remediation: string;
  evidence?: JsonObject;
}

export interface BehavioralHealthSummary {
  healthy: boolean;
  violation_count: number;
  findings: BehavioralFinding[];
  issues: string[];
}

export const FILE_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "write_to_file",
  "replace_file_content",
  "edit_file",
  "apply_diff",
  "patch",
  "create_file",
  "delete_file",
  "file_writer",
  "code_editor",
]);

export const GRAPH_MUTATION_COMMANDS: ReadonlySet<string> = new Set([
  "plan:init",
  "plan:enhance",
  "plan:add",
  "plan:compile",
  "plan:apply",
  "plan:replan",
  "plan:claim",
  "mind:init",
  "mind:candidate",
  "mind:admit",
]);

export const VALIDATION_COMMANDS: ReadonlySet<string> = new Set([
  "task:validate-start",
  "task:review",
  "task:probe",
  "task:reject",
  "critic:start",
  "critic:remediate",
  "gate:prove",
  "coordinator:pushback",
]);

export const TERMINAL_PULSE_OUTCOMES: ReadonlySet<string> = new Set([
  "halted",
  "unarmed",
  "stopped",
  "completed",
]);

export function isCoordinatorRole(role: string): boolean {
  return role === "coordinator" || role.startsWith("coordinator-");
}

export function isOrchestratorRole(role: string): boolean {
  return role === "orchestrator";
}

export function isImplementerRole(role: string): boolean {
  return (
    role === "implementer" ||
    role === "repairer" ||
    role === "sub-implementer" ||
    role === "worker"
  );
}

export function isValidatorRole(role: string): boolean {
  return (
    role === "validator" ||
    role === "sub-validator" ||
    role === "plan-validator" ||
    role === "completeness-critic" ||
    role === "mind-auditor"
  );
}

export function isSubagentRole(role: string): boolean {
  return (
    role === "coordinator" ||
    role.startsWith("coordinator-") ||
    role === "orchestrator" ||
    role === "implementer" ||
    role === "repairer" ||
    role === "sub-implementer" ||
    role === "validator" ||
    role === "sub-validator" ||
    role === "plan-validator" ||
    role === "planner" ||
    role === "completeness-critic" ||
    role === "mind-auditor" ||
    role === "sub-investigator"
  );
}

function inferRole(
  actorId: string,
  roleMap: Map<string, string>,
  state: JsonObject,
): string {
  if (roleMap.has(actorId)) return roleMap.get(actorId)!;
  if (isAgentRole(actorId)) return actorId;

  const packets = state.packets;
  if (isJsonObject(packets)) {
    for (const packet of Object.values(packets)) {
      if (
        isJsonObject(packet) &&
        packet.agent_id === actorId &&
        typeof packet.role === "string"
      ) {
        return packet.role;
      }
    }
  }

  const tasks = state.tasks;
  if (isJsonObject(tasks)) {
    for (const task of Object.values(tasks)) {
      if (!isJsonObject(task)) continue;
      const lease = task.lease;
      if (
        isJsonObject(lease) &&
        lease.agent_id === actorId &&
        typeof lease.role === "string"
      ) {
        return lease.role;
      }
      const attempts = task.attempts;
      if (Array.isArray(attempts)) {
        for (const attempt of attempts) {
          if (
            isJsonObject(attempt) &&
            attempt.agent_id === actorId &&
            typeof attempt.role === "string"
          ) {
            return attempt.role;
          }
        }
      }
    }
  }

  if (/^coord/i.test(actorId)) return "coordinator";
  if (/^orch/i.test(actorId)) return "orchestrator";
  if (/^(impl|repair|worker)/i.test(actorId)) return "implementer";
  if (/^(val|critic|audit)/i.test(actorId)) return "validator";
  if (/^plan/i.test(actorId)) return "planner";

  return "unknown";
}

function auditCoordinatorCodeWriting(
  roleMap: Map<string, string>,
  grants: readonly AgentGrantRecord[],
  commands: readonly CommandRecord[],
  tasks: readonly TaskRecord[],
  findings: BehavioralFinding[],
): void {
  for (const grant of grants) {
    if (!isCoordinatorRole(grant.role)) continue;

    for (const tool of (grant.tools_used ?? []) as readonly AgentToolUse[]) {
      if (tool.category === "file-edit" || FILE_EDIT_TOOLS.has(tool.name)) {
        const toolCategory = tool.category ? tool.category : "file-edit";
        findings.push({
          agent_id: grant.id,
          role: grant.role,
          violation_type: "coordinator_code_writing",
          severity: "critical",
          observation: `Coordinator agent "${grant.id}" recorded usage of code-editing tool "${tool.name}" (category: ${toolCategory})`,
          remediation:
            "Coordinators must never write code or edit files directly. Delegate all implementation tasks to Tier 3 Implementers via subagent dispatches (invoke_subagent).",
          evidence: {
            tool_name: tool.name,
            category: toolCategory,
            first_reported_at: tool.first_reported_at,
          },
        });
      }
    }

    if (grant.tools_granted?.value) {
      for (const tool of grant.tools_granted.value as readonly AgentToolRef[]) {
        if (tool.category === "file-edit" || FILE_EDIT_TOOLS.has(tool.name)) {
          const toolCategory = tool.category ? tool.category : "file-edit";
          findings.push({
            agent_id: grant.id,
            role: grant.role,
            violation_type: "coordinator_code_writing",
            severity: "critical",
            observation: `Coordinator agent "${grant.id}" holds unauthorized grant for code-editing tool "${tool.name}"`,
            remediation:
              "Coordinators must not be provisioned with file-editing tools. Update coordinator capability manifest to omit file-edit tools.",
            evidence: {
              tool_name: tool.name,
              category: toolCategory,
            },
          });
        }
      }
    }
  }

  for (const cmd of commands) {
    const role =
      roleMap.get(cmd.actor) ??
      (isCoordinatorRole(cmd.actor) ? "coordinator" : "");
    if (!isCoordinatorRole(role)) continue;

    const isEditTool = cmd.tool !== undefined && FILE_EDIT_TOOLS.has(cmd.tool);
    const isEditCat = cmd.tool_category === "file-edit";
    const argvJoined = (cmd.argv ?? []).join(" ");
    const hasEditArg = (cmd.argv ?? []).some((arg) => FILE_EDIT_TOOLS.has(arg));

    if (isEditTool || isEditCat || hasEditArg) {
      const cmdDesc = argvJoined ? argvJoined : (cmd.tool ? cmd.tool : "file-edit");
      findings.push({
        agent_id: cmd.actor,
        role: "coordinator",
        violation_type: "coordinator_code_writing",
        severity: "critical",
        observation: `Coordinator agent "${cmd.actor}" executed file modification in command "${cmd.id}" (argv: ${cmdDesc})`,
        remediation:
          "Coordinators must never execute file-editing commands or tools directly. Assign implementation tasks to Tier 3 Implementers.",
        evidence: {
          command_id: cmd.id,
          argv: [...(cmd.argv ?? [])],
          ...(cmd.tool ? { tool: cmd.tool } : {}),
          ...(cmd.tool_category ? { tool_category: cmd.tool_category } : {}),
        },
      });
    }
  }

  for (const task of tasks) {
    if (!task.lease) continue;
    const leaseRole = task.lease.role;
    const agentRole = roleMap.get(task.lease.agent_id);
    if (
      isCoordinatorRole(leaseRole) ||
      (agentRole && isCoordinatorRole(agentRole))
    ) {
      findings.push({
        agent_id: task.lease.agent_id,
        role: "coordinator",
        violation_type: "coordinator_code_writing",
        severity: "critical",
        observation: `Coordinator agent "${task.lease.agent_id}" holds direct implementation lease for task "${task.id}"`,
        remediation:
          "Coordinators must not claim or lease implementation tasks. Implementation leases are exclusively for Tier 3 Implementers.",
        evidence: {
          task_id: task.id,
          lease_role: leaseRole,
          issued_at: task.lease.issued_at,
        },
      });
    }
  }
}

function auditOrchestratorDirectImplementation(
  roleMap: Map<string, string>,
  grants: readonly AgentGrantRecord[],
  commands: readonly CommandRecord[],
  tasks: readonly TaskRecord[],
  findings: BehavioralFinding[],
): void {
  for (const grant of grants) {
    if (!isOrchestratorRole(grant.role)) continue;

    for (const tool of (grant.tools_used ?? []) as readonly AgentToolUse[]) {
      if (tool.category === "file-edit" || FILE_EDIT_TOOLS.has(tool.name)) {
        findings.push({
          agent_id: grant.id,
          role: grant.role,
          violation_type: "orchestrator_direct_implementation",
          severity: "critical",
          observation: `Orchestrator agent "${grant.id}" used code editing tool "${tool.name}"`,
          remediation:
            "Orchestrators must only orchestrate via CLI commands and must never write code or implement tasks directly.",
          evidence: {
            tool_name: tool.name,
          },
        });
      }
    }
  }

  for (const task of tasks) {
    if (!task.lease) continue;
    const leaseRole = task.lease.role;
    const agentRole = roleMap.get(task.lease.agent_id);
    if (
      isOrchestratorRole(leaseRole) ||
      (agentRole && isOrchestratorRole(agentRole))
    ) {
      findings.push({
        agent_id: task.lease.agent_id,
        role: "orchestrator",
        violation_type: "orchestrator_direct_implementation",
        severity: "critical",
        observation: `Orchestrator agent "${task.lease.agent_id}" holds task lease for task "${task.id}"`,
        remediation:
          "Orchestrators must never claim or implement tasks directly. All task execution must be delegated to Tier 2 Coordinators and Tier 3 Implementers.",
        evidence: {
          task_id: task.id,
          lease_role: leaseRole,
        },
      });
    }
  }

  for (const cmd of commands) {
    const role =
      roleMap.get(cmd.actor) ??
      (isOrchestratorRole(cmd.actor) ? "orchestrator" : "");
    if (!isOrchestratorRole(role)) continue;

    if (cmd.task_id) {
      findings.push({
        agent_id: cmd.actor,
        role: "orchestrator",
        violation_type: "orchestrator_direct_implementation",
        severity: "critical",
        observation: `Orchestrator agent "${cmd.actor}" directly executed command "${cmd.id}" bound to task "${cmd.task_id}"`,
        remediation:
          "Orchestrators must not execute task commands directly. Delegate task work to Tier 2 Coordinators.",
        evidence: {
          command_id: cmd.id,
          task_id: cmd.task_id,
          argv: [...(cmd.argv ?? [])],
        },
      });
    }

    const argv = cmd.argv ?? [];
    const planningSubcmd = argv.find((arg) => GRAPH_MUTATION_COMMANDS.has(arg));
    if (planningSubcmd) {
      findings.push({
        agent_id: cmd.actor,
        role: "orchestrator",
        violation_type: "orchestrator_direct_implementation",
        severity: "critical",
        observation: `Orchestrator agent "${cmd.actor}" attempted direct task graph planning/mutation via "${planningSubcmd}" in command "${cmd.id}"`,
        remediation:
          "Plan compilation and graph revisions belong to Tier 2 Coordinators. Orchestrators must manage rounds via mind:* commands.",
        evidence: {
          command_id: cmd.id,
          argv: [...(cmd.argv ?? [])],
          subcommand: planningSubcmd,
        },
      });
    }

    if (
      cmd.tool_category === "file-edit" ||
      (cmd.tool && FILE_EDIT_TOOLS.has(cmd.tool))
    ) {
      findings.push({
        agent_id: cmd.actor,
        role: "orchestrator",
        violation_type: "orchestrator_direct_implementation",
        severity: "critical",
        observation: `Orchestrator agent "${cmd.actor}" executed code editing tool in command "${cmd.id}"`,
        remediation: "Orchestrators must not edit files directly.",
        evidence: {
          command_id: cmd.id,
          ...(cmd.tool ? { tool: cmd.tool } : {}),
          ...(cmd.tool_category ? { tool_category: cmd.tool_category } : {}),
        },
      });
    }
  }
}

function auditImplementerSelfGradingAndTopology(
  roleMap: Map<string, string>,
  tasks: readonly TaskRecord[],
  commands: readonly CommandRecord[],
  events: readonly JsonObject[],
  findings: BehavioralFinding[],
): void {
  for (const task of tasks) {
    const implementerIds = new Set<string>();
    if (task.original_implementer) implementerIds.add(task.original_implementer);
    if (task.lease && isImplementerRole(task.lease.role)) {
      implementerIds.add(task.lease.agent_id);
    }
    for (const attempt of task.attempts ?? []) {
      if (
        isJsonObject(attempt) &&
        typeof attempt.agent_id === "string" &&
        (attempt.role === "implementer" ||
          attempt.kind === "implementation" ||
          attempt.kind === "repair")
      ) {
        implementerIds.add(attempt.agent_id);
      }
    }
    for (const hist of task.history ?? []) {
      if (
        hist.from === "ready" ||
        hist.from === "retry_ready" ||
        hist.to === "submitted" ||
        hist.to === "leased"
      ) {
        if (hist.actor) implementerIds.add(hist.actor);
      }
    }

    const allValidations: readonly ValidationAttempt[] = [
      ...(task.validations ?? []),
      ...(task.validation_history ?? []),
    ];
    for (const val of allValidations) {
      if (val.validator_id && implementerIds.has(val.validator_id)) {
        findings.push({
          agent_id: val.validator_id,
          role: "implementer",
          violation_type: "implementer_self_grading",
          severity: "critical",
          observation: `Implementer agent "${val.validator_id}" performed validation review for task "${task.id}" which it previously implemented`,
          remediation:
            "Implementers must never validate or sign off on their own work. Validation requires independent Tier 3 Validators.",
          evidence: {
            task_id: task.id,
            validator_id: val.validator_id,
            ...(val.verdict ? { verdict: val.verdict } : {}),
            ...(val.domain ? { domain: val.domain } : {}),
          },
        });
      }
    }
  }

  for (const cmd of commands) {
    const role =
      roleMap.get(cmd.actor) ??
      (isImplementerRole(cmd.actor) ? "implementer" : "");
    if (!isImplementerRole(role)) continue;

    const argv = cmd.argv ?? [];

    const valCmd = argv.find((arg) => VALIDATION_COMMANDS.has(arg));
    if (valCmd) {
      findings.push({
        agent_id: cmd.actor,
        role: "implementer",
        violation_type: "implementer_self_grading",
        severity: "critical",
        observation: `Implementer agent "${cmd.actor}" executed validation/grading command "${valCmd}" in command "${cmd.id}"`,
        remediation:
          "Validation commands (task:validate-start, task:review, task:probe, task:reject, gate:prove) are strictly restricted to independent Tier 3 Validators.",
        evidence: {
          command_id: cmd.id,
          argv: [...cmd.argv],
          validation_subcommand: valCmd,
        },
      });
    }

    const graphCmd = argv.find((arg) => GRAPH_MUTATION_COMMANDS.has(arg));
    if (graphCmd) {
      findings.push({
        agent_id: cmd.actor,
        role: "implementer",
        violation_type: "implementer_graph_mutation",
        severity: "critical",
        observation: `Implementer agent "${cmd.actor}" attempted to mutate graph topology via command "${graphCmd}" in command "${cmd.id}"`,
        remediation:
          "Implementers cannot alter task graph topology or compile plans. Graph mutations belong exclusively to Tier 2 Coordinators.",
        evidence: {
          command_id: cmd.id,
          argv: [...cmd.argv],
          graph_subcommand: graphCmd,
        },
      });
    }
  }

  for (const ev of events) {
    if (!isJsonObject(ev)) continue;
    const actor = typeof ev.actor === "string" ? ev.actor : "";
    const kind = typeof ev.kind === "string" ? ev.kind : "";
    const role =
      roleMap.get(actor) ?? (isImplementerRole(actor) ? "implementer" : "");
    if (!isImplementerRole(role)) continue;

    if (
      kind === "plan-compiled" ||
      kind === "plan-applied" ||
      kind === "plan-enhanced" ||
      kind === "plan-replan-requested" ||
      kind === "mind-candidate-recorded"
    ) {
      findings.push({
        agent_id: actor,
        role: "implementer",
        violation_type: "implementer_graph_mutation",
        severity: "critical",
        observation: `Implementer actor "${actor}" emitted graph topology mutation event "${kind}"`,
        remediation:
          "Implementers cannot alter task graph topology. Re-assign planning tasks to Tier 2 Coordinators.",
        evidence: {
          event_kind: kind,
          sequence: typeof ev.sequence === "number" ? ev.sequence : 0,
        },
      });
    }
  }
}

function auditSubagentPulseTermination(
  roleMap: Map<string, string>,
  state: JsonObject,
  commands: readonly CommandRecord[],
  findings: BehavioralFinding[],
): void {
  const pulse = state.pulse;
  if (isJsonObject(pulse)) {
    const last = pulse.last;
    if (isJsonObject(last)) {
      const outcome = typeof last.outcome === "string" ? last.outcome : "";
      const terminalReason =
        typeof last.terminal_reason === "string" ? last.terminal_reason : null;
      const pulseActor = typeof last.actor === "string" ? last.actor : "";

      if (TERMINAL_PULSE_OUTCOMES.has(outcome) || terminalReason !== null) {
        const actorRole =
          roleMap.get(pulseActor) ??
          (isSubagentRole(pulseActor) ? pulseActor : inferRole(pulseActor, roleMap, state));
        if (actorRole && actorRole !== "human" && actorRole !== "user") {
          findings.push({
            agent_id: pulseActor || "unknown-subagent",
            role: actorRole,
            violation_type: "subagent_pulse_termination",
            severity: "critical",
            observation: `Subagent "${pulseActor || "unknown"}" terminated mind pulse loop with outcome "${outcome}" (terminal reason: ${terminalReason ?? "none"})`,
            remediation:
              "Subagents are strictly prohibited from terminating pulse loops or supervisory schedulers. Mind execution must run continuously without agent-driven termination.",
            evidence: {
              ...(typeof last.pulse_id === "string"
                ? { pulse_id: last.pulse_id }
                : {}),
              outcome,
              ...(terminalReason !== null ? { terminal_reason: terminalReason } : {}),
            },
          });
        }
      }
    }
  }

  for (const cmd of commands) {
    const actorRole =
      roleMap.get(cmd.actor) ??
      (isSubagentRole(cmd.actor)
        ? cmd.actor
        : inferRole(cmd.actor, roleMap, state));
    const argv = cmd.argv ?? [];
    const argvJoined = argv.join(" ").toLowerCase();

    if (argvJoined.includes("mind:pulse-close")) {
      const hasTerminalOutcome =
        argvJoined.includes("--outcome halted") ||
        argvJoined.includes("--outcome unarmed") ||
        argvJoined.includes("--outcome stopped") ||
        argvJoined.includes("--outcome completed");
      const hasTerminalReason =
        argvJoined.includes("--terminal-reason") ||
        argvJoined.includes("--reason");

      if (hasTerminalOutcome || hasTerminalReason) {
        const reportedRole = actorRole ? actorRole : "subagent";
        findings.push({
          agent_id: cmd.actor,
          role: reportedRole,
          violation_type: "subagent_pulse_termination",
          severity: "critical",
          observation: `Subagent "${cmd.actor}" executed mind:pulse-close with terminal arguments: "${argv.join(" ")}"`,
          remediation:
            "Subagents must not terminate mind pulses. Schedulers and mind pulses must run infinitely unless manually halted by the human user.",
          evidence: {
            command_id: cmd.id,
            argv: [...argv],
          },
        });
      }
    }

    const isKillOrStopCommand =
      /^(kill|pkill|killall)\b/.test(argv[0] ?? "") ||
      argvJoined.includes("systemctl stop") ||
      argvJoined.includes("systemctl disable") ||
      argvJoined.includes("launchctl unload");

    const targetsScheduler =
      argvJoined.includes("pulse.sh") ||
      argvJoined.includes("mind.timer") ||
      argvJoined.includes("mind.service") ||
      argvJoined.includes("scheduler") ||
      argvJoined.includes("mind");

    if (isKillOrStopCommand && targetsScheduler) {
      const reportedRole = actorRole ? actorRole : "subagent";
      findings.push({
        agent_id: cmd.actor,
        role: reportedRole,
        violation_type: "subagent_pulse_termination",
        severity: "critical",
        observation: `Subagent "${cmd.actor}" executed command attempting to terminate scheduler/daemon process: "${argv.join(" ")}"`,
        remediation:
          "Supervisory schedulers and pulses are protected invariants. Subagents must never kill or stop supervisory background processes.",
        evidence: {
          command_id: cmd.id,
          argv: [...argv],
        },
      });
    }
  }
}

function deduplicateFindings(
  findings: readonly BehavioralFinding[],
): BehavioralFinding[] {
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
  let resolvedState: JsonObject | null = isJsonObject(state)
    ? (state as JsonObject)
    : null;
  let loadedEvents: JsonObject[] = [];

  if (capsuleRoot && existsSync(capsuleRoot)) {
    try {
      const loaded = loadRun(capsuleRoot, false);
      if (!resolvedState) {
        // Bridge safely from RunState to JsonObject
        resolvedState = loaded.state as unknown as JsonObject;
      }
      // Bridge loaded events safely to JsonObject array
      loadedEvents = (loaded.events ?? []) as unknown as JsonObject[];
    } catch {
      // In tests or offline probes where directory is not a full run, fall back to resolvedState
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
    // Graceful fallback on missing/malformed agent ledger
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

  const findings: BehavioralFinding[] = [];

  auditCoordinatorCodeWriting(roleMap, grants, commands, tasks, findings);
  auditOrchestratorDirectImplementation(
    roleMap,
    grants,
    commands,
    tasks,
    findings,
  );
  auditImplementerSelfGradingAndTopology(
    roleMap,
    tasks,
    commands,
    loadedEvents,
    findings,
  );
  auditSubagentPulseTermination(roleMap, resolvedState, commands, findings);

  return deduplicateFindings(findings);
}

export function summarizeBehavioralHealth(
  findings: readonly BehavioralFinding[],
): BehavioralHealthSummary {
  const issues = findings.map(
    (f) =>
      `behavioral [${f.severity}] (${f.role}/${f.agent_id}): ${f.observation}`,
  );
  return {
    healthy: findings.length === 0,
    violation_count: findings.length,
    findings: [...findings],
    issues,
  };
}

export function formatBehavioralRoleHealthSection(
  findings: readonly BehavioralFinding[],
): string {
  const lines: string[] = ["### Behavioral Role Health"];
  if (findings.length === 0) {
    lines.push("- **Status**: clean (0 violations)");
    lines.push(
      "- **Role Segregation**: verified (all agents conform to role contracts)",
    );
  } else {
    lines.push(`- **Status**: violations detected (${findings.length})`);
    lines.push("- **Findings**:");
    for (const f of findings) {
      lines.push(
        `  - \`[${f.severity}]\` **${f.role}** (\`${f.agent_id}\`): ${f.observation}`,
      );
      lines.push(`    - *Remediation*: ${f.remediation}`);
    }
  }
  return lines.join("\n");
}
