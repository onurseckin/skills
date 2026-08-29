import { HarnessError } from "../core/errors/index.ts";

export const DEFECT_MAIN_THREAD_CHATTER_BURNS_OWNER_CONTEXT =
  "defect-main-thread-chatter-burns-owner-context";
export const DEFECT_ROUTINE_PULSE_MAIN_THREAD_CHATTER_LEAK =
  "defect-routine-pulse-main-thread-chatter-leak";
export const FEATURE_MAIN_THREAD_CHATTER_GUARD = "fb-1788020100000-main-thread-chatter-guard";
export const DEFAULT_CHATTER_SUPPRESSION_NOTICE =
  "[Background telemetry/routine pulse suppressed by ChatterGuard]";

export type ChatterCategory =
  | "ROUTINE_PULSE"
  | "BACKGROUND_TICK"
  | "COMPANION_AUDIT"
  | "WITNESS_TRACE"
  | "PROGRESS_NARRATION"
  | "HIGH_PRIORITY_MILESTONE"
  | "ACTIONABLE_ERROR"
  | "STANDARD_PAYLOAD";
export type ChatterSeverity = "low" | "medium" | "high" | "critical";
export type ChatterDecision = "ALLOW" | "SUPPRESS" | "DIVERT";

export interface ChatterClassification {
  readonly category: ChatterCategory;
  readonly isChatter: boolean;
  readonly isSuppressed: boolean;
  readonly reason: string;
  readonly severity: ChatterSeverity;
}

export interface ChatterGuardFilterOptions {
  readonly suppressRoutinePulses?: boolean;
  readonly suppressCompanionAudits?: boolean;
  readonly suppressProgressNarration?: boolean;
  readonly allowHighPriorityMilestones?: boolean;
  readonly allowActionableErrors?: boolean;
  readonly maskSuppressedText?: boolean;
  readonly suppressionNotice?: string;
  readonly telemetrySink?: string;
  readonly targetRecipient?: string;
}

export interface ChatterFilterResult {
  readonly allowed: boolean;
  readonly suppressed: boolean;
  readonly decision: ChatterDecision;
  readonly category: ChatterCategory;
  readonly originalText: string;
  readonly filteredText: string;
  readonly reason: string;
  readonly savedTokensEstimate: number;
  readonly telemetryRoute?: string;
}

export interface ChatterGuardMetrics {
  totalEvaluated: number;
  totalSuppressed: number;
  totalAllowed: number;
  suppressedBytes: number;
  estimatedSavedTokens: number;
  suppressedByCategory: Record<ChatterCategory, number>;
}

export interface AssertOwnerSafetyContext {
  readonly senderId?: string;
  readonly recipientRoleOrId?: string;
  readonly isOwnerSeat?: boolean;
}

const OWNER_INTERACTIVE_RECIPIENTS = new Set([
  "human",
  "user",
  "stdout",
  "interactive",
  "console",
  "terminal",
  "owner",
  "main-thread",
  "root",
]);

const ROUTINE_PULSE_PATTERNS: readonly RegExp[] = [
  /^\s*\[?(?:pulse|heartbeat|tick|liveness|cadence|interval|poll)\s*(?:tick|update|check|ping|ack|beat)?\]?\s*:/i,
  /\b(?:routine\s+pulse|background\s+tick|liveness\s+ping|heartbeat\s+pulse|cadence\s+poll|scheduled\s+tick)\b/i,
  /\bpulse\s+#?\d+\s+(?:nominal|quiescent|idle|ticking|alive|active|started|finished)\b/i,
  /\bheartbeat\s+(?:nominal|ok|ping|pong|alive|ticking)\b/i,
  /\bperiodic\s+(?:scan|poll|check|inspection)\s+(?:nominal|running|completed)\b/i,
  /\bbackground\s+liveness\s+check\b/i,
];

const COMPANION_AUDIT_PATTERNS: readonly RegExp[] = [
  /^\s*\[?(?:companion|witness|auditor|cognitive-witness|meta-auditor)\s*(?:audit|trace|scan|finding|observation)?\]?\s*:/i,
  /\b(?:companion\s+auditor|cognitive\s+witness|meta-auditor|routine\s+audit\s+scan|witness\s+trace)\b/i,
  /\baudit\s+cycle\s+#?\d+\s+(?:nominal|passed|observing|in\s+progress|clean)\b/i,
  /\bcognitive\s+flavor\s+(?:evaluation|score|vector|matrix|poll)\b/i,
  /\broutine\s+questionnaire\s+evaluation\b/i,
  /\bwitness\s+observation\s+recorded\b/i,
];

