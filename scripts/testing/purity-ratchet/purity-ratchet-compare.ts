import type { PurityViolation } from "../guardrails/index.ts";
import { compareEntries, entryIdentity } from "./purity-ratchet-baseline.ts";
import type {
  PurityBaseline,
  PurityBaselineEntry,
  PurityRatchetDelta,
  PurityRatchetDeltaSet,
} from "./purity-ratchet-contracts.ts";

export function summarizeViolations(
  violations: readonly PurityViolation[],
): readonly PurityBaselineEntry[] {
  const counts = new Map<string, PurityBaselineEntry>();
  for (const violation of violations) {
    const identity = entryIdentity({ file: violation.file, rule: violation.rule });
    const existing = counts.get(identity);
    if (existing === undefined) {
      counts.set(identity, { file: violation.file, rule: violation.rule, count: 1 });
    } else {
      counts.set(identity, { ...existing, count: existing.count + 1 });
    }
  }
  return [...counts.values()].sort(compareEntries);
}

function index(entries: readonly PurityBaselineEntry[]): Map<string, PurityBaselineEntry> {
  const findings = new Map<string, PurityBaselineEntry>();
  for (const entry of entries) {
    const identity = entryIdentity(entry);
    if (findings.has(identity)) {
      throw new Error(`Invalid purity baseline: duplicate identity ${entry.file}:${entry.rule}`);
    }
    findings.set(identity, entry);
  }
  return findings;
}

function compareDeltas(left: PurityRatchetDelta, right: PurityRatchetDelta): number {
  if (left.file < right.file) return -1;
  if (left.file > right.file) return 1;
  if (left.rule < right.rule) return -1;
  if (left.rule > right.rule) return 1;
  return 0;
}

export function comparePurityBaseline(
  baseline: PurityBaseline,
  current: readonly PurityBaselineEntry[],
): { readonly baselineDelta: PurityRatchetDeltaSet; readonly passed: boolean } {
  const expected = index(baseline.entries);
  const actual = index(current);

  const added: PurityRatchetDelta[] = [];
  const worsened: PurityRatchetDelta[] = [];
  const resolved: PurityRatchetDelta[] = [];

  for (const [identity, entry] of actual) {
    const existing = expected.get(identity);
    if (existing === undefined) {
      added.push({ file: entry.file, rule: entry.rule, observed: entry.count, baseline: 0 });
    } else if (entry.count > existing.count) {
      worsened.push({
        file: entry.file,
        rule: entry.rule,
        observed: entry.count,
        baseline: existing.count,
      });
    }
  }

  for (const [identity, entry] of expected) {
    if (!actual.has(identity)) {
      resolved.push({ file: entry.file, rule: entry.rule, observed: 0, baseline: entry.count });
    }
  }

  return {
    baselineDelta: {
      added: added.sort(compareDeltas),
      worsened: worsened.sort(compareDeltas),
      resolved: resolved.sort(compareDeltas),
    },
    passed: added.length === 0 && worsened.length === 0,
  };
}
