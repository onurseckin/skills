import type { JsonObject, JsonValue } from "./json.ts";

export type NodeType =
  | "agent"
  | "artifact"
  | "decision"
  | "finding"
  | "gate"
  | "requirement"
  | "task"
  | "topic";
export type EdgeType =
  | "assigned_to"
  | "blocks"
  | "depends_on"
  | "discovered_from"
  | "evidenced_by"
  | "implements"
  | "produces"
  | "relates_to"
  | "supersedes"
  | "validates";
export type PlannedTaskStatus = "proposed" | "ready";

export interface GraphNode extends JsonObject {
  id: string;
  type: NodeType;
  label: string;
  [key: string]: JsonValue;
}

export interface TaskNode extends GraphNode {
  type: "task";
  requirement_ids: string[];
  write_scope: string[];
  resource_scope: string[];
  artifact_ids: string[];
  status: PlannedTaskStatus;
  priority: number;
  effort: number;
  created_order?: number;
}

export interface GraphEdge extends JsonObject {
  source: string;
  target: string;
  type: EdgeType;
}

export interface GateDefinition extends JsonObject {
  id: string;
  command: string | string[];
  cwd: string;
  scope: "task" | "run";
  requirement_ids: string[];
  mandatory: boolean;
}

export interface GraphDocument extends JsonObject {
  schema: "harness.graph";
  version: number;
  revision: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  gates: GateDefinition[];
}
