import type { JsonObject } from "../core/contracts/index.ts";
import { loadRun, transact } from "../engine/store/index.ts";
import type {
  CompletionEvidence,
  GateRuntime,
  RequirementRuntime,
  TaskRecord,
  TransactionPort,
  WorkflowState,
} from "../workflow/types.ts";

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
  const tasksValue =
    typeof value.tasks === "object" && value.tasks !== null && !Array.isArray(value.tasks)
      ? (value.tasks as Record<string, Record<string, unknown>>)
      : {};
  const tasks = Object.fromEntries(
    Object.entries(tasksValue).map(([id, task]) => [id, taskRecord(task)]),
  );
  let requirements: RequirementRuntime[] = [];
  if (
    typeof value.requirements === "object" &&
    value.requirements !== null &&
    !Array.isArray(value.requirements)
  ) {
    const requirementDocument = value.requirements as Record<string, unknown>;
    if (Array.isArray(requirementDocument.requirements)) {
      requirements = (requirementDocument.requirements as RequirementRuntime[]).map((entry) => ({
        ...structuredClone(entry),
        evidence: entry.evidence ?? [],
      }));
    }
  }
  let gates: GateRuntime[] = [];
  let graphRevision: number | undefined = undefined;
  if (typeof value.graph === "object" && value.graph !== null && !Array.isArray(value.graph)) {
    const graph = value.graph as Record<string, unknown>;
    if (!Number.isSafeInteger(graph.revision) || (graph.revision as number) < 1) {
      throw new TypeError("workflow requires a valid graph revision");
    }
    graphRevision = graph.revision as number;
    gates = structuredClone((graph.gates ?? []) as GateRuntime[]);
  }
  const commands = structuredClone(
    (typeof value.commands === "object" && value.commands !== null && !Array.isArray(value.commands)
      ? value.commands
      : {}) as WorkflowState["commands"],
  );
  const orphanEvidence = structuredClone(
    (Array.isArray(value.orphan_evidence) ? value.orphan_evidence : []) as JsonObject[],
  );
  const state: WorkflowState = {
    tasks,
    requirements,
    gates,
    commands,
    orphan_evidence: orphanEvidence,
    ...(graphRevision !== undefined ? { graph_revision: graphRevision } : {}),
  };
  const completion = value.completion;
  if (typeof completion === "object" && completion !== null && !Array.isArray(completion)) {
    state.completion = structuredClone(completion) as CompletionEvidence;
  }
  for (const field of [
    "current_repository_binding",
    "packets",
    "branches",
    "orphan_evidence_dispositions",
    "completion_critic",
    "completion_critic_history",
    "completion_review",
    "completion_reviews",
    "completion_remediations",
    "completion_verification",
    "completion_result",
    "plan_validation",
    "plan_validation_history",
    "plan_review",
    "plan_reviews",
    "gate_proofs",
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
  if (
    typeof draft.requirements === "object" &&
    draft.requirements !== null &&
    !Array.isArray(draft.requirements)
  ) {
    const requirementDocument = draft.requirements as Record<string, unknown>;
    requirementDocument.requirements = workflow.requirements;
  } else if (workflow.requirements.length > 0) {
    draft.requirements = { requirements: workflow.requirements };
  }
  if (typeof draft.graph === "object" && draft.graph !== null && !Array.isArray(draft.graph)) {
    const graph = draft.graph as Record<string, unknown>;
    graph.gates = workflow.gates;
    if (workflow.graph_revision !== undefined) {
      graph.revision = workflow.graph_revision;
    }
  } else if (workflow.gates.length > 0 || workflow.graph_revision !== undefined) {
    draft.graph = {
      gates: workflow.gates,
      ...(workflow.graph_revision !== undefined ? { revision: workflow.graph_revision } : {}),
    };
  }
  draft.commands = workflow.commands;
  draft.orphan_evidence = workflow.orphan_evidence;
  for (const field of [
    "current_repository_binding",
    "completion",
    "branches",
    "packets",
    "orphan_evidence_dispositions",
    "completion_critic",
    "completion_critic_history",
    "completion_review",
    "completion_reviews",
    "completion_remediations",
    "completion_verification",
    "completion_result",
    "plan_validation",
    "plan_validation_history",
    "plan_review",
    "plan_reviews",
    "gate_proofs",
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
