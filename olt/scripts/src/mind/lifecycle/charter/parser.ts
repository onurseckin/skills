import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  CharterGoal,
  StabilityCheck,
  MindBudgetOverrides,
  MindBudget,
  ParsedCharter,
} from "./types.ts";
import {
  DEFAULT_MIND_BUDGET,
  DEFAULT_PROHIBITIONS,
  parseDurationOrNumber,
  parseBudgetsObject,
} from "./types.ts";
export function parseCharterFromYaml(
  doc: Record<string, unknown>,
  rawText: string,
  sha256: string,
): ParsedCharter {
  const rawCharter = (
    doc.charter && typeof doc.charter === "object" && !Array.isArray(doc.charter)
      ? doc.charter
      : doc
  ) as Record<string, unknown>;

  // Mandatory identity
  const identity = typeof rawCharter.identity === "string" ? rawCharter.identity.trim() : "";
  if (!identity) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter is missing required section: identity. Expected 'identity' field in YAML manifest.",
    );
  }

  // Mandatory goals
  const rawGoals = rawCharter.goals;
  if (!rawGoals || !Array.isArray(rawGoals) || rawGoals.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter is missing required section: goals. Expected 'goals' array in YAML manifest.",
    );
  }

  const goals: CharterGoal[] = [];
  for (const item of rawGoals as unknown[]) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const gObj = item as Record<string, unknown>;
      if (typeof gObj.id === "string" && typeof gObj.statement === "string") {
        goals.push({
          id: gObj.id.toUpperCase().trim(),
          statement: gObj.statement.trim(),
        });
      }
    } else if (typeof item === "string") {
      const match = item.trim().match(/^[-*+]?\s*\[?(G[A-Za-z0-9_.-]+)\]?\s*[:\-–]\s*(.+)$/i);
      if (match) {
        goals.push({
          id: match[1]!.toUpperCase(),
          statement: match[2]!.trim(),
        });
      }
    }
  }

  if (goals.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter 'goals' section contains no valid goal items. Expected list of {id, statement} in YAML manifest.",
    );
  }

  // Mandatory non-goals
  const rawNonGoals = (rawCharter.non_goals ?? rawCharter.nonGoals) as unknown;
  if (!rawNonGoals || !Array.isArray(rawNonGoals) || rawNonGoals.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter is missing required section: non-goals. Expected 'non_goals' array in YAML manifest.",
    );
  }

  const nonGoals: string[] = [];
  for (const item of rawNonGoals as unknown[]) {
    if (typeof item === "string" && item.trim()) {
      nonGoals.push(item.trim().replace(/^[-*+]\s*/, ""));
    }
  }

  if (nonGoals.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "charter 'non_goals' section contains no items.");
  }

  // Mandatory repo_roots
  const rawRepoRoots = (rawCharter.repo_roots ?? rawCharter.repoRoots) as unknown;
  if (!rawRepoRoots || !Array.isArray(rawRepoRoots) || rawRepoRoots.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter is missing required section: repo_roots. Expected 'repo_roots' array in YAML manifest.",
    );
  }

  const repoRoots: string[] = [];
  for (const item of rawRepoRoots as unknown[]) {
    if (typeof item === "string" && item.trim()) {
      const clean = item
        .trim()
        .replace(/`/g, "")
        .replace(/^[-*+]\s*/, "");
      if (clean && !repoRoots.includes(clean)) {
        repoRoots.push(clean);
      }
    }
  }

  if (repoRoots.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter 'repo_roots' section contains no valid paths.",
    );
  }

  // Optional stability
  let stability: StabilityCheck[] | undefined;
  const rawStability = rawCharter.stability as unknown;
  if (Array.isArray(rawStability) && rawStability.length > 0) {
    stability = [];
    for (const item of rawStability as unknown[]) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const sObj = item as Record<string, unknown>;
        if (typeof sObj.command === "string") {
          stability.push({
            command: sObj.command.trim(),
            expectedExit: typeof sObj.expectedExit === "number" ? sObj.expectedExit : 0,
          });
        }
      } else if (typeof item === "string") {
        const match = item.trim().match(/^[-*+]?\s*`?([^`→\-:]+)`?\s*(?:→|->|:)?\s*exit\s*(\d+)/i);
        if (match) {
          stability.push({
            command: match[1]!.trim(),
            expectedExit: parseInt(match[2]!, 10),
          });
        }
      }
    }
  }

  // Optional budgets
  const rawBudgets = (rawCharter.budgets ?? rawCharter.budget) as unknown;
  const budgets = rawBudgets ? parseBudgetsObject(rawBudgets) : undefined;

  // Optional prohibitions
  let prohibitions: string | undefined;
  const rawProhibitions = rawCharter.prohibitions;
  if (typeof rawProhibitions === "string") {
    prohibitions = rawProhibitions.trim();
  } else if (Array.isArray(rawProhibitions)) {
    prohibitions = rawProhibitions
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim())
      .join("\n");
  }

  // Optional escalation
  let escalation: string | undefined;
  if (typeof rawCharter.escalation === "string") {
    escalation = rawCharter.escalation.trim();
  }

  // Optional open questions
  let openQuestions: string[] | undefined;
  const rawQuestions = (rawCharter.open_questions ?? rawCharter.openQuestions) as unknown;
  if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
    openQuestions = rawQuestions
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .map((q) => q.trim());
  }

  return {
    identity,
    goals,
    goalIds: goals.map((g) => g.id),
    nonGoals,
    repoRoots,
    ...(stability !== undefined && stability.length > 0 ? { stability } : {}),
    ...(budgets !== undefined && Object.keys(budgets).length > 0 ? { budgets } : {}),
    ...(prohibitions !== undefined && prohibitions.length > 0 ? { prohibitions } : {}),
    ...(escalation !== undefined && escalation.length > 0 ? { escalation } : {}),
    ...(openQuestions !== undefined && openQuestions.length > 0 ? { openQuestions } : {}),
    rawText,
    sha256,
  };
}
