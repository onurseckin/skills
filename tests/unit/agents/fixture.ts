import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { initRun, loadRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { registerAgentGrant } from "../../../olt/scripts/src/workflow/agents/grants.ts";
import { readAgentLedger } from "../../../olt/scripts/src/workflow/agents/ledger.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

/**
 * A run with `task-1` and `task-2` seeded directly into state — the minimum a grant can bind to.
 * Seeded via `transact` rather than the `plan:init`/`plan:add`/`plan:compile` CLI trio: grant
 * registration only ever reads `state.tasks` (see `requireKnownTask` in workflow/agents/grants.ts),
 * so the gates/requirements/graph machinery a real compiled plan carries is irrelevant here.
 */
export function seededRun(callerPath: string, label: string): string {
  const root = scratchRoot(callerPath, label);
  const repo = join(root, "repo");
  mkdirSync(repo);
  const run = initRun(repo, label, new TextEncoder().encode("Build the thing.\n"), "file", true);
  transact(run, "test-setup", "seed-graph", {}, (draft) => {
    draft.tasks = { "task-1": { id: "task-1" }, "task-2": { id: "task-2" } };
  });
  return run;
}

export function ledgerOf(run: string) {
  return readAgentLedger(loadRun(run).state);
}

export function eventKinds(run: string): string[] {
  return loadRun(run).events.map((event) => event.kind);
}

/** The payload of the most recent event of one kind, for asserting what a command actually recorded. */
export function lastPayload(run: string, kind: string): JsonObject {
  const events = loadRun(run).events.filter((event) => event.kind === kind);
  const last = events.at(-1);
  if (last === undefined) throw new Error(`no ${kind} event was recorded in ${run}`);
  return last.payload;
}

export function registerCoordinator(run: string, id = "coordinator-1"): void {
  registerAgentGrant({
    runRoot: run,
    agentId: id,
    role: "coordinator",
    parentAgentId: null,
    parentTaskId: null,
    host: "claude-code",
    authority: { kind: "conditional_genesis" },
    maxAgents: 50,
    telemetry: {},
  });
}
