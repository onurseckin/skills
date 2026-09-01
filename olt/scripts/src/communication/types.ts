export const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
export const DEFAULT_STALE_THRESHOLD_MS = 10_000;
export const DEFAULT_RETRY_INTERVAL_MS = 25;

export type MailboxMessageType =
  | "DISPATCH_TASK"
  | "HANDOFF_RECEIPT"
  | "VALIDATION_REQUEST"
  | "VALIDATION_VERDICT"
  | "COGNITIVE_PUSHBACK"
  | "PULSE_HEARTBEAT"
  | "DEFECT_ESCALATION"
  | "SYSTEM_ALERT";

export interface MailboxEnvelope<T = Record<string, unknown>> {
  readonly id: string;
  readonly sequence: number;
  readonly sender_id: string;
  readonly sender_role: string;
  readonly recipient_id: string;
  readonly message_type: MailboxMessageType;
  readonly timestamp: string;
  readonly payload: T;
  readonly correlation_id: string;
  readonly hmac_signature: string;
}

export interface MailboxCursor {
  readonly last_read_sequence: number;
  readonly last_read_id: string;
  readonly seen_ids: readonly string[];
  readonly updated_at: string;
}

export interface LockPayload {
  readonly pid: number;
  readonly holder: string;
  readonly created_at: string;
}

export interface LockAcquisitionResult {
  readonly acquired: boolean;
  readonly lockFd: number | null;
  readonly lockPath: string;
  readonly holderPid: number | null;
}

export interface SafeLockOptions {
  readonly timeoutMs?: number;
  readonly staleThresholdMs?: number;
  readonly retryMs?: number;
}

export type LockOptions = SafeLockOptions;

export interface MailboxPaths {
  readonly agentMailboxDir: string;
  readonly inboxPath: string;
  readonly outboxPath: string;
  readonly archivePath: string;
  readonly cursorPath: string;
  readonly quarantinePath: string;
  readonly lockPath: string;
}

export interface CreateEnvelopeOptions<T = Record<string, unknown>> {
  readonly senderId: string;
  readonly senderRole: string;
  readonly recipientId: string;
  readonly messageType: MailboxMessageType;
  readonly payload: T;
  readonly correlationId?: string;
  readonly sequence?: number;
  readonly secretKey?: string;
}

export interface VerifyEnvelopeResult {
  readonly valid: boolean;
  readonly error?: string;
}

export interface DispatchMessageOptions<T = Record<string, unknown>> {
  readonly senderId: string;
  readonly senderRole: string;
  readonly recipientRoleOrId: string;
  readonly messageType: MailboxMessageType;
  readonly payload: T;
  readonly sequence?: number;
  readonly correlationId?: string;
  readonly baseDir?: string;
  readonly secretKey?: string;
}

export interface BroadcastNotificationOptions<T = Record<string, unknown>> {
  readonly senderId: string;
  readonly senderRole: string;
  readonly recipientIds: readonly string[];
  readonly messageType: MailboxMessageType;
  readonly payload: T;
  readonly correlationId?: string;
  readonly baseDir?: string;
  readonly secretKey?: string;
}

export interface ReceiptCollectionResult {
  readonly totalReceipts: number;
  readonly receipts: readonly MailboxEnvelope[];
}

export interface ChatterGuardOptions {
  readonly agentId: string;
  readonly parentId: string;
  readonly baseDir?: string;
  readonly secretKey?: string;
}

export interface FilteredNarrationResult {
  readonly isNarration: boolean;
  readonly filteredText: string;
  readonly routedEnvelope?: MailboxEnvelope;
}
