import { HarnessError } from "../core/errors/index.ts";
import {
  ACTIONABLE_ERROR_PATTERNS,
  COMPANION_AUDIT_PATTERNS,
  HIGH_PRIORITY_MILESTONE_PATTERNS,
  PROGRESS_NARRATION_PATTERNS,
  ROUTINE_PULSE_PATTERNS,
  isOwnerInteractiveRecipient,
  matchesAny,
} from "./chatter-patterns.ts";

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

const classify = (
  category: ChatterCategory,
  isChatter: boolean,
  isSuppressed: boolean,
  reason: string,
  severity: ChatterSeverity,
): ChatterClassification => ({ category, isChatter, isSuppressed, reason, severity });

export const estimateTokenSavings = (text: string): number =>
  typeof text === "string" && text.length > 0 ? Math.max(1, Math.ceil(text.length / 4)) : 0;

export const isActionableError = (text: string): boolean =>
  matchesAny(text, ACTIONABLE_ERROR_PATTERNS);
export const isHighPriorityMilestone = (text: string): boolean =>
  matchesAny(text, HIGH_PRIORITY_MILESTONE_PATTERNS);
export const isRoutinePulse = (text: string): boolean => matchesAny(text, ROUTINE_PULSE_PATTERNS);
export const isCompanionAuditorOutput = (text: string): boolean =>
  matchesAny(text, COMPANION_AUDIT_PATTERNS);
export const isProgressNarration = (text: string): boolean =>
  matchesAny(text, PROGRESS_NARRATION_PATTERNS);

const R_ACT = "Actionable error or defect escalation requires immediate owner attention";
const R_MLS = "High priority milestone or final deliverable admitted to owner context";
const R_PLS = "Routine pulse / heartbeat tick suppressed to preserve owner context";
const R_AUD = "Companion auditor / witness chatter suppressed from main thread";
const R_PRG = "Mid-flight progress narration suppressed from main thread";
const R_STD = "Standard payload passes through without suppression";

export function classifyChatter(text: string): ChatterClassification {
  if (typeof text !== "string") throw new HarnessError("INVALID_ARGUMENT", "Text must be a string");
  if (isActionableError(text)) return classify("ACTIONABLE_ERROR", false, false, R_ACT, "critical");
  if (isHighPriorityMilestone(text))
    return classify("HIGH_PRIORITY_MILESTONE", false, false, R_MLS, "high");
  if (isRoutinePulse(text)) return classify("ROUTINE_PULSE", true, true, R_PLS, "low");
  if (isCompanionAuditorOutput(text)) return classify("COMPANION_AUDIT", true, true, R_AUD, "low");
  if (isProgressNarration(text)) return classify("PROGRESS_NARRATION", true, true, R_PRG, "medium");
  return classify("STANDARD_PAYLOAD", false, false, R_STD, "low");
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

const CHATTER_VIOLATION_MSG =
  "Main thread chatter policy violation: routine pulses, background ticking, and companion auditor outputs must not burn owner context";

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
    throw new HarnessError("ROLE_CONFINEMENT_VIOLATION", CHATTER_VIOLATION_MSG);
  }
}

const CATEGORIES: readonly ChatterCategory[] = [
  "ROUTINE_PULSE",
  "BACKGROUND_TICK",
  "COMPANION_AUDIT",
  "WITNESS_TRACE",
  "PROGRESS_NARRATION",
  "HIGH_PRIORITY_MILESTONE",
  "ACTIONABLE_ERROR",
  "STANDARD_PAYLOAD",
];

const createCategoryCounters = (): Record<ChatterCategory, number> =>
  Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<ChatterCategory, number>;

const createInitialMetrics = (): ChatterGuardMetrics => ({
  totalEvaluated: 0,
  totalSuppressed: 0,
  totalAllowed: 0,
  suppressedBytes: 0,
  estimatedSavedTokens: 0,
  suppressedByCategory: createCategoryCounters(),
});

export class ChatterGuardEngine {
  private metrics: ChatterGuardMetrics = createInitialMetrics();

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
    this.metrics = createInitialMetrics();
  }
}

export const chatterGuard = new ChatterGuardEngine();
