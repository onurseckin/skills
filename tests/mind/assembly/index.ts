/**
 * @file index.ts
 * Facade for Mind Assembly domain
 */

export { ASSEMBLY_INIT_SUITES } from "./init/index.ts";
export { ASSEMBLY_PULSE_SUITES } from "./pulse/index.ts";
export { ASSEMBLY_LIFECYCLE_SUITES } from "./lifecycle/index.ts";
export { ASSEMBLY_RUNTIME_SUITES } from "./runtime/index.ts";

export const ASSEMBLY_DOMAINS = ["init", "pulse", "lifecycle", "runtime"] as const;
