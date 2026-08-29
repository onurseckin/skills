import {
  ERROR_CLASS_PROCESS_HANG,
  ERROR_CLASS_STALL_TIMEOUT,
  EXIT_STATUS_SIGKILL_TIMEOUT,
} from "./constants.ts";
import type { ProcessTimeoutWatchdog } from "./runner.ts";
import type { BunSubprocess, WatchdogMonitorResult } from "./types.ts";

export async function monitorSubprocessLoop(
  watchdog: ProcessTimeoutWatchdog,
  subprocess: BunSubprocess,
  onHeartbeat?: () => void,
  signal?: AbortSignal,
): Promise<WatchdogMonitorResult> {
  const pollInterval = Math.min(
    50,
    Math.max(
      5,
      Math.floor(
        Math.min(
          watchdog.wallTimeoutMs,
          watchdog.idleTimeoutMs,
          watchdog.stallProgressThresholdMs,
        ) / 4,
      ),
    ),
  );

  const exitedPromise = subprocess.exited.then((code) => ({
    kind: "exit" as const,
    code,
  }));

  const interruptedPromise = new Promise<{ kind: "interrupted" }>((resolve) => {
    if (signal?.aborted) {
      resolve({ kind: "interrupted" });
    } else {
      signal?.addEventListener("abort", () => resolve({ kind: "interrupted" }), {
        once: true,
      });
    }
  });

  const sleep = (ms: number) =>
    new Promise<"tick">((resolve) => setTimeout(() => resolve("tick"), ms));

  while (true) {
    const step = await Promise.race([exitedPromise, interruptedPromise, sleep(pollInterval)]);

    if (step !== "tick" && step.kind === "exit") {
      return {
        outcome: "exit",
        exitCode: step.code,
        signalsSent: watchdog.getSignalsSent(),
      };
    }

    if (step !== "tick" && step.kind === "interrupted") {
      await watchdog.enforceSigkill();
      const payload = watchdog.synthesizeFailurePayload({
        exitStatus: EXIT_STATUS_SIGKILL_TIMEOUT,
        errorClassification: ERROR_CLASS_PROCESS_HANG,
        reason: "Subprocess execution interrupted by host abort signal",
      });
      return {
        outcome: "interrupted",
        exitCode: null,
        failurePayload: payload,
        signalsSent: watchdog.getSignalsSent(),
      };
    }

    watchdog.emitHeartbeat();
    onHeartbeat?.();

    const liveness = watchdog.checkLiveness();
    if (!liveness.alive) {
      await watchdog.enforceSigkill();
      const payload = watchdog.synthesizeFailurePayload({
        exitStatus: EXIT_STATUS_SIGKILL_TIMEOUT,
        errorClassification: liveness.errorClassification ?? ERROR_CLASS_STALL_TIMEOUT,
        reason:
          typeof liveness.reason === "string"
            ? liveness.reason
            : "Process execution timeout / stall detected by watchdog",
      });

      return {
        outcome: liveness.timeoutKind === "stall" ? "stall" : "timeout",
        exitCode: null,
        failurePayload: payload,
        signalsSent: watchdog.getSignalsSent(),
      };
    }
  }
}
