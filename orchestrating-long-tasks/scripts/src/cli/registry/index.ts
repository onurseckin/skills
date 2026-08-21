import { AGENT_COMMANDS } from "./agent.ts";
import { AUTHORITY_COMMANDS } from "./authority.ts";
import { BRANCH_COMMANDS } from "./branch.ts";
import { CAPTURE_COMMANDS } from "./capture.ts";
import { COORDINATOR_COMMANDS } from "./coordinator.ts";
import { CRITIC_COMMANDS } from "./critic.ts";
import { DIAGNOSTICS_COMMANDS } from "./diagnostics.ts";
import { EXPLAIN_COMMANDS } from "./explain.ts";
import { GATE_COMMANDS } from "./gate.ts";
import { INSPECTION_COMMANDS } from "./inspection.ts";
import { INSTALL_COMMANDS } from "./install.ts";
import { MIND_COMMANDS } from "./mind.ts";
import { ORCHESTRATOR_COMMANDS } from "./orchestrator.ts";
import { ORPHAN_COMMANDS } from "./orphan.ts";
import { PLAN_COMMANDS } from "./plan.ts";
import { QUEUE_COMMANDS } from "./queue.ts";
import { RUN_COMMANDS } from "./run.ts";
import { SUMMARY_COMMANDS } from "./summary.ts";
import { TASK_COMMANDS } from "./task.ts";
import type { CommandDomain, CommandSpec } from "./types.ts";

export * from "./types.ts";

export const COMMAND_REGISTRY: readonly CommandSpec[] = [
  ...PLAN_COMMANDS,
  ...QUEUE_COMMANDS,
  ...TASK_COMMANDS,
  ...RUN_COMMANDS,
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
];

export const COMMAND_DOMAINS: readonly CommandDomain[] = [
  "plan",
  "queue",
  "task",
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
