import type { RunState } from "../core/contracts/capsule.ts";
import type { JsonObject } from "../core/contracts/json.ts";
import { loadRun, transact } from "../engine/store/index.ts";
import type { GateRuntime, TransactionPort, WorkflowState } from "../workflow/types.ts";

function view(raw: RunState): WorkflowState {
  const graph =
    typeof raw.graph === "object" && raw.graph !== null && !Array.isArray(raw.graph)
      ? (raw.graph as JsonObject)
      : undefined;
  const requirements =
    typeof raw.requirements === "object" &&
    raw.requirements !== null &&
    !Array.isArray(raw.requirements)
      ? ((raw.requirements as JsonObject).requirements as WorkflowState["requirements"] | undefined)
      : undefined;
  return {
    tasks: structuredClone((raw.tasks ?? {}) as WorkflowState["tasks"]),
    requirements: structuredClone(requirements ?? []),
    gates: structuredClone((graph?.gates ?? []) as GateRuntime[]),
    commands: structuredClone((raw.commands ?? {}) as WorkflowState["commands"]),
    orphan_evidence: structuredClone((raw.orphan_evidence ?? []) as JsonObject[]),
    graph_revision:
      typeof graph?.revision === "number" && Number.isSafeInteger(graph.revision)
        ? graph.revision
        : 0,
    packets: structuredClone((raw.packets ?? {}) as NonNullable<WorkflowState["packets"]>),
  };
}

export function preplanPacketPort(runRoot: string): TransactionPort {
  return {
    read: () => view(loadRun(runRoot).state),
    transact(actor, kind, payload, mutate) {
      const result = transact(runRoot, actor, kind, payload, (draft) => {
        const state = view(draft);
        mutate(state);
        draft.packets = state.packets ?? {};
      });
      return view(result);
    },
  };
}
