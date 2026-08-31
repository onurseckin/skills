/**
 * @file index.ts
 * Root Facade for Bootstrap domain
 */

export { BOOTSTRAP_FIXTURES_SUITES, scratchRoot, createSandboxDir } from "./fixtures/index.ts";
export { BOOTSTRAP_RUNTIME_SUITES } from "./runtime/index.ts";
export { BOOTSTRAP_ENV_SUITES } from "./env/index.ts";
export { BOOTSTRAP_VERIFICATION_SUITES } from "./verification/index.ts";

export const BOOTSTRAP_DOMAINS = [
  "fixtures",
  "runtime",
  "env",
  "verification",
] as const;
