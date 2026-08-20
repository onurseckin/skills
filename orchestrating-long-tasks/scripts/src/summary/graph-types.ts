import type { AgentGrantRecord } from "../contracts/agents.ts";
import type { BranchRecord } from "../contracts/branch.ts";
import type { EvidenceClass, Evidenced } from "../contracts/evidence.ts";
import type { JsonObject } from "../contracts/json.ts";
import type { TopologyRecord } from "../contracts/topology.ts";
import type { BrowserTestRun, NodeScript, NodeTelemetry, NodeTool } from "./graph-agent-types.ts";
import type {
  BadgeDetail,
  EdgeContainerDetail,
  EdgeExchange,
  EdgeKind,
  EdgeTrafficDetail,
  EdgeVariant,
  ExchangeFinding,
  ExchangeTransferredFile,
  ExchangeType,
  GraphEdgeData,
  PayloadKind,
} from "./graph-edge-types.ts";

export type {
  BadgeDetail,
  EdgeContainerDetail,
  EdgeExchange,
  EdgeKind,
  EdgeTrafficDetail,
  EdgeVariant,
  ExchangeFinding,
  ExchangeTransferredFile,
  ExchangeType,
  GraphEdgeData,
  PayloadKind,
};

export type NodeKind =
  | "orchestrator"
  | "agent"
  | "tool"
  | "router"
  | "join"
  | "gate"
  | "critic"
  | "terminal"
  | "input";

export type {
  BrowserTestRun,
  BrowserTestViewport,
  NamedBrowserTestViewport,
  NodeRole,
  NodeScript,
  NodeTelemetry,
  NodeTool,
} from "./graph-agent-types.ts";

export type NodeStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "warning"
  | "skipped"
  | "cached";

/**
 * The coarse bucket every recorded action folds into (B15.1). `tool` is reserved for a host that
 * reports individual tool invocations; nothing in this codebase's event chain does today, so no
 * `ActionStepRecord` is ever minted with this kind — an absence `collectActionSteps` leaves as
 * absence rather than backfilling from the aggregate `NodeTool` counts, which are a different
 * measurement (totals, not invocations) and would misrepresent one as the other.
 */
export type ActionKind =
  | "command"
  | "file"
  | "agent"
  | "lease"
  | "packet"
  | "finding"
  | "probe"
  | "review"
  | "branch"
  | "gate"
  | "plan"
  | "task"
  | "tool"
  | "run";

/**
 * `"success"` means the harness committed the transaction that produced the action, which every
 * persisted event satisfies by construction: `transact()` throws and appends nothing when the
 * mutation it wraps fails. `"failure"`/`"pending"` come from an explicit verdict or status the
 * payload stated. `"unknown"` is for an action whose substantive result the payload never states at
 * all (an unverdicted review, say) — never a guess dressed as one of the other three.
 */
export type ActionOutcome = "success" | "failure" | "pending" | "unknown";

/**
 * What an action acted on, in the identifiers the harness itself recorded. `nodeId` is filled in
 * only when the graph mints a node under that identifier using a convention this module can name
 * (task, gate, validator, branch sub-task); everything else is left absent rather than guessed.
 */
export interface ActionTarget {
  taskId?: string | undefined;
  gateId?: string | undefined;
  branchId?: string | undefined;
  subTaskId?: string | undefined;
  agentId?: string | undefined;
  commandId?: string | undefined;
  packetId?: string | undefined;
  requirementId?: string | undefined;
  path?: string | undefined;
  nodeId?: string | undefined;
}

/**
 * One row of the run's full action-provenance trace (B15.1): every command, file write, grant,
 * lease, packet, finding, probe, review, branch and plan revision the append-only chain recorded,
 * in the order the chain committed them. `step` is the event's own `sequence` — already monotonic
 * and gapless over every transaction the run persisted — so this is a projection of the chain, not
 * a second counter that could drift from it.
 */