const PROGRESS_NARRATION_PATTERNS: readonly RegExp[] = [
  /^\s*\[?(?:status|progress|mid-flight)\s*(?:update|report|notice|ping)?\]?\s*:/i,
  /\b(?:status|progress|mid-flight)\s+(?:update|report|ping|check|notice)\b/i,
  /\bstep\s+\d+\s*(?:\/|\s+of\s+)\s*\d+/i,
  /\bstep\s+\d+\s*:\s*(?:in\s+progress|started|starting|executing|complete|done)/i,
  /\b(?:now\s+)?executing\s+step\b/i,
  /\b(?:i am|i'm|currently)\s+(?:now\s+)?(?:executing|running|dispatching|processing|working\s+on)\b/i,
  /\b(?:dispatching|spawning)\s+(?:subagent|worker|agent|task)\b/i,
  /\bwaiting\s+for\s+(?:subagent|worker|agent|task\s+completion)\b/i,
  /\bworker\s+(?:dispatched|assigned|spawned|started|running|working)\b/i,
];

const ACTIONABLE_ERROR_PATTERNS: readonly RegExp[] = [
  /^\s*\[?(?:fatal|critical|panic|alert|escalation|fatal_trap)\]?\s*:/i,
  /\b(?:fatal\s+trap|critical\s+fault|panic|unrecoverable\s+error|invariant\s+violation|role_confinement_violation|crash_threshold_exceeded|defect\s+escalation|hardware_fault)\b/i,
  /\bactionable\s+error\s+detected\b/i,
];

const HIGH_PRIORITY_MILESTONE_PATTERNS: readonly RegExp[] = [
  /^\s*\[?(?:milestone|deliverable|handoff|final\s+output|completion|release)\]?\s*:/i,
  /\b(?:milestone\s+achieved|task\s+completed\s+successfully|objective\s+fulfilled|deliverable\s+ready|all\s+\d+\s+tests\s+pass(?:ing)?\s+with\s+0\s+failures)\b/i,
  /\bfinal\s+deliverable\b/i,
  /\bmission\s+accomplished\b/i,
];

function isOwnerInteractiveRecipient(recipient?: string): boolean {
  return (
    typeof recipient === "string" &&
    recipient.trim().length > 0 &&
    OWNER_INTERACTIVE_RECIPIENTS.has(recipient.trim().toLowerCase())
  );
}

export function estimateTokenSavings(text: string): number {
  return typeof text === "string" && text.length > 0 ? Math.max(1, Math.ceil(text.length / 4)) : 0;
}

export function isActionableError(text: string): boolean {
  return (
    typeof text === "string" &&
    text.trim().length > 0 &&
    ACTIONABLE_ERROR_PATTERNS.some((p) => p.test(text.trim()))
  );
}

export function isHighPriorityMilestone(text: string): boolean {
  return (
    typeof text === "string" &&
    text.trim().length > 0 &&
    HIGH_PRIORITY_MILESTONE_PATTERNS.some((p) => p.test(text.trim()))
  );
}

export function isRoutinePulse(text: string): boolean {
  return (
    typeof text === "string" &&
    text.trim().length > 0 &&
    ROUTINE_PULSE_PATTERNS.some((p) => p.test(text.trim()))
  );
}

export function isCompanionAuditorOutput(text: string): boolean {
  return (
    typeof text === "string" &&
    text.trim().length > 0 &&
    COMPANION_AUDIT_PATTERNS.some((p) => p.test(text.trim()))
  );
}

export function isProgressNarration(text: string): boolean {
  return (
    typeof text === "string" &&
    text.trim().length > 0 &&
    PROGRESS_NARRATION_PATTERNS.some((p) => p.test(text.trim()))
  );
}

export function classifyChatter(text: string): ChatterClassification {
  if (typeof text !== "string") throw new HarnessError("INVALID_ARGUMENT", "Text must be a string");
  if (isActionableError(text)) {
    return {
      category: "ACTIONABLE_ERROR",
      isChatter: false,
      isSuppressed: false,
      reason: "Actionable error or defect escalation requires immediate owner attention",
      severity: "critical",
    };
  }
  if (isHighPriorityMilestone(text)) {
    return {
      category: "HIGH_PRIORITY_MILESTONE",
      isChatter: false,
      isSuppressed: false,
      reason: "High priority milestone or final deliverable admitted to owner context",
      severity: "high",
    };
  }
  if (isRoutinePulse(text)) {
    return {
      category: "ROUTINE_PULSE",
      isChatter: true,
      isSuppressed: true,
      reason: "Routine pulse / heartbeat tick suppressed to preserve owner context",
      severity: "low",
    };
  }
  if (isCompanionAuditorOutput(text)) {
    return {
      category: "COMPANION_AUDIT",
      isChatter: true,
      isSuppressed: true,
      reason: "Companion auditor / witness chatter suppressed from main thread",
      severity: "low",
    };
  }
  if (isProgressNarration(text)) {
    return {
      category: "PROGRESS_NARRATION",
      isChatter: true,
      isSuppressed: true,
      reason: "Mid-flight progress narration suppressed from main thread",
      severity: "medium",
    };
  }
  return {
    category: "STANDARD_PAYLOAD",
    isChatter: false,
    isSuppressed: false,
    reason: "Standard payload passes through without suppression",
    severity: "low",
  };
}

export function shouldSuppressForOwner(text: string, options?: ChatterGuardFilterOptions): boolean {
  if ((options?.allowActionableErrors ?? true) && isActionableError(text)) return false;
  if ((options?.allowHighPriorityMilestones ?? true) && isHighPriorityMilestone(text)) return false;
  if ((options?.suppressRoutinePulses ?? true) && isRoutinePulse(text)) return true;
  if ((options?.suppressCompanionAudits ?? true) && isCompanionAuditorOutput(text)) return true;
  if ((options?.suppressProgressNarration ?? true) && isProgressNarration(text)) return true;
  return false;
}

export function filterOwnerContextMessage(
  text: string,
  options?: ChatterGuardFilterOptions,
): ChatterFilterResult {
  if (typeof text !== "string")
    throw new HarnessError("INVALID_ARGUMENT", "Message text must be a string");
  const classification = classifyChatter(text);
  const suppressed = shouldSuppressForOwner(text, options);
  const mask = options?.maskSuppressedText ?? true;
  const notice = options?.suppressionNotice ?? DEFAULT_CHATTER_SUPPRESSION_NOTICE;
  const savedTokens = suppressed ? estimateTokenSavings(text) : 0;
  const telemetryRoute = suppressed
    ? (options?.telemetrySink ?? ".olt/telemetry.jsonl")
    : undefined;

  return {
    allowed: !suppressed,
    suppressed,
    decision: suppressed ? "SUPPRESS" : "ALLOW",
    category: classification.category,
    originalText: text,
    filteredText: suppressed ? (mask ? notice : "") : text,
    reason: classification.reason,
    savedTokensEstimate: savedTokens,
    ...(telemetryRoute !== undefined ? { telemetryRoute } : {}),
  };
}

export function assertNonChatterOwnerContext(
  text: string,
  context?: AssertOwnerSafetyContext,
): void {
  if (typeof text !== "string")
    throw new HarnessError("INVALID_ARGUMENT", "Context payload text must be a string");
  const isOwner =
    context?.isOwnerSeat === true ||
    (context?.isOwnerSeat === undefined &&
      (context?.recipientRoleOrId === undefined ||
        isOwnerInteractiveRecipient(context.recipientRoleOrId)));
  if (isOwner && shouldSuppressForOwner(text)) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      "Main thread chatter policy violation: routine pulses, background ticking, and companion auditor outputs must not burn owner context",
    );
  }
}

