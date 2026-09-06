export type RefusalReason = "out_of_scope" | "disagreed" | "blocked";

export interface ReceiptDelivered {
  readonly type: "RECEIPT_DELIVERED";
  readonly message_id: string;
  readonly correlation_id: string;
  readonly timestamp: string;
}

export interface TaskScopeBindingProof {
  readonly kind: "task_scope";
  readonly path: string;
  readonly run_id: string;
  readonly task_id: string;
}

export interface SatisfyingArtefactProof {
  readonly kind: "artefact";
  readonly path?: string | undefined;
  readonly requirement?: string | undefined;
  readonly artefact_path?: string | undefined;
  readonly commit_hash?: string | undefined;
  readonly artefact_class?: string | undefined;
}

export type BindingProof = TaskScopeBindingProof | SatisfyingArtefactProof;

export interface ReceiptBound {
  readonly type: "RECEIPT_BOUND";
  readonly message_id: string;
  readonly correlation_id: string;
  readonly timestamp: string;
  readonly bindings: readonly BindingProof[];
}

export interface ReceiptRefused {
  readonly type: "RECEIPT_REFUSED";
  readonly message_id: string;
  readonly correlation_id: string;
  readonly timestamp: string;
  readonly reason: RefusalReason;
  readonly requirement_or_path: string;
  readonly details?: string | undefined;
}

export type Phase2Receipt = ReceiptBound | ReceiptRefused;
export type TwoPhaseReceipt = ReceiptDelivered | Phase2Receipt;

export interface WriteScopeRecord {
  readonly run_id: string;
  readonly task_id: string;
  readonly write_scope: readonly string[];
}

export type ScopeLookupFn = (
  runId: string,
  taskId: string,
) => readonly string[] | undefined | Promise<readonly string[] | undefined>;

export interface BindingVerificationItem {
  readonly proof: BindingProof;
  readonly valid: boolean;
  readonly reason?: string | undefined;
}

export interface BindingVerificationSummary {
  readonly valid: boolean;
  readonly results: readonly BindingVerificationItem[];
  readonly errors: readonly string[];
}

export type ExpectationType = "receipt" | "verdict" | "nothing";

export interface ExpectationDeclaration {
  readonly message_id: string;
  readonly correlation_id: string;
  readonly expectation: ExpectationType;
  readonly timeout_ms?: number | undefined;
  readonly declared_at: string;
}

export type ObligationStatus =
  | "PENDING_DELIVERY"
  | "AWAITING_BINDING"
  | "OVERDUE"
  | "RESOLVED_BOUND"
  | "RESOLVED_REFUSED"
  | "INFORMATIONAL";

export interface TrackedObligation {
  readonly message_id: string;
  readonly correlation_id: string;
  readonly expectation: ExpectationType;
  readonly timeout_ms: number;
  readonly created_at: string;
  readonly delivered_receipt?: ReceiptDelivered | undefined;
  readonly phase2_receipt?: Phase2Receipt | undefined;
}

export interface ObligationAssessment {
  readonly message_id: string;
  readonly correlation_id: string;
  readonly expectation: ExpectationType;
  readonly status: ObligationStatus;
  readonly is_overdue: boolean;
  readonly elapsed_ms: number;
  readonly remaining_ms: number;
}

export type ArtefactClass =
  | "dom_metrics"
  | "optical_critique"
  | "unit_test_log"
  | "benchmark"
  | "architecture_audit"
  | "coverage_report"
  | string;

export interface EvidenceArtefact {
  readonly artefact_class: string;
  readonly path: string;
  readonly description?: string | undefined;
  readonly size_bytes?: number | undefined;
}

export interface BrowserSessionMetrics {
  readonly opened: number;
  readonly closed: number;
  readonly active: number;
}

export interface AgentRoster {
  readonly [agent_type: string]: readonly string[];
}

export interface AgentTypeCounts {
  readonly [agent_type: string]: number;
}

export interface ExecutionTelemetry {
  readonly run_id: string;
  readonly wave_id?: string | undefined;
  readonly timestamp: string;
  readonly distinct_agents_by_type: AgentRoster;
  readonly lane_count: number;
  readonly distinct_implementer_count: number;
  readonly evidence_artefacts: readonly EvidenceArtefact[];
  readonly browser_sessions: BrowserSessionMetrics;
}

export type TelemetryAnomalyType =
  | "SERIAL_EXECUTION_DETECTED"
  | "BROWSER_SESSION_LEAK"
  | "MISSING_VALIDATOR_ROSTER"
  | "EMPTY_EVIDENCE_ARTEFACTS"
  | "INVALID_METRIC";

export interface TelemetryAnomaly {
  readonly type: TelemetryAnomalyType;
  readonly severity: "WARNING" | "ERROR";
  readonly message: string;
  readonly details: Record<string, string | number | boolean>;
}

export type ErrorClassification = "RETRYABLE" | "FATAL";

export type ErrorCategory =
  | "TRANSIENT_AUTH_RACE"
  | "LOCK_CONTENTION"
  | "NETWORK_TIMEOUT"
  | "RATE_LIMITED"
  | "DAEMON_INITIALIZING"
  | "PERMISSION_DENIED"
  | "SIGNATURE_VIOLATION"
  | "CONTRACT_VIOLATION"
  | "WRITE_SCOPE_VIOLATION"
  | "UNKNOWN_ERROR";

export interface ClassifiedError {
  readonly classification: ErrorClassification;
  readonly category: ErrorCategory;
  readonly message: string;
  readonly original_error: unknown;
  readonly retryable: boolean;
}

export interface RetryPolicy {
  readonly max_attempts: number;
  readonly initial_delay_ms: number;
  readonly max_delay_ms: number;
  readonly backoff_factor: number;
  readonly jitter: boolean;
}

export interface RetryAttemptRecord {
  readonly attempt: number;
  readonly delay_ms: number;
  readonly error: ClassifiedError;
}

export interface RetryExecutionResult<T> {
  readonly success: boolean;
  readonly value?: T | undefined;
  readonly attempts: number;
  readonly history: readonly RetryAttemptRecord[];
  readonly fatal_error?: ClassifiedError | undefined;
}

export interface HandshakeOffer {
  readonly protocol_version: string;
  readonly supported_versions: readonly string[];
  readonly capabilities: readonly string[];
  readonly heartbeat_interval_ms: number;
  readonly endpoint_id: string;
  readonly timestamp: string;
}

export interface HandshakeAccept {
  readonly accepted: true;
  readonly selected_version: string;
  readonly agreed_capabilities: readonly string[];
  readonly agreed_heartbeat_interval_ms: number;
  readonly endpoint_id: string;
  readonly timestamp: string;
}

export interface HandshakeReject {
  readonly accepted: false;
  readonly reject_reason: string;
  readonly endpoint_id: string;
  readonly timestamp: string;
}

export type HandshakeResult = HandshakeAccept | HandshakeReject;

export interface EndpointConfig {
  readonly endpoint_id: string;
  readonly supported_versions: readonly string[];
  readonly capabilities: readonly string[];
  readonly min_heartbeat_interval_ms: number;
  readonly max_heartbeat_interval_ms: number;
  readonly preferred_heartbeat_interval_ms: number;
  readonly required_capabilities?: readonly string[] | undefined;
}
