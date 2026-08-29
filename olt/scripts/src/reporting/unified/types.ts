import type { ExecutionTier } from "../../authority/thread/index.ts";
import type { LeaseRecordView } from "../lease-agent-extractor.ts";
import type { SugiyamaDagReport, SugiyamaWaveMetrics } from "../sugiyama-dag/index.ts";

export type { SugiyamaDagReport, SugiyamaWaveMetrics };

export {
  extractLeaseAgentId,
  extractLeaseRole,
  extractLeaseAttempt,
  type LeaseRecordView,
} from "../lease-agent-extractor.ts";

export interface LeaseRecord {
  taskId: string;
  agentId: string;
  role: string;
  status: string;
  attempt: number;
  issuedAt?: string | undefined;
  expiresAt?: string | undefined;
  heartbeatAt?: string | undefined;
  pushes?: number | undefined;
  probes?: number | undefined;
  repairs?: number | undefined;
  validatorId?: string | undefined;
  verdict?: string | undefined;
}

export type LeaseMatrixRow = LeaseRecord;

export interface DecisionAuditRow {
  requirementId: string;
  decision: string;
  rationale: string;
  actor: string;
  timestamp?: string | undefined;
}

export interface UnifiedAgentRow {
  agentId: string;
  tier: ExecutionTier;
  tierName: string;
  role: string;
  status: string;
  taskId: string | null;
  attempt: number | null;
  issuedAt?: string | undefined;
  expiresAt?: string | undefined;
}

export interface ImplementerValidatorTrackingRow {
  readonly taskId: string;
  readonly lane: string;
  readonly implementerId: string;
  readonly validatorId: string;
  readonly pushes: string;
  readonly probes: string;
  readonly microCycles: string;
  readonly coordinator: string;
  readonly leaseTimer: string;
}

export interface CoordinatorOwnershipMetrics {
  readonly coordinatorId: string;
  readonly totalTasks: number;
  readonly ownedTasks: number;
  readonly ownershipPct: number;
  readonly activeLeaseTimers: readonly {
    readonly taskId: string;
    readonly agentId: string;
    readonly remainingSeconds: number;
  }[];
}

export interface UnifiedLifecycleBreakdown {
  implementers: {
    count: number;
    active: Array<{
      taskId: string;
      agentId: string;
      role: string;
      attempt: number;
      expiresAt: string;
    }>;
  };
  validators: {
    count: number;
    active: Array<{ taskId: string; validatorId: string; domain: string; deadlineAt: string }>;
  };
  submitted: {
    count: number;
    taskIds: string[];
  };
  standby: {
    count: number;
    taskIds: string[];
  };
  blocked: {
    count: number;
    taskIds: string[];
  };
  satisfied: {
    count: number;
    taskIds: string[];
  };
  repair: {
    count: number;
    taskIds: string[];
  };
}

export interface ReportContext {
  readonly runRoot: string;
  readonly detailed?: boolean | undefined;
}

export interface UnifiedReport {
  markdown: string;
  run_root: string;
  run_id: string;
  phase: string;
  topology: {
    total_tasks: number;
    satisfied: number;
    active: number;
    blocked: number;
    standby: number;
    repair: number;
  };
  lifecycle: UnifiedLifecycleBreakdown;
  occupancy: {
    active_slots: number;
    max_parallel: number;
    gate_max_parallel: number;
    summary: string;
  };
  agent_matrix: UnifiedAgentRow[];
  leases: LeaseMatrixRow[];
  decisions: DecisionAuditRow[];
  implementer_validator_tracking?: ImplementerValidatorTrackingRow[] | undefined;
  coordinator_ownership?: CoordinatorOwnershipMetrics | undefined;
  dag?: SugiyamaDagReport | undefined;
  doctor?:
    | {
        healthy: boolean;
        bun_version: string;
        bun_supported: boolean;
        gitignored: boolean | null;
        issues: readonly string[];
        critical_issues: readonly string[];
        cosmetic_issues: readonly string[];
      }
    | undefined;
  metrics?: SugiyamaWaveMetrics | undefined;
}

export type UnifiedReportView = UnifiedReport;
