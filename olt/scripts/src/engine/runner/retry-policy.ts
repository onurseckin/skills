import type { FailureClass } from "./types.ts";

export function shouldRetry(
  failure: FailureClass | undefined,
  idempotent: boolean,
  attempt: number,
  retries: number,
): boolean {
  return (
    idempotent &&
    (failure === "network_transient" || failure === "host_interruption") &&
    attempt <= retries
  );
}
