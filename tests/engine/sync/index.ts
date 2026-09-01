export {
  createTestDomainCommit,
  createTestDomainLedger,
  createTestProgressSnapshot,
} from "./fixture.ts";

export const SYNC_SUITES = [
  "domain-sync-conflicts",
  "domain-sync-ledger",
  "domain-sync-audit",
  "live-push-badges",
  "live-push-diff",
  "live-push-stagnation",
] as const;
