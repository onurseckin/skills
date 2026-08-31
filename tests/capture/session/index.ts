/**
 * @file index.ts
 * Facade for Browser Pool, Session Authentication, and Live Runner test suites
 */

export const CAPTURE_SESSION_SUITES = [
  "browser-pool-lifecycle",
  "browser-pool-lease",
  "browser-pool-concurrency",
  "live-runner-workflow",
  "live-runner-path-resolver",
  "session-auth-resolution",
  "session-auth-tokens",
  "context-and-state-hasher",
] as const;
