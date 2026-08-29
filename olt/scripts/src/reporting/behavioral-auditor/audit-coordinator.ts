/**
 * Behavioral Audit: Coordinator Code Writing & Tool Confinement
 */
import type {
  AgentGrantRecord,
  AgentToolRef,
  AgentToolUse,
  CommandRecord,
} from "../../core/contracts/index.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import { isCoordinatorRole, isFullTestSuiteCommand } from "./predicates.ts";
import { FILE_EDIT_TOOLS, type BehavioralFinding } from "./types.ts";

export function auditCoordinatorCodeWriting(
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
    const role = roleMap.get(cmd.actor) ?? (isCoordinatorRole(cmd.actor) ? "coordinator" : "");
    if (!isCoordinatorRole(role)) continue;

    const isEditTool = cmd.tool !== undefined && FILE_EDIT_TOOLS.has(cmd.tool);
    const isEditCat = cmd.tool_category === "file-edit";
    const argvJoined = (cmd.argv ?? []).join(" ");
    const hasEditArg = (cmd.argv ?? []).some((arg) => FILE_EDIT_TOOLS.has(arg));

    if (isEditTool || isEditCat || hasEditArg) {
      const cmdDesc = argvJoined ? argvJoined : cmd.tool ? cmd.tool : "file-edit";
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

    if (isFullTestSuiteCommand(cmd.argv ?? [])) {
      findings.push({
        agent_id: cmd.actor,
        role: "coordinator",
        violation_type: "role_confinement_violation",
        severity: "critical",
        observation: `Coordinator agent "${cmd.actor}" executed prohibited full test suite command "${(cmd.argv ?? []).join(" ")}" in command "${cmd.id}"`,
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
