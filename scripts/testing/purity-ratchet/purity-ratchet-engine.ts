import { auditTestPuritySync } from "../guardrails/index.ts";
import { loadPurityBaseline } from "./purity-ratchet-baseline.ts";
import { comparePurityBaseline, summarizeViolations } from "./purity-ratchet-compare.ts";
import { DEFAULT_PURITY_BASELINE } from "../purity-baseline/index.ts";
import type {
  PurityAuditSnapshot,
  PurityRatchetOptions,
  PurityRatchetReport,
} from "./purity-ratchet-contracts.ts";

export { DEFAULT_PURITY_BASELINE } from "../purity-baseline/index.ts";

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

  if (options.mode === "strict") {
    return {
      mode: options.mode,
      scannedFiles: snapshot.scannedFiles,
      totalViolations,
      current,
      baselineDelta: { added: [], worsened: [], resolved: [] },
      passed: totalViolations === 0,
    };
  }

  const baselinePath =
    options.baselinePath !== undefined ? options.baselinePath : DEFAULT_PURITY_BASELINE;
  const baseline = await loadPurityBaseline(options.repoRoot, baselinePath);
  const comparison = comparePurityBaseline(baseline, current);

  return {
    mode: options.mode,
    scannedFiles: snapshot.scannedFiles,
    totalViolations,
    current,
    ...comparison,
  };
}
