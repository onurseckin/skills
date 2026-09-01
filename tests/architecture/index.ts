/**
 * @file index.ts
 * Root Facade for Architecture domain
 */

export { ARCHITECTURE_FIXTURES_SUITES, scratchRoot, createSandboxDir } from "./fixtures/index.ts";
export { ARCHITECTURE_BOUNDARIES_SUITES } from "./boundaries/index.ts";
export { ARCHITECTURE_CONTRACTS_SUITES } from "./contracts/index.ts";
export { ARCHITECTURE_VENDOR_SUITES } from "./vendor/index.ts";

export const ARCHITECTURE_DOMAINS = ["fixtures", "boundaries", "contracts", "vendor"] as const;
