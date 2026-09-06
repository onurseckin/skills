import { describe, expect, it } from "bun:test";
import {
  DEFAULT_RETRY_POLICY,
  classifyError,
  computeRetryDelay,
  executeWithRetry,
} from "../../../olt/scripts/src/liaison/protocol/errors.ts";
import type { RetryPolicy } from "../../../olt/scripts/src/liaison/protocol/types.ts";

describe("Error recovery engine & retry classification", () => {
  describe("Error classification (Retryable vs Fatal)", () => {
    it("classifies transient authentication failure / identity race as RETRYABLE (Forensics §2.7)", () => {
      // Forensics 2.7: msg:recv --actor claude-planner rejected with AUTHENTICATION_FAILURE
      const authErr = new Error("AUTHENTICATION_FAILURE: caller resolved as coordinator_wave-41");
      const classified = classifyError(authErr);
      expect(classified.classification).toBe("RETRYABLE");
      expect(classified.category).toBe("TRANSIENT_AUTH_RACE");
      expect(classified.retryable).toBe(true);

      const identityRaceErr = new Error("IDENTITY_RACE: concurrent caller binding mismatch");
      expect(classifyError(identityRaceErr).classification).toBe("RETRYABLE");
    });

    it("classifies lock contention and busy resources as RETRYABLE", () => {
      const lockErr = new Error("LOCK_CONTENTION: mailbox lock held by pid 4512");
      const classified = classifyError(lockErr);
      expect(classified.classification).toBe("RETRYABLE");
      expect(classified.category).toBe("LOCK_CONTENTION");

      const ebusyErr = { code: "EBUSY", message: "resource busy or locked" };
      expect(classifyError(ebusyErr).classification).toBe("RETRYABLE");
    });

    it("classifies network timeouts and daemon initialization as RETRYABLE", () => {
      const timeoutErr = new Error("ETIMEDOUT: liaison endpoint request timed out");
      expect(classifyError(timeoutErr).classification).toBe("RETRYABLE");
      expect(classifyError(timeoutErr).category).toBe("NETWORK_TIMEOUT");

      const initErr = new Error("DAEMON_INITIALIZING: cache warming in progress");
      expect(classifyError(initErr).classification).toBe("RETRYABLE");
      expect(classifyError(initErr).category).toBe("DAEMON_INITIALIZING");

      const rateLimitErr = new Error("RATE_LIMITED: 429 Too Many Requests");
      expect(classifyError(rateLimitErr).classification).toBe("RETRYABLE");
      expect(classifyError(rateLimitErr).category).toBe("RATE_LIMITED");
    });

    it("classifies HMAC signature violations as FATAL", () => {
      const sigErr = new Error("HMAC_VERIFICATION_FAILED: signature mismatch for envelope 123");
      const classified = classifyError(sigErr);
      expect(classified.classification).toBe("FATAL");
      expect(classified.category).toBe("SIGNATURE_VIOLATION");
      expect(classified.retryable).toBe(false);

      const badSig = new Error("SIGNATURE_INVALID: tampering detected");
      expect(classifyError(badSig).classification).toBe("FATAL");
    });

    it("classifies permission denial, scope violations, and contract violations as FATAL", () => {
      const permErr = new Error("PERMISSION_DENIED: caller lacks write permission");
      expect(classifyError(permErr).classification).toBe("FATAL");
      expect(classifyError(permErr).category).toBe("PERMISSION_DENIED");

      const scopeErr = new Error("SCOPE_VIOLATION: path is not within leased write scope");
      expect(classifyError(scopeErr).classification).toBe("FATAL");
      expect(classifyError(scopeErr).category).toBe("WRITE_SCOPE_VIOLATION");

      const contractErr = new Error("CONTRACT_VIOLATION: payload missing required field");
      expect(classifyError(contractErr).classification).toBe("FATAL");
      expect(classifyError(contractErr).category).toBe("CONTRACT_VIOLATION");
    });
  });

  describe("Retry delay and backoff computation", () => {
    const policy: RetryPolicy = {
      max_attempts: 5,
      initial_delay_ms: 100,
      max_delay_ms: 1000,
      backoff_factor: 2,
      jitter: false,
    };

    it("computes exponential backoff accurately without jitter", () => {
      expect(computeRetryDelay(1, policy)).toBe(100);
      expect(computeRetryDelay(2, policy)).toBe(200);
      expect(computeRetryDelay(3, policy)).toBe(400);
      expect(computeRetryDelay(4, policy)).toBe(800);
      expect(computeRetryDelay(5, policy)).toBe(1000); // capped at max_delay_ms
    });

    it("applies jitter within expected bounds", () => {
      const jitterPolicy: RetryPolicy = { ...policy, jitter: true };
      const zeroJitter = computeRetryDelay(1, jitterPolicy, 0);
      const fullJitter = computeRetryDelay(1, jitterPolicy, 1);

      expect(zeroJitter).toBe(100);
      expect(fullJitter).toBe(125); // 100 + 25% of 100
    });
  });

  describe("executeWithRetry executor", () => {
    it("returns immediately on successful execution", async () => {
      let invocations = 0;
      const result = await executeWithRetry(async () => {
        invocations++;
        return "success-value";
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe("success-value");
      expect(result.attempts).toBe(1);
      expect(invocations).toBe(1);
      expect(result.history).toHaveLength(0);
    });

    it("retries on transient retryable error and succeeds", async () => {
      let invocations = 0;
      const delays: number[] = [];
      const fakeSleeper = async (ms: number) => {
        delays.push(ms);
      };

      const result = await executeWithRetry(
        async () => {
          invocations++;
          if (invocations < 3) {
            throw new Error("AUTHENTICATION_FAILURE: transient identity race");
          }
          return "recovered";
        },
        { max_attempts: 4, initial_delay_ms: 10, jitter: false },
        fakeSleeper,
      );

      expect(result.success).toBe(true);
      expect(result.value).toBe("recovered");
      expect(result.attempts).toBe(3);
      expect(invocations).toBe(3);
      expect(delays).toHaveLength(2);
      expect(result.history).toHaveLength(2);
      expect(result.history[0].error.category).toBe("TRANSIENT_AUTH_RACE");
    });

    it("aborts immediately without retry on fatal error", async () => {
      let invocations = 0;
      const fakeSleeper = async () => {};

      const result = await executeWithRetry(
        async () => {
          invocations++;
          throw new Error("SIGNATURE_INVALID: HMAC mismatch");
        },
        DEFAULT_RETRY_POLICY,
        fakeSleeper,
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(invocations).toBe(1);
      expect(result.fatal_error?.classification).toBe("FATAL");
      expect(result.fatal_error?.category).toBe("SIGNATURE_VIOLATION");
    });

    it("exhausts retries when retryable error persists", async () => {
      let invocations = 0;
      const fakeSleeper = async () => {};

      const result = await executeWithRetry(
        async () => {
          invocations++;
          throw new Error("LOCK_CONTENTION: locked");
        },
        { max_attempts: 3, initial_delay_ms: 10 },
        fakeSleeper,
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(invocations).toBe(3);
      expect(result.history).toHaveLength(3);
      expect(result.fatal_error?.category).toBe("LOCK_CONTENTION");
    });
  });
});
