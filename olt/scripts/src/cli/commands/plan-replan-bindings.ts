import { isJsonObject, type JsonObject, type JsonValue } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { checkScopeOverlap } from "../../graph/scope-analyzer.ts";

export type GateSource = "flag" | "finding" | "parent_task";

export interface PlannedTaskBinding {
  readonly id: string;
  readonly writeScope: readonly string[];
  readonly requirementIds: readonly string[];
  readonly gate: readonly string[] | undefined;
}

export interface PlanBindings {
  readonly tasks: readonly PlannedTaskBinding[];
  readonly requirementIds: ReadonlySet<string>;
}

export interface ResolvedGate {
  readonly argv: string[];
  readonly source: GateSource;
}

function stringList(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function parseGateArgv(command: JsonValue | undefined): string[] | undefined {
  const parts =
    typeof command === "string"
      ? command.trim().split(/\s+/)
      : Array.isArray(command)
        ? command.filter((entry): entry is string => typeof entry === "string")
        : [];
  const argv = parts.filter((part) => part.length > 0);
  return argv.length > 0 ? argv : undefined;
}

function gateEntries(state: JsonObject): readonly JsonValue[] {
  if (Array.isArray(state.gates)) return state.gates;
  const graph = isJsonObject(state.graph) ? state.graph : undefined;
  return graph !== undefined && Array.isArray(graph.gates) ? graph.gates : [];
}

function gateIdCandidates(taskId: string): readonly string[] {
  return [`gate-${taskId.replace(/^task-?/, "")}`, `gate-${taskId}`];
}

export function readPlanBindings(state: JsonObject): PlanBindings {
  const argvByGateId = new Map<string, string[]>();
  for (const entry of gateEntries(state)) {
    if (!isJsonObject(entry) || entry.scope !== "task") continue;
    const argv = parseGateArgv(entry.command);
    if (typeof entry.id === "string" && argv !== undefined) argvByGateId.set(entry.id, argv);
  }

  const tasks: PlannedTaskBinding[] = [];
  const recorded = isJsonObject(state.tasks) ? state.tasks : {};
  for (const [id, value] of Object.entries(recorded)) {
    if (!isJsonObject(value)) continue;
    tasks.push({
      id,
      writeScope: stringList(value.write_scope),
      requirementIds: stringList(value.requirement_ids),
      gate: gateIdCandidates(id)
        .map((candidate) => argvByGateId.get(candidate))
        .find((argv) => argv !== undefined),
    });
  }

  const requirementIds = new Set<string>();
  const requirements = isJsonObject(state.requirements)
    ? state.requirements.requirements
    : undefined;
  if (Array.isArray(requirements)) {
    for (const requirement of requirements) {
      if (isJsonObject(requirement) && typeof requirement.id === "string")
        requirementIds.add(requirement.id);
    }
  }
  return { tasks, requirementIds };
}

export function parentTasks(
  bindings: PlanBindings,
  writeScope: readonly string[],
): readonly PlannedTaskBinding[] {
  return bindings.tasks.filter(
    (task) =>
      task.writeScope.length > 0 && checkScopeOverlap(writeScope, task.writeScope).hasOverlap,
  );
}

function distinctArgv(candidates: readonly (readonly string[])[]): string[][] {
  const seen = new Map<string, string[]>();
  for (const candidate of candidates) seen.set(candidate.join(" "), [...candidate]);
  return [...seen.values()];
}

export interface GateRequest {
  readonly taskId: string;
  readonly writeScope: readonly string[];
  readonly declared: readonly (readonly string[])[];
  readonly flagGate: readonly string[] | undefined;
}

export function resolveClusterGate(bindings: PlanBindings, request: GateRequest): ResolvedGate {
  if (request.flagGate !== undefined) return { argv: [...request.flagGate], source: "flag" };

  const scope = request.writeScope.join(", ");
  const declared = distinctArgv(request.declared);
  if (declared.length === 1) return { argv: declared[0]!, source: "finding" };
  if (declared.length > 1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `findings for repair task ${request.taskId} declare ${declared.length} different revalidation gates (${declared.map((argv) => `'${argv.join(" ")}'`).join(", ")}); pass --gate to state which one revalidates this scope`,
    );
  }

  const inherited = distinctArgv(
    parentTasks(bindings, request.writeScope)
      .map((task) => task.gate)
      .filter((argv): argv is readonly string[] => argv !== undefined),
  );
  if (inherited.length === 1) return { argv: inherited[0]!, source: "parent_task" };
  if (inherited.length > 1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `repair task ${request.taskId} covers ${scope}, which ${inherited.length} planned tasks gate differently (${inherited.map((argv) => `'${argv.join(" ")}'`).join(", ")}); pass --gate`,
    );
  }
  throw new HarnessError(
    "INVALID_ARGUMENT",
    `repair task ${request.taskId} has no revalidation gate: no finding declared revalidation_gate and no planned task writing ${scope} has a recorded gate to inherit; pass --gate`,
  );
}

export function resolveClusterFindingRequirement(
  bindings: PlanBindings,
  declared: string | undefined,
  findingId: string,
  writeScope: readonly string[],
): string {
  if (declared !== undefined) {
    if (!bindings.requirementIds.has(declared)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `finding ${findingId} names requirement ${declared}, which this run has not recorded`,
      );
    }
    return declared;
  }
  const inherited = [
    ...new Set(parentTasks(bindings, writeScope).flatMap((task) => task.requirementIds)),
  ];
  if (inherited.length === 1) return inherited[0]!;
  throw new HarnessError(
    "INVALID_ARGUMENT",
    inherited.length === 0
      ? `finding ${findingId} declares no requirement_id and no planned task writing ${writeScope.join(", ")} carries one to inherit`
      : `finding ${findingId} declares no requirement_id and the planned tasks writing ${writeScope.join(", ")} carry ${inherited.length} (${inherited.join(", ")}); declare requirement_id on the finding`,
  );
}
