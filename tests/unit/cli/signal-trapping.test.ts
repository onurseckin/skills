import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  clearShutdownHooks,
  formatCliError,
  getShutdownHookCount,
  getSignalTrapState,
  mapErrorToExitCode,
  propagateCliExitCode,
  registerShutdownHook,
  runShutdownHooks,
  setupSignalTraps,
  ShutdownRegistry,
  SignalTrapManager,
  teardownSignalTraps,
  withSignalTrap,
} from "../../../olt/scripts/src/cli/signals/index.ts";

describe("CLI Signal Trapping, Shutdown Hooks & Error Propagation", () => {
  beforeEach(() => {
    teardownSignalTraps();
    clearShutdownHooks();
    ShutdownRegistry.resetInstance();
    SignalTrapManager.resetInstance();
  });

  afterEach(() => {
    teardownSignalTraps();
    clearShutdownHooks();
    ShutdownRegistry.resetInstance();
    SignalTrapManager.resetInstance();
  });

  describe("ShutdownRegistry", () => {
    it("registers and counts shutdown hooks", () => {
      expect(getShutdownHookCount()).toBe(0);
      const unregister1 = registerShutdownHook(() => {});
      const unregister2 = registerShutdownHook(() => {});
      expect(getShutdownHookCount()).toBe(2);

      unregister1();
      expect(getShutdownHookCount()).toBe(1);

      unregister2();
      expect(getShutdownHookCount()).toBe(0);
    });

    it("executes hooks in descending priority order", async () => {
      const executionOrder: string[] = [];

      registerShutdownHook(() => {
        executionOrder.push("low-priority");
      }, 10);

      registerShutdownHook(() => {
        executionOrder.push("high-priority");
      }, 100);

      registerShutdownHook(() => {
        executionOrder.push("medium-priority");
      }, 50);

      await runShutdownHooks("SIGTERM");

      expect(executionOrder).toEqual(["high-priority", "medium-priority", "low-priority"]);
    });

    it("resiliently swallows errors thrown in individual shutdown hooks", async () => {
      const logs: string[] = [];

      registerShutdownHook(() => {
        throw new Error("Faulty hook failure");
      }, 10);

      registerShutdownHook(() => {
        logs.push("survived");
      }, 5);

      await runShutdownHooks("SIGINT");
      expect(logs).toEqual(["survived"]);
    });
  });

  describe("SignalTrapManager", () => {
    it("sets up and tears down process signal listeners", () => {
      expect(getSignalTrapState().active).toBe(false);

      const teardown = setupSignalTraps({ exitOnSignal: false });
      expect(getSignalTrapState().active).toBe(true);
      expect(getSignalTrapState().trappedSignals).toContain("SIGINT");
      expect(getSignalTrapState().trappedSignals).toContain("SIGTERM");

      teardown();
      expect(getSignalTrapState().active).toBe(false);
    });

    it("handles signal and invokes shutdown hooks without terminating when exitOnSignal is false", async () => {
      let cleanedUp = false;
      registerShutdownHook(() => {
        cleanedUp = true;
      });

      const manager = SignalTrapManager.getInstance();
      manager.setup({ exitOnSignal: false });

      const exitCode = await manager.handleSignal("SIGINT", false);
      expect(exitCode).toBe(130);
      expect(cleanedUp).toBe(true);
    });

    it("prevents double-execution on duplicate signal invocations", async () => {
      let callCount = 0;
      registerShutdownHook(() => {
        callCount += 1;
      });

      const manager = SignalTrapManager.getInstance();
      manager.setup({ exitOnSignal: false });

      await manager.handleSignal("SIGTERM", false);
      await manager.handleSignal("SIGTERM", false);

      expect(callCount).toBe(1);
    });

    it("wraps asynchronous actions with scoped signal trap and auto-cleanup", async () => {
      let actionExecuted = false;
      let hookExecuted = false;

      const result = await withSignalTrap(
        async () => {
          actionExecuted = true;
          return "success-value";
        },
        () => {
          hookExecuted = true;
        },
      );

      expect(result).toBe("success-value");
      expect(actionExecuted).toBe(true);
      expect(getSignalTrapState().active).toBe(false);
      expect(getShutdownHookCount()).toBe(0);
    });
  });

  describe("Error Propagation & Exit Code Mapping", () => {
    it("maps HarnessError exit codes accurately", () => {
      const lockError = new HarnessError("LOCK_TIMEOUT", "Timeout lock");
      expect(mapErrorToExitCode(lockError)).toBe(4);

      const invalidArg = new HarnessError("INVALID_ARGUMENT", "Bad arg");
      expect(mapErrorToExitCode(invalidArg)).toBe(3);

      const notImpl = new HarnessError("NOT_IMPLEMENTED", "Not yet");
      expect(mapErrorToExitCode(notImpl)).toBe(70);
    });

    it("maps generic and structured errors to appropriate exit codes", () => {
      expect(mapErrorToExitCode({ exitCode: 2 })).toBe(2);
      expect(mapErrorToExitCode({ code: "INVALID_ARGUMENT" })).toBe(2);
      expect(mapErrorToExitCode({ code: "PERMISSION_DENIED" })).toBe(3);
      expect(mapErrorToExitCode(new Error("Generic failure"))).toBe(70);
      expect(mapErrorToExitCode("String error")).toBe(70);
    });

    it("formats error messages as JSON and markdown", () => {
      const harnessErr = new HarnessError("INTEGRITY", "Hash mismatch", [], 3, "Re-run integrity check");

      const mdOutput = formatCliError(harnessErr, { json: false });
      expect(mdOutput).toContain("**Error (INTEGRITY)**: Hash mismatch");
      expect(mdOutput).toContain("> **Fix**: Re-run integrity check");

      const jsonOutput = formatCliError(harnessErr, { json: true });
      const parsed = JSON.parse(jsonOutput) as { ok: boolean; error: { code: string; message: string } };
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe("INTEGRITY");
      expect(parsed.error.message).toBe("Hash mismatch");
    });

    it("propagates exit code to process.exitCode", () => {
      const initialCode = process.exitCode;
      try {
        const code = propagateCliExitCode(new HarnessError("LOCK_TIMEOUT", "timed out"));
        expect(code).toBe(4);
        expect(process.exitCode).toBe(4);
      } finally {
        process.exitCode = initialCode ?? 0;
      }
    });
  });
});
