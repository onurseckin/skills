/**
 * @file index.ts
 * Facade for tests/scenarios/ test domain
 */

export const SCENARIO_SUITES = [
  "scenario-loader.test.ts",
  "long-prompt.test.ts",
  "recovery-pressure.test.ts",
  "validator-pressure.test.ts",
] as const;

export const SCENARIO_MARKDOWN_DOCS = [
  "long-prompt.md",
  "recovery-pressure.md",
  "validator-pressure.md",
] as const;

export {
  parseScenarioMarkdown,
  computeScenarioDigest,
  type ScenarioSpec,
} from "./scenario-loader.test.ts";

export {
  setupVirtualScenariosFS,
  cleanupVirtualScenariosFS,
  scratchRoot,
  getVirtualScenariosFS,
} from "./fixture.ts";
