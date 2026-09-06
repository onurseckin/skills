import { checkDag, type DagTaskNode } from "../../../engine/dag/index.ts";
import { loadRun } from "../../../engine/store/index.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../../options.ts";
import { resolveCapsuleRun } from "../dag-view.ts";
import { formatDagCheckBrief } from "./formatters.ts";
import type { DagCheckCommandResult } from "./types.ts";

function extractTasksFromState(state: Record<string, unknown>): DagTaskNode[] {
  const rawTasks = (state.tasks ?? {}) as Record<string, Record<string, unknown>>;
  const nodes: DagTaskNode[] = [];

  for (const [id, t] of Object.entries(rawTasks)) {
    const rawDeps = Array.isArray(t.dependencies) ? t.dependencies : [];
    const deps = rawDeps.filter((d): d is string => typeof d === "string");
    const rawScopes = Array.isArray(t.write_scope)
      ? t.write_scope
      : Array.isArray(t.writeScope)
        ? t.writeScope
        : [];
    const writeScope = rawScopes.filter((s): s is string => typeof s === "string");
    const effort = typeof t.effort === "number" ? t.effort : 1;
    const label = typeof t.label === "string" ? t.label : id;
    const status = typeof t.status === "string" ? t.status : "unknown";

    nodes.push({
      id,
      label,
      dependencies: deps,
      writeScope,
      effort,
      status,
    });
  }

  return nodes;
}

export function dagCheckCommand(flags: Flags, _context?: CommandContext): DagCheckCommandResult {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const detailed = boolFlag(flags, "detailed");
  const asJson = boolFlag(flags, "json");

  let tasks: DagTaskNode[] = [];
  if (runFlag !== undefined || runIdFlag !== undefined) {
    const runRoot = resolveCapsuleRun(repo, runFlag, runIdFlag);
    const loaded = loadRun(runRoot, false);
    if (loaded && loaded.state) {
      tasks = extractTasksFromState(loaded.state as Record<string, unknown>);
    }
  }

  const checkResult = checkDag(tasks);
  const markdown = formatDagCheckBrief(checkResult, detailed);

  return {
    ok: checkResult.ok,
    markdown,
    result: checkResult,
    ...(asJson ? { json: true } : {}),
  };
}
