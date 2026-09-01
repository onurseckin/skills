export { RUNTIME_COMMANDS_SUITES } from "./commands/index.ts";
export { RUNTIME_WAKE_SUITES } from "./wake/index.ts";
export { RUNTIME_SH_SUITES } from "./sh/index.ts";
export const ASSEMBLY_RUNTIME_SUITES = [
  "commands",
  "wake",
  "sh",
  "mind-observe",
  "liveness",
  "watchdog-manager",
  "concurrency-auditor",
  "profiles",
  "no-legacy-capsules",
] as const;
