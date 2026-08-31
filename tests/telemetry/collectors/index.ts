/**
 * @file index.ts
 * Facade for Telemetry Collectors test suite.
 */

export const collectorsSuite = [
  "base-collector",
  "claude-collector",
  "collector-concurrency",
  "collectors-antigravity",
  "collectors-cache-isolation",
  "collectors-cursor",
  "collectors-host-detection",
  "collectors-probing",
  "openai-collector",
] as const;
