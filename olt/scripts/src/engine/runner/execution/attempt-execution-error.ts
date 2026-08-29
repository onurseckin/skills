import type { AttemptResult } from "../types/types";

export class AttemptExecutionError extends Error {
  public constructor(
    public readonly original: unknown,
    public readonly result: AttemptResult,
  ) {
    super(result.record.integrity_failure ?? "unknown");
    this.name = "AttemptExecutionError";
  }
}
