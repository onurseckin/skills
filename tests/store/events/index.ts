/**
 * @file index.ts
 * Facade for Store Events subpackage
 */

export const STORE_EVENTS_SUITES = [
  "event-lines",
  "event-stream-validation",
  "transaction",
  "event-append-checkpoints",
  "event-validation",
  "event-stream",
  "event-append-recovery",
] as const;
