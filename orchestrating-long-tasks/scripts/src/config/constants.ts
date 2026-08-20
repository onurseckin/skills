export const MANIFEST_SCHEMA = "harness.manifest" as const;
export const STATE_SCHEMA = "harness.state" as const;
export const EVENT_SCHEMA = "harness.event" as const;
export const FORMAT_VERSION = 1 as const;
export const RUNTIME_VERSION = "0.1.0" as const;
export const MINIMUM_BUN_VERSION = "1.3.0" as const;
export const MAX_JSON_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_EVENT_BYTES = 64 * 1024 * 1024;
export const MAX_PRODUCTION_LINES = 200;
export const MAX_TEST_LINES = 250;
export const MIN_ADVERSARIAL_REJECTIONS = 1;
export const MIN_ADVERSARIAL_PROBES = 1;
export const MAX_REPAIR_ROUNDS = 6;
/**
 * A tripwire, not a structural limit: termination is guaranteed by the proper-subset rule on write
 * scopes, so depth only measures how far a task has been subdivided. Crossing it means the original
 * scoping was wrong and a human should look, which is why it is set well above ordinary practice.
 */
export const MAX_BRANCH_DEPTH = 5;

/** Total grants a run may issue at any depth. Assumed, not measured; revisit against real runs. */
export const MAX_AGENTS = 100;
