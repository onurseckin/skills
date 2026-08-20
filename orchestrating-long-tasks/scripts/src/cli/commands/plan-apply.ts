import { basename, join } from "node:path";
import type { JsonObject } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { applyPlan, type PlanningStore } from "../../graph/apply-plan.ts";
import { initializePlannerPacket } from "../../packets/planner-packet.ts";
import { loadRun } from "../../store/index.ts";
import { transact } from "../../store/transaction.ts";
import { formatPlanApplyBrief, formatPlanClaimBrief } from "../formatters/index.ts";
import { actorFlag, integerFlag, textFlag, type Flags } from "../options.ts";

/**
 * Bridges the durable capsule store to the store-agnostic shape `applyPlan` was written against.
 * `applyPlan`'s own mutation callback is always synchronous (guardPlanRevision + projectPlan run
 * inline); the check below turns a future async mutation into a loud failure instead of a silently
 * dropped one.
 */
function capsulePlanningStore(runRoot: string): PlanningStore {
  return {
    async load() {
      const loaded = loadRun(runRoot);
      // RunState is a JsonObject; PlanningStore was written against the untyped shape apply-plan's
      // validators expect, so this is a structural widening, not a lossy cast.
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

/**
 * The planner's own entry point: it has no task and no lease, so there is nothing for it to
 * `task:claim`. This is the sole caller that turns the packet-issuing code in packets/planner-packet
 * into something a real run reaches.
 */
export async function planClaimCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const agent = textFlag(flags, "agent")!;
  const published = await initializePlannerPacket(run, agent);
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

/**
 * Applies the requirements and graph the planner wrote to planning/, against the graph revision
 * the planner's own packet told it to expect. This is the only code that enforces that check —
 * without it, a planner working from a stale packet can silently overwrite a newer plan.
 */
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
