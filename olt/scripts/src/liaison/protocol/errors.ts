import type {
  ClassifiedError,
  ErrorCategory,
  ErrorClassification,
  RetryAttemptRecord,
  RetryExecutionResult,
  RetryPolicy,
} from "./types.ts";

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_attempts: 4,
  initial_delay_ms: 50,
  max_delay_ms: 1000,
  backoff_factor: 2.0,
  jitter: true,
};

function extractErrorInfo(error: unknown): { message: string; code: string; name: string } {
  if (typeof error === "string") {
    return { message: error, code: "", name: "Error" };
  }
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;
    const message = typeof obj.message === "string" ? obj.message : String(error);
    const code = typeof obj.code === "string" ? obj.code : "";
    const name = typeof obj.name === "string" ? obj.name : "Error";
    return { message, code, name };
  }
  return { message: String(error), code: "", name: "Error" };
}

export function classifyError(error: unknown): ClassifiedError {
  const { message, code, name } = extractErrorInfo(error);
  const text = `${code} ${name} ${message}`.toUpperCase();

  // Signature violation check (always fatal)
  if (
    text.includes("SIGNATURE_INVALID") ||
    text.includes("HMAC_VERIFICATION_FAILED") ||
    text.includes("BAD_SIGNATURE") ||
    text.includes("SIGNATURE_VIOLATION") ||
    text.includes("CORRUPT_ENVELOPE")
  ) {
    return {
      classification: "FATAL",
      category: "SIGNATURE_VIOLATION",
      message,
      original_error: error,
      retryable: false,
    };
  }

  // Permissions / Access check (fatal)
  if (
    text.includes("PERMISSION_DENIED") ||
    text.includes("EACCES") ||
    text.includes("FORBIDDEN") ||
    text.includes("HTTP 403") ||
    text.includes("STATUS 403")
  ) {
    return {
      classification: "FATAL",
      category: "PERMISSION_DENIED",
      message,
      original_error: error,
      retryable: false,
    };
  }

  // Write scope violation (fatal)
  if (
    text.includes("SCOPE_VIOLATION") ||
    text.includes("OUT_OF_SCOPE") ||
    text.includes("WRITE_SCOPE_VIOLATION") ||
    text.includes("UNAUTHORIZED_PATH")
  ) {
    return {
      classification: "FATAL",
      category: "WRITE_SCOPE_VIOLATION",
      message,
      original_error: error,
      retryable: false,
    };
  }

  // Contract violation (fatal)
  if (
    text.includes("CONTRACT_VIOLATION") ||
    text.includes("UNRECOGNIZED_VOCABULARY") ||
    text.includes("MALFORMED_PAYLOAD") ||
    text.includes("SCHEMA_MISMATCH")
  ) {
    return {
      classification: "FATAL",
      category: "CONTRACT_VIOLATION",
      message,
      original_error: error,
      retryable: false,
    };
  }

  // Transient authentication failure / Identity race under concurrency (retryable per forensics 2.7)
  if (
    text.includes("AUTHENTICATION_FAILURE") ||
    text.includes("IDENTITY_RACE") ||
    text.includes("AUTH_RACE") ||
    text.includes("CONCURRENCY_CONFLICT") ||
    text.includes("TOKEN_EXPIRED_REFRESHABLE")
  ) {
    return {
      classification: "RETRYABLE",
      category: "TRANSIENT_AUTH_RACE",
      message,
      original_error: error,
      retryable: true,
    };
  }

  // Lock contention (retryable)
  if (
    text.includes("LOCK_CONTENTION") ||
    text.includes("LOCK_TIMEOUT") ||
    text.includes("EBUSY") ||
    text.includes("EAGAIN") ||
    text.includes("FILE_LOCKED") ||
    text.includes("RESOURCE_LOCKED")
  ) {
    return {
      classification: "RETRYABLE",
      category: "LOCK_CONTENTION",
      message,
      original_error: error,
      retryable: true,
    };
  }

  // Network / Transport timeout (retryable)
  if (
    text.includes("ETIMEDOUT") ||
    text.includes("ECONNRESET") ||
    text.includes("ECONNREFUSED") ||
    text.includes("NETWORK_TIMEOUT") ||
    text.includes("SOCKET_CLOSED") ||
    text.includes("FETCH_FAILED")
  ) {
    return {
      classification: "RETRYABLE",
      category: "NETWORK_TIMEOUT",
      message,
      original_error: error,
      retryable: true,
    };
  }

  // Rate limiting (retryable)
  if (text.includes("RATE_LIMITED") || text.includes("TOO_MANY_REQUESTS") || text.includes("429")) {
    return {
      classification: "RETRYABLE",
      category: "RATE_LIMITED",
      message,
      original_error: error,
      retryable: true,
    };
  }

  // Daemon initializing (retryable)
  if (
    text.includes("DAEMON_INITIALIZING") ||
    text.includes("NOT_READY") ||
    text.includes("INITIALIZING")
  ) {
    return {
      classification: "RETRYABLE",
      category: "DAEMON_INITIALIZING",
      message,
      original_error: error,
      retryable: true,
    };
  }

  // Fallback check for general transient indicators
  const isTransient =
    text.includes("TRANSIENT") || text.includes("TEMPORARY") || text.includes("TIMEOUT");

  return {
    classification: isTransient ? "RETRYABLE" : "FATAL",
    category: isTransient ? "NETWORK_TIMEOUT" : "UNKNOWN_ERROR",
    message,
    original_error: error,
    retryable: isTransient,
  };
}

export function computeRetryDelay(
  attempt: number,
  policy: RetryPolicy,
  randomFraction: number = Math.random(),
): number {
  const exponent = Math.max(0, attempt - 1);
  const rawDelay = policy.initial_delay_ms * Math.pow(policy.backoff_factor, exponent);
  const baseDelay = Math.min(policy.max_delay_ms, rawDelay);

  if (!policy.jitter) {
    return Math.round(baseDelay);
  }

  // Jitter between 0% and 25% of base delay
  const jitterAmount = baseDelay * 0.25 * randomFraction;
  return Math.round(baseDelay + jitterAmount);
}

export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  customPolicy?: Partial<RetryPolicy>,
  sleeper: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<RetryExecutionResult<T>> {
  const policy: RetryPolicy = {
    ...DEFAULT_RETRY_POLICY,
    ...customPolicy,
  };

  const history: RetryAttemptRecord[] = [];

  for (let attempt = 1; attempt <= policy.max_attempts; attempt++) {
    try {
      const value = await fn();
      return {
        success: true,
        value,
        attempts: attempt,
        history,
      };
    } catch (err) {
      const classified = classifyError(err);

      if (!classified.retryable) {
        return {
          success: false,
          attempts: attempt,
          history,
          fatal_error: classified,
        };
      }

      const delayMs = computeRetryDelay(attempt, policy);
      history.push({
        attempt,
        delay_ms: delayMs,
        error: classified,
      });

      if (attempt < policy.max_attempts) {
        await sleeper(delayMs);
      }
    }
  }

  const lastAttempt = history[history.length - 1];
  return {
    success: false,
    attempts: policy.max_attempts,
    history,
    fatal_error: lastAttempt?.error,
  };
}
