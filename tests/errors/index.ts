/**
 * @file index.ts
 * Root Facade for Errors domain
 */

export { ERROR_FIXTURES_SUITES, scratchRoot, createSandboxDir } from "./fixtures/index.ts";
export { ERROR_CLASSES_SUITES } from "./classes/index.ts";
export { ERROR_HANDLERS_SUITES } from "./handlers/index.ts";
export { ERROR_FORMATTERS_SUITES } from "./formatters/index.ts";

export const ERROR_DOMAINS = ["fixtures", "classes", "handlers", "formatters"] as const;
