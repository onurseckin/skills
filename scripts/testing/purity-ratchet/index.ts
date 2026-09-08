export {
  assertInsideRepository,
  compareEntries,
  entryIdentity,
  loadPurityBaseline,
  parseBaseline,
  PURITY_BASELINE_SCHEMA,
  serializeBaseline,
} from "./purity-ratchet-baseline.ts";

export { comparePurityBaseline, summarizeViolations } from "./purity-ratchet-compare.ts";

export type {
  PurityAuditPort,
  PurityAuditSnapshot,
  PurityBaseline,
  PurityBaselineEntry,
  PurityRatchetDelta,
  PurityRatchetDeltaSet,
  PurityRatchetFormat,
  PurityRatchetMode,
  PurityRatchetOptions,
  PurityRatchetReport,
} from "./purity-ratchet-contracts.ts";

export {
  carryOverReasons,
  checkPurityRatchet,
  DEFAULT_PURITY_BASELINE,
} from "./purity-ratchet-engine.ts";

export {
  renderJsonlBaseline,
  renderJsonReport,
  renderMarkdownReport,
} from "./purity-ratchet-report.ts";
