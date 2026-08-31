/**
 * @file index.ts
 * Facade for Capture Configuration & Persona Registry test suites
 */

export const CAPTURE_CONFIG_SUITES = [
  "capture-config",
  "config-loader",
  "persona-registry-core",
  "persona-registry-resolution",
  "cli-commands",
  "docker-health",
] as const;
