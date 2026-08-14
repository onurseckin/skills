import type { JsonValue } from "../contracts/json.ts";
import type { ErrorCode } from "./codes.ts";

export class HarnessError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly issues: readonly JsonValue[] = [],
    public readonly exitCode = code === "LOCK_TIMEOUT" ? 4 : code === "NOT_IMPLEMENTED" ? 70 : 3,
  ) {
    super(message);
    this.name = "HarnessError";
  }
}
