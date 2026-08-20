import type { AttemptResult } from "./types.ts";

export class AttemptExecutionError extends Error {
  public constructor(
    public readonly original: unknown,
    public readonly result: AttemptResult,
  ) {
    // Every production path fills integrity_failure via boundedEvidenceError before this runs;
    // "unknown" names the gap honestly if a future caller ever constructs a result without it.
    super(result.record.integrity_failure ?? "unknown");
    this.name = "AttemptExecutionError";
  }
}
