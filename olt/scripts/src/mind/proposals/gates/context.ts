import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCharter } from "../../lifecycle/charter/index.ts";

export interface CharterContext {
  readonly goals: ReadonlySet<string>;
  readonly nonGoals: readonly string[];
  readonly repoRoots: readonly string[];
}

export function resolveCharterContext(
  state: Record<string, unknown>,
  repoRoot: string,
): CharterContext {
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const charterRecord = (mindState.charter ?? {}) as Record<string, unknown>;

  // 1. Try reading from charter file on disk
  const charterRel =
    typeof charterRecord.source_path === "string"
      ? charterRecord.source_path
      : "olt/agents/mind.yaml";
  const charterFullPath = resolve(repoRoot, charterRel);

  if (existsSync(charterFullPath)) {
    try {
      const charterText = readFileSync(charterFullPath, "utf-8");
      const parsed = parseCharter(charterText);
      return {
        goals: new Set(parsed.goalIds),
        nonGoals: parsed.nonGoals,
        repoRoots: parsed.repoRoots,
      };
    } catch {
      // ignore parse error and fallback to state
    }
  }

  // 2. Fallback to state.mind.charter
  const goalsFromState = Array.isArray(charterRecord.goals)
    ? (charterRecord.goals as readonly (string | { id?: string })[]).map((g) =>
        typeof g === "string" ? g : typeof g?.id === "string" ? g.id : "G1",
      )
    : ["G1"];

  const nonGoalsFromState = Array.isArray(charterRecord.non_goals)
    ? (charterRecord.non_goals as readonly string[])
    : [];

  const repoRootsFromState = Array.isArray(charterRecord.repo_roots)
    ? (charterRecord.repo_roots as readonly string[])
    : ["."];

  return {
    goals: new Set(goalsFromState),
    nonGoals: nonGoalsFromState,
    repoRoots: repoRootsFromState,
  };
}
