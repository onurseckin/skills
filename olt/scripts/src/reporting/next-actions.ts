import { getHarnessConfig } from "../config/harness-config.ts";
import type { AgentGrantRecord } from "../contracts/agents.ts";
import type { JsonObject } from "../contracts/json.ts";
import {
  mergeActions,
  repositoryOf,
  type BranchView,
  type CommandView,
  type GateView,
  type NextActions,
  type TaskView,
} from "./action-types.ts";
import { openBranchActions } from "./branch-actions.ts";
import { completionActions } from "./completion-actions.ts";
import { pushArgv, registryArgv } from "./registry-argv.ts";
import { taskActions } from "./task-actions.ts";

const DISPATCHABLE = new Set(["ready", "proposed", "retry_ready"]);

function orientation(
  entrypoint: string,
  runRoot: string,
  agents: readonly AgentGrantRecord[],
  branches: readonly BranchView[],
): string[][] {
  const argv: string[][] = [];
  pushArgv(argv, registryArgv(entrypoint, "run:status", [["run", runRoot]]));
  pushArgv(argv, registryArgv(entrypoint, "doctor", [["run", runRoot]]));
  if (agents.length > 0) {
    pushArgv(argv, registryArgv(entrypoint, "agent:list", [["run", runRoot]]));
  }
  if (branches.length > 0) {
    pushArgv(argv, registryArgv(entrypoint, "branch:status", [["run", runRoot], ["all"]]));
  }
  return argv;
}

function pausedRequirementIds(view: JsonObject): Set<string> {
  const requirements = Array.isArray(view.requirements)
    ? (view.requirements as Record<string, unknown>[])
    : [];
  return new Set(
    requirements
      .filter(
        ({ disposition, authority_status }) =>
          disposition === "needs_authority" &&
          (authority_status === null || authority_status === undefined),
      )
      .map(({ id }) => String(id)),
  );
}

export function nextActions(
  runRoot: string,
  entrypoint: string,
  view: JsonObject,
  agents: readonly AgentGrantRecord[] = [],
): NextActions {
  const branches = (Array.isArray(view.branches) ? view.branches : []) as unknown as BranchView[];
  const argv = orientation(entrypoint, runRoot, agents, branches);
  const staleEvidence = Array.isArray(view.stale_evidence) ? view.stale_evidence : [];
  if (staleEvidence.length > 0) {
    pushArgv(
      argv,
      registryArgv(entrypoint, "recover", [
        ["run", runRoot],
        ["actor", "coordinator"],
        ["grace-seconds", "0"],
      ]),
    );
    return { argv, unavailable: [] };
  }
  const paused = pausedRequirementIds(view);
  const unavailable = [...paused]
    .sort()
    .map(
      (id) =>
        `requirement ${id} is paused for an authority decision and no registry command records one; every task bound to it stays undispatched`,
    );
  const tasks = view.tasks as unknown as TaskView[];
  const gates = view.gates as unknown as GateView[];
  const records = view.commands as unknown as CommandView[];
  const active = tasks.filter(
    ({ requirement_ids }) => !requirement_ids.some((id) => paused.has(id)),
  );
  if (active.some(({ status }) => DISPATCHABLE.has(status))) {
    pushArgv(argv, registryArgv(entrypoint, "queue:wave", [["run", runRoot]]));
    pushArgv(argv, registryArgv(entrypoint, "queue:next", [["run", runRoot]]));
  }
  const minProbes = getHarnessConfig(repositoryOf(runRoot), runRoot).min_adversarial_probes;
  const perTask = active.map((task) =>
    taskActions(entrypoint, runRoot, task, gates, records, minProbes),
  );
  const branchWork = openBranchActions(entrypoint, runRoot, branches);
  const completion =
    tasks.length > 0 && tasks.every(({ status }) => status === "done")
      ? completionActions(entrypoint, runRoot, view, gates, records)
      : { argv: [], unavailable: [] };
  return mergeActions({ argv, unavailable }, ...perTask, branchWork, completion);
}
