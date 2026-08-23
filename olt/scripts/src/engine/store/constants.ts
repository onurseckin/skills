export {
  EVENT_SCHEMA,
  FORMAT_VERSION,
  MANIFEST_SCHEMA,
  RUNTIME_VERSION,
  STATE_SCHEMA,
} from "../../config/constants.ts";
export const RUN_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const CAPSULE_ID_PATTERN = /^[0-9a-f]{32}$/;
export const RESERVED_STATE_KEYS = [
  "schema",
  "version",
  "revision",
  "event_sequence",
  "event_head",
] as const;

export const CHECKPOINT_INTERVAL = 20;

export function isCheckpointSequence(sequence: number): boolean {
  return sequence % CHECKPOINT_INTERVAL === 0;
}

export interface StoreLimits {
  maxJsonBytes?: number;
  maxEventBytes?: number;
  maxEventLogBytes?: number;
  maxEventCount?: number;
  maxDepth?: number;
}

export function limits(options: StoreLimits = {}): Required<StoreLimits> {
  return {
    maxJsonBytes: options.maxJsonBytes ?? 64 * 1024 * 1024,
    maxEventBytes: options.maxEventBytes ?? 64 * 1024 * 1024,
    maxEventLogBytes: options.maxEventLogBytes ?? 256 * 1024 * 1024,
    maxEventCount: options.maxEventCount ?? 100_000,
    maxDepth: options.maxDepth ?? 128,
  };
}
