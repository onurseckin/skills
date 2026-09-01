import { HarnessError, type JsonValue } from "../../../core/index.ts";

/**
 * Optical Validator Quarantine Invariants
 */
export const OPTICAL_QUARANTINE_INVARIANTS = [
  "COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK",
  "HEADFUL_VISUAL_SCREENSHOT_REVIEW_MANDATE",
  "ZERO_SOURCE_EDITS",
  "ZERO_SOURCE_READS",
  "ZERO_DIRECTORY_LISTINGS",
  "SUPERFICIAL_UI_APPROVAL_BAN",
  "HUMAN_GRADE_COGNITIVE_CRITIQUE",
] as const;

export type OpticalQuarantineInvariant = (typeof OPTICAL_QUARANTINE_INVARIANTS)[number];

/**
 * Quarantine Tool Category Classification
 */
export type QuarantineCategory =
  | "AUTHORIZED_OPTICAL_VISUAL"
  | "AUTHORIZED_BROWSER_INTERACTION"
  | "AUTHORIZED_MESSAGING_COORDINATION"
  | "FORBIDDEN_SOURCE_READING"
  | "FORBIDDEN_PATTERN_SEARCHING"
  | "FORBIDDEN_DIRECTORY_LISTING"
  | "FORBIDDEN_COMMAND_EXECUTION"
  | "FORBIDDEN_SOURCE_EDITING"
  | "FORBIDDEN_SUBAGENT_SPAWNING";

/**
 * Tool descriptor object representation
 */
export interface ToolDescriptor {
  readonly name: string;
  readonly description?: string | undefined;
  readonly parameters?: Record<string, unknown> | undefined;
}

/**
 * Invocation context for runtime validation
 */
export interface ToolInvocationContext {
  readonly agentId: string;
  readonly role: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly timestamp?: string | undefined;
  readonly callId?: string | undefined;
}

/**
 * Result of capability check
 */
export interface QuarantineCheckResult {
  readonly allowed: boolean;
  readonly reason: string;
  readonly category: QuarantineCategory;
  readonly violations: readonly string[];
}

/**
 * Result of backdoor bypass detection
 */
export interface BackdoorDetectionResult {
  readonly detected: boolean;
  readonly severity: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly vector?: string | undefined;
  readonly description?: string | undefined;
  readonly matchedPattern?: string | undefined;
}

/**
 * Result of runtime boundary enforcement
 */
export interface QuarantineEnforcementResult {
  readonly action: "ALLOW" | "BLOCK" | "STRIP" | "TERMINATE";
  readonly reason: string;
  readonly bypassAttempt?: BackdoorDetectionResult | undefined;
  readonly violationInvariant?: OpticalQuarantineInvariant | undefined;
}

/**
 * Audit log entry for quarantined tool calls
 */
export interface QuarantineAuditRecord {
  readonly callId: string;
  readonly agentId: string;
  readonly role: string;
  readonly toolName: string;
  readonly timestamp: string;
  readonly decision: "ALLOWED" | "BLOCKED";
  readonly category: QuarantineCategory;
  readonly bypassDetected: boolean;
  readonly details?: string | undefined;
  readonly violationInvariant?: OpticalQuarantineInvariant | undefined;
}
