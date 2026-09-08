export const ACCEPTED_ENGINE_WIRING_DEFECTS: readonly string[] = [
  "auditPolicyDoctor|exported-but-never-invoked",
  "checkCommandLockIntegrity|exported-but-never-invoked",
  "checkCompanionAuditorsDoctor|exported-but-never-invoked",
  "checkEpistemicConfidence|exported-but-never-invoked",
  "checkMailboxDiskActivity|exported-but-never-invoked",
  "checkQuotaHealth|exported-but-never-invoked",
];

export const ENGINE_WIRING_KNOWN_LIMITS: readonly string[] = [
  "Only object literal call arguments are decidable. A spread, a forwarded variable or any expression built at runtime is treated as real input, so an engine wired that way is never reported.",
  'Only [], {} and undefined count as empty literals. "", 0, false and null are observable values that engines legitimately branch on, so they are treated as real input.',
  "'passed but never read' needs a decidable read set. An engine that hands its whole options object to a helper is excluded, because the helper may read any property.",
  "Inertness caused by runtime values is invisible here. An engine that really acquires input but cannot use it - checkQuotaHealth resolves no host at zero arguments, so its telemetry probe matches nothing and it always emits QUOTA_UNKNOWN_UNMEASURED - is reported as wired. Deciding that needs interprocedural constant propagation and branch feasibility, which this guard does not attempt.",
];
