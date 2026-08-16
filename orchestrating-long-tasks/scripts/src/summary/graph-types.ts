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

export type NodeStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "warning"
  | "skipped"
  | "cached";

export type EdgeKind =
  | "sequence"
  | "spawn"
  | "conditional"
  | "loop"
  | "fallback"
  | "join"
  | "data"
  | "dependency"
  | "gate"
  | "critic";

export type PayloadKind = "prompt" | "full-context" | "summary" | "artifact" | "decision" | "file";
export type ModelTier = "xs" | "s" | "m" | "l";

export interface FileRef {
  path: string;
  mode?: "read" | "write" | "attach" | undefined;
  lines?: string | undefined;
  diff?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
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
  evidence?: Array<{ kind?: string | undefined; reference?: string | undefined; observation?: string | undefined; url?: string | undefined }> | undefined;
  screenshots?: MediaAsset[] | undefined;
  [key: string]: unknown;
}

export interface GraphSection {
  id: string;
  title: string;
  description?: string | undefined;
  nodeIds: string[];
  collapsed?: boolean | undefined;
}

export interface BadgeDetail {
  text: string;
  variant?: "info" | "warning" | "error" | "success" | "neutral" | undefined;
  icon?: string | undefined;
  clickable?: boolean | undefined;
  targetTab?: "overview" | "io" | "files" | "commands" | "feedback" | string | undefined;
}

export interface PlaywrightMetadata {
  viewport?: { width: number; height: number } | undefined;
  traces?: string[] | undefined;
  videos?: string[] | undefined;
  screenshots?: MediaAsset[] | undefined;
  testFile?: string | undefined;
  durationMs?: number | undefined;
  browser?: string | undefined;
  status?: "passed" | "failed" | "timedOut" | "interrupted" | string | undefined;
  [key: string]: unknown;
}

export interface ExchangeTransferredFile {
  path: string;
  mode?: "read" | "write" | "attach" | string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
  diff?: string | undefined;
}

export interface ExchangeFinding {
  id?: string | undefined;
  requirementId?: string | undefined;
  severity?: "critical" | "important" | "suggestion" | string | undefined;
  observation?: string | undefined;
  remediation?: string | undefined;
  status?: "open" | "resolved" | string | undefined;
  revalidationProof?: { method?: string | undefined; evidence?: string[] | undefined } | undefined;
}

export interface ExchangeResolutionProof {
  method?: string | undefined;
  evidence?: string[] | string | undefined;
  details?: string | undefined;
}

export interface EdgeTrafficExchange {
  id: string;
  timestamp?: string | undefined;
  source?: string | undefined;
  target?: string | undefined;
  step?: number | string | undefined;
  stepNumber?: number | string | undefined;
  direction?: "forward" | "reverse" | string | undefined;
  type?:
    | "submission"
    | "rejection"
    | "repair"
    | "approval"
    | "prompt"
    | "artifact"
    | "feedback"
    | "decision"
    | "dispatch"
    | "handoff"
    | string
    | undefined;
  kind?: PayloadKind | string | undefined;
  summary?: string | undefined;
  tokens?: number | undefined;
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  bytes?: number | undefined;
  durationMs?: number | undefined;
  latencyMs?: number | undefined;
  status?: "success" | "error" | "warning" | "in_transit" | "nominal" | "high" | "congested" | string | undefined;
  payloadSnippet?: string | undefined;
  payloadPreview?: string | undefined;
  fullPayload?: string | undefined;
  inputGoal?: string | undefined;
  outputPassed?: string | undefined;
  filesTransferred?: Array<ExchangeTransferredFile | string> | undefined;
  files?: Array<ExchangeTransferredFile | string> | undefined;
  auditFinding?: ExchangeFinding | string | undefined;
  finding?: ExchangeFinding | string | undefined;
  rejectionObservation?: string | undefined;
  observation?: string | undefined;
  requiredRemediation?: string | undefined;
  remediation?: string | undefined;
  remediatedPayload?: string | undefined;
  verdict?: "PASS" | "FAIL" | "WARNING" | string | undefined;
  resolutionProof?: ExchangeResolutionProof | string | undefined;
  proof?: ExchangeResolutionProof | string | undefined;
  evidence?: string | string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
  [key: string]: unknown;
}

export interface EdgeTrafficDetail {
  volume?: number | undefined;
  messagesCount?: number | undefined;
  tokens?: number | undefined;
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  latencyMs?: number | undefined;
  bytes?: number | undefined;
  ratePerSec?: number | undefined;
  lastActive?: string | undefined;
  status?: "nominal" | "high" | "congested" | "active" | "idle" | "error" | string | undefined;
  glowColor?: string | undefined;
  glowIntensity?: number | undefined;
  exchanges?: EdgeTrafficExchange[] | undefined;
}

export interface EdgeHandoff {
  kind: PayloadKind;
  summary?: string | undefined;
  tokens?: number | undefined;
}

export interface EdgeContainerDetail {
  stepBadge: string;
  title: string;
  detail?: string | undefined;
  variant: "info" | "warning" | "error" | "success" | "neutral" | "cyan";
  icon?: string | undefined;
}

export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  label?: string | undefined;
  directed?: boolean | undefined;
  isCycle?: boolean | undefined;
  kind?: EdgeKind | undefined;
  condition?: string | undefined;
  stepNumber?: number | string | undefined;
  badge?: BadgeDetail | undefined;
  container?: EdgeContainerDetail | undefined;
  handoff?: EdgeHandoff | undefined;
  weight?: number | undefined;
  minLen?: number | undefined;
  traffic?: EdgeTrafficDetail | undefined;
  isHighTraffic?: boolean | undefined;
  trafficVolume?: number | undefined;
  exchanges?: EdgeTrafficExchange[] | undefined;
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
  badges?: Array<{
    label: string;
    variant?: "success" | "info" | "amber" | "error" | "gray" | undefined;
  }> | undefined;
  model?: string | undefined;
  harnessModel?: string | undefined;
  tier?: ModelTier | undefined;
  sectionId?: string | undefined;
  tools?: Array<{ name: string; type?: "generic" | "custom" | undefined }> | undefined;
  files?: FileRef[] | undefined;
  metrics?: unknown;
  io?: { inputs?: IoPort[] | undefined; outputs?: IoPort[] | undefined } | undefined;
  prompt?: string | undefined;
  output?: string | undefined;
  logs?: string | undefined;
  metadata?: {
    commands?: unknown[] | undefined;
    findings?: FindingDetail[] | undefined;
    writeScope?: string[] | undefined;
    leaseAgent?: string | undefined;
    validator_id?: string | undefined;
    validatorId?: string | undefined;
    repairRounds?: number | undefined;
    validationHistory?: unknown[] | undefined;
    mediaAssets?: MediaAsset[] | undefined;
    screenshots?: MediaAsset[] | undefined;
    assets?: MediaAsset[] | undefined;
    playwrightMetadata?: PlaywrightMetadata | undefined;
    opposedChangesCount?: number | undefined;
    pushbackCount?: number | undefined;
    critic_id?: string | undefined;
    criticId?: string | undefined;
    status?: string | undefined;
    unresolved_finding_ids?: string[] | undefined;
    unresolvedFindingIds?: string[] | undefined;
    residual_risks?: unknown[] | undefined;
    requirement_proofs?: unknown[] | undefined;
    [key: string]: unknown;
  } | undefined;
  mediaAssets?: MediaAsset[] | undefined;
  screenshots?: MediaAsset[] | undefined;
  rank?: number | undefined;
  group?: string | undefined;
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
}
