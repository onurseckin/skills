import { execute } from "../../olt/scripts/src/cli/execute.ts";
import { roleToTier } from "../../olt/scripts/src/packets/command-authority.ts";

export interface SupervisorChain {
  readonly mind: string;
  readonly orchestrator: string;
  readonly coordinator: string;
}

export const FIXTURE_MIND_ROOT = "fixture-mind-root";
export const FIXTURE_ORCH_ROOT = "fixture-orch-root";
export const FIXTURE_COORD_ROOT = "fixture-coord-root";

export async function establishSupervisorChain(
  run: string,
  host = "antigravity",
): Promise<SupervisorChain> {
  const mind = FIXTURE_MIND_ROOT;
  const orchestrator = FIXTURE_ORCH_ROOT;
  const coordinator = FIXTURE_COORD_ROOT;
  await execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    mind,
    "--role",
    "mind",
    "--host",
    host,
  ]);
  await execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    orchestrator,
    "--role",
    "orchestrator",
    "--host",
    host,
    "--parent-agent",
    mind,
    "--actor",
    mind,
  ]);
  await execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    coordinator,
    "--role",
    "coordinator",
    "--host",
    host,
    "--parent-agent",
    orchestrator,
    "--actor",
    orchestrator,
  ]);
  return { mind, orchestrator, coordinator };
}

export function parentForRole(chain: SupervisorChain, role: string): string {
  const tier = roleToTier(role);
  if (tier <= 1) return chain.mind;
  if (tier === 2) return chain.orchestrator;
  return chain.coordinator;
}

export async function registerUnderChain(
  run: string,
  chain: SupervisorChain,
  agent: string,
  role: string,
  host = "antigravity",
  parentAgent?: string,
  parentTask?: string,
): Promise<void> {
  const resolvedParent = parentAgent ?? parentForRole(chain, role);
  await execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    agent,
    "--role",
    role,
    "--host",
    host,
    "--parent-agent",
    resolvedParent,
    "--actor",
    resolvedParent,
    ...(parentTask === undefined ? [] : ["--parent-task", parentTask]),
  ]);
}
