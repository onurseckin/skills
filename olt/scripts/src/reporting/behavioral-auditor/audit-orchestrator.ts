/**
 * Behavioral Audit: Orchestrator Direct Implementation
 */
import type { AgentGrantRecord, AgentToolUse, CommandRecord } from "../../core/contracts/index.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import { isFullTestSuiteCommand, isOrchestratorRole } from "./predicates.ts";
import { FILE_EDIT_TOOLS, GRAPH_MUTATION_COMMANDS, type BehavioralFinding } from "./types.ts";

export function auditOrchestratorDirectImplementation(
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
    if (isOrchestratorRole(leaseRole) || (agentRole && isOrchestratorRole(agentRole))) {
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
    const role = roleMap.get(cmd.actor) ?? (isOrchestratorRole(cmd.actor) ? "orchestrator" : "");
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

    if (cmd.tool_category === "file-edit" || (cmd.tool && FILE_EDIT_TOOLS.has(cmd.tool))) {
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

    if (isFullTestSuiteCommand(argv)) {
      findings.push({
        agent_id: cmd.actor,
        role: "orchestrator",
        violation_type: "role_confinement_violation",
        severity: "critical",
        observation: `Orchestrator agent "${cmd.actor}" executed prohibited full test suite command "${argv.join(" ")}" in command "${cmd.id}"`,
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
