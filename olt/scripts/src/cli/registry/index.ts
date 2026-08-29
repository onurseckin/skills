import { AGENT_COMMANDS } from "./agent.ts";
import { AUTHORITY_COMMANDS } from "./authority.ts";
import { BRANCH_COMMANDS } from "./branch.ts";
import { CAPTURE_COMMANDS } from "./capture.ts";
import { COORDINATOR_COMMANDS } from "./coordinator.ts";
import { CRITIC_COMMANDS } from "./critic.ts";
import { DEFECT_COMMANDS } from "./defect.ts";
import { DIAGNOSTICS_COMMANDS } from "./diagnostics.ts";
import { EXPLAIN_COMMANDS } from "./explain.ts";
import { FACTORY_COMMANDS } from "./factory.ts";
import { GATE_COMMANDS } from "./gate.ts";
import { HYGIENE_COMMANDS } from "./hygiene.ts";
import { INSPECTION_COMMANDS } from "./inspection.ts";
import { INSTALL_COMMANDS } from "./install.ts";
import { MIND_COMMANDS } from "./mind.ts";
import { MSG_COMMANDS } from "./msg.ts";
import { ORCHESTRATOR_COMMANDS } from "./orchestrator.ts";
import { ORPHAN_COMMANDS } from "./orphan.ts";
import { PLAN_COMMANDS } from "./plan.ts";
import { POLICY_COMMANDS } from "./policy.ts";
import { QUEUE_COMMANDS } from "./queue.ts";
import { REPORTING_COMMANDS } from "./reporting.ts";
import { ROLE_COMMANDS } from "./role.ts";
import { RUN_COMMANDS } from "./run.ts";
import { SCHED_COMMANDS } from "./sched.ts";
import { SHELL_COMMANDS } from "./shell.ts";
import { SUMMARY_COMMANDS } from "./summary.ts";
import { TASK_COMMANDS } from "./task.ts";
import { WORKTREE_COMMANDS } from "./worktree.ts";
import {
  DEFAULT_EXIT_CODES,
  PRIMARY_VERBS,
  commandTier,
  flagShapes,
  isInternalCommand,
  isPrimaryCommand,
  optionalFlag,
  repeatableFlag,
  requiredFlag,
  type CommandAuthoritySpec,
  type CommandDomain,
  type CommandHandler,
  type CommandSpec,
  type CommandTier,
  type ExitCodeSpec,
  type FlagSpec,
  type FlagType,
  type PrimaryVerb,
} from "./types.ts";

export {
  DEFAULT_EXIT_CODES,
  PRIMARY_VERBS,
  commandTier,
  flagShapes,
  isInternalCommand,
  isPrimaryCommand,
  optionalFlag,
  repeatableFlag,
  requiredFlag,
  type CommandAuthoritySpec,
  type CommandDomain,
  type CommandHandler,
  type CommandSpec,
  type CommandTier,
  type ExitCodeSpec,
  type FlagSpec,
  type FlagType,
  type PrimaryVerb,
};
export { AGENT_COMMANDS } from "./agent.ts";
export { AUTHORITY_COMMANDS } from "./authority.ts";
export { BRANCH_COMMANDS } from "./branch.ts";
export { CAPTURE_COMMANDS } from "./capture.ts";
export { COORDINATOR_COMMANDS } from "./coordinator.ts";
export { CRITIC_COMMANDS } from "./critic.ts";
export { DEFECT_COMMANDS } from "./defect.ts";
export { DIAGNOSTICS_COMMANDS } from "./diagnostics.ts";
export { EXPLAIN_COMMANDS } from "./explain.ts";
export { FACTORY_COMMANDS } from "./factory.ts";
export { GATE_COMMANDS } from "./gate.ts";
export { HYGIENE_COMMANDS } from "./hygiene.ts";
export { INSPECTION_COMMANDS } from "./inspection.ts";
export { INSTALL_COMMANDS } from "./install.ts";
export { MIND_COMMANDS } from "./mind.ts";
export { MSG_COMMANDS } from "./msg.ts";
export { ORCHESTRATOR_COMMANDS } from "./orchestrator.ts";
export { ORPHAN_COMMANDS } from "./orphan.ts";
export { PLAN_COMMANDS } from "./plan.ts";
export { POLICY_COMMANDS } from "./policy.ts";
export { QUEUE_COMMANDS } from "./queue.ts";
export { REPORTING_COMMANDS } from "./reporting.ts";
export { ROLE_COMMANDS } from "./role.ts";
export { RUN_COMMANDS } from "./run.ts";
export { SCHED_COMMANDS } from "./sched.ts";
export { SHELL_COMMANDS } from "./shell.ts";
export { SUMMARY_COMMANDS } from "./summary.ts";
export { TASK_COMMANDS } from "./task.ts";
export { WORKTREE_COMMANDS } from "./worktree.ts";