function emptyCategoryCounts(): Record<ChatterCategory, number> {
  return {
    ROUTINE_PULSE: 0,
    BACKGROUND_TICK: 0,
    COMPANION_AUDIT: 0,
    WITNESS_TRACE: 0,
    PROGRESS_NARRATION: 0,
    HIGH_PRIORITY_MILESTONE: 0,
    ACTIONABLE_ERROR: 0,
    STANDARD_PAYLOAD: 0,
  };
}

export class ChatterGuardEngine {
  private metrics: ChatterGuardMetrics = {
    totalEvaluated: 0,
    totalSuppressed: 0,
    totalAllowed: 0,
    suppressedBytes: 0,
    estimatedSavedTokens: 0,
    suppressedByCategory: emptyCategoryCounts(),
  };

  public evaluate(text: string, options?: ChatterGuardFilterOptions): ChatterFilterResult {
    const result = filterOwnerContextMessage(text, options);
    this.metrics.totalEvaluated += 1;
    if (result.suppressed) {
      this.metrics.totalSuppressed += 1;
      this.metrics.suppressedBytes += text.length;
      this.metrics.estimatedSavedTokens += result.savedTokensEstimate;
      this.metrics.suppressedByCategory[result.category] += 1;
    } else {
      this.metrics.totalAllowed += 1;
    }
    return result;
  }

  public assertSafe(text: string, context?: AssertOwnerSafetyContext): void {
    assertNonChatterOwnerContext(text, context);
  }

  public getMetrics(): ChatterGuardMetrics {
    return { ...this.metrics, suppressedByCategory: { ...this.metrics.suppressedByCategory } };
  }

  public resetMetrics(): void {
    this.metrics = {
      totalEvaluated: 0,
      totalSuppressed: 0,
      totalAllowed: 0,
      suppressedBytes: 0,
      estimatedSavedTokens: 0,
      suppressedByCategory: emptyCategoryCounts(),
    };
  }
}

export const chatterGuard = new ChatterGuardEngine();
