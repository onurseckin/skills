import { execFileSync } from "node:child_process";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";

/** Sentences the fixture plants so a completeness assertion has something distinctive to look for. */
export const PLANTED = {
  promptAlpha: "Rewrite the alpha parser so it accepts the new grammar",
  promptBeta: "Harden the beta writer against partial flushes",
  planSummary: "Two independent subsystems need work",
  planObservation: "the alpha parser has no grammar tests",
  planTodo: "add grammar fixtures for the empty payload",
  planRisk: "the beta flush path is untested",
  planQuestion: "is a partial flush observable from outside",
  planSource: "src/alpha/index.ts",
  rejectReason: "Grammar fixture for the empty payload is missing",
  rejectRemediation: "Add a fixture that exercises the empty payload",
  probeAlpha: "Prove the parser rejects an empty payload",
  probeBeta: "Prove a partial flush cannot lose the tail",
  repairSummary: "Empty payload fixture added and exercised",
  branchReason: "the flush path needs its own investigation before the writer can change",
  subTaskLabel: "Investigate the flush path",
  subTaskSummary: "A partial flush reproduces under a short buffer",
  collectSummary: "Flush path understood; the writer change is unblocked",
  criticSummary: "Every requirement is proven by a recorded gate",
  model: "fixture-model-large",
} as const;

/**
 * A gate has to perform substantive verification, and it has to be genuinely tied to the one task's
 * own write scope: A3-gate-discrimination (`graph/plan-audit.ts`) refuses a plan where two tasks with
 * disjoint write scopes share byte-identical gate argv, because such a gate passes whether either
 * task did its work or nothing at all. `git diff --check` is whole-repo by construction — the grammar
 * `graph/gate-tool-grammar.ts` accepts for it takes no path operand at all — so it cannot be split
 * into two per-task variants; it is reserved for `RUN_GATE` below, which runs once at the run level
 * and is never compared against a task gate. Each task instead gets its own `test -f <path-in-its-own-
 * scope>`: a real binary spawn (no language runtime, so this stays cheap enough for the unit suite)
 * whose one operand is that task's own scope path, so the two tasks can never collide on argv the way
 * a shared `git diff --check` did.
 */
export const TASK_GATE_ALPHA = ["test", "-f", "src/alpha/index.ts"];
export const TASK_GATE_BETA = ["test", "-f", "src/beta/index.ts"];
export const RUN_GATE = ["git", "diff", "--cached", "--check"];

type FlagValue = readonly string[] | string | undefined;
export type Issue = (value: unknown) => string;

export function text(value: unknown): string {
  if (typeof value !== "string") throw new Error(`expected a string, got ${typeof value}`);
  return value;
}

/** `{ "--task": "task-alpha" }` reads as the command line it becomes; a repeated flag takes a list. */
export async function cli(
  command: string,
  flags: Readonly<Record<string, FlagValue>>,
  remainder: readonly string[] = [],
): Promise<Record<string, unknown>> {
  const argv: string[] = [command];
  for (const [name, value] of Object.entries(flags)) {
    if (value === undefined) continue;
    for (const entry of typeof value === "string" ? [value] : value) argv.push(name, entry);
  }
  if (remainder.length > 0) argv.push("--", ...remainder);
  return execute(argv);
}

export function git(repo: string, argv: readonly string[]): void {
  execFileSync("git", [...argv], { cwd: repo });
}
