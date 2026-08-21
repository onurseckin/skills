export const MANIFEST_SCHEMA = "harness.manifest" as const;
export const STATE_SCHEMA = "harness.state" as const;
export const EVENT_SCHEMA = "harness.event" as const;
export const FORMAT_VERSION = 1 as const;
export const RUNTIME_VERSION = "0.2.0" as const;
export const MINIMUM_BUN_VERSION = "1.3.0" as const;
export const MAX_JSON_FILE_BYTES = 64 * 1024 * 1024;
export const MIN_ADVERSARIAL_PROBES = 1;
export const MAX_REPAIR_ROUNDS = 6;
export const MAX_BRANCH_DEPTH = 5;

export const MAX_AGENTS = 100;
