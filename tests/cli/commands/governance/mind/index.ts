export { CLI_MIND_MESSAGING_SUITES } from "./messaging/index.ts";
export { CLI_MIND_PULSE_SUITES } from "./pulse/index.ts";

export const CLI_GOVERNANCE_MIND_SUITES = [
  "mind-candidate",
  "mind-command-core",
  "mind-command-edge",
  "mind-command-flags",
  "mind-events",
  "mind-ops",
] as const;
