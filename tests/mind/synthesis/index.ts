/**
 * @file index.ts
 * Facade for Mind Synthesis domain
 */

export { SYNTHESIS_SMART_TASKS_SUITES } from "./smart-tasks/index.ts";
export { SYNTHESIS_DISCOVERY_SUITES } from "./discovery/index.ts";
export { SYNTHESIS_SOURCES_SUITES } from "./sources/index.ts";

export const SYNTHESIS_DOMAINS = [
  "smart-tasks",
  "discovery",
  "sources",
] as const;