export interface ActionStepRecord {
  step: number;
  timestamp: string;
  actor: string;
  kind: ActionKind;
  /** The event kind exactly as the harness recorded it, for a reader who wants the raw vocabulary. */
  rawKind: string;
  target: ActionTarget;
  outcome: ActionOutcome;
  evidence_class: EvidenceClass;
  summary: string;
}

export interface FileRef {
  path: string;
  mode?: "read" | "write" | "attach" | undefined;
  /** A compact hunk-range summary (`"12-18,44"`), derived from the same diff as `diff`. */
  lines?: string | undefined;
  diff?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
  /**
   * How this path came to be listed. A path the implementer reported is `agent_reported`; a path a
   * Git reading produced is `harness_observed`. The two are never merged into one anonymous list.
   */
  evidence_class?: EvidenceClass | undefined;
  /** Git's own two-character status for the path, when a repository reading produced this ref. */
  statusCode?: string | undefined;
  /** The digest of the bytes the harness hashed, or null when the path had none to hash. */
  sha256?: string | null | undefined;
  /**
   * The owning task's own account of why it changed, `report.summary` carried onto every path in
   * that report's `files_changed` — the report never splits a reason out per file, so this is the
   * whole-changeset reason, not a claim about this path alone. Always `agent_reported`.
   */
  rationale?: string | undefined;
  /** Requirement ids the owning report claimed this change set served. Always `agent_reported`. */
  requirementIds?: string[] | undefined;
  /** The step, from the same space as `RunFacts.steps`, whose action produced this reference. */
  step?: number | undefined;
}

export interface IoPort {
  node?: string | undefined;
  kind: PayloadKind;
  label: string;
  tokens?: number | undefined;
  preview?: string | undefined;
  dataRef?: string | undefined;
}

