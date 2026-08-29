import type { HealthCheckId, HealthCheckResult, HealthFinding } from "./types.ts";
import { finding } from "./types.ts";

export interface HealthAllowance {
  /** Which check this excuses a finding from. A partial run that never asked for this check could
   *  not have produced the finding either way, so its absence is not staleness. */
  readonly check: HealthCheckId;
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
    key: "unused-export:olt/scripts/harness.ts#main",
    check: "unused-code",
    reason:
      "The process entry point. Nothing inside the tree can call it - the runtime does - and it stays exported so the CLI can be driven in-process instead of only by spawning bun.",
  },
  {
    key: "string-fallback:olt/scripts/src/installer/tree-digest.ts:):.",
    check: "literal-fallbacks",
    reason:
      "No value is missing here: relative(root, root) returns the empty string, and `.` is that result spelled as a path so the root entry has a path of its own. The check reads every `||` with a string on the right as a substitution and cannot see that this one converts a known result rather than inventing an unknown one.",
  },
  {
    key: "string-fallback:olt/scripts/src/orchestrator/watchdog.ts:config.autoWakeAction:nudge",
    check: "literal-fallbacks",
    reason:
      "A declared policy default, not a reading: it sits with the five timeout defaults above it and states what the watchdog does when the caller expresses no preference. The numeric half of the check already excludes knobs from POLICY_WORDS; the string half has no such vocabulary, so the same kind of default reads as a substitution.",
  },
  {
    key: "numeric-fallback:olt/scripts/src/summary/metrics/metrics-collector-helpers.ts:manifest?.prompt_bytes:0",
    check: "literal-fallbacks",
    reason:
      "computeTaskTokens's byte-ratio branch already discloses its output as an estimate (isEstimated: true, evidenceClass: 'derived'), and Math.max(50, ...) floors the result regardless. A missing manifest contributing 0 bytes toward an already-disclosed guess is a policy for that guess, not a claim that we measured a prompt of zero bytes.",
  },
  {
    key: "numeric-fallback:olt/scripts/src/summary/metrics/metrics-collector-helpers.ts:reasoningTokens:0",
    check: "literal-fallbacks",
    reason:
      "Only reached inside the estimated/derived branches of computeTaskTokens and computeGateTokens, whose result is already labelled isEstimated: true. Most providers never emit reasoning tokens at all, so folding an absent optional category into an already-disclosed estimate as 'no contribution' does not overstate a measurement - the host-reported branch above (sumReportedTokens) is where a real reading's absence is instead left as absence.",
  },
  {
    key: "numeric-fallback:olt/scripts/src/summary/metrics/metrics-collector-helpers.ts:cacheCreationTokens:0",
    check: "literal-fallbacks",
    reason:
      "Same as the reasoningTokens allowance above: reached only inside the already-disclosed estimate branches, and prompt caching is opt-in per provider, so an absent count there is 'not applicable', not 'unmeasured'.",
  },
  {
    key: "numeric-fallback:olt/scripts/src/summary/metrics/metrics-collector-helpers.ts:cacheReadTokens:0",
    check: "literal-fallbacks",
    reason:
      "Same as the reasoningTokens allowance above: reached only inside the already-disclosed estimate branches, and prompt caching is opt-in per provider, so an absent count there is 'not applicable', not 'unmeasured'.",
  },
  {
    key: "numeric-fallback:olt/scripts/src/summary/metrics/metrics-collector.ts:manifest?.prompt_bytes:0",
    check: "literal-fallbacks",
    reason:
      "computeTokenEstimations feeds RollupMetrics.estimated_tokens, a required field that is a run-wide byte-ratio guess by name and by type - unlike total_edge_traffic_exchanges lower in the same file, which is genuinely omitted when unknown because it is not disclosed as an estimate. A missing manifest contributing 0 bytes to an already-named 'estimated_tokens' total is a policy for that guess, not a claim of a measured zero.",
  },
  {
    key: "numeric-fallback:olt/scripts/src/summary/metrics/metrics-collector.ts:cmd.logs?.stdout?.bytes:0",
    check: "literal-fallbacks",
    reason:
      "Same estimated_tokens computation as the prompt_bytes allowance above: a command whose stdout byte count was not captured contributes 0 to the run-wide guess rather than the guess claiming a real reading for it.",
  },
  {
    key: "unused-export:olt/scripts/src/core/config/env.ts#resetHarnessConfigCache",
    check: "unused-code",
    reason:
      "The resolved-config cache lives for the life of one process, and every harness.ts invocation is a fresh process, so production never has a stale read to invalidate. The reset exists to stop the shared module cache leaking between test cases that run in the same process - a problem only the test runner has.",
  },
  {
    key: "unused-export:olt/scripts/src/installer/release-copy.ts#atomicReleaseCopy",
    check: "unused-code",
    reason:
      "The one production installer (installer/install.ts) must apply client links between the release copy's commit and finalize, so it drives prepareReleaseCopy directly instead of through this all-in-one helper. atomicReleaseCopy composes the same commit/rollback/cleanup sequence without that interleaving, which is exactly the shape the release-copy subsystem's own tests - and the crash-injection worker they spawn - need to exercise it in isolation from client-link concerns.",
  },
  {
    key: "unused-export:olt/scripts/src/engine/runner/execution/attempt-intent.ts#writeAttemptStarted",
    check: "unused-code",
    reason:
      "Production always needs the AttemptIntentController this record initialisation can return, and run-attempt.ts gets it from the sibling startAttemptIntent. writeAttemptStarted returns the bare record and accepts a syncParent override that startAttemptIntent does not expose, which is the seam attempt-directory-durability.test.ts needs to observe fsync-before-marker ordering directly - a capability only a test asks for.",
  },
  {
    key: "string-fallback:olt/scripts/src/core/runtime-tree.ts:):.",
    check: "literal-fallbacks",
    reason:
      "Both sites normalise a relative(root, X) path and fall back to a dot when that call returns the empty string: at the root itself it does, and a dot is that same result spelled as a path so the root entry is addressable. Identical shape to the already-allowed installer/tree-digest.ts case, and only visible to this check now that copyPinnedRuntime has a caller and the module is reachable.",
  },
  {
    key: "string-fallback:olt/scripts/src/summary/assets/asset-mapper.ts:options?.scope:all",
    check: "literal-fallbacks",
    reason:
      "A declared policy default, the same shape as the already-allowed watchdog.ts case: AssetScope's own doc comment says \"'all' exists for callers that genuinely want the union\", so a caller that names no scope is asking for everything, not reporting a scope that went missing.",
  },
  {
    key: "string-fallback:olt/scripts/src/summary/graph/graph-generator-critic-nodes.ts:completion?.status:pending",
    check: "literal-fallbacks",
    reason:
      'CompletionResult.status is a single-member literal type ("complete"); its only content is whether the field exists at all. This mirrors the terminal node\'s own status ternary (completion?.status === "complete" ? "success" : "pending") three lines above it, unflagged only because a ternary is not `??` - both name the same two-state lifecycle, not a value substituted for one the run failed to record.',
  },
  {
    key: "string-fallback:olt/scripts/src/workflow/scope-partitioner.ts:):root",
    check: "literal-fallbacks",
    reason:
      'Same shape as the already-allowed tree-digest.ts and runtime-tree.ts root-path cases: cluster.scope is always a known LCA path, and "root" only fires when that known path is exactly "." - stripped to the empty string by the slug regex - so this spells a known result as a task-id-safe slug, it does not invent one for a scope the partitioner never had.',
  },
  {
    key: "intent-missing:docs/planning/orchestration-overhaul/BACKLOG.md:B37:.tmp/fixture-build/build-fixture.ts",
    check: "intent-drift",
    reason:
      "B37's own resolution note names this file as '(gitignored, 426 lines)' in the same sentence that cites it - it is CLAUDE.md's `.tmp/` ephemeral-scratch convention by design, produced once to drive the real harness for B37's fixture-demo verification and never meant to be checked in. Its absence from the scanned tree is the convention working, not a requirement that went unmet.",
  },
  {
    key: "unqualified-dispatch:skill:references/failure-modes.md:159:invoke_subagent",
    check: "vendor-prose",
    reason: "Antigravity host failure-mode documentation explaining subagent invocation mechanics.",
  },
  {
    key: "unqualified-dispatch:skill:references/host-environment.md:62:invoke_subagent",
    check: "vendor-prose",
    reason: "Antigravity host environment reference describing available subagent dispatch APIs.",
  },
  {
    key: "unqualified-dispatch:skill:references/host-environment.md:62:define_subagent",
    check: "vendor-prose",
    reason: "Antigravity host environment reference describing subagent definition APIs.",
  },
  {
    key: "unqualified-dispatch:skill:references/host-environment.md:84:invoke_subagent",
    check: "vendor-prose",
    reason: "Antigravity host environment reference describing subagent dispatch semantics.",
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

function matches(allowance: HealthAllowance, check: HealthCheckId, key: string): boolean {
  // A key match alone is not enough: keys are namespaced by convention (a check's own prefix on
  // every key it emits), not by construction, so two checks could in principle emit the same key.
  // Requiring `check` too means an allowance scoped to one check can never suppress a same-keyed
  // finding from a different one, even if that convention ever slips.
  if (allowance.check !== check) return false;
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
  const requested = new Set(checks.map((result) => result.check));
  // Keyed by check+key, not by key alone: two allowances for different checks can share a key
  // string (nothing stops it - see matches()'s own comment on the same risk), and a plain
  // Set<key> would let a real match under one check silently mark a same-keyed allowance for an
  // unrelated check as "used" too, hiding it from the staleness sweep below even though nothing
  // under its own check ever matched it.
  const usedKey = (check: HealthCheckId, key: string): string => `${check} ${key}`;
  const used = new Set<string>();
  const applied = checks.map((result) => ({
    ...result,
    findings: result.findings.map((entry) => {
      const allowance = allowances.find((candidate) => matches(candidate, result.check, entry.key));
      if (allowance === undefined) return entry;
      used.add(usedKey(allowance.check, allowance.key));
      return { ...entry, acknowledged: allowance.reason };
    }),
  }));
  // A caller may request a subset of checks (the CLI's per-check flags, or a test that only cares
  // about a few ratchets). An allowance for a check that was never run could not have matched
  // anything either way, so it is silently skipped rather than reported stale - staleness is only
  // meaningful for a check this call actually looked at.
  const stale = allowances
    .filter(
      (allowance) =>
        requested.has(allowance.check) && !used.has(usedKey(allowance.check, allowance.key)),
    )
    .map((allowance) =>
      finding(
        "unused-code",
        `stale-allowance:${allowance.key}`,
        "olt/scripts/src/health/allowlist.ts",
        `the allowance for \`${allowance.key}\` matches no finding; the code it excused is gone`,
      ),
    );
  return { checks: applied, stale };
}
