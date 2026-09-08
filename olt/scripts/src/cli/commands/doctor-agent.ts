import { HarnessError } from "../../core/errors/index.ts";
import {
  CANONICAL_ROLES,
  formatDoctorAgentMarkdown,
  isCanonicalRole,
  runDoctorAgent,
  type AgentRole,
} from "../../sentinel/index.ts";
import { textFlag, listFlag, type Flags } from "../index.ts";

export async function doctorAgentCommand(flags: Flags): Promise<Record<string, unknown>> {
  const roleRaw = textFlag(flags, "role", true);
  if (!roleRaw || !isCanonicalRole(roleRaw)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid or unknown canonical role: '${roleRaw}'. Valid roles: ${CANONICAL_ROLES.join(", ")}`,
      [],
      2,
      `Specify a valid role using --role <role>`,
    );
  }
  const role: AgentRole = roleRaw;

  const agentId =
    textFlag(flags, "agent", false) ??
    textFlag(flags, "agent-id", false) ??
    textFlag(flags, "actor", false);
  if (!agentId) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--agent is required for doctor:agent",
      [],
      2,
      "Pass --agent <agent-id>",
    );
  }

  const taskId = textFlag(flags, "task", false) ?? textFlag(flags, "task-id", false);
  const runRoot =
    textFlag(flags, "run", false) ??
    textFlag(flags, "run-id", false) ??
    textFlag(flags, "capsule", false);
  const repoRoot = textFlag(flags, "repo-root", false);
  const format = textFlag(flags, "format", false);
  const filesList = listFlag(flags, "files", false);
  const commandsList = listFlag(flags, "commands", false);

  const report = runDoctorAgent({
    role,
    agentId,
    taskId,
    runRoot,
    repoRoot,
    modifiedFiles: filesList,
    executedCommands: commandsList,
  });

  const markdown = formatDoctorAgentMarkdown(report);

  return {
    status: report.status,
    agent_id: report.agent_id,
    role: report.role,
    ...(report.task_id ? { task_id: report.task_id } : {}),
    strike_count: report.strike_count,
    violations: report.violations,
    markdown,
    ...(format === "json" ? { json: true } : {}),
  };
}
