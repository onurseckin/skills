import { existsSync } from "node:fs";
import { HarnessError } from "../errors/harness-error.ts";
import type { AgentGrantRecord, AgentToolRef, AgentToolUse } from "../contracts/agents.ts";
import { isAgentRole } from "../contracts/packets.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import { isJsonObject, type JsonObject } from "../contracts/json.ts";
import type { TaskRecord, ValidationAttempt } from "../workflow/types.ts";
import type { RunState } from "../contracts/capsule.ts";
import { readAgentLedger } from "../workflow/agents/ledger.ts";
import { loadRun } from "../store/index.ts";
import {
  type ExecutionTier,
  roleToTier,
  validateTierSpawning,
} from "../authority/thread-identifier.ts";

export const DOCTOR_SUPERVISOR_CODE_CONTAMINATION = "DOCTOR_SUPERVISOR_CODE_CONTAMINATION";

export type TierViolationType =
  | "cross_tier_spawning_violation"
  | "coordinator_code_writing"
  | "orchestrator_direct_implementation"
  | "implementer_self_grading"
  | "implementer_graph_mutation"
  | "subagent_pulse_termination"
  | "role_confinement_violation"
  | "supervisor_code_contamination";

export type TierViolationSeverity = "critical" | "important" | "minor";

export interface TierConfinementFinding {
  readonly agent_id: string;
  readonly role: string;
  readonly tier: ExecutionTier;
  readonly violation_type: TierViolationType;
  readonly severity: TierViolationSeverity;
  readonly observation: string;
  readonly remediation: string;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface TierConfinementSummary {
  readonly healthy: boolean;
  readonly violation_count: number;
  readonly findings: readonly TierConfinementFinding[];
  readonly issues: readonly string[];
}

export const CODE_EDIT_TOOLS: ReadonlySet<string> = new Set([
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
  return role === "coordinator" || role.startsWith("coordinator-") || role.startsWith("coord-");
}

export function isOrchestratorRole(role: string): boolean {
  return role === "orchestrator" || role.startsWith("orch-") || role.startsWith("orchestrator-");
}

export function isImplementerRole(role: string): boolean {
  return (
    role === "implementer" || role === "repairer" || role === "sub-implementer" || role === "worker"
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

export function isTier3Role(role: string): boolean {
  return (
    isImplementerRole(role) ||
    isValidatorRole(role) ||
    role === "planner" ||
    role === "sub-investigator"
  );
}

export function isFullTestSuiteCommand(argv: readonly string[]): boolean {
  if (!argv || argv.length === 0) return false;
  const joined = argv.join(" ").trim();
  const lowerJoined = joined.toLowerCase();

  if (
    lowerJoined === "bun test" ||
    lowerJoined === "bun run test" ||
    lowerJoined === "bun run test:unit" ||
    lowerJoined === "bun test:unit" ||
    lowerJoined.includes("test --coverage") ||
    lowerJoined.includes("run test:unit") ||
    lowerJoined === "npm test" ||
    lowerJoined === "npm run test" ||
    lowerJoined === "npm run test:unit" ||
    lowerJoined === "yarn test" ||
    lowerJoined === "yarn test:unit" ||
    lowerJoined === "pnpm test" ||
    lowerJoined === "pnpm test:unit" ||
    lowerJoined === "pytest" ||
    lowerJoined === "vitest" ||
    lowerJoined === "cargo test" ||
    lowerJoined === "go test ./..."
  ) {
    return true;
  }

  const isTestRunner =
    (argv[0] === "bun" && argv[1] === "test") ||
    (argv[0] === "bun" &&
      argv[1] === "run" &&
      typeof argv[2] === "string" &&
      argv[2].startsWith("test")) ||
    (argv[0] === "npm" &&
      (argv[1] === "test" ||
        (argv[1] === "run" && typeof argv[2] === "string" && argv[2].startsWith("test")))) ||
    (argv[0] === "yarn" && (argv[1] === "test" || argv[1] === "test:unit")) ||
    (argv[0] === "pnpm" && (argv[1] === "test" || argv[1] === "test:unit")) ||
    argv[0] === "pytest" ||
    argv[0] === "vitest" ||
    argv[0] === "jest";

  if (isTestRunner) {
    const hasSingleTestFile = argv.some(
      (arg) =>
        !arg.startsWith("-") &&
        /(\.(test|spec)\.[cm]?[jt]sx?|([/_]test|^test)[^/]*\.py|_test\.py|_spec\.rb)$/i.test(arg),
    );
    if (!hasSingleTestFile) {
      return true;
    }
  }

  return false;
}

function inferRole(actorId: string, roleMap: Map<string, string>, state: JsonObject): string {
  if (roleMap.has(actorId)) return roleMap.get(actorId)!;
  if (isAgentRole(actorId)) return actorId;

  const packets = state.packets;
  if (isJsonObject(packets)) {
    for (const packet of Object.values(packets)) {
      if (isJsonObject(packet) && packet.agent_id === actorId && typeof packet.role === "string") {
        return packet.role;
      }
    }
  }

  const tasks = state.tasks;
  if (isJsonObject(tasks)) {
    for (const task of Object.values(tasks)) {
      if (!isJsonObject(task)) continue;
      const lease = task.lease;
      if (isJsonObject(lease) && lease.agent_id === actorId && typeof lease.role === "string") {
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
  if (/^mind/i.test(actorId)) return "mind";

  return "unknown";
}

/**
 * Mechanically audits agent lineage for cross-tier spawning violations (e.g. Orchestrator spawning Implementer directly).
 */
export function auditCrossTierSpawning(
  roleMap: Map<string, string>,
  grants: readonly AgentGrantRecord[],
  findings: TierConfinementFinding[],
): void {
  for (const grant of grants) {
    if (!grant.parent_agent_id) continue;

    const childRole = grant.role;
    const childTier = roleToTier(childRole);
    const parentRole =
      roleMap.get(grant.parent_agent_id) ?? inferRole(grant.parent_agent_id, roleMap, {});
    const parentTier = roleToTier(parentRole);

    const validation = validateTierSpawning(parentTier, childTier, parentRole, childRole);
    if (!validation.allowed) {
      findings.push({
        agent_id: grant.id,
        role: grant.role,
        tier: childTier,
        violation_type: "cross_tier_spawning_violation",
        severity: "critical",
        observation: `Illegal cross-tier spawning detected: Parent agent "${grant.parent_agent_id}" (Tier ${parentTier} ${parentRole}) directly spawned child agent "${grant.id}" (Tier ${childTier} ${childRole}). Violation: ${validation.reason ?? "Violates 4-tier hierarchy"}`,
        remediation:
          "Enforce strict 4-tier boundary confinement: Tier 0 Mind deploys Tier 1 Orchestrator; Tier 1 Orchestrator deploys Tier 2 Coordinators; Tier 2 Coordinator deploys Tier 3 Implementers and Validators.",
        evidence: {
          parent_agent_id: grant.parent_agent_id,
          parent_role: parentRole,
          parent_tier: parentTier,
          child_agent_id: grant.id,
          child_role: childRole,
          child_tier: childTier,
        },
      });
    }
  }
}

/**
 * Mechanically audits Coordinator code editing attempts and implementation lease holding.
 */
export function auditCoordinatorConfinement(
  roleMap: Map<string, string>,
  grants: readonly AgentGrantRecord[],
  commands: readonly CommandRecord[],
  tasks: readonly TaskRecord[],
  findings: TierConfinementFinding[],
): void {
  for (const grant of grants) {
    if (!isCoordinatorRole(grant.role)) continue;

    for (const tool of (grant.tools_used ?? []) as readonly AgentToolUse[]) {
      if (tool.category === "file-edit" || CODE_EDIT_TOOLS.has(tool.name)) {
        findings.push({
          agent_id: grant.id,
          role: grant.role,
          tier: 2,
          violation_type: "coordinator_code_writing",
          severity: "critical",
          observation: `Tier 2 Coordinator agent "${grant.id}" recorded usage of code-editing tool "${tool.name}" (category: ${tool.category ?? "file-edit"})`,
          remediation:
            "Coordinators must never write code or edit files directly. Delegate all implementation tasks to Tier 3 Implementers via host native subagents.",
          evidence: {
            tool_name: tool.name,
            category: tool.category,
            first_reported_at: tool.first_reported_at,
          },
        });
      }
    }

    if (grant.tools_granted?.value) {
      for (const tool of grant.tools_granted.value as readonly AgentToolRef[]) {
        if (tool.category === "file-edit" || CODE_EDIT_TOOLS.has(tool.name)) {
          findings.push({
            agent_id: grant.id,
            role: grant.role,
            tier: 2,
            violation_type: "coordinator_code_writing",
            severity: "critical",
            observation: `Tier 2 Coordinator agent "${grant.id}" holds unauthorized grant for code-editing tool "${tool.name}"`,
            remediation:
              "Coordinators must not be provisioned with file-editing tools. Update coordinator capability manifest to omit file-edit tools.",
            evidence: {
              tool_name: tool.name,
              category: tool.category,
            },
          });
        }
      }
    }
  }

  for (const cmd of commands) {
    const role = roleMap.get(cmd.actor) ?? (isCoordinatorRole(cmd.actor) ? "coordinator" : "");
    if (!isCoordinatorRole(role)) continue;

    const isEditTool = cmd.tool !== undefined && CODE_EDIT_TOOLS.has(cmd.tool);
    const isEditCat = cmd.tool_category === "file-edit";
    const hasEditArg = (cmd.argv ?? []).some((arg) => CODE_EDIT_TOOLS.has(arg));

    if (isEditTool || isEditCat || hasEditArg) {
      findings.push({
        agent_id: cmd.actor,
        role: "coordinator",
        tier: 2,
        violation_type: "coordinator_code_writing",
        severity: "critical",
        observation: `Tier 2 Coordinator agent "${cmd.actor}" executed file modification in command "${cmd.id}"`,
        remediation:
          "Coordinators must never execute file-editing commands or tools directly. Assign implementation tasks to Tier 3 Implementers.",
        evidence: {
          command_id: cmd.id,
          argv: [...(cmd.argv ?? [])],
          ...(cmd.tool ? { tool: cmd.tool } : {}),
        },
      });
    }

    if (isFullTestSuiteCommand(cmd.argv ?? [])) {
      findings.push({
        agent_id: cmd.actor,
        role: "coordinator",
        tier: 2,
        violation_type: "role_confinement_violation",
        severity: "critical",
        observation: `Tier 2 Coordinator agent "${cmd.actor}" executed prohibited full test suite command "${(cmd.argv ?? []).join(" ")}" in command "${cmd.id}"`,
        remediation:
          "Coordinators are strictly banned from running full test suites (`bun test`, `bun run test:unit`, `bun test --coverage`). Coordinators coordinate task evidence without running tests; full tests belong exclusively to Completeness Critics.",
        evidence: {
          command_id: cmd.id,
          argv: [...(cmd.argv ?? [])],
        },
      });
    }
  }

  for (const task of tasks) {
    if (!task.lease) continue;
    const leaseRole = task.lease.role;
    const agentRole = roleMap.get(task.lease.agent_id);
    if (isCoordinatorRole(leaseRole) || (agentRole && isCoordinatorRole(agentRole))) {
      findings.push({
        agent_id: task.lease.agent_id,
        role: "coordinator",
        tier: 2,
        violation_type: "coordinator_code_writing",
        severity: "critical",
        observation: `Tier 2 Coordinator agent "${task.lease.agent_id}" holds direct implementation lease for task "${task.id}"`,
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

/**
 * Mechanically audits Orchestrator direct implementation, code editing, and task graph mutation.
 */
export function auditOrchestratorConfinement(
  roleMap: Map<string, string>,
  grants: readonly AgentGrantRecord[],
  commands: readonly CommandRecord[],
  tasks: readonly TaskRecord[],
  findings: TierConfinementFinding[],
): void {
  for (const grant of grants) {
    if (!isOrchestratorRole(grant.role)) continue;

    for (const tool of (grant.tools_used ?? []) as readonly AgentToolUse[]) {
      if (tool.category === "file-edit" || CODE_EDIT_TOOLS.has(tool.name)) {
        findings.push({
          agent_id: grant.id,
          role: grant.role,
          tier: 1,
          violation_type: "orchestrator_direct_implementation",
          severity: "critical",
          observation: `Tier 1 Orchestrator agent "${grant.id}" used code editing tool "${tool.name}"`,
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
    if (isOrchestratorRole(leaseRole) || (agentRole && isOrchestratorRole(agentRole))) {
      findings.push({
        agent_id: task.lease.agent_id,
        role: "orchestrator",
        tier: 1,
        violation_type: "orchestrator_direct_implementation",
        severity: "critical",
        observation: `Tier 1 Orchestrator agent "${task.lease.agent_id}" holds task lease for task "${task.id}"`,
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
    const role = roleMap.get(cmd.actor) ?? (isOrchestratorRole(cmd.actor) ? "orchestrator" : "");
    if (!isOrchestratorRole(role)) continue;

    if (cmd.task_id) {
      findings.push({
        agent_id: cmd.actor,
        role: "orchestrator",
        tier: 1,
        violation_type: "orchestrator_direct_implementation",
        severity: "critical",
        observation: `Tier 1 Orchestrator agent "${cmd.actor}" directly executed command "${cmd.id}" bound to task "${cmd.task_id}"`,
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
        tier: 1,
        violation_type: "orchestrator_direct_implementation",
        severity: "critical",
        observation: `Tier 1 Orchestrator agent "${cmd.actor}" attempted direct task graph planning/mutation via "${planningSubcmd}" in command "${cmd.id}"`,
        remediation:
          "Plan compilation and graph revisions belong to Tier 2 Coordinators. Orchestrators must manage rounds via mind:* commands.",
        evidence: {
          command_id: cmd.id,
          argv: [...(cmd.argv ?? [])],
          subcommand: planningSubcmd,
        },
      });
    }

    if (cmd.tool_category === "file-edit" || (cmd.tool && CODE_EDIT_TOOLS.has(cmd.tool))) {
      findings.push({
        agent_id: cmd.actor,
        role: "orchestrator",
        tier: 1,
        violation_type: "orchestrator_direct_implementation",
        severity: "critical",
        observation: `Tier 1 Orchestrator agent "${cmd.actor}" executed code editing tool in command "${cmd.id}"`,
        remediation: "Orchestrators must not edit files directly.",
        evidence: {
          command_id: cmd.id,
          ...(cmd.tool ? { tool: cmd.tool } : {}),
        },
      });
    }

    if (isFullTestSuiteCommand(argv)) {
      findings.push({
        agent_id: cmd.actor,
        role: "orchestrator",
        tier: 1,
        violation_type: "role_confinement_violation",
        severity: "critical",
        observation: `Tier 1 Orchestrator agent "${cmd.actor}" executed prohibited full test suite command "${argv.join(" ")}" in command "${cmd.id}"`,
        remediation:
          "Orchestrators are strictly banned from running full test suites (`bun test`, `bun run test:unit`, `bun test --coverage`). Only Completeness Critics may run full tests; workers run only scoped single-file tests.",
        evidence: {
          command_id: cmd.id,
          argv: [...argv],
        },
      });
    }
  }
}

/**
 * Mechanically audits Implementer self-grading, validation command execution, and graph topology mutations.
 */
export function auditImplementerConfinement(
  roleMap: Map<string, string>,
  tasks: readonly TaskRecord[],
  commands: readonly CommandRecord[],
  events: readonly JsonObject[],
  findings: TierConfinementFinding[],
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
          tier: 3,
          violation_type: "implementer_self_grading",
          severity: "critical",
          observation: `Tier 3 Implementer agent "${val.validator_id}" performed validation review for task "${task.id}" which it previously implemented`,
          remediation:
            "Implementers must never validate or sign off on their own work. Validation requires independent Tier 3 Validators.",
          evidence: {
            task_id: task.id,
            validator_id: val.validator_id,
            ...(val.verdict ? { verdict: val.verdict } : {}),
          },
        });
      }
    }
  }

  for (const cmd of commands) {
    const role = roleMap.get(cmd.actor) ?? (isImplementerRole(cmd.actor) ? "implementer" : "");
    if (!isImplementerRole(role)) continue;

    const argv = cmd.argv ?? [];

    const valCmd = argv.find((arg) => VALIDATION_COMMANDS.has(arg));
    if (valCmd) {
      findings.push({
        agent_id: cmd.actor,
        role: "implementer",
        tier: 3,
        violation_type: "implementer_self_grading",
        severity: "critical",
        observation: `Tier 3 Implementer agent "${cmd.actor}" executed validation/grading command "${valCmd}" in command "${cmd.id}"`,
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
        tier: 3,
        violation_type: "implementer_graph_mutation",
        severity: "critical",
        observation: `Tier 3 Implementer agent "${cmd.actor}" attempted to mutate graph topology via command "${graphCmd}" in command "${cmd.id}"`,
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
    const role = roleMap.get(actor) ?? (isImplementerRole(actor) ? "implementer" : "");
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
        tier: 3,
        violation_type: "implementer_graph_mutation",
        severity: "critical",
        observation: `Tier 3 Implementer actor "${actor}" emitted graph topology mutation event "${kind}"`,
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

/**
 * Mechanically audits subagent pulse termination violations.
 */
export function auditPulseTerminationConfinement(
  roleMap: Map<string, string>,
  state: JsonObject,
  commands: readonly CommandRecord[],
  findings: TierConfinementFinding[],
): void {
  const pulse = state.pulse;
  if (isJsonObject(pulse)) {
    const last = pulse.last;
    if (isJsonObject(last)) {
      const outcome = typeof last.outcome === "string" ? last.outcome : "";
      const terminalReason = typeof last.terminal_reason === "string" ? last.terminal_reason : null;
      const pulseActor = typeof last.actor === "string" ? last.actor : "";

      if (TERMINAL_PULSE_OUTCOMES.has(outcome) || terminalReason !== null) {
        const actorRole = roleMap.get(pulseActor) ?? inferRole(pulseActor, roleMap, state);
        if (actorRole && actorRole !== "human" && actorRole !== "user") {
          findings.push({
            agent_id: pulseActor || "unknown-subagent",
            role: actorRole,
            tier: roleToTier(actorRole),
            violation_type: "subagent_pulse_termination",
            severity: "critical",
            observation: `Subagent "${pulseActor || "unknown"}" terminated mind pulse loop with outcome "${outcome}" (terminal reason: ${terminalReason ?? "none"})`,
            remediation:
              "Subagents are strictly prohibited from terminating pulse loops or supervisory schedulers. Mind execution must run continuously without agent-driven termination.",
            evidence: {
              outcome,
              ...(terminalReason !== null ? { terminal_reason: terminalReason } : {}),
            },
          });
        }
      }
    }
  }

  for (const cmd of commands) {
    const actorRole = roleMap.get(cmd.actor) ?? inferRole(cmd.actor, roleMap, state);
    const argv = cmd.argv ?? [];
    const argvJoined = argv.join(" ").toLowerCase();

    if (argvJoined.includes("mind:pulse-close")) {
      const hasTerminalOutcome =
        argvJoined.includes("--outcome halted") ||
        argvJoined.includes("--outcome unarmed") ||
        argvJoined.includes("--outcome stopped") ||
        argvJoined.includes("--outcome completed");
      const hasTerminalReason =
        argvJoined.includes("--terminal-reason") || argvJoined.includes("--reason");

      if (hasTerminalOutcome || hasTerminalReason) {
        const reportedRole = actorRole ? actorRole : "subagent";
        findings.push({
          agent_id: cmd.actor,
          role: reportedRole,
          tier: roleToTier(reportedRole),
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
        tier: roleToTier(reportedRole),
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
  findings: readonly TierConfinementFinding[],
): TierConfinementFinding[] {
  const seen = new Set<string>();
  const deduplicated: TierConfinementFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.agent_id}::${finding.violation_type}::${finding.observation}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(finding);
    }
  }
  return deduplicated;
}

export interface GitDiffRecord {
  readonly path: string;
  readonly status?: string | undefined;
  readonly actor?: string | undefined;
  readonly role?: string | undefined;
}

export function isSourceCodeFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase().trim();
  if (
    normalized.startsWith(".capsules/") ||
    normalized.includes("/.capsules/")
  ) {
    return false;
  }
  if (
    normalized.endsWith(".md") ||
    normalized.endsWith(".json") ||
    normalized.endsWith(".yaml") ||
    normalized.endsWith(".yml") ||
    normalized.endsWith(".txt")
  ) {
    if (
      normalized.includes("/src/") ||
      normalized.includes("scripts/src/") ||
      normalized.endsWith(".ts") ||
      normalized.endsWith(".js")
    ) {
      return true;
    }
    return false;
  }
  return (
    /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|rb|c|cpp|h|hpp|cs|java|kt|swift|scala|sh|bash|zsh)$/i.test(
      normalized,
    ) ||
    normalized.includes("/src/") ||
    normalized.includes("scripts/src/")
  );
}

/**
 * Mechanical audit for DOCTOR_SUPERVISOR_CODE_CONTAMINATION.
 * Ensures zero direct source code file mutations, no file editing tool usage,
 * no direct code modification commands, and no git diff modifications by Orchestrators (Tier 1) and Coordinators (Tier 2).
 */
export function auditSupervisorCodeContamination(
  roleMap: Map<string, string>,
  grants: readonly AgentGrantRecord[],
  commands: readonly CommandRecord[],
  tasks: readonly TaskRecord[],
  gitDiffs?: readonly (string | GitDiffRecord)[],
  findings?: TierConfinementFinding[],
): TierConfinementFinding[] {
  const resultFindings: TierConfinementFinding[] = findings ?? [];

  // 1. Audit Grants & Tool Usage for Supervisors
  for (const grant of grants) {
    const role = grant.role;
    if (!isOrchestratorRole(role) && !isCoordinatorRole(role)) continue;
    const tier = roleToTier(role);

    for (const tool of (grant.tools_used ?? []) as readonly AgentToolUse[]) {
      if (tool.category === "file-edit" || CODE_EDIT_TOOLS.has(tool.name)) {
        resultFindings.push({
          agent_id: grant.id,
          role,
          tier,
          violation_type: "supervisor_code_contamination",
          severity: "critical",
          observation: `[${DOCTOR_SUPERVISOR_CODE_CONTAMINATION}] Tier ${tier} supervisor "${grant.id}" (${role}) used code-editing tool "${tool.name}"`,
          remediation:
            "Supervisors must maintain zero source code file mutations and delegate all implementation exclusively to Tier 3 Implementers.",
          evidence: {
            check: DOCTOR_SUPERVISOR_CODE_CONTAMINATION,
            tool_name: tool.name,
            category: tool.category,
          },
        });
      }
    }
  }

  // 2. Audit Command History for Supervisors
  for (const cmd of commands) {
    const role = roleMap.get(cmd.actor) ?? inferRole(cmd.actor, roleMap, {});
    if (!isOrchestratorRole(role) && !isCoordinatorRole(role)) continue;
    const tier = roleToTier(role);

    const isEditTool = cmd.tool !== undefined && CODE_EDIT_TOOLS.has(cmd.tool);
    const isEditCat = cmd.tool_category === "file-edit";
    const hasEditArg = (cmd.argv ?? []).some((arg) => CODE_EDIT_TOOLS.has(arg));

    if (isEditTool || isEditCat || hasEditArg) {
      resultFindings.push({
        agent_id: cmd.actor,
        role,
        tier,
        violation_type: "supervisor_code_contamination",
        severity: "critical",
        observation: `[${DOCTOR_SUPERVISOR_CODE_CONTAMINATION}] Tier ${tier} supervisor "${cmd.actor}" executed file modification tool/command in "${cmd.id}"`,
        remediation:
          "Supervisors must never edit code directly. Delegate all file edits to Tier 3 Implementers.",
        evidence: {
          check: DOCTOR_SUPERVISOR_CODE_CONTAMINATION,
          command_id: cmd.id,
          argv: [...(cmd.argv ?? [])],
          ...(cmd.tool ? { tool: cmd.tool } : {}),
        },
      });
    }

    if (
      cmd.repository_before &&
      cmd.repository_after &&
      cmd.repository_before.content_sha256 !== cmd.repository_after.content_sha256
    ) {
      resultFindings.push({
        agent_id: cmd.actor,
        role,
        tier,
        violation_type: "supervisor_code_contamination",
        severity: "critical",
        observation: `[${DOCTOR_SUPERVISOR_CODE_CONTAMINATION}] Tier ${tier} supervisor "${cmd.actor}" caused direct repository content mutation in command "${cmd.id}" (before: ${cmd.repository_before.content_sha256.slice(0, 8)}, after: ${cmd.repository_after.content_sha256.slice(0, 8)})`,
        remediation:
          "Supervisors must not mutate repository source files during command execution.",
        evidence: {
          check: DOCTOR_SUPERVISOR_CODE_CONTAMINATION,
          command_id: cmd.id,
          repo_before_sha: cmd.repository_before.content_sha256,
          repo_after_sha: cmd.repository_after.content_sha256,
        },
      });
    }
  }

  // 3. Audit Task Leases held by Supervisors
  for (const task of tasks) {
    if (!task.lease) continue;
    const leaseRole = task.lease.role;
    const agentRole =
      roleMap.get(task.lease.agent_id) ?? inferRole(task.lease.agent_id, roleMap, {});
    const isSup =
      isOrchestratorRole(leaseRole) ||
      isCoordinatorRole(leaseRole) ||
      isOrchestratorRole(agentRole) ||
      isCoordinatorRole(agentRole);

    if (isSup) {
      const effectiveRole =
        isOrchestratorRole(leaseRole) || isOrchestratorRole(agentRole)
          ? "orchestrator"
          : "coordinator";
      const tier = roleToTier(effectiveRole);

      resultFindings.push({
        agent_id: task.lease.agent_id,
        role: effectiveRole,
        tier,
        violation_type: "supervisor_code_contamination",
        severity: "critical",
        observation: `[${DOCTOR_SUPERVISOR_CODE_CONTAMINATION}] Tier ${tier} supervisor "${task.lease.agent_id}" holds active implementation lease for task "${task.id}"`,
        remediation:
          "Supervisors must not hold implementation task leases. Implementation tasks must be claimed only by Tier 3 Implementers.",
        evidence: {
          check: DOCTOR_SUPERVISOR_CODE_CONTAMINATION,
          task_id: task.id,
          lease_role: leaseRole,
        },
      });
    }
  }

  // 4. Audit Git Diffs attributed to Supervisors
  if (gitDiffs && gitDiffs.length > 0) {
    for (const diff of gitDiffs) {
      const diffPath = typeof diff === "string" ? diff : diff.path;
      const diffActor = typeof diff === "object" && diff.actor ? diff.actor : undefined;
      const diffRole = typeof diff === "object" && diff.role ? diff.role : undefined;

      if (isSourceCodeFile(diffPath)) {
        if (diffActor) {
          const actorRole =
            diffRole ?? roleMap.get(diffActor) ?? inferRole(diffActor, roleMap, {});
          if (isOrchestratorRole(actorRole) || isCoordinatorRole(actorRole)) {
            const tier = roleToTier(actorRole);
            resultFindings.push({
              agent_id: diffActor,
              role: actorRole,
              tier,
              violation_type: "supervisor_code_contamination",
              severity: "critical",
              observation: `[${DOCTOR_SUPERVISOR_CODE_CONTAMINATION}] Tier ${tier} supervisor "${diffActor}" modified source code file "${diffPath}" in git diff`,
              remediation:
                "Zero direct source code file mutations are permitted by supervisors. Revert changes and delegate to Tier 3 Implementers.",
              evidence: {
                check: DOCTOR_SUPERVISOR_CODE_CONTAMINATION,
                file_path: diffPath,
                actor: diffActor,
                role: actorRole,
              },
            });
          }
        }
      }
    }
  }

  return resultFindings;
}

/**
 * Full mechanical audit of 4-tier boundary confinement across capsule state.
 */
export function auditTierConfinement(
  capsuleRoot: string,
  state?: RunState | JsonObject | null,
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
      // In offline tests fall back to resolvedState
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
    // Graceful fallback
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
  auditSupervisorCodeContamination(roleMap, grants, commands, tasks, undefined, findings);

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

/**
 * Hard mechanical assertion ensuring supervisors (Tier 1 Orchestrators & Tier 2 Coordinators)
 * never perform direct code edits or hold task leases.
 * Throws a fatal HarnessError if any supervisor code contamination is detected.
 */
export function assertSupervisorRoleConfinement(
  findings: readonly TierConfinementFinding[],
): void {
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

