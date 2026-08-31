/**
 * @file index.ts
 * Facade for Mind Feedback domain
 */

export { FEEDBACK_QUEUE_SUITES } from "./queue/index.ts";
export { FEEDBACK_ARCHIVAL_SUITES } from "./archival/index.ts";
export { FEEDBACK_MEMORY_SUITES } from "./memory/index.ts";
export { FEEDBACK_ADMISSION_SUITES } from "./admission/index.ts";

export const FEEDBACK_DOMAINS = [
  "queue",
  "archival",
  "memory",
  "admission",
] as const;
