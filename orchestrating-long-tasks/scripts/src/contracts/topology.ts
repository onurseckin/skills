import { isEvidenceClass, type EvidenceClass } from "./evidence.ts";
import { isJsonObject, isSafeInteger, type JsonObject } from "./json.ts";

export type TopologyReason = "dependency" | "write_scope_conflict" | "priority_capacity";

export const TOPOLOGY_REASONS: readonly TopologyReason[] = [
  "dependency",
  "write_scope_conflict",
  "priority_capacity",
];

const TOPOLOGY_REASON_NAMES = new Set<string>(TOPOLOGY_REASONS);

export interface TopologyWave extends JsonObject {
  wave: number;
  task_ids: string[];
}

export interface TopologyDecision extends JsonObject {
  task_id: string;
  wave: number;
  parallel_with: string[];
  serialized_after: string[];
  reason: TopologyReason;
  rationale: string;
  evidence_class: EvidenceClass;
}

export interface TopologyRecord extends JsonObject {
  revision: number;
  waves: TopologyWave[];
  decisions: TopologyDecision[];
  max_parallel: number;
}

export function isTopologyReason(value: unknown): value is TopologyReason {
  return typeof value === "string" && TOPOLOGY_REASON_NAMES.has(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function isTopologyWave(value: unknown): value is TopologyWave {
  return isJsonObject(value) && isSafeInteger(value.wave) && isStringArray(value.task_ids);
}

export function isTopologyDecision(value: unknown): value is TopologyDecision {
  return (
    isJsonObject(value) &&
    typeof value.task_id === "string" &&
    isSafeInteger(value.wave) &&
    isStringArray(value.parallel_with) &&
    isStringArray(value.serialized_after) &&
    isTopologyReason(value.reason) &&
    typeof value.rationale === "string" &&
    isEvidenceClass(value.evidence_class)
  );
}

export function isTopologyRecord(value: unknown): value is TopologyRecord {
  return (
    isJsonObject(value) &&
    isSafeInteger(value.revision) &&
    isSafeInteger(value.max_parallel) &&
    Array.isArray(value.waves) &&
    value.waves.every(isTopologyWave) &&
    Array.isArray(value.decisions) &&
    value.decisions.every(isTopologyDecision)
  );
}

export function readTopology(state: unknown): TopologyRecord | null {
  if (!isJsonObject(state)) return null;
  const topology = state.topology;
  return isTopologyRecord(topology) ? topology : null;
}

export function topologyWavesByTask(topology: TopologyRecord): Map<string, number> {
  const waves = new Map<string, number>();
  for (const wave of topology.waves) {
    for (const taskId of wave.task_ids) waves.set(taskId, wave.wave);
  }
  return waves;
}
