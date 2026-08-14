import type { JsonObject } from "../contracts/json.ts";
import type { PlanningStore } from "../graph/planning-store.ts";
import { loadRun, transact } from "../store/index.ts";
import type {
  CompletionEvidence,
  GateRuntime,
  RequirementRuntime,
  TaskRecord,
  TransactionPort,
  WorkflowState,
} from "../workflow/types.ts";

export function planningPort(runRoot: string): PlanningStore {
  return {
    async load() {
      const loaded = loadRun(runRoot);
      return { prompt: loaded.prompt.slice(), state: structuredClone(loaded.state) };
    },
    async transact(actor, kind, payload, mutation) {
      return transact(runRoot, actor, kind, payload as JsonObject, (draft) => {
        draft.tasks ??= {};
        draft.plan_history ??= [];
        const result = mutation(draft);
        if (result instanceof Promise) {
          throw new TypeError("durable planning mutations must be synchronous");
        }
      });
    },
  };
}

function taskRecord(value: Record<string, unknown>): TaskRecord {
  const copy = structuredClone(value) as TaskRecord;
  copy.requirement_ids = Array.isArray(copy.requirement_ids) ? copy.requirement_ids : [];
  copy.write_scope = Array.isArray(copy.write_scope) ? copy.write_scope : [];
  copy.dependencies = Array.isArray(copy.dependencies) ? copy.dependencies : [];
  copy.attempts = Array.isArray(copy.attempts) ? copy.attempts : [];
  copy.history = Array.isArray(copy.history) ? copy.history : [];
  copy.repair_round = Number.isSafeInteger(copy.repair_round) ? copy.repair_round : 0;
  return copy;
}

function workflowState(value: Record<string, unknown>): WorkflowState {
  if (!value.graph || !value.tasks || !value.requirements) {
    throw new TypeError("workflow requires an applied plan");
  }
  const tasks = Object.fromEntries(
    Object.entries(value.tasks as Record<string, Record<string, unknown>>).map(([id, task]) => [
      id,
      taskRecord(task),
    ]),
  );
  const requirementDocument = value.requirements as Record<string, unknown>;
  const requirements = (requirementDocument.requirements as RequirementRuntime[]).map((entry) => ({
    ...structuredClone(entry),
    evidence: entry.evidence ?? [],
  }));
  const graph = value.graph as Record<string, unknown>;
  if (!Number.isSafeInteger(graph.revision) || (graph.revision as number) < 1) {
    throw new TypeError("workflow requires a valid graph revision");
  }
  const gates = structuredClone((graph.gates ?? []) as GateRuntime[]);
  const commands = structuredClone((value.commands ?? {}) as WorkflowState["commands"]);
  const orphanEvidence = structuredClone((value.orphan_evidence ?? []) as JsonObject[]);
  const state: WorkflowState = {
    tasks,
    requirements,
    gates,
    commands,
    orphan_evidence: orphanEvidence,
    graph_revision: graph.revision as number,
  };
  const completion = value.completion;
  if (typeof completion === "object" && completion !== null && !Array.isArray(completion)) {
    state.completion = structuredClone(completion) as CompletionEvidence;
  }
  for (const field of [
    "current_repository_binding",
    "packets",
    "orphan_evidence_dispositions",
    "completion_critic",
    "completion_critic_history",
    "completion_review",
    "completion_reviews",
    "completion_remediations",
    "completion_verification",
    "completion_result",
  ] as const) {
    const entry = value[field];
    if (entry !== undefined) {
      (state as Record<string, unknown>)[field] = structuredClone(entry);
    }
  }
  return state;
}

function mergeWorkflow(draft: Record<string, unknown>, workflow: WorkflowState): void {
  draft.tasks = workflow.tasks;
  const requirementDocument = draft.requirements as Record<string, unknown>;
  requirementDocument.requirements = workflow.requirements;
  const graph = draft.graph as Record<string, unknown>;
  graph.gates = workflow.gates;
  graph.revision = workflow.graph_revision;
  draft.commands = workflow.commands;
  draft.orphan_evidence = workflow.orphan_evidence;
  for (const field of [
    "current_repository_binding",
    "completion",
    "packets",
    "orphan_evidence_dispositions",
    "completion_critic",
    "completion_critic_history",
    "completion_review",
    "completion_reviews",
    "completion_remediations",
    "completion_verification",
    "completion_result",
  ] as const) {
    const entry = workflow[field];
    if (entry === undefined) delete draft[field];
    else draft[field] = entry;
  }
}

export function workflowPort(runRoot: string): TransactionPort {
  return {
    read: () => workflowState(loadRun(runRoot).state),
    transact(actor, kind, payload, mutate) {
      const state = transact(runRoot, actor, kind, payload, (draft) => {
        const workflow = workflowState(draft);
        mutate(workflow);
        mergeWorkflow(draft, workflow);
      });
      return workflowState(state);
    },
  };
}
