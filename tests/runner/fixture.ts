/**
 * @file fixture.ts
 * Runner Domain Virtual Test Fixture Facade.
 * Provides in-memory virtual filesystem helpers and deterministic cleanup for runner suites.
 */

export {
  getRunnerVfs,
  setupVirtualRunnerFS,
  tempRoot,
  writeTree,
  cleanupTempRoots,
  cleanupVirtualRunnerFS,
} from "./command/fixture.ts";
