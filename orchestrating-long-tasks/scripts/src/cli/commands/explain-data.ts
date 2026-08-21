import { PLATFORM_AND_LOCK_ENTRIES } from "./explain-data-platform.ts";
import { PATH_SAFETY_AND_INTEGRITY_ENTRIES } from "./explain-data-path-integrity.ts";
import { INVALID_STATE_AND_ARGUMENT_ENTRIES } from "./explain-data-state-argument.ts";
import type { ExplainEntry } from "./explain-data-types.ts";

export type { ExplainCause, ExplainEntry, ExplainExample } from "./explain-data-types.ts";

export const EXPLAIN_ENTRIES: readonly ExplainEntry[] = [
  ...PATH_SAFETY_AND_INTEGRITY_ENTRIES,
  ...INVALID_STATE_AND_ARGUMENT_ENTRIES,
  ...PLATFORM_AND_LOCK_ENTRIES,
];
