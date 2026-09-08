import { auditTestPuritySync } from "../guardrails/index.ts";
import { entryIdentity, loadPurityBaseline } from "./purity-ratchet-baseline.ts";
import { comparePurityBaseline, summarizeViolations } from "./purity-ratchet-compare.ts";
import { DEFAULT_PURITY_BASELINE } from "../purity-baseline/index.ts";
import type {
  PurityAuditSnapshot,
  PurityBaselineEntry,
  PurityRatchetOptions,
  PurityRatchetReport,
} from "./purity-ratchet-contracts.ts";

export { DEFAULT_PURITY_BASELINE } from "../purity-baseline/index.ts";

export function carryOverReasons(
  current: readonly PurityBaselineEntry[],
  baselineEntries: readonly PurityBaselineEntry[],
): readonly PurityBaselineEntry[] {
  const byIdentity = new Map<string, PurityBaselineEntry>();
  for (const entry of baselineEntries) {
    byIdentity.set(entryIdentity(entry), entry);
  }
  return current.map((entry) => {
    const active = byIdentity.get(entryIdentity(entry));
    if (active?.reason !== undefined) {
      return { ...entry, reason: active.reason };
    }
    return entry;
  });
}

function runAudit(options: PurityRatchetOptions): PurityAuditSnapshot {
  if (options.audit !== undefined) return options.audit();
  return auditTestPuritySync({ all: true });
}

export async function checkPurityRatchet(
  options: PurityRatchetOptions,
): Promise<PurityRatchetReport> {
  const snapshot = runAudit(options);
  const current = summarizeViolations(snapshot.violations);
  const totalViolations = snapshot.violations.length;

  const baselinePath =
    options.baselinePath !== undefined ? options.baselinePath : DEFAULT_PURITY_BASELINE;

  if (options.mode === "strict") {
    let resolvedCurrent = current;
    try {
      const baseline = await loadPurityBaseline(options.repoRoot, baselinePath);
      resolvedCurrent = carryOverReasons(current, baseline.entries);
    } catch {}
    return {
      mode: options.mode,
      scannedFiles: snapshot.scannedFiles,
      totalViolations,
      current: resolvedCurrent,
      baselineDelta: { added: [], worsened: [], resolved: [] },
      passed: totalViolations === 0,
    };
  }

  const baseline = await loadPurityBaseline(options.repoRoot, baselinePath);
  const currentWithReasons = carryOverReasons(current, baseline.entries);
  const comparison = comparePurityBaseline(baseline, currentWithReasons);

  return {
    mode: options.mode,
    scannedFiles: snapshot.scannedFiles,
    totalViolations,
    current: currentWithReasons,
    ...comparison,
  };
}
