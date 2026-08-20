import type { HealthCheckResult, HealthFinding } from "./types.ts";
import { finding } from "./types.ts";

export interface HealthAllowance {
  /** An exact finding key, or a prefix ending in `*`. */
  readonly key: string;
  /** Why this is not a defect. An allowance without one is meaningless and is refused. */
  readonly reason: string;
}

/**
 * The opt-out list. It is short on purpose: every entry is a place the checker's pattern cannot
 * tell a defect from the thing it is looking at - the boundary the tree is entered through, or a
 * declared policy the fallback grammar has no way to recognise. A finding parked here because
 * nobody has fixed it yet would turn the report into a list of things we have agreed to stop
 * seeing, so an entry must say what makes the code correct, not when someone means to get to it.
 */
export const ALLOWED_FINDINGS: readonly HealthAllowance[] = [
  {
    key: "unused-export:orchestrating-long-tasks/scripts/harness.ts#main",
    reason:
      "The process entry point. Nothing inside the tree can call it - the runtime does - and it stays exported so the CLI can be driven in-process instead of only by spawning bun.",
  },
  {
    key: "string-fallback:orchestrating-long-tasks/scripts/src/installer/tree-digest.ts:):.",
    reason:
      "No value is missing here: relative(root, root) returns the empty string, and `.` is that result spelled as a path so the root entry has a path of its own. The check reads every `||` with a string on the right as a substitution and cannot see that this one converts a known result rather than inventing an unknown one.",
  },
  {
    key: "string-fallback:orchestrating-long-tasks/scripts/src/orchestrator/watchdog.ts:config.autoWakeAction:nudge",
    reason:
      "A declared policy default, not a reading: it sits with the five timeout defaults above it and states what the watchdog does when the caller expresses no preference. The numeric half of the check already excludes knobs from POLICY_WORDS; the string half has no such vocabulary, so the same kind of default reads as a substitution.",
  },
];

export function assertAllowancesHaveReasons(
  allowances: readonly HealthAllowance[] = ALLOWED_FINDINGS,
): void {
  const blank = allowances.filter((entry) => entry.reason.trim().length === 0);
  if (blank.length > 0) {
    throw new Error(`health allowance without a reason: ${blank.map((e) => e.key).join(", ")}`);
  }
}

function matches(allowance: HealthAllowance, key: string): boolean {
  return allowance.key.endsWith("*")
    ? key.startsWith(allowance.key.slice(0, -1))
    : allowance.key === key;
}

export interface AllowanceOutcome {
  readonly checks: readonly HealthCheckResult[];
  /** Allowances that matched nothing: the code they excused is gone, and so should they be. */
  readonly stale: readonly HealthFinding[];
}

export function applyAllowances(
  checks: readonly HealthCheckResult[],
  allowances: readonly HealthAllowance[] = ALLOWED_FINDINGS,
): AllowanceOutcome {
  assertAllowancesHaveReasons(allowances);
  const used = new Set<string>();
  const applied = checks.map((result) => ({
    ...result,
    findings: result.findings.map((entry) => {
      const allowance = allowances.find((candidate) => matches(candidate, entry.key));
      if (allowance === undefined) return entry;
      used.add(allowance.key);
      return { ...entry, acknowledged: allowance.reason };
    }),
  }));
  const stale = allowances
    .filter((allowance) => !used.has(allowance.key))
    .map((allowance) =>
      finding(
        "unused-code",
        `stale-allowance:${allowance.key}`,
        "orchestrating-long-tasks/scripts/src/health/allowlist.ts",
        `the allowance for \`${allowance.key}\` matches no finding; the code it excused is gone`,
      ),
    );
  return { checks: applied, stale };
}
