import type { EvidenceClass } from "../../core/contracts/evidence.ts";

export type EdgeKind =
  | "backtrack"
  | "branch"
  | "collect"
  | "conditional"
  | "critic"
  | "data"
  | "dependency"
  | "dispatch"
  | "fallback"
  | "gate"
  | "handoff"
  | "join"
  | "loop"
  | "probe"
  | "pushback"
  | "sequence"
  | "signoff"
  | "spawn"
  | "validation";

export type PayloadKind = "prompt" | "full-context" | "summary" | "artifact" | "decision" | "file";

export type EdgeVariant = "info" | "warning" | "error" | "success" | "neutral" | "cyan";

export type ExchangeType =
  | "branch"
  | "collect"
  | "dependency"
  | "dispatch"
  | "handoff"
  | "probe"
  | "prompt"
  | "pushback"
  | "signoff"
  | "submission"
  | "verdict";

export interface BadgeDetail {
  text: string;
  variant?: "info" | "warning" | "error" | "success" | "neutral" | undefined;
  icon?: string | undefined;
  clickable?: boolean | undefined;
  targetTab?: "overview" | "io" | "files" | "commands" | "feedback" | string | undefined;
}

export interface EdgeContainerDetail {
  stepBadge: string;
  title: string;
  detail?: string | undefined;
  variant: EdgeVariant;
  icon?: string | undefined;
}

export interface ExchangeTransferredFile {
  path: string;
  mode?: "read" | "write" | "attach" | string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface ExchangeFinding {
  id?: string | undefined;
  requirementId?: string | undefined;
  class?: string | undefined;
  severity?: string | undefined;
  observation?: string | undefined;
  remediation?: string | undefined;
  status?: string | undefined;
  round?: number | undefined;
}

export interface EdgeExchange {
  id: string;
  timestamp?: string | undefined;
  direction: "forward" | "reverse";
  type: ExchangeType;
  kind: PayloadKind;
  summary: string;
  detail?: string | undefined;
  verdict?: "PASS" | "FAIL" | "PROBE" | undefined;
  files?: ExchangeTransferredFile[] | undefined;
  finding?: ExchangeFinding | undefined;
  bytes?: number | undefined;
  durationMs?: number | undefined;
  evidence_class: EvidenceClass;
}

export interface EdgeTrafficDetail {
  evidence_class: EvidenceClass;
  messagesCount?: number | undefined;
  bytes?: number | undefined;
  durationMs?: number | undefined;
}

export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string | undefined;
  directed?: boolean | undefined;
  isCycle?: boolean | undefined;
  condition?: string | undefined;
  stepNumber?: number | string | undefined;
  badge?: BadgeDetail | undefined;
  container?: EdgeContainerDetail | undefined;
  accent?: string | undefined;
  weight?: number | undefined;
  minLen?: number | undefined;
  traffic?: EdgeTrafficDetail | undefined;
  exchanges?: EdgeExchange[] | undefined;
}