export interface MediaAsset {
  id: string;
  type: "image" | "video" | "audio" | "document" | "code" | "log" | "diagram" | string;
  url: string;
  title?: string | undefined;
  description?: string | undefined;
  thumbnailUrl?: string | undefined;
  timestamp?: string | undefined;
  step?: number | string | undefined;
  author?: string | undefined;
  mimeType?: string | undefined;
  sizeBytes?: number | undefined;
  dimensions?: { width: number; height: number } | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface FindingDetail {
  id: string;
  requirementId?: string | undefined;
  severity: "critical" | "important" | "suggestion";
  observation: string;
  pushbackReason?: string | undefined;
  opposedChanges?: string | undefined;
  remediation?: string | undefined;
  rejectionRound?: number | undefined;
  round?: number | undefined;
  author?: string | undefined;
  validatorId?: string | undefined;
  timestamp?: string | undefined;
  status: "open" | "resolved";
  targetFiles?: string[] | undefined;
  fileRefs?: FileRef[] | undefined;
  revalidationProof?: { method: string; evidence: string[] } | undefined;
  remediationProof?: { method: string; evidence: string[] } | undefined;
  /** When and by whom the finding was closed, as the review recorded it. */
  resolvedAt?: string | undefined;
  resolvedBy?: string | undefined;
  /** "defect" or "probe_demand": a demand for proof is not an assertion that anything is broken. */
  class?: string | undefined;
  evidence?:
    | Array<{
        kind?: string | undefined;
        reference?: string | undefined;
        observation?: string | undefined;
        url?: string | undefined;
      }>
    | undefined;
  screenshots?: MediaAsset[] | undefined;
  [key: string]: unknown;
}

/**
 * A finding as it hangs off a node: the screenshots have moved into `node.assets`, so what stays
 * here is the reference, not a second copy of the asset.
 */
export interface NodeFinding extends FindingDetail {
  screenshots?: undefined;
  screenshotAssetIds?: string[] | undefined;
}

export interface GraphSection {
  id: string;
  title: string;
  description?: string | undefined;
  nodeIds: string[];
  collapsed?: boolean | undefined;
  /** Why this region exists. For a branch region this is the recorded branch reason. */
  reason?: string | undefined;
  parentNodeId?: string | undefined;
  status?: string | undefined;
  /** How deep the region sits, when the record measured it. */
  depth?: number | undefined;
  openedAt?: string | undefined;
  closedAt?: string | undefined;
  /**
   * What came back when the region closed. Absent while it is still open, and absent for a region
   * that was abandoned without a summary — never a stand-in sentence.
   */
  outcomeSummary?: string | undefined;
  /** Paths a Git reading attributed to the region, with the evidence class of that reading. */
  filesChanged?: Evidenced<string[]> | undefined;
  files?: FileRef[] | undefined;
}

/** One recorded move of the task state machine, plus what the review carried when it caused one. */
export interface NodeStateTransition {
  at: string;
  actor: string;
  from: string;
  to: string;
  reason: string;
  attempt: number;
  evidence_class: EvidenceClass;
  verdict?: string | undefined;
  round?: number | undefined;
  findingClass?: string | undefined;
  findingCount?: number | undefined;
}

export interface GraphNodeData {
  id: string;
  name: string;
  description?: string | undefined;
  type?: string | undefined;
  kind?: NodeKind | undefined;
  status?: NodeStatus | undefined;
  step?: number | undefined;
  stepLabel?: string | undefined;
  badge?: BadgeDetail | undefined;
  badges?:
    | Array<{
        label: string;
        variant?: "success" | "info" | "amber" | "error" | "gray" | undefined;
      }>
    | undefined;
  /** Model, tier and token telemetry, or absent when the grant ledger reported none. */
  telemetry?: NodeTelemetry | undefined;
  sectionId?: string | undefined;
  tools?: NodeTool[] | undefined;
  scripts?: NodeScript[] | undefined;
  stateTransitions?: NodeStateTransition[] | undefined;
  /** The one canonical home for this node's evidence. Nothing else in the graph repeats it. */
  assets?: MediaAsset[] | undefined;
  /** Automated browser runs this node's commands drove. Their screenshots live in `assets`. */
  browserTests?: BrowserTestRun[] | undefined;
  files?: FileRef[] | undefined;
  metrics?: unknown;
  io?: { inputs?: IoPort[] | undefined; outputs?: IoPort[] | undefined } | undefined;
  prompt?: string | undefined;
  output?: string | undefined;
  logs?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  rank?: number | undefined;
  group?: string | undefined;
}

/**
 * The raw prompt, carried whole. The export is the only file the visualizer receives, so a prompt
 * trimmed to a preview here is a prompt nobody can read back.
 */
export interface RunPromptFacts {
  text: string;
  bytes: number;
  sha256?: string | undefined;
  path?: string | undefined;
  evidence_class: EvidenceClass;
}

/**
 * The enhanced plan: the document an agent reported, plus the digests the harness took of the bytes
 * that reached disk. The document is `agent_reported` however it is rendered — it is a claim about
 * the repository, never the requirement source, which stays bound to the raw prompt.
 */
export interface RunEnhancedPlanFacts {
  revision?: number | undefined;
  recordedAt?: string | undefined;
  actor?: string | undefined;
  promptSha256?: string | undefined;
  markdownPath?: string | undefined;
  jsonPath?: string | undefined;
  markdownSha256?: string | undefined;
  jsonSha256?: string | undefined;
  /** The rendered document. Absent when the capsule no longer holds the file. */
  markdown?: string | undefined;
  /** The recorded document exactly as `planning/enhanced-plan.json` holds it. */
  document?: JsonObject | undefined;
  evidence_class: EvidenceClass;
}

/** One report document the harness wrote under `reports/`, carried whole. */
export interface RunReportFacts {
  path: string;
  document: JsonObject;
  evidence_class: EvidenceClass;
}

/** The requirements compiled from the prompt, with the line disposition that produced them. */
export interface RunRequirementFacts {
  schema?: string | undefined;
  version?: number | undefined;
  promptSha256?: string | undefined;
  requirements: JsonObject[];
  dispositions: JsonObject[];
  evidence_class: EvidenceClass;
}

/**
 * Which repository the run was bound to, as the harness read it. Every digest here is a measurement
 * of bytes on disk, which is what lets a reader tell one run's baseline from another's.
 */
export interface RunRepositoryFacts {
  baselineBinding?: JsonObject | undefined;
  currentBinding?: JsonObject | undefined;
  baselineInspectionSha256?: string | undefined;
  currentInspectionSha256?: string | undefined;
  inspections?: JsonObject[] | undefined;
  evidence_class: EvidenceClass;
}

/**
 * Where the append-only event chain stood when the export was taken. It is what lets a reader say
 * which revision of the capsule this graph describes.
 */
export interface RunIntegrityFacts {
  schema?: string | undefined;
  version?: number | undefined;
  revision?: number | undefined;
  eventSequence?: number | undefined;
  eventHead?: string | null | undefined;
  graphRevision?: number | undefined;
  evidence_class: EvidenceClass;
}

/** The whole-run verdicts: critic authorisations, reviews, remediations and the seal. */
export interface RunCompletionFacts {
  critic?: JsonObject | undefined;
  criticHistory?: JsonObject[] | undefined;
  review?: JsonObject | undefined;
  reviews?: JsonObject[] | undefined;
  remediations?: JsonObject[] | undefined;
  verification?: JsonObject | undefined;
  result?: JsonObject | undefined;
  evidence?: JsonObject | undefined;
}

/**
 * Everything the run recorded that no single node owns. It sits beside `nodes` and `edges` rather
 * than inside them because a graph renderer that knows nothing about orchestration can ignore the
 * whole key and still draw the graph.
 */
export interface RunFacts {
  runId: string;
  capsuleId?: string | undefined;
  prompt: RunPromptFacts;
  enhancedPlan?: RunEnhancedPlanFacts | undefined;
  requirements?: RunRequirementFacts | undefined;
  topology?: TopologyRecord | undefined;
  taskOrder?: string[] | undefined;
  gates?: JsonObject[] | undefined;
  branches?: BranchRecord[] | undefined;
  agents?: AgentGrantRecord[] | undefined;
  /** Set when `state.agents` was present but unreadable, so the absence of grants is explained. */
  agentLedgerIssue?: string | undefined;
  reports?: RunReportFacts[] | undefined;
  /** The compiled plan document: requirement, task and artifact nodes with the edges between them. */
  planGraph?: JsonObject | undefined;
  /** Superseded plan revisions, kept so a replan is visible rather than merely implied. */
  planHistory?: JsonObject[] | undefined;
  /** Tasks as the planner declared them, before and after compilation. */
  planningTasks?: JsonObject[] | undefined;
  planningBuffer?: JsonObject[] | undefined;
  /** Role packets published to agents, which is the record of what each was told it may do. */
  packets?: JsonObject[] | undefined;
  repository?: RunRepositoryFacts | undefined;
  integrity?: RunIntegrityFacts | undefined;
  /** The append-only event chain, whole. It is the only ordered record of what happened when. */
  events?: JsonObject[] | undefined;
  /** The same chain, projected into the typed, filterable action-provenance trace (B15.1). */
  steps?: ActionStepRecord[] | undefined;
  /** The capture manifest: how the prompt was taken and what the run was initialised with. */
  manifest?: JsonObject | undefined;
  completion?: RunCompletionFacts | undefined;
  orphanEvidence?: JsonObject[] | undefined;
  orphanEvidenceDispositions?: JsonObject[] | undefined;
}

export interface GraphDataset {
  id: string;
  title: string;
  description?: string | undefined;
  directed?: boolean | undefined;
  entry?: string | undefined;
  exits?: string[] | undefined;
  sections?: GraphSection[] | undefined;
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  /** Run-level facts no node owns. Absent only when the exporter was given no run to describe. */
  run?: RunFacts | undefined;
}
