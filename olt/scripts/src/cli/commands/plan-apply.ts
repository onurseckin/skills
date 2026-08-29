import { basename, join } from "node:path";
import type { JsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { applyPlan, type PlanningStore } from "../../graph/apply-plan.ts";
import { initializePlannerPacket } from "../../packets/planner-packet.ts";
import { loadRun } from "../../engine/store/index.ts";
import { transact } from "../../engine/store/index.ts";
import { formatPlanApplyBrief, formatPlanClaimBrief } from "../formatters/index.ts";
import { actorFlag, integerFlag, textFlag, type Flags } from "../options.ts";

export function capsulePlanningStore(runRoot: string): PlanningStore {
  return {
    async load() {
      const loaded = loadRun(runRoot);
      return { prompt: loaded.prompt, state: loaded.state as unknown as Record<string, unknown> };
    },
    async transact(actor, kind, payload, mutation) {
      const result = transact(runRoot, actor, kind, payload as JsonObject, (draft) => {
        const maybeAsync = mutation(draft as unknown as Record<string, unknown>);
        if (maybeAsync instanceof Promise) {
          throw new HarnessError(
            "INTEGRITY",
            "plan mutation resolved asynchronously; the durable transaction cannot wait for it",
          );
        }
      });
      return result as unknown as Record<string, unknown>;
    },
  };
}

export async function planClaimCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const agent = textFlag(flags, "agent")!;
  const expectedRevision = integerFlag(flags, "expected-revision", { minimum: 0 }) ?? undefined;
  const published = await initializePlannerPacket(run, agent, expectedRevision);
  const markdown = formatPlanClaimBrief({
    runId: basename(run),
    agent,
    packetId: published.record.id,
  });
  return {
    markdown,
    run_root: run,
    packet_id: published.record.id,
    packet_path: published.markdownPath,
    role_contract_sha256: published.packet.metadata.role_contract_sha256,
  };
}

export async function planApplyCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const actor = actorFlag(flags);
  const requirementsPath =
    textFlag(flags, "requirements", false) ?? join(run, "planning", "requirements.json");
  const graphPath = textFlag(flags, "graph", false) ?? join(run, "planning", "graph.json");
  const expectedRevision = integerFlag(flags, "expected-revision", { minimum: 0 }) ?? null;

  const store = capsulePlanningStore(run);
  const state = await applyPlan(store, actor, requirementsPath, graphPath, expectedRevision);
  const graph = state.graph as { revision?: number } | undefined;
  const revision = typeof graph?.revision === "number" ? graph.revision : 0;
  const tasks = state.tasks as Record<string, unknown> | undefined;

  const markdown = formatPlanApplyBrief({
    runId: basename(run),
    revision,
    totalTasks: tasks ? Object.keys(tasks).length : 0,
  });

  return { markdown, run_root: run, revision, state };
}
