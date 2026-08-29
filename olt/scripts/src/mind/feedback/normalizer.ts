import { HarnessError } from "../../core/errors/index.ts";
import type { FeedbackCategory, FeedbackPriority, FeedbackStatus } from "./queue/types.ts";
import { validateCategory, validatePriority, validateStatus } from "./queue/types.ts";

export function normalizeFeedbackCategory(val: unknown): FeedbackCategory {
  return validateCategory(val);
}

export function normalizeFeedbackPriority(val: unknown): FeedbackPriority {
  return validatePriority(val);
}

export function normalizeFeedbackStatus(val: unknown): FeedbackStatus {
  return validateStatus(val);
}

export { validateCategory, validatePriority, validateStatus };
