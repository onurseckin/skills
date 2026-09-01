/**
 * @file index.ts
 * Facade for Configuration Loader test suite.
 */

export const configLoaderSuite = [
  "harness-config-precedence",
  "harness-config-provenance-precedence",
  "harness-config-resolution",
  "inspect",
  "resolved-config",
] as const;
