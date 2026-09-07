import type { FeedbackCategory, FeedbackPriority } from "../../../mind/feedback/queue/index.ts";

export function parsePriority(val: string | undefined): FeedbackPriority {
  if (!val) return "NORMAL";
  const upper = val.trim().toUpperCase();
  if (upper === "CRITICAL_USER_FEEDBACK" || upper === "CRITICAL") return "CRITICAL_USER_FEEDBACK";
  if (upper === "HIGH_ARCHITECTURAL_FEATURE" || upper === "HIGH")
    return "HIGH_ARCHITECTURAL_FEATURE";
  if (upper === "USER_DIRECTIVE" || upper === "DIRECTIVE") return "USER_DIRECTIVE";
  if (upper === "NORMAL" || upper === "MEDIUM") return "NORMAL";
  if (upper === "LOW") return "LOW";
  return "NORMAL";
}

export function parseCategory(val: string | undefined): FeedbackCategory {
  if (!val) return "GENERAL";
  const upper = val.trim().toUpperCase();
  if (upper === "DOCUMENTATION") return "DOCUMENTATION";
  if (upper === "AGENT_CONTRACTS") return "AGENT_CONTRACTS";
  if (upper === "CLI_TOOLING") return "CLI_TOOLING";
  if (upper === "WATCHDOG") return "WATCHDOG";
  if (upper === "SCALING") return "SCALING";
  if (upper === "ARCHITECTURE") return "ARCHITECTURE";
  if (upper === "CORE_ENGINE") return "CORE_ENGINE";
  if (upper === "REPAIR") return "REPAIR";
  return "GENERAL";
}