export const COMMAND_REGISTRY: readonly CommandSpec[] = [
  ...PLAN_COMMANDS,
  ...QUEUE_COMMANDS,
  ...TASK_COMMANDS,
  ...REPORTING_COMMANDS,
  ...RUN_COMMANDS,
  ...SHELL_COMMANDS,
  ...CRITIC_COMMANDS,
  ...SUMMARY_COMMANDS,
  ...INSPECTION_COMMANDS,
  ...ORCHESTRATOR_COMMANDS,
  ...BRANCH_COMMANDS,
  ...AGENT_COMMANDS,
  ...ORPHAN_COMMANDS,
  ...AUTHORITY_COMMANDS,
  ...INSTALL_COMMANDS,
  ...DIAGNOSTICS_COMMANDS,
  ...EXPLAIN_COMMANDS,
  ...GATE_COMMANDS,
  ...COORDINATOR_COMMANDS,
  ...CAPTURE_COMMANDS,
  ...MIND_COMMANDS,
  ...POLICY_COMMANDS,
  ...FACTORY_COMMANDS,
  ...MSG_COMMANDS,
  ...WORKTREE_COMMANDS,
  ...SCHED_COMMANDS,
  ...ROLE_COMMANDS,
  ...HYGIENE_COMMANDS,
  ...DEFECT_COMMANDS,
];

export const COMMAND_DOMAINS: readonly CommandDomain[] = [
  "plan",
  "queue",
  "task",
  "reporting",
  "run",
  "critic",
  "summary",
  "inspection",
  "orchestrator",
  "branch",
  "agent",
  "orphan",
  "authority",
  "install",
  "diagnostics",
  "gate",
  "capture",
  "mind",
  "policy",
  "msg",
  "worktree",
  "sched",
  "role",
  "hygiene",
  "defect",
];

const BY_INVOCATION: ReadonlyMap<string, CommandSpec> = (() => {
  const index = new Map<string, CommandSpec>();
  for (const spec of COMMAND_REGISTRY) {
    for (const invocation of [spec.name, ...spec.aliases]) {
      if (index.has(invocation)) throw new Error(`duplicate CLI command name: ${invocation}`);
      index.set(invocation, spec);
    }
  }
  return index;
})();

export function findCommand(invocation: string): CommandSpec | undefined {
  return BY_INVOCATION.get(invocation);
}

export function commandInvocations(): readonly string[] {
  return [...BY_INVOCATION.keys()];
}

export const PRIMARY_COMMANDS: readonly CommandSpec[] = COMMAND_REGISTRY.filter(isPrimaryCommand);

export const INTERNAL_COMMANDS: readonly CommandSpec[] = COMMAND_REGISTRY.filter(isInternalCommand);

export function getPrimaryCommands(): readonly CommandSpec[] {
  return PRIMARY_COMMANDS;
}

export function getInternalCommands(): readonly CommandSpec[] {
  return INTERNAL_COMMANDS;
}
