import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { initRun, loadRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { registerAgentGrant } from "../../../olt/scripts/src/workflow/agents/grants.ts";
import { readAgentLedger } from "../../../olt/scripts/src/workflow/agents/ledger.ts";

const activeGrantRoots: string[] = [];

/**
 * A run with task-1 and task-2 seeded directly into state — the minimum a grant can bind to.
 */
export function seededRun(callerPath: string, label: string): string {
  const root = mkdtempSync(join(tmpdir(), "agent-grant-run-"));
  activeGrantRoots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  const run = initRun(repo, label, new TextEncoder().encode("Build the thing.\n"), "file", true);
  transact(run, "test-setup", "seed-graph", {}, (draft) => {
    draft.tasks = { "task-1": { id: "task-1" }, "task-2": { id: "task-2" } };
  });
  return run;
}

export function cleanupGrantRoots(): void {
  const roots = activeGrantRoots.splice(0);
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
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
