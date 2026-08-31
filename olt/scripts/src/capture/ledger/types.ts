export type CaptureEventType =
  | "CAPTURE_INITIALIZED"
  | "VIEWPORT_RENDERED"
  | "INTERACTION_DISPATCHED"
  | "PHYSICS_EXTRACTED"
  | "SCREENSHOT_CAPTURED"
  | "VALIDATION_EVALUATED"
  | "TREE_MUTATED"
  | "TREE_PRUNED"
  | "CAPTURE_FINALIZED"
  | "CAPTURE_FAILED";

export interface CaptureEventRecord {
  readonly sequenceNumber: number;
  readonly eventId: string;
  readonly timestamp: string;
  readonly eventType: CaptureEventType;
  readonly payload: Record<string, unknown>;
  readonly prevHash: string;
  readonly hash: string;
  readonly actor?: string | undefined;
}

export interface LedgerVerificationResult {
  readonly valid: boolean;
  readonly totalEvents: number;
  readonly latestHash: string;
  readonly error?: string | undefined;
  readonly corruptedSequenceNumber?: number | undefined;
}

export interface EventLedgerStats {
  readonly totalEvents: number;
  readonly genesisHash: string;
  readonly latestHash: string;
  readonly ledgerPath?: string | undefined;
  readonly isClosed: boolean;
}

export interface EventLedgerOptions {
  readonly ledgerPath?: string | undefined;
  readonly autoFlush?: boolean | undefined;
}
