import { join } from "node:path";
import { healDag, type DagTaskNode } from "../../../engine/dag/index.ts";
import { loadRun } from "../../../engine/store/index.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../../options.ts";
import { resolveCapsuleRun } from "../dag-view.ts";
import { formatDagHealBrief } from "./formatters.ts";
import type { DagHealCommandResult } from "./types.ts";

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

export function dagHealCommand(flags: Flags, _context?: CommandContext): DagHealCommandResult {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const modeFlag = textFlag(flags, "mode", false);
  const dryRun = boolFlag(flags, "dry-run");
  const asJson = boolFlag(flags, "json");

  const mode = modeFlag === "invert" ? "invert" : "prune";

  let tasks: DagTaskNode[] = [];
  let lockPath: string | undefined;

  if (runFlag !== undefined || runIdFlag !== undefined) {
    const runRoot = resolveCapsuleRun(repo, runFlag, runIdFlag);
    lockPath = join(runRoot, "dag-heal.lock");
    const loaded = loadRun(runRoot, false);
    if (loaded && loaded.state) {
      tasks = extractTasksFromState(loaded.state as Record<string, unknown>);
    }
  }

  const healResult = healDag(tasks, {
    mode,
    ...(lockPath ? { lockPath } : {}),
    dryRun,
  });

  const markdown = formatDagHealBrief(healResult);

  return {
    ok: healResult.healed,
    markdown,
    result: healResult,
    ...(asJson ? { json: true } : {}),
  };
}
